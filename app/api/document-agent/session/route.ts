import {
  DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
} from '@/core/document-agent/v1';
import { readUtf8BodyWithinLimitV1 } from '@/server/model-council/bounded-body';
import {
  authenticateGatewaySessionV1,
  clearGatewaySessionCookieV1,
  gatewaySessionCookieV1,
  issueGatewaySessionV1,
  loadGatewayDatabaseV1,
  revokeGatewaySessionV1,
} from '@/server/document-agent/gateway-admission';
import { checkDocumentGatewayBoundaryV1 } from '@/server/document-agent/gateway-config';

const MAX_SESSION_BODY_BYTES = 1_024;
const HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function response(status: number, value: object, extraHeaders?: HeadersInit) {
  const headers = new Headers(HEADERS);
  if (extraHeaders) new Headers(extraHeaders).forEach((entry, name) => headers.set(name, entry));
  return new Response(JSON.stringify(value), { status, headers });
}

function issue(status: number, message: string) {
  return response(status, { issue: message, delivery: 'not_sent' });
}

async function publicBoundary(request: Request) {
  const boundary = checkDocumentGatewayBoundaryV1(request);
  if (!boundary.ok) return { response: issue(boundary.status, boundary.issue) } as const;
  if (boundary.configuration.mode !== 'invite') {
    return { response: issue(409, 'Anonymous gateway sessions are used only by the hosted invite deployment.') } as const;
  }
  const database = await loadGatewayDatabaseV1();
  if (!database) return { response: issue(503, 'The private-beta admission store is unavailable. No provider was contacted.') } as const;
  return { configuration: boundary.configuration, database } as const;
}

export async function GET(request: Request) {
  const boundary = await publicBoundary(request);
  if ('response' in boundary) return boundary.response;
  try {
    const session = await authenticateGatewaySessionV1(request, boundary.database);
    return session
      ? response(200, { kind: DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1, schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1, authenticated: true, expiresAt: new Date(session.expiresAt).toISOString() })
      : response(401, { kind: DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1, schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1, authenticated: false, expiresAt: null });
  } catch {
    return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');
  }
}

export async function POST(request: Request) {
  const boundary = await publicBoundary(request);
  if ('response' in boundary) return boundary.response;
  try {
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') ?? '')) {
      return issue(415, 'Content-Type must be application/json. No provider was contacted.');
    }
    const raw = await readUtf8BodyWithinLimitV1(request, MAX_SESSION_BODY_BYTES);
    if (!raw) return issue(413, 'The access request is empty or too large. No provider was contacted.');
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return issue(400, 'The access request is not valid JSON. No provider was contacted.'); }
    const accessPass = value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === 1 && 'accessPass' in value
      ? (value as { accessPass?: unknown }).accessPass
      : undefined;
    const current = await authenticateGatewaySessionV1(request, boundary.database);
    if (current) {
      return response(200, { kind: DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1, schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1, authenticated: true, expiresAt: new Date(current.expiresAt).toISOString() });
    }
    const created = await issueGatewaySessionV1(boundary.database, boundary.configuration, accessPass);
    if (!created.ok) {
      return created.reason === 'rate_limited'
        ? issue(429, 'Private-beta session capacity is exhausted. Try again later.')
        : issue(401, 'The private-beta access pass was not accepted.');
    }
    return response(201, {
      kind: DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1,
      schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
      authenticated: true,
      expiresAt: new Date(created.session.expiresAt).toISOString(),
    }, { 'set-cookie': gatewaySessionCookieV1(created.rawToken, created.session.expiresAt) });
  } catch {
    return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');
  }
}

export async function DELETE(request: Request) {
  const boundary = await publicBoundary(request);
  if ('response' in boundary) return boundary.response;
  try {
    const session = await authenticateGatewaySessionV1(request, boundary.database);
    if (session) await revokeGatewaySessionV1(boundary.database, session);
    return response(200, {
      kind: DOCUMENT_AGENT_GATEWAY_SESSION_KIND_V1,
      schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
      authenticated: false,
      expiresAt: null,
    }, { 'set-cookie': clearGatewaySessionCookieV1() });
  } catch {
    return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');
  }
}
