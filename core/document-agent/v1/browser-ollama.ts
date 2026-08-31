import {
  DOCUMENT_AGENT_RECEIPT_KIND_V1,
  DOCUMENT_AGENT_RESPONSE_KIND_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  type DocumentAgentFailedRunResultV1,
  type DocumentAgentRequestV1,
  type DocumentAgentResponseV1,
  type DocumentAgentRunResultV1,
} from './contracts';
import { serializeDocumentAgentPayloadV1, verifyDocumentAgentRequestV1 } from './payload';
import { DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1 } from './prompt';
import { PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1 } from './schema';
import { canonicalizeProviderEvidenceSpansV1 } from './ground';
import { parseDocumentAgentResponseV1, validateProviderDocumentAnalysisV1 } from './validate';

const MAX_RESPONSE_BYTES = 96 * 1024;
const MAX_OUTPUT_TOKENS = 4_000;
const CONSENT_MAX_AGE_MS = 15 * 60 * 1_000;
const CONSENT_CLOCK_SKEW_MS = 60 * 1_000;
export const DOCUMENT_AGENT_OLLAMA_TIMEOUT_MS_V1 = 120_000;

function isLoopback(hostname: string) { return hostname === 'localhost' || hostname === '127.0.0.1'; }

export function browserDirectDocumentAgentOllamaEndpointV1(
  target: DocumentAgentRequestV1['payload']['providerTarget'],
  pageOrigin: string,
) {
  if (target.provider !== 'ollama' || !target.recipient.startsWith('Ollama at ')) return null;
  try {
    const page = new URL(pageOrigin);
    const recipientOrigin = target.recipient.slice('Ollama at '.length);
    const recipient = new URL(recipientOrigin);
    if (!isLoopback(page.hostname) || !isLoopback(recipient.hostname)) return null;
    if (page.protocol !== 'http:' || recipient.protocol !== 'http:') return null;
    if (page.username || page.password || page.origin !== pageOrigin || page.pathname !== '/' || page.search || page.hash) return null;
    if (recipient.username || recipient.password || recipient.origin !== recipientOrigin || recipient.pathname !== '/' || recipient.search || recipient.hash) return null;
    return new URL('/api/chat', `${recipient.origin}/`).toString();
  } catch {
    return null;
  }
}

async function readUtf8WithinLimit(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) return undefined;
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maximumBytes) return undefined;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) { await reader.cancel(); return undefined; }
      chunks.push(next.value);
    }
  } catch { return undefined; } finally { reader.releaseLock(); }
  const joined = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { joined.set(chunk, offset); offset += chunk.byteLength; });
  try { return new TextDecoder('utf-8', { fatal: true }).decode(joined); } catch { return undefined; }
}

function sourceInput(payload: DocumentAgentRequestV1['payload']) {
  return JSON.stringify({
    kind: 'paperwork.untrusted_source_passages',
    schemaVersion: payload.schemaVersion,
    sourceRevisionId: payload.sourceRevisionId,
    segments: payload.segments,
  });
}

function failed(
  model: string,
  startedAt: string,
  completedAt: string,
  issueCode: DocumentAgentFailedRunResultV1['issueCode'],
  retryable: boolean,
): DocumentAgentFailedRunResultV1 {
  return { provider: 'ollama', model, status: 'failed', startedAt, completedAt, issueCode, retryable };
}

function directResponse(
  request: DocumentAgentRequestV1,
  result: DocumentAgentRunResultV1,
): DocumentAgentResponseV1 {
  const target = request.payload.providerTarget;
  const status = result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'not_sent';
  const startedAt = result.status === 'unavailable' ? null : result.startedAt;
  const completedAt = result.status === 'unavailable' ? null : result.completedAt;
  return {
    kind: DOCUMENT_AGENT_RESPONSE_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    requestId: request.requestId,
    result,
    receipt: {
      kind: DOCUMENT_AGENT_RECEIPT_KIND_V1,
      schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
      receiptId: `receipt.${crypto.randomUUID()}`,
      requestId: request.requestId,
      consent: request.consent,
      gatewayTransfer: {
        recipient: 'PaperWork model gateway',
        status: 'not_sent',
        startedAt: null,
        completedAt: null,
        payloadDigest: request.consent.previewDigest,
        payloadByteCount: request.consent.previewByteCount,
      },
      transfer: {
        provider: 'ollama',
        model: target.model,
        recipient: target.recipient,
        channel: 'browser_to_provider',
        status,
        startedAt,
        completedAt,
        payloadDigest: request.consent.previewDigest,
        payloadByteCount: request.consent.previewByteCount,
        providerPolicy: {
          retention: 'unknown',
          trainingUse: 'unknown',
          assertedBy: 'Local Ollama operator configuration',
          policyUrl: 'https://docs.ollama.com/capabilities/structured-outputs',
        },
      },
    },
  };
}

export async function runBrowserDirectDocumentAgentOllamaV1(
  input: unknown,
  options: {
    readonly pageOrigin?: string;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
    readonly now?: () => string;
    readonly timeoutMs?: number;
  } = {},
): Promise<DocumentAgentResponseV1> {
  const snapshot = structuredClone(input);
  const verified = await verifyDocumentAgentRequestV1(snapshot);
  if (!verified.ok) throw new TypeError('Document-agent consent did not cover the exact payload.');
  const request = verified.value;
  const payload = JSON.parse(serializeDocumentAgentPayloadV1(request.payload)) as DocumentAgentRequestV1['payload'];
  const target = payload.providerTarget;
  const pageOrigin = options.pageOrigin ?? (typeof globalThis.location === 'object' ? globalThis.location.origin : '');
  const endpoint = browserDirectDocumentAgentOllamaEndpointV1(target, pageOrigin);
  if (target.provider !== 'ollama' || !endpoint) throw new TypeError('The approved Ollama target is not an exact loopback recipient.');
  if (options.signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError');

  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const consentAge = Date.parse(startedAt) - Date.parse(request.consent.recordedAt);
  if (!Number.isFinite(consentAge) || consentAge < -CONSENT_CLOCK_SKEW_MS || consentAge > CONSENT_MAX_AGE_MS) {
    throw new TypeError('Document-agent consent expired before local model delivery.');
  }
  const controller = new AbortController();
  const timeoutMs = Math.min(DOCUMENT_AGENT_OLLAMA_TIMEOUT_MS_V1, Math.max(1, options.timeoutMs ?? DOCUMENT_AGENT_OLLAMA_TIMEOUT_MS_V1));
  const timeout = setTimeout(() => controller.abort('provider_timeout'), timeoutMs);
  const abort = () => controller.abort(options.signal?.reason ?? 'cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  let result: DocumentAgentRunResultV1;
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: target.model,
        stream: false,
        format: PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1,
        options: { temperature: 0, num_predict: MAX_OUTPUT_TOKENS },
        messages: [
          { role: 'system', content: DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1 },
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
      result = failed(target.model, startedAt, now(), retryable ? 'provider_unavailable' : 'provider_rejected', retryable);
    } else {
      const raw = await readUtf8WithinLimit(response, MAX_RESPONSE_BYTES);
      if (!raw) {
        result = failed(target.model, startedAt, now(), 'invalid_provider_output', false);
      } else {
        let envelope: unknown;
        try { envelope = JSON.parse(raw); } catch { envelope = undefined; }
        const record = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope as Record<string, unknown> : undefined;
        const message = record?.message && typeof record.message === 'object' && !Array.isArray(record.message) ? record.message as Record<string, unknown> : undefined;
        const content = record?.model === target.model
          && record.done === true
          && record.done_reason === 'stop'
          && typeof message?.content === 'string'
          ? message.content
          : undefined;
        if (!content || new TextEncoder().encode(content).byteLength > MAX_RESPONSE_BYTES) {
          result = failed(target.model, startedAt, now(), 'invalid_provider_output', false);
        } else {
          let output: unknown;
          try { output = JSON.parse(content); } catch { output = undefined; }
          const grounded = canonicalizeProviderEvidenceSpansV1(output, payload.segments);
          const parsed = validateProviderDocumentAnalysisV1(grounded, payload.segments);
          result = parsed.ok
            ? { provider: 'ollama', model: target.model, status: 'completed', startedAt, completedAt: now(), validation: 'schema_and_source_spans_checked', analysis: parsed.value }
            : failed(target.model, startedAt, now(), 'invalid_provider_output', false);
        }
      }
    }
  } catch {
    result = failed(
      target.model,
      startedAt,
      now(),
      controller.signal.reason === 'provider_timeout' ? 'provider_timeout' : 'network_failure',
      true,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
  const response = directResponse(request, result);
  const parsedResponse = parseDocumentAgentResponseV1(response, payload.segments, {
    requestId: request.requestId,
    previewDigest: request.consent.previewDigest,
    previewByteCount: request.consent.previewByteCount,
    providerTarget: target,
  });
  if (!parsedResponse.ok) throw new TypeError('PaperWork rejected its own Ollama run receipt.');
  return parsedResponse.value;
}
