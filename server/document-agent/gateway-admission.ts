import {
  DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1,
  DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1,
  PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1,
  type DocumentAgentRunGrantRequestV1,
} from '@/core/document-agent/v1';
import { GATEWAY_SCHEMA_STATEMENTS_V1 } from '@/db/schema';
import {
  DOCUMENT_GATEWAY_SESSION_COOKIE_V1,
  type InviteDocumentGatewayConfigurationV1,
} from '@/server/document-agent/gateway-config';

export interface GatewaySessionV1 {
  readonly sessionHash: string;
  readonly expiresAt: number;
}

export type GatewaySessionIssueV1 =
  | { readonly ok: true; readonly session: GatewaySessionV1; readonly rawToken: string }
  | { readonly ok: false; readonly reason: 'invalid_pass' | 'rate_limited' };

export type GatewayGrantIssueV1 =
  | { readonly ok: true; readonly rawToken: string; readonly grantHash: string; readonly expiresAt: number }
  | { readonly ok: false; readonly reason: 'duplicate' | 'rate_limited' };

export type GatewayGrantConsumeV1 =
  | { readonly ok: true; readonly grantHash: string; readonly costUnits: number }
  | { readonly ok: false; readonly reason: 'invalid_or_used' | 'capacity_exhausted' };

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
// Keep the D1 concurrency lease comfortably beyond the 45-second provider timeout.
const PROVIDER_LEASE_MS = 90_000;
const MAX_OUTPUT_TOKENS = 4_000;
const FIXED_PROVIDER_INPUT_BYTE_BOUND = new TextEncoder().encode(
  `${DOCUMENT_AGENT_SYSTEM_INSTRUCTIONS_V1}${JSON.stringify(PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA_V1)}`,
).byteLength + 8 * 1_024;
const schemaPromises = new WeakMap<object, Promise<void>>();

function isD1Database(value: unknown): value is D1Database {
  return Boolean(value && typeof value === 'object'
    && typeof (value as { prepare?: unknown }).prepare === 'function'
    && typeof (value as { batch?: unknown }).batch === 'function');
}

export async function loadGatewayDatabaseV1(): Promise<D1Database | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    const candidate = (env as unknown as Record<string, unknown>).DB;
    return isD1Database(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export async function ensureGatewaySchemaV1(database: D1Database) {
  const cached = schemaPromises.get(database);
  if (cached) return cached;
  const pending = database.batch(GATEWAY_SCHEMA_STATEMENTS_V1.map((statement) => database.prepare(statement))).then(() => undefined);
  schemaPromises.set(database, pending);
  try {
    await pending;
  } catch (error) {
    schemaPromises.delete(database);
    throw error;
  }
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashGatewaySecretV1(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function equalHex(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function randomToken(prefix: 'session' | 'grant') {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `${prefix}.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`;
}

async function cleanupGatewayMetadataV1(
  database: D1Database,
  configuration: InviteDocumentGatewayConfigurationV1,
  now: number,
) {
  const cutoff = now - configuration.metadataRetentionMs;
  await database.batch([
    database.prepare(`
      UPDATE paperwork_gateway_grants
      SET status = 'delivery_unknown', completed_at = ?, lease_expires_at = NULL
      WHERE status = 'in_flight' AND lease_expires_at <= ?
    `).bind(now, now),
    database.prepare('DELETE FROM paperwork_gateway_grants WHERE consumed_at IS NULL AND issued_at < ?').bind(cutoff),
    database.prepare('DELETE FROM paperwork_gateway_grants WHERE consumed_at IS NOT NULL AND consumed_at < ?').bind(cutoff),
    database.prepare('DELETE FROM paperwork_gateway_sessions WHERE created_at < ?').bind(cutoff),
  ]);
}

export async function validateGatewayInvitePassV1(
  accessPass: unknown,
  configuration: InviteDocumentGatewayConfigurationV1,
) {
  if (typeof accessPass !== 'string') return false;
  const bytes = new TextEncoder().encode(accessPass);
  if (bytes.byteLength < 16 || bytes.byteLength > 256) return false;
  return equalHex(await hashGatewaySecretV1(accessPass), configuration.inviteDigest);
}

export async function issueGatewaySessionV1(
  database: D1Database,
  configuration: InviteDocumentGatewayConfigurationV1,
  accessPass: unknown,
  now = Date.now(),
): Promise<GatewaySessionIssueV1> {
  if (!await validateGatewayInvitePassV1(accessPass, configuration)) return { ok: false, reason: 'invalid_pass' };
  await ensureGatewaySchemaV1(database);
  await cleanupGatewayMetadataV1(database, configuration, now);
  const rawToken = randomToken('session');
  const sessionHash = await hashGatewaySecretV1(rawToken);
  const expiresAt = now + configuration.sessionTtlMs;
  const result = await database.prepare(`
    INSERT INTO paperwork_gateway_sessions (
      session_hash, invite_hash, created_at, expires_at, revoked_at
    )
    SELECT ?, ?, ?, ?, NULL
    WHERE (
      SELECT COUNT(*) FROM paperwork_gateway_sessions
      WHERE invite_hash = ? AND created_at >= ?
    ) < ?
  `).bind(
    sessionHash,
    configuration.inviteDigest,
    now,
    expiresAt,
    configuration.inviteDigest,
    now - HOUR_MS,
    configuration.maxSessionsPerHour,
  ).run();
  if (result.meta.changes !== 1) return { ok: false, reason: 'rate_limited' };
  return { ok: true, session: { sessionHash, expiresAt }, rawToken };
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function gatewaySessionCookieV1(rawToken: string, expiresAt: number, now = Date.now()) {
  const maxAge = Math.max(0, Math.floor((expiresAt - now) / 1_000));
  return `${DOCUMENT_GATEWAY_SESSION_COOKIE_V1}=${rawToken}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearGatewaySessionCookieV1() {
  return `${DOCUMENT_GATEWAY_SESSION_COOKIE_V1}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function authenticateGatewaySessionV1(
  request: Request,
  database: D1Database,
  now = Date.now(),
): Promise<GatewaySessionV1 | undefined> {
  const rawToken = cookieValue(request, DOCUMENT_GATEWAY_SESSION_COOKIE_V1);
  if (!rawToken || !/^session\.[A-Za-z0-9_-]{43}$/u.test(rawToken)) return undefined;
  await ensureGatewaySchemaV1(database);
  const sessionHash = await hashGatewaySecretV1(rawToken);
  const row = await database.prepare(`
    SELECT session_hash, expires_at
    FROM paperwork_gateway_sessions
    WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).bind(sessionHash, now).first<{ session_hash: string; expires_at: number }>();
  return row ? { sessionHash: row.session_hash, expiresAt: row.expires_at } : undefined;
}

export async function revokeGatewaySessionV1(
  database: D1Database,
  session: GatewaySessionV1,
  now = Date.now(),
) {
  await database.prepare(`
    UPDATE paperwork_gateway_sessions SET revoked_at = ?
    WHERE session_hash = ? AND revoked_at IS NULL
  `).bind(now, session.sessionHash).run();
}

export async function issueGatewayGrantV1(
  database: D1Database,
  configuration: InviteDocumentGatewayConfigurationV1,
  session: GatewaySessionV1,
  request: DocumentAgentRunGrantRequestV1,
  now = Date.now(),
): Promise<GatewayGrantIssueV1> {
  await ensureGatewaySchemaV1(database);
  await cleanupGatewayMetadataV1(database, configuration, now);
  const rawToken = randomToken('grant');
  const grantHash = await hashGatewaySecretV1(rawToken);
  const expiresAt = Math.min(now + configuration.grantTtlMs, session.expiresAt);
  const consentAt = Date.parse(request.consentRecordedAt);
  const result = await database.prepare(`
    INSERT INTO paperwork_gateway_grants (
      grant_hash, request_id, session_hash, provider, model, recipient,
      preview_digest, preview_bytes, consent_at, issued_at, expires_at,
      consumed_at, cost_units, status, lease_expires_at, completed_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'issued', NULL, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM paperwork_gateway_grants WHERE request_id = ?
    ) AND EXISTS (
      SELECT 1 FROM paperwork_gateway_sessions
      WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?
    ) AND (
      SELECT COUNT(*) FROM paperwork_gateway_grants
      WHERE session_hash = ? AND status = 'issued' AND expires_at > ?
    ) < ?
    AND (
      SELECT COUNT(*) FROM paperwork_gateway_grants
      WHERE session_hash = ? AND issued_at >= ?
    ) < ?
    AND (
      SELECT COUNT(*) FROM paperwork_gateway_grants
      WHERE issued_at >= ?
    ) < ?
  `).bind(
    grantHash,
    request.requestId,
    session.sessionHash,
    request.providerTarget.provider,
    request.providerTarget.model,
    request.providerTarget.recipient,
    request.previewDigest.value,
    request.previewByteCount,
    consentAt,
    now,
    expiresAt,
    request.requestId,
    session.sessionHash,
    now,
    session.sessionHash,
    now,
    configuration.maxOpenGrants,
    session.sessionHash,
    now - HOUR_MS,
    configuration.maxGrantIssuesPerHour,
    now - HOUR_MS,
    configuration.globalMaxGrantIssuesPerHour,
  ).run();
  if (result.meta.changes === 1) return { ok: true, rawToken, grantHash, expiresAt };
  const duplicate = await database.prepare(`
    SELECT request_id FROM paperwork_gateway_grants WHERE request_id = ?
  `).bind(request.requestId).first<{ request_id: string }>();
  return { ok: false, reason: duplicate ? 'duplicate' : 'rate_limited' };
}

export function estimateGatewayCostUnitsV1(previewByteCount: number) {
  // The canonical payload is JSON-encoded again inside provider input. Twice
  // its UTF-8 size plus fixed prompt/schema framing is a deliberately high
  // byte-derived token bound; the provider hard spend cap remains authoritative.
  const conservativeInputTokens = 2 * previewByteCount + FIXED_PROVIDER_INPUT_BYTE_BOUND;
  return Math.max(1, Math.ceil((conservativeInputTokens + MAX_OUTPUT_TOKENS) / 1_000));
}

export async function consumeGatewayGrantV1(
  request: Request,
  database: D1Database,
  configuration: InviteDocumentGatewayConfigurationV1,
  session: GatewaySessionV1,
  grantRequest: DocumentAgentRunGrantRequestV1,
  now = Date.now(),
): Promise<GatewayGrantConsumeV1> {
  const rawToken = request.headers.get(DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1);
  if (!rawToken || !/^grant\.[A-Za-z0-9_-]{43}$/u.test(rawToken)) {
    return { ok: false, reason: 'invalid_or_used' };
  }
  await ensureGatewaySchemaV1(database);
  const grantHash = await hashGatewaySecretV1(rawToken);
  const costUnits = estimateGatewayCostUnitsV1(grantRequest.previewByteCount);
  const consentAt = Date.parse(grantRequest.consentRecordedAt);
  const hourlyStart = now - HOUR_MS;
  const dailyStart = now - DAY_MS;
  const leaseExpiresAt = now + PROVIDER_LEASE_MS;
  const result = await database.prepare(`
    UPDATE paperwork_gateway_grants
    SET consumed_at = ?, cost_units = ?, status = 'in_flight', lease_expires_at = ?
    WHERE grant_hash = ?
      AND session_hash = ?
      AND request_id = ?
      AND provider = ?
      AND model = ?
      AND recipient = ?
      AND preview_digest = ?
      AND preview_bytes = ?
      AND consent_at = ?
      AND status = 'issued'
      AND consumed_at IS NULL
      AND expires_at >= ?
      AND EXISTS (
        SELECT 1 FROM paperwork_gateway_sessions
        WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?
      )
      AND (
        SELECT COUNT(*) FROM paperwork_gateway_grants
        WHERE session_hash = ? AND consumed_at >= ?
      ) < ?
      AND (
        SELECT COALESCE(SUM(cost_units), 0) FROM paperwork_gateway_grants
        WHERE session_hash = ? AND consumed_at >= ?
      ) + ? <= ?
      AND (
        SELECT COALESCE(SUM(cost_units), 0) FROM paperwork_gateway_grants
        WHERE consumed_at >= ?
      ) + ? <= ?
      AND (
        SELECT COUNT(*) FROM paperwork_gateway_grants
        WHERE status = 'in_flight' AND lease_expires_at > ?
      ) < ?
  `).bind(
    now,
    costUnits,
    leaseExpiresAt,
    grantHash,
    session.sessionHash,
    grantRequest.requestId,
    grantRequest.providerTarget.provider,
    grantRequest.providerTarget.model,
    grantRequest.providerTarget.recipient,
    grantRequest.previewDigest.value,
    grantRequest.previewByteCount,
    consentAt,
    now,
    session.sessionHash,
    now,
    session.sessionHash,
    hourlyStart,
    configuration.maxRequestsPerHour,
    session.sessionHash,
    dailyStart,
    costUnits,
    configuration.sessionDailyCostUnits,
    dailyStart,
    costUnits,
    configuration.globalDailyCostUnits,
    now,
    configuration.maxConcurrentRequests,
  ).run();
  if (result.meta.changes === 1) return { ok: true, grantHash, costUnits };
  const row = await database.prepare(`
    SELECT status, consumed_at, expires_at FROM paperwork_gateway_grants
    WHERE grant_hash = ?
      AND session_hash = ?
      AND request_id = ?
      AND provider = ?
      AND model = ?
      AND recipient = ?
      AND preview_digest = ?
      AND preview_bytes = ?
      AND consent_at = ?
      AND EXISTS (
        SELECT 1 FROM paperwork_gateway_sessions
        WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?
      )
  `).bind(
    grantHash,
    session.sessionHash,
    grantRequest.requestId,
    grantRequest.providerTarget.provider,
    grantRequest.providerTarget.model,
    grantRequest.providerTarget.recipient,
    grantRequest.previewDigest.value,
    grantRequest.previewByteCount,
    consentAt,
    session.sessionHash,
    now,
  ).first<{ status: string; consumed_at: number | null; expires_at: number }>();
  if (row && row.status === 'issued' && row.consumed_at === null && row.expires_at >= now) {
    return { ok: false, reason: 'capacity_exhausted' };
  }
  return { ok: false, reason: 'invalid_or_used' };
}

export async function completeGatewayGrantV1(
  database: D1Database,
  grantHash: string,
  status: 'completed' | 'failed' | 'delivery_unknown',
  now = Date.now(),
) {
  await database.prepare(`
    UPDATE paperwork_gateway_grants
    SET status = ?, completed_at = ?, lease_expires_at = NULL
    WHERE grant_hash = ? AND status = 'in_flight'
  `).bind(status, now, grantHash).run();
}
