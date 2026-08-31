import { PROVIDER_IDS_V1 } from '../../model-council/v1';
import {
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  type DocumentAgentDigestV1,
  type DocumentAgentProviderTargetV1,
  type DocumentAgentRequestV1,
} from './contracts';

export const DOCUMENT_AGENT_GATEWAY_MODE_HEADER_V1 = 'x-paperwork-gateway-mode' as const;
export const DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1 = 'x-paperwork-run-grant' as const;
export const DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1 = 'paperwork.gateway_session' as const;
export const DOCUMENT_AGENT_GATEWAY_GRANT_REQUEST_KIND_V1 = 'paperwork.document_agent_run_grant_request' as const;
export const DOCUMENT_AGENT_GATEWAY_GRANT_RESPONSE_KIND_V1 = 'paperwork.document_agent_run_grant_response' as const;

export type DocumentAgentGatewayModeV1 = 'disabled' | 'local_development' | 'invite';

export type DocumentAgentGatewaySessionV1 =
  | {
      readonly kind: typeof DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1;
      readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
      readonly authenticated: true;
      readonly expiresAt: string;
    }
  | {
      readonly kind: typeof DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1;
      readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
      readonly authenticated: false;
      readonly expiresAt: null;
    };

export interface DocumentAgentRunGrantRequestV1 {
  readonly kind: typeof DOCUMENT_AGENT_GATEWAY_GRANT_REQUEST_KIND_V1;
  readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
  readonly requestId: string;
  readonly consentRecordedAt: string;
  readonly providerTarget: DocumentAgentProviderTargetV1;
  readonly previewDigest: DocumentAgentDigestV1;
  readonly previewByteCount: number;
}

export interface DocumentAgentRunGrantResponseV1 {
  readonly kind: typeof DOCUMENT_AGENT_GATEWAY_GRANT_RESPONSE_KIND_V1;
  readonly schemaVersion: typeof DOCUMENT_AGENT_SCHEMA_VERSION_V1;
  readonly grantToken: string;
  readonly expiresAt: string;
}

type RecordValue = Record<string, unknown>;

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GRANT_TOKEN = /^grant\.[A-Za-z0-9_-]{43}$/;

function exactRecord(value: unknown, keys: readonly string[]): value is RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function providerTarget(value: unknown): value is DocumentAgentProviderTargetV1 {
  if (!exactRecord(value, ['provider', 'model', 'recipient'])) return false;
  return typeof value.provider === 'string'
    && PROVIDER_IDS_V1.includes(value.provider as (typeof PROVIDER_IDS_V1)[number])
    && typeof value.model === 'string'
    && value.model.length >= 1
    && value.model.length <= 256
    && typeof value.recipient === 'string'
    && value.recipient.length >= 1
    && value.recipient.length <= 1_000;
}

function digest(value: unknown): value is DocumentAgentDigestV1 {
  return exactRecord(value, ['algorithm', 'value'])
    && value.algorithm === 'sha-256'
    && typeof value.value === 'string'
    && SHA256.test(value.value);
}

export function documentAgentGatewayModeV1(value: string | null): DocumentAgentGatewayModeV1 {
  return value === 'local_development' || value === 'invite' ? value : 'disabled';
}

export function parseDocumentAgentGatewaySessionV1(
  value: unknown,
): DocumentAgentGatewaySessionV1 | undefined {
  if (!exactRecord(value, ['kind', 'schemaVersion', 'authenticated', 'expiresAt'])
      || value.kind !== DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1
      || value.schemaVersion !== DOCUMENT_AGENT_SCHEMA_VERSION_V1
      || typeof value.authenticated !== 'boolean') return undefined;
  if (value.authenticated === true && canonicalTimestamp(value.expiresAt)) {
    return value as unknown as DocumentAgentGatewaySessionV1;
  }
  if (value.authenticated === false && value.expiresAt === null) {
    return value as unknown as DocumentAgentGatewaySessionV1;
  }
  return undefined;
}

export function prepareDocumentAgentRunGrantRequestV1(
  request: DocumentAgentRequestV1,
): DocumentAgentRunGrantRequestV1 {
  return Object.freeze({
    kind: DOCUMENT_AGENT_GATEWAY_GRANT_REQUEST_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    requestId: request.requestId,
    consentRecordedAt: request.consent.recordedAt,
    providerTarget: Object.freeze({ ...request.payload.providerTarget }),
    previewDigest: Object.freeze({ ...request.consent.previewDigest }),
    previewByteCount: request.consent.previewByteCount,
  });
}

export function parseDocumentAgentRunGrantRequestV1(
  value: unknown,
): DocumentAgentRunGrantRequestV1 | undefined {
  if (!exactRecord(value, [
    'kind',
    'schemaVersion',
    'requestId',
    'consentRecordedAt',
    'providerTarget',
    'previewDigest',
    'previewByteCount',
  ])) return undefined;
  if (value.kind !== DOCUMENT_AGENT_GATEWAY_GRANT_REQUEST_KIND_V1
      || value.schemaVersion !== DOCUMENT_AGENT_SCHEMA_VERSION_V1
      || typeof value.requestId !== 'string'
      || !ID.test(value.requestId)
      || !canonicalTimestamp(value.consentRecordedAt)
      || !providerTarget(value.providerTarget)
      || !digest(value.previewDigest)
      || !Number.isSafeInteger(value.previewByteCount)
      || (value.previewByteCount as number) < 1
      || (value.previewByteCount as number) > 510 * 1024) return undefined;
  return value as unknown as DocumentAgentRunGrantRequestV1;
}

export function parseDocumentAgentRunGrantResponseV1(
  value: unknown,
): DocumentAgentRunGrantResponseV1 | undefined {
  if (!exactRecord(value, ['kind', 'schemaVersion', 'grantToken', 'expiresAt'])) return undefined;
  if (value.kind !== DOCUMENT_AGENT_GATEWAY_GRANT_RESPONSE_KIND_V1
      || value.schemaVersion !== DOCUMENT_AGENT_SCHEMA_VERSION_V1
      || typeof value.grantToken !== 'string'
      || !GRANT_TOKEN.test(value.grantToken)
      || !canonicalTimestamp(value.expiresAt)) return undefined;
  return value as unknown as DocumentAgentRunGrantResponseV1;
}
