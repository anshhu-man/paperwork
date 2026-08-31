import type { ProviderIdV1 } from '@/core/model-council/v1';

export const DOCUMENT_GATEWAY_SESSION_COOKIE_V1 = '__Host-paperwork_session' as const;

export interface LocalDocumentGatewayConfigurationV1 {
  readonly mode: 'local_development';
  readonly enabled: true;
}

export interface InviteDocumentGatewayConfigurationV1 {
  readonly mode: 'invite';
  readonly enabled: true;
  readonly appOrigin: string;
  readonly inviteDigest: string;
  readonly publicProvider: Exclude<ProviderIdV1, 'ollama'>;
  readonly sessionTtlMs: number;
  readonly grantTtlMs: number;
  readonly metadataRetentionMs: number;
  readonly maxSessionsPerHour: number;
  readonly maxOpenGrants: number;
  readonly maxGrantIssuesPerHour: number;
  readonly globalMaxGrantIssuesPerHour: number;
  readonly maxRequestsPerHour: number;
  readonly sessionDailyCostUnits: number;
  readonly globalDailyCostUnits: number;
  readonly maxConcurrentRequests: number;
}

export interface DisabledDocumentGatewayConfigurationV1 {
  readonly mode: 'disabled';
  readonly enabled: false;
}

export type DocumentGatewayConfigurationV1 =
  | LocalDocumentGatewayConfigurationV1
  | InviteDocumentGatewayConfigurationV1
  | DisabledDocumentGatewayConfigurationV1;

export type DocumentGatewayBoundaryV1 =
  | { readonly ok: true; readonly configuration: LocalDocumentGatewayConfigurationV1 | InviteDocumentGatewayConfigurationV1 }
  | { readonly ok: false; readonly status: 403 | 503; readonly issue: string };

const SHA256 = /^[a-f0-9]{64}$/;
const HOSTED_PROVIDERS = new Set<Exclude<ProviderIdV1, 'ollama'>>([
  'openai',
  'anthropic',
  'mistral',
  'deepseek',
]);

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function exactHttpsOrigin(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function localFlagEnabled(environment: NodeJS.ProcessEnv) {
  return environment.PAPERWORK_DOCUMENT_AGENT_ENABLED === 'true';
}

export function getDocumentGatewayConfigurationV1(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentGatewayConfigurationV1 {
  if (!localFlagEnabled(environment)) return { mode: 'disabled', enabled: false };
  if (environment.NODE_ENV === 'development') return { mode: 'local_development', enabled: true };
  if (environment.NODE_ENV !== 'production'
      || environment.PAPERWORK_PUBLIC_GATEWAY_MODE !== 'invite'
      || environment.PAPERWORK_PROVIDER_SPEND_CAP_CONFIGURED !== 'true') {
    return { mode: 'disabled', enabled: false };
  }

  const appOrigin = exactHttpsOrigin(environment.PAPERWORK_PUBLIC_APP_ORIGIN?.trim());
  const inviteDigest = environment.PAPERWORK_GATEWAY_ACCESS_TOKEN_SHA256?.trim();
  const publicProvider = environment.PAPERWORK_PUBLIC_PROVIDER?.trim() as Exclude<ProviderIdV1, 'ollama'> | undefined;
  const sessionHours = boundedInteger(environment.PAPERWORK_GATEWAY_SESSION_HOURS, 8, 1, 24);
  const grantMinutes = boundedInteger(environment.PAPERWORK_GATEWAY_GRANT_MINUTES, 5, 1, 15);
  const retentionHours = boundedInteger(environment.PAPERWORK_GATEWAY_METADATA_RETENTION_HOURS, 24, 24, 168);
  const maxSessionsPerHour = boundedInteger(environment.PAPERWORK_GATEWAY_MAX_SESSIONS_PER_HOUR, 50, 1, 500);
  const maxOpenGrants = boundedInteger(environment.PAPERWORK_GATEWAY_MAX_OPEN_GRANTS, 3, 1, 10);
  const maxGrantIssuesPerHour = boundedInteger(environment.PAPERWORK_GATEWAY_MAX_GRANT_ISSUES_PER_HOUR, 10, 1, 200);
  const globalMaxGrantIssuesPerHour = boundedInteger(environment.PAPERWORK_GATEWAY_GLOBAL_MAX_GRANT_ISSUES_PER_HOUR, 100, 1, 5_000);
  const maxRequestsPerHour = boundedInteger(environment.PAPERWORK_GATEWAY_MAX_REQUESTS_PER_HOUR, 5, 1, 100);
  const sessionDailyCostUnits = boundedInteger(environment.PAPERWORK_GATEWAY_SESSION_DAILY_COST_UNITS, 200, 1, 10_000);
  const globalDailyCostUnits = boundedInteger(environment.PAPERWORK_GATEWAY_GLOBAL_DAILY_COST_UNITS, 1_000, 1, 100_000);
  const maxConcurrentRequests = boundedInteger(environment.PAPERWORK_GATEWAY_MAX_CONCURRENT_REQUESTS, 2, 1, 20);
  if (!appOrigin || !inviteDigest || !SHA256.test(inviteDigest) || !publicProvider
      || !HOSTED_PROVIDERS.has(publicProvider) || !sessionHours || !grantMinutes || !retentionHours
      || !maxSessionsPerHour || !maxOpenGrants || !maxGrantIssuesPerHour
      || !globalMaxGrantIssuesPerHour || !maxRequestsPerHour || !sessionDailyCostUnits
      || !globalDailyCostUnits || !maxConcurrentRequests) {
    return { mode: 'disabled', enabled: false };
  }
  return Object.freeze({
    mode: 'invite',
    enabled: true,
    appOrigin,
    inviteDigest,
    publicProvider,
    sessionTtlMs: sessionHours * 60 * 60 * 1_000,
    grantTtlMs: grantMinutes * 60 * 1_000,
    metadataRetentionMs: retentionHours * 60 * 60 * 1_000,
    maxSessionsPerHour,
    maxOpenGrants,
    maxGrantIssuesPerHour,
    globalMaxGrantIssuesPerHour,
    maxRequestsPerHour,
    sessionDailyCostUnits,
    globalDailyCostUnits,
    maxConcurrentRequests,
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function loopback(request: Request) {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname); } catch { return false; }
}

export function checkDocumentGatewayBoundaryV1(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
): DocumentGatewayBoundaryV1 {
  const configuration = getDocumentGatewayConfigurationV1(environment);
  if (!configuration.enabled) {
    return { ok: false, status: 503, issue: 'The document gateway is disabled or incompletely configured. No provider was contacted.' };
  }
  const origin = request.headers.get('origin');
  const requiresOrigin = request.method !== 'GET' && request.method !== 'HEAD';
  if ((requiresOrigin && !origin) || (origin && !sameOrigin(request))) {
    return { ok: false, status: 403, issue: 'A same-origin request is required. No provider was contacted.' };
  }
  if (configuration.mode === 'local_development') {
    return loopback(request)
      ? { ok: true, configuration }
      : { ok: false, status: 403, issue: 'Development analysis is available only from a loopback origin. No provider was contacted.' };
  }
  let requestOrigin: string;
  try { requestOrigin = new URL(request.url).origin; } catch {
    return { ok: false, status: 403, issue: 'The request origin is invalid. No provider was contacted.' };
  }
  if (requestOrigin !== configuration.appOrigin || (origin && origin !== configuration.appOrigin)) {
    return { ok: false, status: 403, issue: 'This deployment origin is not authorized. No provider was contacted.' };
  }
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return { ok: false, status: 403, issue: 'A same-origin browser request is required. No provider was contacted.' };
  }
  return { ok: true, configuration };
}

export function documentGatewayModeV1(environment: NodeJS.ProcessEnv = process.env) {
  return getDocumentGatewayConfigurationV1(environment).mode;
}
