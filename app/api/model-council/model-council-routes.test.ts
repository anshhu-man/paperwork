import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
  PROVIDER_ANALYSIS_KIND_V1,
  digestModelCouncilPayloadV1,
  parseModelCouncilCatalogV1,
  parseModelCouncilResponseV1,
  prepareModelCouncilPayloadV1,
  type ProviderAnalysisV1,
} from '@/core/model-council/v1';

import { POST } from './analyze/route';
import { GET } from './catalog/route';

const REVISION = 'revision.gateway.test';
const CLEAR_PROVIDER_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  OPENAI_API_KEY: undefined,
  OPENAI_MODEL: undefined,
  ANTHROPIC_API_KEY: undefined,
  ANTHROPIC_MODEL: undefined,
  MISTRAL_API_KEY: undefined,
  MISTRAL_MODEL: undefined,
  MISTRAL_BASE_URL: undefined,
  DEEPSEEK_API_KEY: undefined,
  DEEPSEEK_MODEL: undefined,
  OLLAMA_BASE_URL: undefined,
  OLLAMA_MODEL: undefined,
};

function validAnalysis(): ProviderAnalysisV1 {
  return {
    kind: PROVIDER_ANALYSIS_KIND_V1,
    schemaVersion: '1.0.0',
    documentType: 'employment_offer',
    sourceRevisionId: REVISION,
    fields: {
      role: {
        value: { kind: 'text', text: 'Platform Engineer' },
        evidence: [{
          sourceRevisionId: REVISION,
          segmentId: 'segment.gateway.test',
          page: 1,
          quote: 'role of Platform Engineer',
        }],
      },
      acceptanceDeadline: null,
      startDate: null,
      annualBaseSalary: null,
      workLocation: null,
      probation: null,
      actionRequired: null,
    },
  };
}

function withEnvironment(values: NodeJS.ProcessEnv) {
  const names = Object.keys(values);
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
  return () => previous.forEach((value, name) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

test('catalog is strict, no-store, and exposes configuration state without secrets', async () => {
  const restore = withEnvironment({
    ...CLEAR_PROVIDER_ENV,
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    OPENAI_API_KEY: 'catalog-secret',
    OPENAI_MODEL: 'openai-test-model',
  });
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    const raw = await response.text();
    assert.equal(raw.includes('catalog-secret'), false);
    const parsed = parseModelCouncilCatalogV1(JSON.parse(raw));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.providers.find((provider) => provider.id === 'openai')?.availability, 'configured');
      assert.equal(parsed.value.providers.find((provider) => provider.id === 'anthropic')?.availability, 'not_configured');
    }
  } finally {
    restore();
  }
});

test('analysis route rejects cross-origin and digest-mismatched requests before provider fetch', async (context) => {
  let fetches = 0;
  context.mock.method(globalThis, 'fetch', (async () => {
    fetches += 1;
    throw new Error('Provider must not be called');
  }) as typeof fetch);

  const crossOrigin = await POST(new Request('http://localhost:3000/api/model-council/analyze', {
    method: 'POST',
    headers: {
      origin: 'https://attacker.example',
      'content-type': 'application/json',
      'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
    },
    body: '{}',
  }));
  assert.equal(crossOrigin.status, 403);

  const publicOrigin = await POST(new Request('https://paperwork.example/api/model-council/analyze', {
    method: 'POST',
    headers: {
      origin: 'https://paperwork.example',
      'content-type': 'application/json',
      'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
    },
    body: '{}',
  }));
  assert.equal(publicOrigin.status, 403);

  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION,
    sourceFingerprint: 'b'.repeat(64),
    providerTargets: [{ provider: 'openai', model: 'openai-test-model', recipient: 'OpenAI API' }],
    segments: [{ segmentId: 'segment.gateway.test', page: 1, text: 'We offer you the role of Platform Engineer.' }],
  });
  const mismatch = await POST(new Request('http://localhost:3000/api/model-council/analyze', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
      'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
    },
    body: JSON.stringify({
      kind: 'paperwork.model_council_request',
      schemaVersion: '1.0.0',
      requestId: `request.${crypto.randomUUID()}`,
      payload,
      consent: {
        approvedBy: 'user',
        recordedAt: new Date().toISOString(),
        providers: ['openai'],
        previewDigest: { algorithm: 'sha-256', value: '0'.repeat(64) },
        previewByteCount: 1,
      },
    }),
  }));
  assert.equal(mismatch.status, 400);
  assert.equal(fetches, 0);
});

test('analysis route returns the exact checked schema and both transfer hops', async (context) => {
  const restore = withEnvironment({
    ...CLEAR_PROVIDER_ENV,
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    OPENAI_API_KEY: 'route-secret',
    OPENAI_MODEL: 'openai-test-model',
  });
  let fetchedUrl = '';
  let fetches = 0;
  context.mock.method(globalThis, 'fetch', (async (input: string | URL | Request) => {
    fetches += 1;
    fetchedUrl = input instanceof Request ? input.url : String(input);
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validAnalysis()) }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);

  try {
    const payload = prepareModelCouncilPayloadV1({
      sourceRevisionId: REVISION,
      sourceFingerprint: 'c'.repeat(64),
      providerTargets: [{ provider: 'openai', model: 'openai-test-model', recipient: 'OpenAI API' }],
      segments: [{ segmentId: 'segment.gateway.test', page: 1, text: 'We offer you the role of Platform Engineer.' }],
    });
    const digest = await digestModelCouncilPayloadV1(payload);
    const request = {
      kind: 'paperwork.model_council_request',
      schemaVersion: '1.0.0',
      requestId: `request.${crypto.randomUUID()}`,
      payload,
      consent: {
        approvedBy: 'user',
        recordedAt: new Date().toISOString(),
        providers: payload.providers,
        previewDigest: { algorithm: digest.algorithm, value: digest.value },
        previewByteCount: digest.byteCount,
      },
    };
    const response = await POST(new Request('http://localhost:3000/api/model-council/analyze', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
      },
      body: JSON.stringify(request),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(fetchedUrl, 'https://api.openai.com/v1/responses');
    const parsed = parseModelCouncilResponseV1(await response.json(), payload.segments, {
      requestId: request.requestId,
      previewDigest: { algorithm: digest.algorithm, value: digest.value },
      previewByteCount: digest.byteCount,
      providerTargets: payload.providerTargets,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.results[0].status, 'completed');
      assert.equal(parsed.value.receipt.gatewayTransfer.recipient, 'PaperWork model gateway');
      assert.equal(parsed.value.receipt.transfers[0].status, 'completed');
      assert.equal(parsed.value.receipt.transfers[0].payloadDigest.value, digest.value);
    }
    const replay = await POST(new Request('http://localhost:3000/api/model-council/analyze', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
      },
      body: JSON.stringify(request),
    }));
    assert.equal(replay.status, 409);
    assert.equal(fetches, 1);
  } finally {
    restore();
  }
});

test('analysis route rejects changed model configuration after preview without contacting a provider', async (context) => {
  const restore = withEnvironment({
    ...CLEAR_PROVIDER_ENV,
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    OPENAI_API_KEY: 'route-secret',
    OPENAI_MODEL: 'changed-after-preview',
  });
  let fetches = 0;
  context.mock.method(globalThis, 'fetch', (async () => {
    fetches += 1;
    throw new Error('Provider must not be contacted');
  }) as typeof fetch);
  try {
    const payload = prepareModelCouncilPayloadV1({
      sourceRevisionId: REVISION,
      sourceFingerprint: 'd'.repeat(64),
      providerTargets: [{ provider: 'openai', model: 'previewed-model', recipient: 'OpenAI API' }],
      segments: [{ segmentId: 'segment.gateway.test', page: 1, text: 'We offer you the role of Platform Engineer.' }],
    });
    const digest = await digestModelCouncilPayloadV1(payload);
    const response = await POST(new Request('http://localhost:3000/api/model-council/analyze', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
      },
      body: JSON.stringify({
        kind: 'paperwork.model_council_request',
        schemaVersion: '1.0.0',
        requestId: `request.${crypto.randomUUID()}`,
        payload,
        consent: {
          approvedBy: 'user',
          recordedAt: new Date().toISOString(),
          providers: payload.providers,
          previewDigest: { algorithm: digest.algorithm, value: digest.value },
          previewByteCount: digest.byteCount,
        },
      }),
    }));
    assert.equal(response.status, 409);
    assert.equal(fetches, 0);
  } finally {
    restore();
  }
});

test('analysis route rejects single and mixed Ollama targets before provider fetch', async (context) => {
  const restore = withEnvironment({
    ...CLEAR_PROVIDER_ENV,
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
    OPENAI_API_KEY: 'route-secret',
    OPENAI_MODEL: 'openai-test-model',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    OLLAMA_MODEL: 'ollama-test-model',
  });
  let fetches = 0;
  context.mock.method(globalThis, 'fetch', (async () => {
    fetches += 1;
    throw new Error('Provider must not be contacted');
  }) as typeof fetch);
  try {
    for (const providerTargets of [
      [{ provider: 'ollama' as const, model: 'ollama-test-model', recipient: 'Ollama at http://127.0.0.1:11434' }],
      [
        { provider: 'openai' as const, model: 'openai-test-model', recipient: 'OpenAI API' },
        { provider: 'ollama' as const, model: 'ollama-test-model', recipient: 'Ollama at http://127.0.0.1:11434' },
      ],
    ]) {
      const payload = prepareModelCouncilPayloadV1({
        sourceRevisionId: REVISION,
        sourceFingerprint: 'f'.repeat(64),
        providerTargets,
        segments: [{ segmentId: 'segment.gateway.test', page: 1, text: 'We offer you the role of Platform Engineer.' }],
      });
      const digest = await digestModelCouncilPayloadV1(payload);
      const response = await POST(new Request('http://localhost:3000/api/model-council/analyze', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          'x-paperwork-catalog-version': MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
        },
        body: JSON.stringify({
          kind: 'paperwork.model_council_request',
          schemaVersion: '1.0.0',
          requestId: `request.${crypto.randomUUID()}`,
          payload,
          consent: {
            approvedBy: 'user',
            recordedAt: new Date().toISOString(),
            providers: payload.providers,
            previewDigest: { algorithm: digest.algorithm, value: digest.value },
            previewByteCount: digest.byteCount,
          },
        }),
      }));
      assert.equal(response.status, 409);
      assert.match(await response.text(), /directly by the browser/);
    }
    assert.equal(fetches, 0);
  } finally {
    restore();
  }
});
