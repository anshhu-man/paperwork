import {
  PROVIDER_ANALYSIS_JSON_SCHEMA_V1,
  MODEL_COUNCIL_SYSTEM_INSTRUCTIONS_V1,
  validateProviderAnalysisV1,
  type ModelCouncilPayloadV1,
  type ModelCouncilRunResultV1,
  type ProviderIdV1,
} from '@/core/model-council/v1';

import type { ProviderRuntimeV1 } from './registry';
import { readUtf8BodyWithinLimitV1 } from './bounded-body';

const PROVIDER_TIMEOUT_MS = 45_000;
const MAX_PROVIDER_RESPONSE_BYTES = 96 * 1024;
const MAX_OUTPUT_TOKENS = 4_000;

export interface ProviderRequestV1 {
  readonly url: string;
  readonly init: RequestInit;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sourceInput(payload: ModelCouncilPayloadV1) {
  return JSON.stringify({
    kind: 'paperwork.untrusted_source_passages',
    schemaVersion: payload.schemaVersion,
    sourceRevisionId: payload.sourceRevisionId,
    segments: payload.segments,
  });
}

function jsonHeaders(runtime: ProviderRuntimeV1): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (runtime.id === 'anthropic') {
    headers['x-api-key'] = runtime.apiKey!;
    headers['anthropic-version'] = '2023-06-01';
  } else if (runtime.apiKey) {
    headers.authorization = `Bearer ${runtime.apiKey}`;
  }
  return headers;
}

export function buildProviderRequestV1(
  runtime: ProviderRuntimeV1,
  payload: ModelCouncilPayloadV1,
  signal?: AbortSignal,
): ProviderRequestV1 {
  const input = sourceInput(payload);
  let body: JsonRecord;

  switch (runtime.id) {
    case 'openai':
      body = {
        model: runtime.model,
        store: false,
        instructions: MODEL_COUNCIL_SYSTEM_INSTRUCTIONS_V1,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        tools: [],
        parallel_tool_calls: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'paperwork_provider_analysis_v1',
            strict: true,
            schema: PROVIDER_ANALYSIS_JSON_SCHEMA_V1,
          },
        },
      };
      break;
    case 'anthropic':
      body = {
        model: runtime.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: MODEL_COUNCIL_SYSTEM_INSTRUCTIONS_V1,
        messages: [{ role: 'user', content: input }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: PROVIDER_ANALYSIS_JSON_SCHEMA_V1,
          },
        },
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
          { role: 'system', content: MODEL_COUNCIL_SYSTEM_INSTRUCTIONS_V1 },
          { role: 'user', content: input },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'paperwork_provider_analysis_v1',
            strict: true,
            schema: PROVIDER_ANALYSIS_JSON_SCHEMA_V1,
          },
        },
      };
      break;
    case 'deepseek':
      body = {
        model: runtime.model,
        instructions: MODEL_COUNCIL_SYSTEM_INSTRUCTIONS_V1,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
        tools: [],
        text: {
          format: {
            type: 'json_schema',
            name: 'paperwork_provider_analysis_v1',
            schema: PROVIDER_ANALYSIS_JSON_SCHEMA_V1,
          },
        },
      };
      break;
    case 'ollama':
      throw new TypeError('Loopback Ollama is browser-direct and cannot use the model gateway.');
  }

  return {
    url: runtime.endpoint,
    init: {
      method: 'POST',
      headers: jsonHeaders(runtime),
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal,
    },
  };
}

function extractResponsesText(value: JsonRecord) {
  if (value.status !== 'completed') return undefined;
  if (typeof value.output_text === 'string') return value.output_text;
  if (!Array.isArray(value.output)) return undefined;
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return undefined;
}

function extractChatText(value: JsonRecord) {
  if (!Array.isArray(value.choices) || !isRecord(value.choices[0])) return undefined;
  if (value.choices[0].finish_reason !== 'stop') return undefined;
  const message = value.choices[0].message;
  if (!isRecord(message)) return undefined;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return undefined;
  return message.content
    .filter((part): part is JsonRecord => isRecord(part) && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function extractAnthropicText(value: JsonRecord) {
  if (value.stop_reason !== 'end_turn' || !Array.isArray(value.content)) return undefined;
  const block = value.content.find((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string');
  return isRecord(block) && typeof block.text === 'string' ? block.text : undefined;
}

function extractOllamaText(value: JsonRecord) {
  if (value.done !== true || value.done_reason !== 'stop') return undefined;
  return isRecord(value.message) && typeof value.message.content === 'string'
    ? value.message.content
    : undefined;
}

export function parseProviderResponseTextV1(provider: ProviderIdV1, value: unknown) {
  if (!isRecord(value)) return undefined;
  switch (provider) {
    case 'openai':
    case 'deepseek': return extractResponsesText(value);
    case 'anthropic': return extractAnthropicText(value);
    case 'mistral': return extractChatText(value);
    case 'ollama': return extractOllamaText(value);
  }
}

function safeModelName(runtime: ProviderRuntimeV1) {
  return runtime.model ?? 'not-configured';
}

function failedResult(
  runtime: ProviderRuntimeV1,
  startedAt: string,
  completedAt: string,
  issueCode: Extract<ModelCouncilRunResultV1, { status: 'failed' }>['issueCode'],
  retryable: boolean,
): ModelCouncilRunResultV1 {
  return {
    provider: runtime.id,
    model: safeModelName(runtime),
    status: 'failed',
    startedAt,
    completedAt,
    issueCode,
    retryable,
  };
}

function linkedAbortSignal(parent?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('provider_timeout'), PROVIDER_TIMEOUT_MS);
  const abort = () => controller.abort(parent?.reason ?? 'cancelled');
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.reason === 'provider_timeout',
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abort);
    },
  };
}

export async function runProviderV1(
  runtime: ProviderRuntimeV1,
  payload: ModelCouncilPayloadV1,
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
    readonly now?: () => string;
  } = {},
): Promise<ModelCouncilRunResultV1> {
  if (runtime.id === 'ollama') {
    return {
      provider: runtime.id,
      model: safeModelName(runtime),
      status: 'unavailable',
      issueCode: 'provider_unavailable',
      retryable: false,
    };
  }
  if (!runtime.enabled || !runtime.configured) {
    return {
      provider: runtime.id,
      model: safeModelName(runtime),
      status: 'unavailable',
      issueCode: runtime.configured ? 'council_disabled' : 'not_configured',
      retryable: false,
    };
  }
  const target = payload.providerTargets.find((item) => item.provider === runtime.id);
  if (!target || target.model !== runtime.model || target.recipient !== runtime.recipient) {
    return {
      provider: runtime.id,
      model: safeModelName(runtime),
      status: 'unavailable',
      issueCode: 'provider_unavailable',
      retryable: false,
    };
  }
  if (options.signal?.aborted) {
    return {
      provider: runtime.id,
      model: safeModelName(runtime),
      status: 'unavailable',
      issueCode: 'provider_unavailable',
      retryable: true,
    };
  }

  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const linked = linkedAbortSignal(options.signal);
  try {
    const request = buildProviderRequestV1(runtime, payload, linked.signal);
    const response = await (options.fetchImpl ?? fetch)(request.url, request.init);
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      return failedResult(runtime, startedAt, now(), retryable ? 'provider_unavailable' : 'provider_rejected', retryable);
    }
    const raw = await readUtf8BodyWithinLimitV1(response, MAX_PROVIDER_RESPONSE_BYTES);
    if (!raw) {
      return failedResult(runtime, startedAt, now(), 'invalid_provider_output', false);
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return failedResult(runtime, startedAt, now(), 'invalid_provider_output', false);
    }
    const outputText = parseProviderResponseTextV1(runtime.id, envelope);
    if (!outputText || new TextEncoder().encode(outputText).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      return failedResult(runtime, startedAt, now(), 'invalid_provider_output', false);
    }
    let output: unknown;
    try {
      output = JSON.parse(outputText);
    } catch {
      return failedResult(runtime, startedAt, now(), 'invalid_provider_output', false);
    }
    const parsed = validateProviderAnalysisV1(output, payload.segments);
    if (!parsed.ok) return failedResult(runtime, startedAt, now(), 'invalid_provider_output', false);
    const completedAt = now();
    return {
      provider: runtime.id,
      model: safeModelName(runtime),
      status: 'completed',
      startedAt,
      completedAt,
      validation: 'source_quotes_checked',
      analysis: parsed.value,
    };
  } catch {
    const completedAt = now();
    if (linked.signal.aborted) {
      return failedResult(runtime, startedAt, completedAt, linked.timedOut() ? 'provider_timeout' : 'network_failure', true);
    }
    return failedResult(runtime, startedAt, completedAt, 'network_failure', true);
  } finally {
    linked.dispose();
  }
}
