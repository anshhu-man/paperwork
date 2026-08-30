import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PROVIDER_ANALYSIS_KIND_V1,
  prepareModelCouncilPayloadV1,
  type ModelCouncilPayloadV1,
  type ProviderAnalysisV1,
  type ProviderIdV1,
} from '@/core/model-council/v1';

import { buildProviderRequestV1, runProviderV1 } from './providers';
import { getProviderRuntimesV1, getPublicProviderCatalogV1, type ProviderRuntimeV1 } from './registry';

const REVISION = 'revision.provider.test';

function payload(providers: readonly ProviderIdV1[] = ['openai']): ModelCouncilPayloadV1 {
  return prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION,
    sourceFingerprint: 'a'.repeat(64),
    providerTargets: providers.map((provider) => ({
      provider,
      model: `${provider}-test-model`,
      recipient: `${provider} test API`,
    })),
    segments: [{
      segmentId: 'segment.provider.test',
      page: 1,
      text: 'We offer you the role of Systems Engineer. Please sign and return this letter.',
    }],
  });
}

function analysis(): ProviderAnalysisV1 {
  return {
    kind: PROVIDER_ANALYSIS_KIND_V1,
    schemaVersion: '1.0.0',
    documentType: 'employment_offer',
    sourceRevisionId: REVISION,
    fields: {
      role: {
        value: { kind: 'text', text: 'Systems Engineer' },
        evidence: [{
          sourceRevisionId: REVISION,
          segmentId: 'segment.provider.test',
          page: 1,
          quote: 'role of Systems Engineer',
        }],
      },
      acceptanceDeadline: null,
      startDate: null,
      annualBaseSalary: null,
      workLocation: null,
      probation: null,
      actionRequired: {
        value: { kind: 'text', text: 'Sign and return this letter' },
        evidence: [{
          sourceRevisionId: REVISION,
          segmentId: 'segment.provider.test',
          page: 1,
          quote: 'sign and return this letter',
        }],
      },
    },
  };
}

function runtime(id: ProviderIdV1): ProviderRuntimeV1 {
  const base = {
    id,
    displayName: id,
    model: `${id}-test-model`,
    configured: true,
    enabled: true,
    access: id === 'ollama'
      ? 'self_hosted' as const
      : id === 'mistral'
        ? 'hosted_api_model_license_varies' as const
        : id === 'deepseek'
          ? 'open_weight_hosted_api' as const
          : 'commercial_api' as const,
    recipient: `${id} test API`,
    privacyUrl: 'https://example.com/privacy',
    disclosure: 'Synthetic test provider.',
    apiKey: id === 'ollama' ? undefined : 'server-secret',
    endpoint: id === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : `https://api.example.com/${id}`,
  };
  return base;
}

function bodyOf(request: ReturnType<typeof buildProviderRequestV1>) {
  const body = request.init.body;
  assert.equal(typeof body, 'string');
  if (typeof body !== 'string') throw new TypeError('Expected a JSON request body.');
  return JSON.parse(body) as Record<string, unknown>;
}

test('all four hosted adapters use fixed POST requests, no redirects, no tools, and provider-native schemas', () => {
  for (const provider of ['openai', 'anthropic', 'mistral', 'deepseek'] as const) {
    const request = buildProviderRequestV1(runtime(provider), payload([provider]));
    const body = bodyOf(request);
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.redirect, 'error');
    assert.equal(request.init.cache, 'no-store');
    assert.equal(request.url, runtime(provider).endpoint);
    assert.equal(JSON.stringify(body).includes('server-secret'), false);
    assert.match(JSON.stringify(body), /untrusted source data/i);
    if (provider === 'openai' || provider === 'deepseek') {
      assert.deepEqual(body.tools, []);
      assert.equal((body.text as Record<string, Record<string, unknown>>).format.type, 'json_schema');
    } else if (provider === 'anthropic') {
      assert.equal((body.output_config as Record<string, Record<string, unknown>>).format.type, 'json_schema');
    } else if (provider === 'mistral') {
      assert.deepEqual(body.tools, []);
      assert.equal((body.response_format as Record<string, unknown>).type, 'json_schema');
    }
  }
});

function envelope(provider: ProviderIdV1, output: ProviderAnalysisV1) {
  const content = JSON.stringify(output);
  if (provider === 'openai' || provider === 'deepseek') {
    return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] };
  }
  if (provider === 'anthropic') return { stop_reason: 'end_turn', content: [{ type: 'text', text: content }] };
  if (provider === 'mistral') return { choices: [{ finish_reason: 'stop', message: { content } }] };
  return { done: true, done_reason: 'stop', message: { content } };
}

test('all four hosted adapters produce the same checked PaperWork output contract', async () => {
  for (const provider of ['openai', 'anthropic', 'mistral', 'deepseek'] as const) {
    const result = await runProviderV1(runtime(provider), payload([provider]), {
      fetchImpl: async () => new Response(JSON.stringify(envelope(provider, analysis())), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      now: (() => {
        const times = ['2026-08-30T10:00:00.000Z', '2026-08-30T10:00:01.000Z'];
        return () => times.shift() ?? '2026-08-30T10:00:01.000Z';
      })(),
    });
    assert.equal(result.status, 'completed', provider);
    if (result.status === 'completed') {
      assert.equal(result.validation, 'source_quotes_checked');
      assert.equal(result.analysis.fields.role?.value.text, 'Systems Engineer');
    }
  }
});

test('adapter rejects schema-shaped output whose quote is absent from the sent passages', async () => {
  const invalid = structuredClone(analysis());
  (invalid.fields.role!.evidence[0] as { quote: string }).quote = 'role of Chief Executive Officer';
  const result = await runProviderV1(runtime('openai'), payload(['openai']), {
    fetchImpl: async () => new Response(JSON.stringify(envelope('openai', invalid))),
  });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.equal(result.issueCode, 'invalid_provider_output');
});

test('registry never exposes secrets and cannot enable provider calls in production', () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    OPENAI_API_KEY: 'do-not-expose',
    OPENAI_MODEL: 'exact-openai-model',
  };
  const development = getProviderRuntimesV1({ ...base, NODE_ENV: 'development' });
  assert.equal(development.find((provider) => provider.id === 'openai')?.enabled, true);
  assert.equal(JSON.stringify(getPublicProviderCatalogV1({ ...base })).includes('do-not-expose'), false);
  const production = getProviderRuntimesV1({ ...base, NODE_ENV: 'production' });
  assert.equal(production.find((provider) => provider.id === 'openai')?.enabled, false);
  const withoutNodeEnvironment = Object.fromEntries(
    Object.entries(base).filter(([name]) => name !== 'NODE_ENV'),
  ) as NodeJS.ProcessEnv;
  const missingEnvironment = getProviderRuntimesV1(withoutNodeEnvironment);
  assert.equal(missingEnvironment.find((provider) => provider.id === 'openai')?.enabled, false);
  const testEnvironment = getProviderRuntimesV1({ ...base, NODE_ENV: 'test' });
  assert.equal(testEnvironment.find((provider) => provider.id === 'openai')?.enabled, false);
  const mistralUs = getProviderRuntimesV1({
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    MISTRAL_API_KEY: 'mistral-secret',
    MISTRAL_MODEL: 'exact-mistral-model',
    MISTRAL_BASE_URL: 'https://api.us.mistral.ai',
  }).find((provider) => provider.id === 'mistral');
  const mistralEu = getProviderRuntimesV1({
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    MISTRAL_API_KEY: 'mistral-secret',
    MISTRAL_MODEL: 'exact-mistral-model',
    MISTRAL_BASE_URL: 'https://api.eu.mistral.ai',
  }).find((provider) => provider.id === 'mistral');
  assert.equal(mistralUs?.recipient, 'Mistral API at https://api.us.mistral.ai');
  assert.equal(mistralEu?.recipient, 'Mistral API at https://api.eu.mistral.ai');
  assert.notEqual(mistralUs?.recipient, mistralEu?.recipient);
  const ollamaBase: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    OLLAMA_MODEL: 'local-model',
  };
  const localOllama = getProviderRuntimesV1({
    ...ollamaBase,
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  }).find((provider) => provider.id === 'ollama');
  assert.equal(localOllama?.configured, true);
  assert.equal(localOllama?.recipient, 'Ollama at http://127.0.0.1:11434');
  for (const rejectedBase of [
    'https://localhost:11434',
    'http://[::1]:11434',
    'http://127.0.0.1:11434/path',
    'http://127.0.0.1:11434?query=1',
    'http://models.example:11434',
  ]) {
    const rejected = getProviderRuntimesV1({
      ...ollamaBase,
      OLLAMA_BASE_URL: rejectedBase,
    }).find((provider) => provider.id === 'ollama');
    assert.equal(rejected?.configured, false, rejectedBase);
  }
  const acknowledgementCannotEnable = getProviderRuntimesV1({
    ...base,
    NODE_ENV: 'production',
    PAPERWORK_MODEL_COUNCIL_COST_CONTROLS_READY: 'true',
  });
  assert.equal(acknowledgementCannotEnable.find((provider) => provider.id === 'openai')?.enabled, false);
});

test('truncated Mistral envelopes are rejected', async () => {
  const mistral = await runProviderV1(runtime('mistral'), payload(['mistral']), {
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(analysis()) } }] })),
  });
  assert.equal(mistral.status, 'failed');

});

test('the server gateway fails closed for Ollama without starting fetch', async () => {
  assert.throws(
    () => buildProviderRequestV1(runtime('ollama'), payload(['ollama'])),
    /browser-direct/,
  );
  let fetches = 0;
  const result = await runProviderV1(runtime('ollama'), payload(['ollama']), {
    fetchImpl: async () => {
      fetches += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(fetches, 0);
  assert.equal(result.status, 'unavailable');
});

test('an already-aborted request never starts a provider fetch', async () => {
  const controller = new AbortController();
  controller.abort('cancelled');
  let fetches = 0;
  const result = await runProviderV1(runtime('openai'), payload(['openai']), {
    signal: controller.signal,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(fetches, 0);
  assert.equal(result.status, 'unavailable');
});
