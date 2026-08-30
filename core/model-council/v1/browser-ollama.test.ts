import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PROVIDER_ANALYSIS_KIND_V1,
  browserDirectOllamaEndpointV1,
  digestModelCouncilPayloadV1,
  prepareModelCouncilPayloadV1,
  runBrowserDirectOllamaV1,
  type ProviderAnalysisV1,
} from './index';

const REVISION = 'revision.browser.ollama.test';
const MODEL = 'local-structured-model';
const RECIPIENT = 'Ollama at http://127.0.0.1:11434';

function payload() {
  return prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION,
    sourceFingerprint: 'e'.repeat(64),
    providerTargets: [{ provider: 'ollama', model: MODEL, recipient: RECIPIENT }],
    segments: [{
      segmentId: 'segment.browser.ollama.test',
      page: 1,
      text: 'We offer you the role of Systems Engineer.',
    }],
  });
}

function analysis(): ProviderAnalysisV1 {
  return {
    kind: PROVIDER_ANALYSIS_KIND_V1,
    schemaVersion: '1.0.0',
    documentType: 'employment_offer',
    sourceRevisionId: REVISION,
    fields: {
      role: {
        value: { kind: 'text', text: 'Systems Engineer' },
        evidence: [{
          sourceRevisionId: REVISION,
          segmentId: 'segment.browser.ollama.test',
          page: 1,
          quote: 'role of Systems Engineer',
        }],
      },
      acceptanceDeadline: null,
      startDate: null,
      annualBaseSalary: null,
      workLocation: null,
      probation: null,
      actionRequired: null,
    },
  };
}

async function request() {
  const exactPayload = payload();
  const digest = await digestModelCouncilPayloadV1(exactPayload);
  return {
    kind: 'paperwork.model_council_request',
    schemaVersion: '1.0.0',
    requestId: 'request.browser.ollama.test',
    payload: exactPayload,
    consent: {
      approvedBy: 'user',
      recordedAt: '2026-08-30T10:00:00.000Z',
      providers: exactPayload.providers,
      previewDigest: { algorithm: digest.algorithm, value: digest.value },
      previewByteCount: digest.byteCount,
    },
  };
}

function envelope(output: unknown) {
  return {
    done: true,
    done_reason: 'stop',
    message: { content: JSON.stringify(output) },
  };
}

test('browser-direct Ollama resolves only an exact loopback recipient from a loopback page', () => {
  const target = payload().providerTargets[0];
  assert.equal(
    browserDirectOllamaEndpointV1(target, 'http://localhost:3000'),
    'http://127.0.0.1:11434/api/chat',
  );
  assert.equal(browserDirectOllamaEndpointV1(target, 'https://paperwork.example'), null);
  assert.equal(browserDirectOllamaEndpointV1(target, 'https://localhost:3000'), null);
  assert.equal(browserDirectOllamaEndpointV1(
    { ...target, recipient: 'Ollama at https://models.example' },
    'http://localhost:3000',
  ), null);
  for (const recipient of [
    'Ollama at http://localhost.evil:11434',
    'Ollama at http://user:password@localhost:11434',
    'Ollama at http://localhost:11434/private',
    'Ollama at http://localhost:11434?model=changed',
    'Ollama at http://localhost:11434#changed',
    'Ollama at http://[::1]:11434',
  ]) {
    assert.equal(
      browserDirectOllamaEndpointV1({ ...target, recipient }, 'http://localhost:3000'),
      null,
      recipient,
    );
  }
  assert.equal(browserDirectOllamaEndpointV1(target, 'http://user:password@localhost:3000'), null);
  assert.equal(browserDirectOllamaEndpointV1(target, 'http://localhost:3000/path'), null);
});

test('browser-direct Ollama returns the same source-checked website contract', async () => {
  let requestedUrl = '';
  let requestedBody: Record<string, unknown> | undefined;
  let requestedInit: RequestInit | undefined;
  const result = await runBrowserDirectOllamaV1(await request(), {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: (async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(envelope(analysis())), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });
  assert.equal(requestedUrl, 'http://127.0.0.1:11434/api/chat');
  assert.equal(requestedBody?.stream, false);
  assert.equal(typeof requestedBody?.format, 'object');
  assert.equal('tools' in (requestedBody ?? {}), false);
  assert.equal(requestedInit?.credentials, 'omit');
  assert.equal(requestedInit?.redirect, 'error');
  assert.equal(requestedInit?.referrerPolicy, 'no-referrer');
  const headers = new Headers(requestedInit?.headers);
  assert.equal(headers.has('authorization'), false);
  const messages = requestedBody?.messages as Array<{ readonly role: string; readonly content: string }>;
  assert.match(messages[0].content, /Copy every sourceRevisionId, segmentId, page, and evidence quote exactly/);
  assert.match(messages[0].content, /money amount as digits with an optional decimal point only/);
  const sourceMessage = JSON.parse(messages[1].content) as Record<string, unknown>;
  assert.equal(sourceMessage.kind, 'paperwork.untrusted_source_passages');
  assert.equal('sourceFingerprint' in sourceMessage, false);
  assert.equal(result.status, 'completed');
  if (result.status === 'completed') {
    assert.equal(result.validation, 'source_quotes_checked');
    assert.equal(result.analysis.fields.role?.value.text, 'Systems Engineer');
  }
});

test('browser-direct Ollama rechecks exact consent and refuses mixed transport before fetch', async () => {
  let fetchCount = 0;
  const mustNotFetch = (async () => {
    fetchCount += 1;
    throw new Error('must not fetch');
  }) as typeof fetch;

  const changed = structuredClone(await request()) as unknown as {
    payload: { segments: Array<{ text: string }> };
  };
  changed.payload.segments[0].text = 'The caller changed this after approval.';
  const changedResult = await runBrowserDirectOllamaV1(changed, {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: mustNotFetch,
  });
  assert.equal(changedResult.status, 'unavailable');

  const mixedPayload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION,
    sourceFingerprint: 'e'.repeat(64),
    providerTargets: [
      { provider: 'openai', model: 'hosted-model', recipient: 'OpenAI API' },
      { provider: 'ollama', model: MODEL, recipient: RECIPIENT },
    ],
    segments: [{
      segmentId: 'segment.browser.ollama.test',
      page: 1,
      text: 'We offer you the role of Systems Engineer.',
    }],
  });
  const mixedDigest = await digestModelCouncilPayloadV1(mixedPayload);
  const mixedResult = await runBrowserDirectOllamaV1({
    kind: 'paperwork.model_council_request',
    schemaVersion: '1.0.0',
    requestId: 'request.browser.ollama.mixed',
    payload: mixedPayload,
    consent: {
      approvedBy: 'user',
      recordedAt: '2026-08-30T10:00:00.000Z',
      providers: mixedPayload.providers,
      previewDigest: { algorithm: mixedDigest.algorithm, value: mixedDigest.value },
      previewByteCount: mixedDigest.byteCount,
    },
  }, {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: mustNotFetch,
  });
  assert.equal(mixedResult.status, 'unavailable');
  assert.equal(fetchCount, 0);
});

test('browser-direct Ollama snapshots consented bytes before asynchronous hashing', async () => {
  const callerOwned = structuredClone(await request()) as unknown as {
    payload: { segments: Array<{ text: string }> };
  };
  let sentText = '';
  const run = runBrowserDirectOllamaV1(callerOwned, {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const source = JSON.parse(body.messages[1].content) as {
        segments: Array<{ text: string }>;
      };
      sentText = source.segments[0].text;
      return new Response(JSON.stringify(envelope(analysis())), { status: 200 });
    }) as typeof fetch,
  });
  callerOwned.payload.segments[0].text = 'MUTATED WHILE THE DIGEST WAS PENDING';
  const result = await run;
  assert.equal(result.status, 'completed');
  assert.equal(sentText, 'We offer you the role of Systems Engineer.');
});

test('browser-direct Ollama withholds an oversized response body', async () => {
  const oversized = await runBrowserDirectOllamaV1(await request(), {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: (async () => new Response('x'.repeat(97 * 1024), {
      status: 200,
      headers: { 'content-length': String(97 * 1024) },
    })) as typeof fetch,
  });
  assert.equal(oversized.status, 'failed');
  if (oversized.status === 'failed') assert.equal(oversized.issueCode, 'invalid_provider_output');
});

test('browser-direct Ollama withholds invalid, unfinished, network, and timed-out output', async () => {
  const unsupported = await runBrowserDirectOllamaV1(await request(), {
    pageOrigin: 'https://paperwork.example',
    fetchImpl: (async () => { throw new Error('must not fetch'); }) as typeof fetch,
  });
  assert.equal(unsupported.status, 'unavailable');

  const invalidAnalysis = structuredClone(analysis());
  (invalidAnalysis.fields.role!.evidence[0] as { quote: string }).quote = 'Chief Executive Officer';
  const invalid = await runBrowserDirectOllamaV1(await request(), {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: (async () => new Response(JSON.stringify(envelope(invalidAnalysis)))) as typeof fetch,
  });
  assert.equal(invalid.status, 'failed');
  if (invalid.status === 'failed') assert.equal(invalid.issueCode, 'invalid_provider_output');

  const unfinished = await runBrowserDirectOllamaV1(await request(), {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: (async () => new Response(JSON.stringify({
      done: false,
      message: { content: JSON.stringify(analysis()) },
    }))) as typeof fetch,
  });
  assert.equal(unfinished.status, 'failed');
  if (unfinished.status === 'failed') assert.equal(unfinished.issueCode, 'invalid_provider_output');

  const network = await runBrowserDirectOllamaV1(await request(), {
    pageOrigin: 'http://localhost:3000',
    fetchImpl: (async () => { throw new TypeError('network'); }) as typeof fetch,
  });
  assert.equal(network.status, 'failed');
  if (network.status === 'failed') assert.equal(network.issueCode, 'network_failure');

  const timedOut = await runBrowserDirectOllamaV1(await request(), {
    pageOrigin: 'http://localhost:3000',
    timeoutMs: 1,
    fetchImpl: ((_, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch,
  });
  assert.equal(timedOut.status, 'failed');
  if (timedOut.status === 'failed') assert.equal(timedOut.issueCode, 'provider_timeout');
});
