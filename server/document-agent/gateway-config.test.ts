import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkDocumentGatewayBoundaryV1,
  getDocumentGatewayConfigurationV1,
} from './gateway-config';

const INVITE_DIGEST = 'a'.repeat(64);

function productionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PAPERWORK_DOCUMENT_AGENT_ENABLED: 'true',
    PAPERWORK_PUBLIC_GATEWAY_MODE: 'invite',
    PAPERWORK_PROVIDER_SPEND_CAP_CONFIGURED: 'true',
    PAPERWORK_PUBLIC_APP_ORIGIN: 'https://paperwork.example',
    PAPERWORK_GATEWAY_ACCESS_TOKEN_SHA256: INVITE_DIGEST,
    PAPERWORK_PUBLIC_PROVIDER: 'openai',
  };
}

test('production gateway enables only with the complete invite boundary', () => {
  const enabled = getDocumentGatewayConfigurationV1(productionEnvironment());
  assert.equal(enabled.mode, 'invite');
  if (enabled.mode === 'invite') {
    assert.equal(enabled.appOrigin, 'https://paperwork.example');
    assert.equal(enabled.publicProvider, 'openai');
    assert.equal(enabled.maxConcurrentRequests, 2);
    assert.equal(enabled.maxGrantIssuesPerHour, 10);
    assert.equal(enabled.globalMaxGrantIssuesPerHour, 100);
    assert.equal(enabled.metadataRetentionMs, 24 * 60 * 60 * 1_000);
  }

  const invalidMutations: Array<Partial<NodeJS.ProcessEnv>> = [
    { PAPERWORK_PROVIDER_SPEND_CAP_CONFIGURED: 'false' },
    { PAPERWORK_PUBLIC_APP_ORIGIN: 'http://paperwork.example' },
    { PAPERWORK_PUBLIC_APP_ORIGIN: 'https://paperwork.example/path' },
    { PAPERWORK_GATEWAY_ACCESS_TOKEN_SHA256: 'not-a-digest' },
    { PAPERWORK_PUBLIC_PROVIDER: 'ollama' },
    { PAPERWORK_GATEWAY_METADATA_RETENTION_HOURS: '23' },
    { PAPERWORK_GATEWAY_MAX_GRANT_ISSUES_PER_HOUR: '0' },
    { NODE_ENV: 'test' },
  ];
  for (const mutation of invalidMutations) {
    assert.equal(getDocumentGatewayConfigurationV1({ ...productionEnvironment(), ...mutation }).mode, 'disabled');
  }
});

test('production boundary requires the configured origin and browser fetch metadata', () => {
  const environment = productionEnvironment();
  const accepted = checkDocumentGatewayBoundaryV1(new Request('https://paperwork.example/api/document-agent/analyze', {
    method: 'POST',
    headers: { origin: 'https://paperwork.example', 'sec-fetch-site': 'same-origin' },
  }), environment);
  assert.equal(accepted.ok, true);

  for (const headers of [
    new Headers({ origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }),
    new Headers({ origin: 'https://paperwork.example' }),
    new Headers({ 'sec-fetch-site': 'same-origin' }),
  ]) {
    const rejected = checkDocumentGatewayBoundaryV1(new Request('https://paperwork.example/api/document-agent/analyze', {
      method: 'POST',
      headers,
    }), environment);
    assert.equal(rejected.ok, false);
  }

  const wrongDeployment = checkDocumentGatewayBoundaryV1(new Request('https://preview.paperwork.example/api/document-agent/analyze', {
    method: 'POST',
    headers: { origin: 'https://preview.paperwork.example', 'sec-fetch-site': 'same-origin' },
  }), environment);
  assert.equal(wrongDeployment.ok, false);
});

test('local document-agent enablement is separate from the legacy model council flag', () => {
  assert.equal(getDocumentGatewayConfigurationV1({
    NODE_ENV: 'development',
    PAPERWORK_MODEL_COUNCIL_ENABLED: 'true',
  }).mode, 'disabled');
  assert.equal(getDocumentGatewayConfigurationV1({
    NODE_ENV: 'development',
    PAPERWORK_DOCUMENT_AGENT_ENABLED: 'true',
  }).mode, 'local_development');

  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    PAPERWORK_DOCUMENT_AGENT_ENABLED: 'true',
  };
  assert.equal(checkDocumentGatewayBoundaryV1(
    new Request('http://localhost:3000/api/document-agent/catalog'),
    environment,
  ).ok, true);
  assert.equal(checkDocumentGatewayBoundaryV1(
    new Request('http://192.168.1.20:3000/api/document-agent/catalog'),
    environment,
  ).ok, false);
});
