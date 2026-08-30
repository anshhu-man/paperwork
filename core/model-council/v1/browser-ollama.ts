import {
  MODEL_COUNCIL_SYSTEM_INSTRUCTIONS_V1,
} from './prompt';
import { PROVIDER_ANALYSIS_JSON_SCHEMA_V1 } from './schema';
import type {
  ModelCouncilPayloadV1,
  ModelCouncilProviderTargetV1,
  ModelCouncilRunResultV1,
} from './contracts';
import { validateProviderAnalysisV1 } from './validate';
import { serializeModelCouncilPayloadV1, verifyModelCouncilRequestV1 } from './payload';

const MAX_OLLAMA_RESPONSE_BYTES_V1 = 96 * 1024;
const MAX_OLLAMA_OUTPUT_TOKENS_V1 = 4_000;
export const OLLAMA_BROWSER_TIMEOUT_MS_V1 = 120_000;

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Resolves only the exact loopback recipient that was shown and digest-bound.
 * All other Ollama destinations fail closed in v1.
 */
export function browserDirectOllamaEndpointV1(
  target: ModelCouncilProviderTargetV1,
  pageOrigin: string,
) {
  if (target.provider !== 'ollama' || !target.recipient.startsWith('Ollama at ')) return null;
  try {
    const page = new URL(pageOrigin);
    const recipientOrigin = target.recipient.slice('Ollama at '.length);
    const recipient = new URL(recipientOrigin);
    if (!isLoopbackHostname(page.hostname) || !isLoopbackHostname(recipient.hostname)) return null;
    if (page.protocol !== 'http:' || recipient.protocol !== 'http:') return null;
    if (page.username || page.password || page.origin !== pageOrigin
        || page.pathname !== '/' || page.search || page.hash) return null;
    if (recipient.username || recipient.password || recipient.origin !== recipientOrigin) return null;
    if (recipient.pathname !== '/' || recipient.search || recipient.hash) return null;
    return new URL('/api/chat', `${recipient.origin}/`).toString();
  } catch {
    return null;
  }
}

function sourceInput(payload: ModelCouncilPayloadV1) {
  return JSON.stringify({
    kind: 'paperwork.untrusted_source_passages',
    schemaVersion: payload.schemaVersion,
    sourceRevisionId: payload.sourceRevisionId,
    segments: payload.segments,
  });
}

async function readUtf8WithinLimit(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) return undefined;
  if (!response.body) {
    const value = await response.arrayBuffer();
    if (value.byteLength > maximumBytes) return undefined;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch {
      return undefined;
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(next.value);
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } catch {
    return undefined;
  }
}

function failedResult(
  model: string,
  startedAt: string,
  completedAt: string,
  issueCode: Extract<ModelCouncilRunResultV1, { status: 'failed' }>['issueCode'],
  retryable: boolean,
): ModelCouncilRunResultV1 {
  return {
    provider: 'ollama',
    model,
    status: 'failed',
    startedAt,
    completedAt,
    issueCode,
    retryable,
  };
}

export async function runBrowserDirectOllamaV1(
  requestInput: unknown,
  options: {
    readonly pageOrigin?: string;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
    readonly now?: () => string;
    /** Test seam; production callers omit this and receive the fixed upper bound. */
    readonly timeoutMs?: number;
  } = {},
): Promise<ModelCouncilRunResultV1> {
  let verified: Awaited<ReturnType<typeof verifyModelCouncilRequestV1>>;
  try {
    // Snapshot synchronously before the digest's asynchronous WebCrypto step.
    // Caller-owned objects can otherwise be mutated while hashing is pending.
    const requestSnapshot = structuredClone(requestInput);
    verified = await verifyModelCouncilRequestV1(requestSnapshot);
  } catch {
    verified = { success: false, ok: false, issues: [] };
  }
  if (!verified.ok) {
    return {
      provider: 'ollama',
      model: 'not-configured',
      status: 'unavailable',
      issueCode: 'provider_unavailable',
      retryable: false,
    };
  }
  // Work from a private canonical snapshot after consent verification too, so
  // no later internal operation can change the bytes being sent.
  const payload = JSON.parse(serializeModelCouncilPayloadV1(verified.value.payload)) as ModelCouncilPayloadV1;
  const target = payload.providerTargets.length === 1 ? payload.providerTargets[0] : undefined;
  const model = target?.model ?? 'not-configured';
  const pageOrigin = options.pageOrigin
    ?? (typeof globalThis.location === 'object' ? globalThis.location.origin : '');
  const endpoint = target ? browserDirectOllamaEndpointV1(target, pageOrigin) : null;
  if (!target || payload.providers.length !== 1 || payload.providers[0] !== 'ollama' || !endpoint) {
    return {
      provider: 'ollama',
      model,
      status: 'unavailable',
      issueCode: 'provider_unavailable',
      retryable: false,
    };
  }
  if (options.signal?.aborted) {
    return {
      provider: 'ollama',
      model,
      status: 'unavailable',
      issueCode: 'provider_unavailable',
      retryable: true,
    };
  }

  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const controller = new AbortController();
  const requestedTimeout = options.timeoutMs ?? OLLAMA_BROWSER_TIMEOUT_MS_V1;
  const timeoutMs = Math.min(OLLAMA_BROWSER_TIMEOUT_MS_V1, Math.max(1, requestedTimeout));
  const timeout = setTimeout(() => controller.abort('provider_timeout'), timeoutMs);
  const abort = () => controller.abort(options.signal?.reason ?? 'cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: PROVIDER_ANALYSIS_JSON_SCHEMA_V1,
        options: { temperature: 0, num_predict: MAX_OLLAMA_OUTPUT_TOKENS_V1 },
        messages: [
          { role: 'system', content: MODEL_COUNCIL_SYSTEM_INSTRUCTIONS_V1 },
          { role: 'user', content: sourceInput(payload) },
        ],
      }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      return failedResult(model, startedAt, now(), retryable ? 'provider_unavailable' : 'provider_rejected', retryable);
    }
    const raw = await readUtf8WithinLimit(response, MAX_OLLAMA_RESPONSE_BYTES_V1);
    if (!raw) return failedResult(model, startedAt, now(), 'invalid_provider_output', false);
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return failedResult(model, startedAt, now(), 'invalid_provider_output', false);
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return failedResult(model, startedAt, now(), 'invalid_provider_output', false);
    }
    const record = envelope as Record<string, unknown>;
    const message = record.message;
    if (record.done !== true || record.done_reason !== 'stop'
        || !message || typeof message !== 'object' || Array.isArray(message)
        || typeof (message as Record<string, unknown>).content !== 'string') {
      return failedResult(model, startedAt, now(), 'invalid_provider_output', false);
    }
    const outputText = (message as Record<string, unknown>).content as string;
    if (new TextEncoder().encode(outputText).byteLength > MAX_OLLAMA_RESPONSE_BYTES_V1) {
      return failedResult(model, startedAt, now(), 'invalid_provider_output', false);
    }
    let output: unknown;
    try {
      output = JSON.parse(outputText);
    } catch {
      return failedResult(model, startedAt, now(), 'invalid_provider_output', false);
    }
    const parsed = validateProviderAnalysisV1(output, payload.segments);
    if (!parsed.ok) return failedResult(model, startedAt, now(), 'invalid_provider_output', false);
    return {
      provider: 'ollama',
      model,
      status: 'completed',
      startedAt,
      completedAt: now(),
      validation: 'source_quotes_checked',
      analysis: parsed.value,
    };
  } catch {
    const completedAt = now();
    if (controller.signal.aborted) {
      return failedResult(
        model,
        startedAt,
        completedAt,
        controller.signal.reason === 'provider_timeout' ? 'provider_timeout' : 'network_failure',
        true,
      );
    }
    return failedResult(model, startedAt, completedAt, 'network_failure', true);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
