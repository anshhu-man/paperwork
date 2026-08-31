import {
  DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1,
  PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1,
  canonicalizeProviderEvidenceSpansV1,
  validateProviderDocumentAnalysisV1,
  type DocumentAgentFailedRunResultV1,
  type DocumentAgentPayloadV1,
  type DocumentAgentRunResultV1,
} from '@/core/document-agent/v1';
import { parseProviderResponseTextV1 } from '@/server/model-council/providers';
import type { ProviderRuntimeV1 } from '@/server/model-council/registry';
import { readUtf8BodyWithinLimitV1 } from '@/server/model-council/bounded-body';

const PROVIDER_TIMEOUT_MS = 45_000;
const MAX_PROVIDER_RESPONSE_BYTES = 96 * 1024;
const MAX_OUTPUT_TOKENS = 4_000;

type JsonRecord = Record<string, unknown>;

function sourceInput(payload: DocumentAgentPayloadV1) {
  return JSON.stringify({
    kind: 'paperwork.untrusted_source_passages',
    schemaVersion: payload.schemaVersion,
    sourceRevisionId: payload.sourceRevisionId,
    segments: payload.segments,
  });
}

function headers(runtime: ProviderRuntimeV1): Record<string, string> {
  const result: Record<string, string> = { 'content-type': 'application/json' };
  if (runtime.id === 'anthropic') {
    result['x-api-key'] = runtime.apiKey!;
    result['anthropic-version'] = '2023-06-01';
  } else if (runtime.apiKey) {
    result.authorization = `Bearer ${runtime.apiKey}`;
  }
  return result;
}

export function buildDocumentAgentProviderRequestV1(
  runtime: ProviderRuntimeV1,
  payload: DocumentAgentPayloadV1,
  signal?: AbortSignal,
) {
  const input = sourceInput(payload);
  let body: JsonRecord;
  switch (runtime.id) {
    case 'openai':
      body = {
        model: runtime.model,
        store: false,
        instructions: DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        tools: [],
        parallel_tool_calls: false,
        text: { format: { type: 'json_schema', name: 'paperwork_provider_document_analysis_v1', strict: true, schema: PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1 } },
      };
      break;
    case 'anthropic':
      body = {
        model: runtime.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1,
        messages: [{ role: 'user', content: input }],
        output_config: { format: { type: 'json_schema', schema: PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1 } },
      };
      break;
    case 'mistral':
      body = {
        model: runtime.model,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
        tool_choice: 'none',
        tools: [],
        messages: [
          { role: 'system', content: DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1 },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'paperwork_provider_document_analysis_v1', strict: true, schema: PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1 } },
      };
      break;
    case 'deepseek':
      body = {
        model: runtime.model,
        instructions: DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
        tools: [],
        text: { format: { type: 'json_schema', name: 'paperwork_provider_document_analysis_v1', schema: PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1 } },
      };
      break;
    case 'ollama':
      throw new TypeError('Loopback Ollama is browser-direct.');
  }
  return {
    url: runtime.endpoint,
    init: {
      method: 'POST',
      headers: headers(runtime),
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal,
    } satisfies RequestInit,
  };
}

function failed(
  runtime: ProviderRuntimeV1,
  startedAt: string,
  completedAt: string,
  issueCode: DocumentAgentFailedRunResultV1['issueCode'],
  retryable: boolean,
): DocumentAgentFailedRunResultV1 {
  return { provider: runtime.id, model: runtime.model ?? 'not-configured', status: 'failed', startedAt, completedAt, issueCode, retryable };
}

function linkedSignal(parent?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('provider_timeout'), PROVIDER_TIMEOUT_MS);
  const abort = () => controller.abort(parent?.reason ?? 'cancelled');
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.reason === 'provider_timeout',
    dispose: () => { clearTimeout(timeout); parent?.removeEventListener('abort', abort); },
  };
}

export async function runDocumentAgentProviderV1(
  runtime: ProviderRuntimeV1,
  payload: DocumentAgentPayloadV1,
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; readonly now?: () => string } = {},
): Promise<DocumentAgentRunResultV1> {
  const model = runtime.model ?? 'not-configured';
  if (runtime.id === 'ollama' || !runtime.enabled || !runtime.configured) {
    return { provider: runtime.id, model, status: 'unavailable', issueCode: runtime.configured ? 'agent_disabled' : 'not_configured', retryable: false };
  }
  const target = payload.providerTarget;
  if (target.provider !== runtime.id || target.model !== runtime.model || target.recipient !== runtime.recipient || options.signal?.aborted) {
    return { provider: runtime.id, model, status: 'unavailable', issueCode: 'provider_unavailable', retryable: Boolean(options.signal?.aborted) };
  }
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const linked = linkedSignal(options.signal);
  try {
    const request = buildDocumentAgentProviderRequestV1(runtime, payload, linked.signal);
    const response = await (options.fetchImpl ?? fetch)(request.url, request.init);
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      return failed(runtime, startedAt, now(), retryable ? 'provider_unavailable' : 'provider_rejected', retryable);
    }
    const raw = await readUtf8BodyWithinLimitV1(response, MAX_PROVIDER_RESPONSE_BYTES);
    if (!raw) return failed(runtime, startedAt, now(), 'invalid_provider_output', false);
    let envelope: unknown;
    try { envelope = JSON.parse(raw); } catch { return failed(runtime, startedAt, now(), 'invalid_provider_output', false); }
    const outputText = parseProviderResponseTextV1(runtime.id, envelope);
    if (!outputText || new TextEncoder().encode(outputText).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      return failed(runtime, startedAt, now(), 'invalid_provider_output', false);
    }
    let output: unknown;
    try { output = JSON.parse(outputText); } catch { return failed(runtime, startedAt, now(), 'invalid_provider_output', false); }
    const grounded = canonicalizeProviderEvidenceSpansV1(output, payload.segments);
    const parsed = validateProviderDocumentAnalysisV1(grounded, payload.segments);
    if (!parsed.ok) return failed(runtime, startedAt, now(), 'invalid_provider_output', false);
    return {
      provider: runtime.id,
      model,
      status: 'completed',
      startedAt,
      completedAt: now(),
      validation: 'schema_and_source_spans_checked',
      analysis: parsed.value,
    };
  } catch {
    return failed(runtime, startedAt, now(), linked.timedOut() ? 'provider_timeout' : 'network_failure', true);
  } finally {
    linked.dispose();
  }
}
