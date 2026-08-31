import assert from 'node:assert/strict';
import test from 'node:test';

import {
  prepareDocumentAgentPayloadV1,
  type DocumentAgentPayloadV1,
  type ProviderDocumentAnalysisV1,
} from '@/core/document-agent/v1';
import type { ProviderIdV1 } from '@/core/model-council/v1';
import type { ProviderRuntimeV1 } from '@/server/model-council/registry';

import { buildDocumentAgentProviderRequestV1, runDocumentAgentProviderV1 } from './providers';

const REVISION = 'revision.document.provider';
const SEGMENT_ID = 'segment.document.provider';
const TEXT = [
  'EMPLOYMENT OFFER',
  'Role: Systems Engineer',
  'Base salary: USD 100 annual.',
  'Please sign and return this letter by August 31, 2026.',
].join('\n');

function runtime(id: ProviderIdV1): ProviderRuntimeV1 {
  return {
    id,
    displayName: id,
    model: `${id}-document-model`,
    configured: true,
    enabled: true,
    access: id === 'ollama'
      ? 'self_hosted'
      : id === 'mistral'
        ? 'hosted_api_model_license_varies'
        : id === 'deepseek'
          ? 'open_weight_hosted_api'
          : 'commercial_api',
    recipient: `${id} document API`,
    privacyUrl: 'https://example.com/privacy',
    disclosure: 'Synthetic provider.',
    apiKey: id === 'ollama' ? undefined : 'server-secret',
    endpoint: id === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : `https://api.example.com/${id}`,
  };
}

function payload(provider: ProviderIdV1): DocumentAgentPayloadV1 {
  const target = runtime(provider);
  return prepareDocumentAgentPayloadV1({
    requestId: 'request.document.provider',
    consentRecordedAt: '2026-08-31T12:00:00.000Z',
    sourceRevisionId: REVISION,
    sourceFingerprint: 'a'.repeat(64),
    providerTarget: { provider, model: target.model!, recipient: target.recipient },
    segments: [{ segmentId: SEGMENT_ID, page: 1, text: TEXT }],
  });
}

function evidence(quote: string) {
  const start = TEXT.indexOf(quote);
  assert.notEqual(start, -1);
  return { sourceRevisionId: REVISION, segmentId: SEGMENT_ID, page: 1, span: { start, end: start + quote.length }, quote };
}

function analysis(): ProviderDocumentAnalysisV1 {
  const requirement = 'Please sign and return this letter by August 31, 2026.';
  return {
    kind: 'paperwork.provider_document_analysis',
    schemaVersion: '1.0.0',
    sourceRevisionId: REVISION,
    documentType: 'employment_offer',
    documentTypeEvidence: [evidence('EMPLOYMENT OFFER')],
    findings: [
      { fieldId: 'offer.role', group: null, value: { kind: 'text', text: 'Systems Engineer' }, evidence: [evidence('Systems Engineer')] },
      { fieldId: 'offer.base_salary', group: null, value: { kind: 'money', amount: '100', currency: 'USD', basis: 'annual' }, evidence: [evidence('Base salary: USD 100 annual.')] },
      { fieldId: 'offer.acceptance_deadline', group: null, value: { kind: 'date', value: '2026-08-31' }, evidence: [evidence(requirement)] },
    ],
    requirements: [{ operation: 'sign', text: 'sign and return this letter', due: { kind: 'date', value: '2026-08-31' }, evidence: [evidence(requirement)] }],
    conflicts: [],
    suggestions: [{ intent: 'verify', basisFindingIndexes: [1] }],
  };
}

function providerEnvelope(provider: ProviderIdV1, output: ProviderDocumentAnalysisV1) {
  const content = JSON.stringify(output);
  if (provider === 'openai' || provider === 'deepseek') return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] };
  if (provider === 'anthropic') return { stop_reason: 'end_turn', content: [{ type: 'text', text: content }] };
  if (provider === 'mistral') return { choices: [{ finish_reason: 'stop', message: { content } }] };
  return { model: runtime(provider).model, done: true, done_reason: 'stop', message: { content } };
}

test('all hosted document adapters use provider-native strict schemas without tools', () => {
  for (const provider of ['openai', 'anthropic', 'mistral', 'deepseek'] as const) {
    const request = buildDocumentAgentProviderRequestV1(runtime(provider), payload(provider));
    assert.equal(request.url, runtime(provider).endpoint);
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.redirect, 'error');
    assert.equal(request.init.cache, 'no-store');
    assert.equal(typeof request.init.body, 'string');
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes('server-secret'), false);
    assert.equal(serialized.includes('sourceFingerprint'), false);
    assert.match(serialized, /paperwork\.untrusted_source_passages/);
    if (provider === 'openai' || provider === 'deepseek') {
      assert.deepEqual(body.tools, []);
      assert.equal((body.text as { format: { type: string } }).format.type, 'json_schema');
    } else if (provider === 'anthropic') {
      assert.equal((body.output_config as { format: { type: string } }).format.type, 'json_schema');
    } else {
      assert.deepEqual(body.tools, []);
      assert.equal((body.response_format as { type: string }).type, 'json_schema');
    }
  }
});

test('all hosted document adapters return the same citation-checked webpage contract', async () => {
  for (const provider of ['openai', 'anthropic', 'mistral', 'deepseek'] as const) {
    const result = await runDocumentAgentProviderV1(runtime(provider), payload(provider), {
      fetchImpl: async () => new Response(JSON.stringify(providerEnvelope(provider, analysis())), { status: 200 }),
      now: (() => {
        const times = ['2026-08-31T12:00:01.000Z', '2026-08-31T12:00:02.000Z'];
        return () => times.shift() ?? '2026-08-31T12:00:02.000Z';
      })(),
    });
    assert.equal(result.status, 'completed', provider);
    if (result.status === 'completed') {
      assert.equal(result.validation, 'schema_and_source_spans_checked');
      assert.equal(result.analysis.findings[0]?.fieldId, 'offer.role');
      assert.equal(result.analysis.requirements[0]?.operation, 'sign');
    }
  }
});

test('hosted document adapters withhold wrong citations and server-side Ollama', async () => {
  const invalid = structuredClone(analysis());
  (invalid.findings[0]!.evidence[0] as { quote: string }).quote = 'Chief Executive Officer';
  const result = await runDocumentAgentProviderV1(runtime('openai'), payload('openai'), {
    fetchImpl: async () => new Response(JSON.stringify(providerEnvelope('openai', invalid)), { status: 200 }),
  });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.equal(result.issueCode, 'invalid_provider_output');

  let fetches = 0;
  const local = await runDocumentAgentProviderV1(runtime('ollama'), payload('ollama'), {
    fetchImpl: async () => { fetches += 1; throw new Error('must not run'); },
  });
  assert.equal(fetches, 0);
  assert.equal(local.status, 'unavailable');
  assert.throws(() => buildDocumentAgentProviderRequestV1(runtime('ollama'), payload('ollama')), /browser-direct/);
});
