import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';

import {
  DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1,
  DOCUMENT_AGENT_GATEWAY_GRANT_REQUEST_KIND_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  parseDocumentAgentRunGrantRequestV1,
  parseDocumentAgentRunGrantResponseV1,
  parseDocumentAgentGatewaySessionV1,
  type DocumentAgentRunGrantRequestV1,
} from '@/core/document-agent/v1';
import type { InviteDocumentGatewayConfigurationV1 } from './gateway-config';
import {
  authenticateGatewaySessionV1,
  completeGatewayGrantV1,
  consumeGatewayGrantV1,
  ensureGatewaySchemaV1,
  estimateGatewayCostUnitsV1,
  gatewaySessionCookieV1,
  hashGatewaySecretV1,
  issueGatewayGrantV1,
  issueGatewaySessionV1,
  revokeGatewaySessionV1,
} from './gateway-admission';

const ACCESS_PASS = 'paperwork-test-access-pass';
let sqlite: DatabaseSync;
let database: D1Database;
let configuration: InviteDocumentGatewayConfigurationV1;

class SqliteStatementAdapter {
  constructor(
    private readonly connection: DatabaseSync,
    private readonly query: string,
    private readonly values: readonly unknown[] = [],
  ) {}

  bind(...values: unknown[]) { return new SqliteStatementAdapter(this.connection, this.query, values); }
  async run() {
    const result = this.connection.prepare(this.query).run(...this.values as never[]);
    return {
      success: true,
      results: [],
      meta: {
        duration: 0,
        size_after: 0,
        rows_read: 0,
        rows_written: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
        changed_db: Number(result.changes) > 0,
        changes: Number(result.changes),
      },
    };
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.connection.prepare(this.query).get(...this.values as never[]) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async all<T = Record<string, unknown>>() {
    return { success: true, results: this.connection.prepare(this.query).all(...this.values as never[]) as T[], meta: {} };
  }
}

class SqliteD1Adapter {
  constructor(private readonly connection: DatabaseSync) {}
  prepare(query: string) { return new SqliteStatementAdapter(this.connection, query); }
  async batch(statements: SqliteStatementAdapter[]) { return Promise.all(statements.map((statement) => statement.run())); }
}

function grantRequest(suffix: string): DocumentAgentRunGrantRequestV1 {
  return {
    kind: DOCUMENT_AGENT_GATEWAY_GRANT_REQUEST_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    requestId: `request.${suffix}`,
    consentRecordedAt: '2026-08-31T10:00:00.000Z',
    providerTarget: { provider: 'openai', model: 'openai-test-model', recipient: 'OpenAI API' },
    previewDigest: { algorithm: 'sha-256', value: 'a'.repeat(64) },
    previewByteCount: 12_000,
  };
}

before(async () => {
  sqlite = new DatabaseSync(':memory:');
  database = new SqliteD1Adapter(sqlite) as unknown as D1Database;
  configuration = {
    mode: 'invite',
    enabled: true,
    appOrigin: 'https://paperwork.example',
    inviteDigest: await hashGatewaySecretV1(ACCESS_PASS),
    publicProvider: 'openai',
    sessionTtlMs: 8 * 60 * 60 * 1_000,
    grantTtlMs: 5 * 60 * 1_000,
    metadataRetentionMs: 24 * 60 * 60 * 1_000,
    maxSessionsPerHour: 10,
    maxOpenGrants: 3,
    maxGrantIssuesPerHour: 10,
    globalMaxGrantIssuesPerHour: 100,
    maxRequestsPerHour: 10,
    sessionDailyCostUnits: 1_000,
    globalDailyCostUnits: 10_000,
    maxConcurrentRequests: 1,
  };
  await ensureGatewaySchemaV1(database);
});

after(() => sqlite.close());

test('gateway contracts reject extra fields and malformed grant tokens', () => {
  const request = grantRequest('contract');
  assert.deepEqual(parseDocumentAgentRunGrantRequestV1(request), request);
  assert.equal(parseDocumentAgentRunGrantRequestV1({ ...request, documentText: 'must not be accepted' }), undefined);
  assert.equal(parseDocumentAgentRunGrantResponseV1({
    kind: 'paperwork.document_agent_run_grant_response',
    schemaVersion: '1.0.0',
    grantToken: 'grant.not-valid',
    expiresAt: '2026-08-31T10:05:00.000Z',
  }), undefined);
  assert.deepEqual(parseDocumentAgentGatewaySessionV1({
    kind: 'paperwork.gateway_session',
    schemaVersion: '1.0.0',
    authenticated: true,
    expiresAt: '2026-08-31T18:00:00.000Z',
  }), {
    kind: 'paperwork.gateway_session',
    schemaVersion: '1.0.0',
    authenticated: true,
    expiresAt: '2026-08-31T18:00:00.000Z',
  });
  assert.equal(parseDocumentAgentGatewaySessionV1({
    kind: 'paperwork.gateway_session',
    schemaVersion: '1.0.0',
    authenticated: false,
    expiresAt: '2026-08-31T18:00:00.000Z',
  }), undefined);
});

test('revoking a session atomically prevents its unused grant from starting delivery', async () => {
  const now = Date.parse('2026-08-31T09:30:01.000Z');
  const issuedSession = await issueGatewaySessionV1(database, configuration, ACCESS_PASS, now);
  assert.equal(issuedSession.ok, true);
  if (!issuedSession.ok) return;
  const approved = grantRequest('revoked-session');
  const issuedGrant = await issueGatewayGrantV1(database, configuration, issuedSession.session, approved, now);
  assert.equal(issuedGrant.ok, true);
  if (!issuedGrant.ok) return;
  await revokeGatewaySessionV1(database, issuedSession.session, now + 1);
  assert.deepEqual(
    await issueGatewayGrantV1(database, configuration, issuedSession.session, grantRequest('revoked-session-new'), now + 2),
    { ok: false, reason: 'rate_limited' },
  );
  const consumed = await consumeGatewayGrantV1(new Request('https://paperwork.example', {
    headers: { [DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1]: issuedGrant.rawToken },
  }), database, configuration, issuedSession.session, approved, now + 2);
  assert.deepEqual(consumed, { ok: false, reason: 'invalid_or_used' });
});

test('D1 bounds unused grant issuance independently of provider-call quotas', async () => {
  const isolatedSqlite = new DatabaseSync(':memory:');
  const isolatedDatabase = new SqliteD1Adapter(isolatedSqlite) as unknown as D1Database;
  await ensureGatewaySchemaV1(isolatedDatabase);
  const now = Date.parse('2026-09-03T10:00:01.000Z');
  const limited = {
    ...configuration,
    maxGrantIssuesPerHour: 1,
    globalMaxGrantIssuesPerHour: 1,
  };
  try {
    const issuedSession = await issueGatewaySessionV1(isolatedDatabase, limited, ACCESS_PASS, now);
    assert.equal(issuedSession.ok, true);
    if (!issuedSession.ok) return;
    assert.equal((await issueGatewayGrantV1(isolatedDatabase, limited, issuedSession.session, grantRequest('grant-rate-a'), now)).ok, true);
    assert.deepEqual(
      await issueGatewayGrantV1(isolatedDatabase, limited, issuedSession.session, grantRequest('grant-rate-b'), now + 1),
      { ok: false, reason: 'rate_limited' },
    );
    const secondSession = await issueGatewaySessionV1(isolatedDatabase, limited, ACCESS_PASS, now + 2);
    assert.equal(secondSession.ok, true);
    if (secondSession.ok) {
      assert.deepEqual(
        await issueGatewayGrantV1(isolatedDatabase, limited, secondSession.session, grantRequest('grant-rate-c'), now + 3),
        { ok: false, reason: 'rate_limited' },
      );
    }
  } finally {
    isolatedSqlite.close();
  }
});

test('cost units include fixed prompt/schema framing and a byte-derived input bound', () => {
  assert.ok(estimateGatewayCostUnitsV1(1) > 4);
  assert.ok(estimateGatewayCostUnitsV1(12_000) > 8);
});

test('D1 session and one-use grant bind the exact approved target and digest', async () => {
  const now = Date.parse('2026-08-31T10:00:01.000Z');
  const issuedSession = await issueGatewaySessionV1(database, configuration, ACCESS_PASS, now);
  assert.equal(issuedSession.ok, true);
  if (!issuedSession.ok) return;
  assert.equal(await issueGatewaySessionV1(database, configuration, 'wrong-access-pass-value', now).then((value) => value.ok), false);
  const cookie = gatewaySessionCookieV1(issuedSession.rawToken, issuedSession.session.expiresAt, now);
  const authenticated = await authenticateGatewaySessionV1(new Request('https://paperwork.example', {
    headers: { cookie: cookie.split(';')[0] },
  }), database, now);
  assert.equal(authenticated?.sessionHash, issuedSession.session.sessionHash);

  const approved = grantRequest('one-use');
  const issuedGrant = await issueGatewayGrantV1(database, configuration, issuedSession.session, approved, now);
  assert.equal(issuedGrant.ok, true);
  if (!issuedGrant.ok) return;
  const analyzeRequest = new Request('https://paperwork.example/api/document-agent/analyze', {
    headers: { [DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1]: issuedGrant.rawToken },
  });
  const changed = structuredClone(approved);
  (changed.providerTarget as { model: string }).model = 'changed-model';
  assert.deepEqual(await consumeGatewayGrantV1(analyzeRequest, database, configuration, issuedSession.session, changed, now), {
    ok: false,
    reason: 'invalid_or_used',
  });
  const consumed = await consumeGatewayGrantV1(analyzeRequest, database, configuration, issuedSession.session, approved, now);
  assert.equal(consumed.ok, true);
  if (!consumed.ok) return;
  assert.equal(consumed.costUnits, estimateGatewayCostUnitsV1(approved.previewByteCount));
  assert.deepEqual(await consumeGatewayGrantV1(analyzeRequest, database, configuration, issuedSession.session, approved, now), {
    ok: false,
    reason: 'invalid_or_used',
  });
  await completeGatewayGrantV1(database, consumed.grantHash, 'completed', now + 1_000);

  const stored = await database.prepare('SELECT * FROM paperwork_gateway_grants WHERE grant_hash = ?')
    .bind(consumed.grantHash).first<Record<string, unknown>>();
  assert.equal(stored?.status, 'completed');
  assert.equal(JSON.stringify(stored).includes('documentText'), false);
  assert.equal(JSON.stringify(stored).includes(ACCESS_PASS), false);
});

test('D1 admission enforces global in-flight concurrency before provider delivery', async () => {
  const now = Date.parse('2026-08-31T11:00:01.000Z');
  const firstSession = await issueGatewaySessionV1(database, configuration, ACCESS_PASS, now);
  assert.equal(firstSession.ok, true);
  if (!firstSession.ok) return;
  const firstRequest = grantRequest('concurrency-a');
  const firstGrant = await issueGatewayGrantV1(database, configuration, firstSession.session, firstRequest, now);
  assert.equal(firstGrant.ok, true);
  if (!firstGrant.ok) return;
  const firstConsume = await consumeGatewayGrantV1(new Request('https://paperwork.example', {
    headers: { [DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1]: firstGrant.rawToken },
  }), database, configuration, firstSession.session, firstRequest, now);
  assert.equal(firstConsume.ok, true);

  const secondRequest = grantRequest('concurrency-b');
  const secondGrant = await issueGatewayGrantV1(database, configuration, firstSession.session, secondRequest, now + 1);
  assert.equal(secondGrant.ok, true);
  if (!secondGrant.ok) return;
  const secondConsume = await consumeGatewayGrantV1(new Request('https://paperwork.example', {
    headers: { [DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1]: secondGrant.rawToken },
  }), database, configuration, firstSession.session, secondRequest, now + 1);
  assert.deepEqual(secondConsume, { ok: false, reason: 'capacity_exhausted' });
  if (firstConsume.ok) await completeGatewayGrantV1(database, firstConsume.grantHash, 'failed', now + 2);
});

test('expired in-flight leases reconcile to delivery unknown on later admission', async () => {
  const isolatedSqlite = new DatabaseSync(':memory:');
  const isolatedDatabase = new SqliteD1Adapter(isolatedSqlite) as unknown as D1Database;
  await ensureGatewaySchemaV1(isolatedDatabase);
  const now = Date.parse('2026-09-03T12:00:01.000Z');
  try {
    const issuedSession = await issueGatewaySessionV1(isolatedDatabase, configuration, ACCESS_PASS, now);
    assert.equal(issuedSession.ok, true);
    if (!issuedSession.ok) return;
    const approved = grantRequest('abandoned-lease');
    const issuedGrant = await issueGatewayGrantV1(isolatedDatabase, configuration, issuedSession.session, approved, now);
    assert.equal(issuedGrant.ok, true);
    if (!issuedGrant.ok) return;
    const consumed = await consumeGatewayGrantV1(new Request('https://paperwork.example', {
      headers: { [DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1]: issuedGrant.rawToken },
    }), isolatedDatabase, configuration, issuedSession.session, approved, now);
    assert.equal(consumed.ok, true);
    if (!consumed.ok) return;

    await issueGatewaySessionV1(isolatedDatabase, configuration, ACCESS_PASS, now + 91_000);
    const reconciled = await isolatedDatabase.prepare('SELECT status, lease_expires_at FROM paperwork_gateway_grants WHERE grant_hash = ?')
      .bind(consumed.grantHash).first<{ status: string; lease_expires_at: number | null }>();
    assert.equal(reconciled?.status, 'delivery_unknown');
    assert.equal(reconciled?.lease_expires_at, null);
  } finally {
    isolatedSqlite.close();
  }
});

test('cleanup preserves consumed cost for its complete rolling daily window', async () => {
  const issuedAt = Date.parse('2026-09-04T10:00:01.000Z');
  const consumedAt = issuedAt + configuration.grantTtlMs - 1;
  const issuedSession = await issueGatewaySessionV1(database, configuration, ACCESS_PASS, issuedAt);
  assert.equal(issuedSession.ok, true);
  if (!issuedSession.ok) return;
  const approved = grantRequest('rolling-cost');
  const issuedGrant = await issueGatewayGrantV1(database, configuration, issuedSession.session, approved, issuedAt);
  assert.equal(issuedGrant.ok, true);
  if (!issuedGrant.ok) return;
  const consumed = await consumeGatewayGrantV1(new Request('https://paperwork.example', {
    headers: { [DOCUMENT_AGENT_GATEWAY_GRANT_HEADER_V1]: issuedGrant.rawToken },
  }), database, configuration, issuedSession.session, approved, consumedAt);
  assert.equal(consumed.ok, true);
  if (!consumed.ok) return;

  const cleanupAt = issuedAt + configuration.metadataRetentionMs + 1;
  await issueGatewaySessionV1(database, configuration, ACCESS_PASS, cleanupAt);
  const retained = await database.prepare('SELECT cost_units FROM paperwork_gateway_grants WHERE grant_hash = ?')
    .bind(consumed.grantHash).first<{ cost_units: number }>();
  assert.equal(retained?.cost_units, consumed.costUnits);
});
