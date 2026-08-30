import {
  MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
  MODEL_COUNCIL_RECEIPT_KIND_V1,
  MODEL_COUNCIL_RESPONSE_KIND_V1,
  MODEL_COUNCIL_SCHEMA_VERSION_V1,
  buildModelCouncilConsensusV1,
  parseModelCouncilResponseV1,
  verifyModelCouncilRequestV1,
  type ModelCouncilProviderPolicyV1,
  type ModelCouncilResponseV1,
  type ModelCouncilRunResultV1,
  type ModelCouncilTransferReceiptV1,
  type ProviderIdV1,
} from '@/core/model-council/v1';
import { runProviderV1 } from '@/server/model-council/providers';
import { getProviderRuntimesV1, type ProviderRuntimeV1 } from '@/server/model-council/registry';
import { readUtf8BodyWithinLimitV1 } from '@/server/model-council/bounded-body';

const MAX_GATEWAY_BODY_BYTES = 512 * 1024;
const CONSENT_MAX_AGE_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const MAX_ACTIVE_COUNCIL_REQUESTS = 2;
const replayWindow = new Map<string, number>();
let activeCouncilRequests = 0;

const HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function jsonIssue(status: number, issue: string, delivery: 'not_sent' | 'unknown' = 'not_sent') {
  return new Response(JSON.stringify({ issue, delivery }), { status, headers: HEADERS });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isLoopbackRequest(request: Request) {
  try {
    const hostname = new URL(request.url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function providerPolicy(runtime: ProviderRuntimeV1): ModelCouncilProviderPolicyV1 {
  return {
    retention: runtime.id === 'ollama' ? 'unknown' : 'provider_policy',
    trainingUse: runtime.id === 'deepseek' ? 'may_be_used' : 'unknown',
    assertedBy: runtime.id === 'ollama' ? 'Self-host operator configuration' : runtime.displayName,
    policyUrl: runtime.privacyUrl,
  };
}

function transferFor(
  result: ModelCouncilRunResultV1,
  runtime: ProviderRuntimeV1,
  digest: { readonly algorithm: 'sha-256'; readonly value: string },
  byteCount: number,
): ModelCouncilTransferReceiptV1 {
  const timing = result.status === 'unavailable'
    ? { startedAt: null, completedAt: null }
    : { startedAt: result.startedAt, completedAt: result.completedAt };
  return {
    provider: result.provider,
    model: result.model,
    recipient: runtime.recipient,
    channel: 'gateway_to_provider',
    status: result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'not_sent',
    ...timing,
    payloadDigest: digest,
    payloadByteCount: byteCount,
    providerPolicy: providerPolicy(runtime),
  };
}

function byProvider(runtimes: readonly ProviderRuntimeV1[]) {
  return new Map<ProviderIdV1, ProviderRuntimeV1>(runtimes.map((runtime) => [runtime.id, runtime]));
}

function reserveRequestId(requestId: string, now: number) {
  for (const [seenId, expiresAt] of replayWindow) {
    if (expiresAt <= now) replayWindow.delete(seenId);
  }
  if (replayWindow.has(requestId)) return false;
  replayWindow.set(requestId, now + CONSENT_MAX_AGE_MS + CLOCK_SKEW_MS);
  return true;
}

export async function POST(request: Request) {
  const gatewayStartedAt = new Date().toISOString();
  if (!isLoopbackRequest(request)) {
    return jsonIssue(403, 'Model review is available only from a loopback development origin. No provider was contacted.');
  }
  if (!isSameOrigin(request)) return jsonIssue(403, 'A same-origin request is required. No provider was contacted.');
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') ?? '')) {
    return jsonIssue(415, 'Content-Type must be application/json. No provider was contacted.');
  }
  if (request.headers.get('x-paperwork-catalog-version') !== MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1) {
    return jsonIssue(409, 'The provider catalog changed. Refresh and preview the payload again.');
  }

  let raw: string | undefined;
  try {
    raw = await readUtf8BodyWithinLimitV1(request, MAX_GATEWAY_BODY_BYTES);
  } catch {
    return jsonIssue(400, 'The request body could not be read. No provider was contacted.');
  }
  if (!raw) {
    return jsonIssue(413, 'The model-council request is empty or too large. No provider was contacted.');
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return jsonIssue(400, 'The model-council request is not valid JSON. No provider was contacted.');
  }
  let verified: Awaited<ReturnType<typeof verifyModelCouncilRequestV1>>;
  try {
    verified = await verifyModelCouncilRequestV1(input);
  } catch {
    return jsonIssue(400, 'The request did not match its strict payload and consent contract. No provider was contacted.');
  }
  if (!verified.ok) return jsonIssue(400, 'The request did not match its strict payload and consent contract. No provider was contacted.');
  if (verified.value.payload.providers.includes('ollama')) {
    return jsonIssue(409, 'Loopback Ollama must be contacted directly by the browser and cannot pass through the PaperWork gateway. No provider was contacted.');
  }

  const consentTime = Date.parse(verified.value.consent.recordedAt);
  const receivedTime = Date.parse(gatewayStartedAt);
  const consentAge = receivedTime - consentTime;
  if (consentAge < -CLOCK_SKEW_MS || consentAge > CONSENT_MAX_AGE_MS) {
    return jsonIssue(409, 'Consent expired or has an invalid timestamp. Preview the payload again. No provider was contacted.');
  }

  const runtimes = getProviderRuntimesV1();
  const runtimeMap = byProvider(runtimes);
  if (!runtimes.some((runtime) => runtime.enabled)) {
    return jsonIssue(503, 'The model council is disabled on this deployment. No provider was contacted.');
  }

  const selectedRuntimes = verified.value.payload.providerTargets.map((target) => runtimeMap.get(target.provider)!);
  const changedTarget = verified.value.payload.providerTargets.some((target, index) => {
    const runtime = selectedRuntimes[index];
    return !runtime
      || !runtime.enabled
      || runtime.model !== target.model
      || runtime.recipient !== target.recipient;
  });
  if (changedTarget) {
    return jsonIssue(409, 'A selected model or recipient is unavailable or changed. Refresh and preview the payload again. No provider was contacted.');
  }
  if (!reserveRequestId(verified.value.requestId, receivedTime)) {
    return jsonIssue(409, 'This model-council request was already used. Generate a fresh preview before retrying. No provider was contacted.');
  }
  if (activeCouncilRequests >= MAX_ACTIVE_COUNCIL_REQUESTS) {
    return jsonIssue(429, 'The local model gateway is busy. Generate a fresh preview before retrying. No provider was contacted.');
  }

  activeCouncilRequests += 1;
  const gatewayCompletedAt = new Date().toISOString();
  let results: readonly ModelCouncilRunResultV1[];
  try {
    results = await Promise.all(selectedRuntimes.map((runtime) => runProviderV1(runtime, verified.value.payload, {
      signal: request.signal,
    })));
  } finally {
    activeCouncilRequests -= 1;
  }
  const digest = verified.value.consent.previewDigest;
  const byteCount = verified.value.consent.previewByteCount;
  const response: ModelCouncilResponseV1 = {
    kind: MODEL_COUNCIL_RESPONSE_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: verified.value.requestId,
    results,
    consensus: buildModelCouncilConsensusV1(results),
    receipt: {
      kind: MODEL_COUNCIL_RECEIPT_KIND_V1,
      schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
      receiptId: `receipt.${crypto.randomUUID()}`,
      requestId: verified.value.requestId,
      consent: verified.value.consent,
      gatewayTransfer: {
        recipient: 'PaperWork model gateway',
        status: 'completed',
        startedAt: gatewayStartedAt,
        completedAt: gatewayCompletedAt,
        payloadDigest: digest,
        payloadByteCount: byteCount,
      },
      transfers: results.map((result, index) => transferFor(result, selectedRuntimes[index], digest, byteCount)),
    },
  };
  const parsed = parseModelCouncilResponseV1(response, verified.value.payload.segments, {
    requestId: verified.value.requestId,
    previewDigest: digest,
    previewByteCount: byteCount,
    providerTargets: verified.value.payload.providerTargets,
  });
  if (!parsed.ok) return jsonIssue(500, 'PaperWork safely withheld an invalid model-council response.', 'unknown');
  return new Response(JSON.stringify(parsed.value), { status: 200, headers: HEADERS });
}
