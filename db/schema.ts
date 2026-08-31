/**
 * D1 contains admission metadata only. These tables must never receive source
 * passages, PDF bytes, prompts, model output, filenames, raw IP addresses, or
 * raw session/grant credentials.
 */
export const CREATE_GATEWAY_SESSIONS_TABLE_V1 = `
CREATE TABLE IF NOT EXISTS paperwork_gateway_sessions (
  session_hash TEXT PRIMARY KEY NOT NULL CHECK (length(session_hash) = 64),
  invite_hash TEXT NOT NULL CHECK (length(invite_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT
`;

export const CREATE_GATEWAY_GRANTS_TABLE_V1 = `
CREATE TABLE IF NOT EXISTS paperwork_gateway_grants (
  grant_hash TEXT PRIMARY KEY NOT NULL CHECK (length(grant_hash) = 64),
  request_id TEXT NOT NULL UNIQUE,
  session_hash TEXT NOT NULL CHECK (length(session_hash) = 64),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  recipient TEXT NOT NULL,
  preview_digest TEXT NOT NULL CHECK (length(preview_digest) = 64),
  preview_bytes INTEGER NOT NULL,
  consent_at INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  cost_units INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('issued', 'in_flight', 'completed', 'failed', 'delivery_unknown')),
  lease_expires_at INTEGER,
  completed_at INTEGER
) STRICT
`;

export const CREATE_GATEWAY_SESSIONS_INVITE_CREATED_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_sessions_invite_created
ON paperwork_gateway_sessions(invite_hash, created_at)
`;

export const CREATE_GATEWAY_SESSIONS_CREATED_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_sessions_created
ON paperwork_gateway_sessions(created_at)
`;

export const CREATE_GATEWAY_GRANTS_SESSION_ISSUED_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_grants_session_issued
ON paperwork_gateway_grants(session_hash, issued_at)
`;

export const CREATE_GATEWAY_GRANTS_ISSUED_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_grants_issued
ON paperwork_gateway_grants(issued_at)
`;

export const CREATE_GATEWAY_GRANTS_CONSUMED_ISSUED_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_grants_consumed_issued
ON paperwork_gateway_grants(consumed_at, issued_at)
`;

export const CREATE_GATEWAY_GRANTS_SESSION_CONSUMED_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_grants_session_consumed
ON paperwork_gateway_grants(session_hash, consumed_at)
`;

export const CREATE_GATEWAY_GRANTS_CONSUMED_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_grants_consumed
ON paperwork_gateway_grants(consumed_at)
`;

export const CREATE_GATEWAY_GRANTS_ACTIVE_LEASE_INDEX_V1 = `
CREATE INDEX IF NOT EXISTS idx_paperwork_gateway_grants_active_lease
ON paperwork_gateway_grants(status, lease_expires_at)
`;

export const GATEWAY_SCHEMA_STATEMENTS_V1 = [
  CREATE_GATEWAY_SESSIONS_TABLE_V1,
  CREATE_GATEWAY_GRANTS_TABLE_V1,
  CREATE_GATEWAY_SESSIONS_INVITE_CREATED_INDEX_V1,
  CREATE_GATEWAY_SESSIONS_CREATED_INDEX_V1,
  CREATE_GATEWAY_GRANTS_SESSION_ISSUED_INDEX_V1,
  CREATE_GATEWAY_GRANTS_ISSUED_INDEX_V1,
  CREATE_GATEWAY_GRANTS_CONSUMED_ISSUED_INDEX_V1,
  CREATE_GATEWAY_GRANTS_SESSION_CONSUMED_INDEX_V1,
  CREATE_GATEWAY_GRANTS_CONSUMED_INDEX_V1,
  CREATE_GATEWAY_GRANTS_ACTIVE_LEASE_INDEX_V1,
] as const;
