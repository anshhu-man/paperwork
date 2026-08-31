import {
  DOCUMENT_AGENT_GATEWAY_GRANT_RESPONSE_KIND_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  parseDocumentAgentRunGrantRequestV1,
} from '@/core/document-agent/v1';
import { MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1 } from '@/core/model-council/v1';
import { readUtf8BodyWithinLimitV1 } from '@/server/model-council/bounded-body';
import { getProviderRuntimesV1 } from '@/server/model-council/registry';
import {
  authenticateGatewaySessionV1,
  issueGatewayGrantV1,
  loadGatewayDatabaseV1,
} from '@/server/document-agent/gateway-admission';
import { checkDocumentGatewayBoundaryV1 } from '@/server/document-agent/gateway-config';

const MAX_GRANT_BODY_BYTES = 8 * 1_024;
const CONSENT_MAX_AGE_MS = 15 * 60 * 1_000;
const CLOCK_SKEW_MS = 60 * 1_000;
const HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function issue(status: number, message: string) {
  return new Response(JSON.stringify({ issue: message, delivery: 'not_sent' }), { status, headers: HEADERS });
}

export async function POST(request: Request) {
  const boundary = checkDocumentGatewayBoundaryV1(request);
  if (!boundary.ok) return issue(boundary.status, boundary.issue);
  if (boundary.configuration.mode !== 'invite') return issue(409, 'Run grants are used only by the hosted invite deployment.');
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') ?? '')) return issue(415, 'Content-Type must be application/json. No provider was contacted.');
  if (request.headers.get('x-paperwork-catalog-version') !== MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1) return issue(409, 'The provider catalog changed. Preview the analysis again.');
  const database = await loadGatewayDatabaseV1();
  if (!database) return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');

  try {
    const session = await authenticateGatewaySessionV1(request, database);
    if (!session) return issue(401, 'A valid private-beta session is required. No provider was contacted.');
    const raw = await readUtf8BodyWithinLimitV1(request, MAX_GRANT_BODY_BYTES);
    if (!raw) return issue(413, 'The run-grant request is empty or too large. No provider was contacted.');
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return issue(400, 'The run-grant request is not valid JSON. No provider was contacted.'); }
    const parsed = parseDocumentAgentRunGrantRequestV1(input);
    if (!parsed) return issue(400, 'The run-grant request did not match its closed contract. No provider was contacted.');
    const now = Date.now();
    const consentAge = now - Date.parse(parsed.consentRecordedAt);
    if (!Number.isFinite(consentAge) || consentAge < -CLOCK_SKEW_MS || consentAge > CONSENT_MAX_AGE_MS) return issue(409, 'Consent expired. Preview the analysis again.');
    const target = parsed.providerTarget;
    const runtime = getProviderRuntimesV1(process.env, 'document_agent').find((candidate) => candidate.id === target.provider);
    if (!runtime || !runtime.enabled || runtime.id === 'ollama' || runtime.model !== target.model || runtime.recipient !== target.recipient) {
      return issue(409, 'The selected model or recipient is unavailable or changed. Preview again.');
    }
    const grant = await issueGatewayGrantV1(database, boundary.configuration, session, parsed, now);
    if (!grant.ok) {
      return grant.reason === 'duplicate'
        ? issue(409, 'This approved request already has or used a run grant. Generate a fresh preview.')
        : issue(429, 'Too many unused run grants exist for this private session.');
    }
    return new Response(JSON.stringify({
      kind: DOCUMENT_AGENT_GATEWAY_GRANT_RESPONSE_KIND_V1,
      schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
      grantToken: grant.rawToken,
      expiresAt: new Date(grant.expiresAt).toISOString(),
    }), { status: 201, headers: HEADERS });
  } catch {
    return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');
  }
}
