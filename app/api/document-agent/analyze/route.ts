import {
  DOCUMENT_AGENT_RECEIPT_KIND_V1,
  DOCUMENT_AGENT_RESPONSE_KIND_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  parseDocumentAgentResponseV1,
  prepareDocumentAgentRunGrantRequestV1,
  verifyDocumentAgentRequestV1,
  type DocumentAgentProviderPolicyV1,
  type DocumentAgentResponseV1,
} from '@/core/document-agent/v1';
import { MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1 } from '@/core/model-council/v1';
import { readUtf8BodyWithinLimitV1 } from '@/server/model-council/bounded-body';
import { getProviderRuntimesV1, type ProviderRuntimeV1 } from '@/server/model-council/registry';
import { runDocumentAgentProviderV1 } from '@/server/document-agent/providers';
import {
  authenticateGatewaySessionV1,
  completeGatewayGrantV1,
  consumeGatewayGrantV1,
  loadGatewayDatabaseV1,
  type GatewaySessionV1,
} from '@/server/document-agent/gateway-admission';
import {
  checkDocumentGatewayBoundaryV1,
  type InviteDocumentGatewayConfigurationV1,
} from '@/server/document-agent/gateway-config';

const MAX_BODY_BYTES = 512 * 1024;
const CONSENT_MAX_AGE_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const MAX_ACTIVE_REQUESTS = 2;
const replayWindow = new Map<string, number>();
let activeRequests = 0;

const HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function issue(status: number, message: string, delivery: 'not_sent' | 'unknown' = 'not_sent') {
  return new Response(JSON.stringify({ issue: message, delivery }), { status, headers: HEADERS });
}

function reserve(requestId: string, now: number) {
  for (const [seen, expiresAt] of replayWindow) if (expiresAt <= now) replayWindow.delete(seen);
  if (replayWindow.has(requestId)) return false;
  replayWindow.set(requestId, now + CONSENT_MAX_AGE_MS + CLOCK_SKEW_MS);
  return true;
}

function policy(runtime: ProviderRuntimeV1): DocumentAgentProviderPolicyV1 {
  return {
    retention: runtime.id === 'ollama' ? 'unknown' : 'provider_policy',
    trainingUse: runtime.id === 'deepseek' ? 'may_be_used' : 'unknown',
    assertedBy: runtime.displayName,
    policyUrl: runtime.privacyUrl,
  };
}

export async function POST(request: Request) {
  const gatewayStartedAt = new Date().toISOString();
  const boundary = checkDocumentGatewayBoundaryV1(request);
  if (!boundary.ok) return issue(boundary.status, boundary.issue);
  let database: D1Database | undefined;
  let session: GatewaySessionV1 | undefined;
  let publicConfiguration: InviteDocumentGatewayConfigurationV1 | undefined;
  if (boundary.configuration.mode === 'invite') {
    publicConfiguration = boundary.configuration;
    database = await loadGatewayDatabaseV1();
    if (!database) return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');
    try { session = await authenticateGatewaySessionV1(request, database); } catch {
      return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');
    }
    if (!session) return issue(401, 'A valid private-beta session is required. No provider was contacted.');
  }
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') ?? '')) return issue(415, 'Content-Type must be application/json. No provider was contacted.');
  if (request.headers.get('x-paperwork-catalog-version') !== MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1) return issue(409, 'The provider catalog changed. Preview the analysis again.');

  let raw: string | undefined;
  try { raw = await readUtf8BodyWithinLimitV1(request, MAX_BODY_BYTES); } catch { return issue(400, 'The request body could not be read. No provider was contacted.'); }
  if (!raw) return issue(413, 'The document-agent request is empty or too large. No provider was contacted.');
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return issue(400, 'The request is not valid JSON. No provider was contacted.'); }
  const verified = await verifyDocumentAgentRequestV1(input);
  if (!verified.ok) return issue(400, 'The request did not match its strict payload and consent contract. No provider was contacted.');
  const target = verified.value.payload.providerTarget;
  if (target.provider === 'ollama') return issue(409, 'Loopback Ollama must be contacted directly by the browser. No provider was contacted.');

  const now = Date.now();
  const consentAge = now - Date.parse(verified.value.consent.recordedAt);
  if (!Number.isFinite(consentAge) || consentAge < -CLOCK_SKEW_MS || consentAge > CONSENT_MAX_AGE_MS) return issue(409, 'Consent expired. Preview the analysis again.');
  const runtime = getProviderRuntimesV1(process.env, 'document_agent').find((candidate) => candidate.id === target.provider);
  if (!runtime || !runtime.enabled || runtime.model !== target.model || runtime.recipient !== target.recipient) return issue(409, 'The selected model or recipient is unavailable or changed. Preview again.');
  let grantHash: string | undefined;
  if (publicConfiguration && database && session) {
    let consumed;
    try {
      consumed = await consumeGatewayGrantV1(
        request,
        database,
        publicConfiguration,
        session,
        prepareDocumentAgentRunGrantRequestV1(verified.value),
        now,
      );
    } catch {
      return issue(503, 'The private-beta admission store is unavailable. No provider was contacted.');
    }
    if (!consumed.ok) {
      return consumed.reason === 'capacity_exhausted'
        ? issue(429, 'This session or deployment has reached its current model budget. No provider was contacted.')
        : issue(409, 'The one-use run grant is invalid, expired, changed, or already used. No provider was contacted.');
    }
    grantHash = consumed.grantHash;
  } else {
    if (activeRequests >= MAX_ACTIVE_REQUESTS) return issue(429, 'The document gateway is busy. Generate a fresh preview before retrying.');
    if (!reserve(verified.value.requestId, now)) return issue(409, 'This document-agent request was already used. Generate a fresh preview.');
  }

  const tracksLocalConcurrency = boundary.configuration.mode === 'local_development';
  if (tracksLocalConcurrency) activeRequests += 1;
  let result;
  try {
    result = await runDocumentAgentProviderV1(runtime, verified.value.payload, { signal: request.signal });
  } catch {
    if (grantHash && database) {
      try { await completeGatewayGrantV1(database, grantHash, 'delivery_unknown'); } catch { /* lease expiry remains the fail-safe */ }
    }
    return issue(502, 'The document provider run ended unexpectedly. Delivery status is unknown.', 'unknown');
  } finally {
    if (tracksLocalConcurrency) activeRequests -= 1;
  }
  if (grantHash && database) {
    const status = result.status === 'completed'
      ? 'completed'
      : result.status === 'failed' && (result.issueCode === 'network_failure' || result.issueCode === 'provider_timeout')
        ? 'delivery_unknown'
        : 'failed';
    try { await completeGatewayGrantV1(database, grantHash, status); } catch { /* admission lease expires automatically */ }
  }
  const gatewayCompletedAt = new Date().toISOString();
  const digest = verified.value.consent.previewDigest;
  const bytes = verified.value.consent.previewByteCount;
  const transferStatus = result.status === 'completed'
    ? 'completed'
    : result.status === 'failed'
      ? result.issueCode === 'network_failure' || result.issueCode === 'provider_timeout'
        ? 'delivery_unknown'
        : 'failed'
      : 'not_sent';
  const startedAt = result.status === 'unavailable' ? null : result.startedAt;
  const completedAt = result.status === 'unavailable' ? null : result.completedAt;
  const response: DocumentAgentResponseV1 = {
    kind: DOCUMENT_AGENT_RESPONSE_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    requestId: verified.value.requestId,
    result,
    receipt: {
      kind: DOCUMENT_AGENT_RECEIPT_KIND_V1,
      schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
      receiptId: `receipt.${crypto.randomUUID()}`,
      requestId: verified.value.requestId,
      consent: verified.value.consent,
      gatewayTransfer: {
        recipient: 'PaperWork model gateway',
        status: 'completed',
        startedAt: gatewayStartedAt,
        completedAt: gatewayCompletedAt,
        payloadDigest: digest,
        payloadByteCount: bytes,
      },
      transfer: {
        provider: result.provider,
        model: result.model,
        recipient: runtime.recipient,
        channel: 'gateway_to_provider',
        status: transferStatus,
        startedAt,
        completedAt,
        payloadDigest: digest,
        payloadByteCount: bytes,
        providerPolicy: policy(runtime),
      },
    },
  };
  const parsed = parseDocumentAgentResponseV1(response, verified.value.payload.segments, {
    requestId: verified.value.requestId,
    previewDigest: digest,
    previewByteCount: bytes,
    providerTarget: target,
  });
  if (!parsed.ok) return issue(500, 'PaperWork safely withheld an invalid document-agent response.', 'unknown');
  return new Response(JSON.stringify(parsed.value), { status: 200, headers: HEADERS });
}
