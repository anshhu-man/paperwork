import {
  DOCUMENT_AGENT_MAX_PREVIEW_BYTES_V1,
  DOCUMENT_AGENT_OUTPUT_CONTRACT_V1,
  DOCUMENT_AGENT_PAYLOAD_KIND_V1,
  DOCUMENT_AGENT_PROMPT_VERSION_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  type DocumentAgentPayloadDigestV1,
  type DocumentAgentPayloadV1,
  type DocumentAgentRequestV1,
  type DocumentAgentSourceSegmentInputV1,
  type DocumentAgentProviderTargetV1,
} from './contracts';
import {
  parseDocumentAgentPayloadV1,
  parseDocumentAgentRequestV1,
  type DocumentAgentIssueV1,
  type DocumentAgentParseResultV1,
} from './validate';

export interface PrepareDocumentAgentPayloadInputV1 {
  readonly requestId: string;
  readonly consentRecordedAt: string;
  readonly sourceRevisionId: string;
  readonly sourceFingerprint: string;
  readonly providerTarget: DocumentAgentProviderTargetV1;
  readonly segments: readonly DocumentAgentSourceSegmentInputV1[];
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Canonical JSON accepts plain objects only.');
    return `{${Object.keys(object).sort().map((key) => {
      if (object[key] === undefined) throw new TypeError('Canonical JSON rejects undefined.');
      return `${JSON.stringify(key)}:${canonicalJson(object[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value}.`);
}

export function prepareDocumentAgentPayloadV1(input: PrepareDocumentAgentPayloadInputV1): DocumentAgentPayloadV1 {
  const payload: DocumentAgentPayloadV1 = {
    kind: DOCUMENT_AGENT_PAYLOAD_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    promptVersion: DOCUMENT_AGENT_PROMPT_VERSION_V1,
    outputContract: DOCUMENT_AGENT_OUTPUT_CONTRACT_V1,
    requestId: input.requestId,
    consentRecordedAt: input.consentRecordedAt,
    sourceRevisionId: input.sourceRevisionId,
    sourceFingerprint: { algorithm: 'sha-256', value: input.sourceFingerprint },
    providerTarget: {
      provider: input.providerTarget.provider,
      model: input.providerTarget.model,
      recipient: input.providerTarget.recipient,
    },
    segments: input.segments.map((segment, sequence) => ({
      sourceRevisionId: input.sourceRevisionId,
      segmentId: segment.segmentId,
      sequence,
      page: segment.page,
      text: segment.text,
    })),
  };
  const parsed = parseDocumentAgentPayloadV1(payload);
  if (!parsed.ok) throw new TypeError('Document-agent payload failed its closed contract.');
  if (new TextEncoder().encode(canonicalJson(parsed.value)).byteLength > DOCUMENT_AGENT_MAX_PREVIEW_BYTES_V1) {
    throw new TypeError('Document-agent payload is too large.');
  }
  return parsed.value;
}

export function serializeDocumentAgentPayloadV1(payload: DocumentAgentPayloadV1) {
  const parsed = parseDocumentAgentPayloadV1(payload);
  if (!parsed.ok) throw new TypeError('Document-agent payload failed its closed contract.');
  return canonicalJson(parsed.value);
}

export async function digestDocumentAgentPayloadV1(payload: DocumentAgentPayloadV1): Promise<DocumentAgentPayloadDigestV1> {
  const bytes = new TextEncoder().encode(serializeDocumentAgentPayloadV1(payload));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return {
    algorithm: 'sha-256',
    value: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    byteCount: bytes.byteLength,
  };
}

export async function verifyDocumentAgentRequestV1(
  input: unknown,
): Promise<DocumentAgentParseResultV1<DocumentAgentRequestV1>> {
  const parsed = parseDocumentAgentRequestV1(input);
  if (!parsed.ok) return parsed;
  const actual = await digestDocumentAgentPayloadV1(parsed.value.payload);
  const issues: DocumentAgentIssueV1[] = [];
  if (actual.value !== parsed.value.consent.previewDigest.value) {
    issues.push({ path: '$.consent.previewDigest', code: 'preview_digest_mismatch', message: 'Consent does not cover the exact payload.' });
  }
  if (actual.byteCount !== parsed.value.consent.previewByteCount) {
    issues.push({ path: '$.consent.previewByteCount', code: 'preview_size_mismatch', message: 'Consent byte count does not match the exact payload.' });
  }
  if (parsed.value.consent.provider !== parsed.value.payload.providerTarget.provider) {
    issues.push({ path: '$.consent.provider', code: 'provider_mismatch', message: 'Consent provider differs from the payload target.' });
  }
  return issues.length > 0
    ? { ok: false, success: false, issues }
    : parsed;
}
