import {
  MODEL_COUNCIL_PAYLOAD_KIND_V1,
  MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
  MODEL_COUNCIL_PROMPT_VERSION_V1,
  MODEL_COUNCIL_SCHEMA_VERSION_V1,
  PROVIDER_IDS_V1,
  type ModelCouncilDigestV1,
  type ModelCouncilPayloadDigestV1,
  type ModelCouncilPayloadV1,
  type ModelCouncilProviderTargetV1,
  type ModelCouncilRequestV1,
  type ModelCouncilSourceSegmentInputV1,
} from './contracts';
import {
  ModelCouncilContractErrorV1,
  parseModelCouncilPayloadV1,
  parseModelCouncilRequestV1,
  type ModelCouncilParseResultV1,
} from './validate';

export interface PrepareModelCouncilPayloadInputV1 {
  readonly sourceRevisionId: string;
  readonly sourceFingerprint: string | ModelCouncilDigestV1;
  readonly segments: readonly ModelCouncilSourceSegmentInputV1[];
  readonly providerTargets: readonly ModelCouncilProviderTargetV1[];
}

function canonicalJsonValue(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain a non-finite number.');
      return JSON.stringify(value);
    }
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(',')}]`;
      const record = value as Record<string, unknown>;
      const prototype = Object.getPrototypeOf(record);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Canonical JSON accepts plain objects only.');
      }
      const entries = Object.keys(record)
        .sort()
        .map((key) => {
          if (record[key] === undefined) throw new TypeError('Canonical JSON cannot contain undefined.');
          return `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`;
        });
      return `{${entries.join(',')}}`;
    }
    default:
      throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
  }
}

/**
 * Builds the exact, closed payload shown before consent. Provider order is
 * canonicalized, while segment order remains the canonical document order.
 */
export function prepareModelCouncilPayloadV1(
  input: PrepareModelCouncilPayloadInputV1,
): ModelCouncilPayloadV1 {
  const fingerprint = typeof input.sourceFingerprint === 'string'
    ? { algorithm: 'sha-256' as const, value: input.sourceFingerprint }
    : { algorithm: input.sourceFingerprint.algorithm, value: input.sourceFingerprint.value };
  const providerTargets = [...input.providerTargets]
    .map((target) => ({
      provider: target.provider,
      model: target.model,
      recipient: target.recipient,
    }))
    .sort((left, right) => PROVIDER_IDS_V1.indexOf(left.provider) - PROVIDER_IDS_V1.indexOf(right.provider));
  const providers = providerTargets.map((target) => target.provider);
  const payload: ModelCouncilPayloadV1 = {
    kind: MODEL_COUNCIL_PAYLOAD_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    catalogVersion: MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
    promptVersion: MODEL_COUNCIL_PROMPT_VERSION_V1,
    sourceRevisionId: input.sourceRevisionId,
    sourceFingerprint: fingerprint,
    providers,
    providerTargets,
    segments: input.segments.map((segment, sequence) => ({
      sourceRevisionId: input.sourceRevisionId,
      segmentId: segment.segmentId,
      sequence,
      page: segment.page,
      text: segment.text,
    })),
  };
  const parsed = parseModelCouncilPayloadV1(payload);
  if (!parsed.success) throw new ModelCouncilContractErrorV1(parsed.issues);
  return parsed.data;
}

/** UTF-8 canonical JSON used by both the preview and transfer receipt. */
export function serializeModelCouncilPayloadV1(payload: ModelCouncilPayloadV1) {
  const parsed = parseModelCouncilPayloadV1(payload);
  if (!parsed.success) throw new ModelCouncilContractErrorV1(parsed.issues);
  return canonicalJsonValue(parsed.data);
}

export async function digestModelCouncilPayloadV1(
  payload: ModelCouncilPayloadV1,
): Promise<ModelCouncilPayloadDigestV1> {
  const serialized = serializeModelCouncilPayloadV1(payload);
  const bytes = new TextEncoder().encode(serialized);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const value = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { algorithm: 'sha-256', value, byteCount: bytes.byteLength };
}

/** Structural validation plus proof that consent covers the exact preview bytes. */
export async function verifyModelCouncilRequestV1(
  input: unknown,
): Promise<ModelCouncilParseResultV1<ModelCouncilRequestV1>> {
  const parsed = parseModelCouncilRequestV1(input);
  if (!parsed.success) return parsed;
  const actual = await digestModelCouncilPayloadV1(parsed.data.payload);
  const issues = [];
  if (actual.value !== parsed.data.consent.previewDigest.value) {
    issues.push({
      path: '$.consent.previewDigest',
      code: 'preview_digest_mismatch',
      message: 'Consent digest does not match the exact canonical payload.',
    });
  }
  if (actual.byteCount !== parsed.data.consent.previewByteCount) {
    issues.push({
      path: '$.consent.previewByteCount',
      code: 'preview_size_mismatch',
      message: 'Consent byte count does not match the exact canonical payload.',
    });
  }
  return issues.length > 0
    ? { success: false, ok: false, issues }
    : parsed;
}
