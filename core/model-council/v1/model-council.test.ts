import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  MODEL_COUNCIL_CATALOG_KIND_V1,
  MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1,
  MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
  MODEL_COUNCIL_PROMPT_VERSION_V1,
  MODEL_COUNCIL_RECEIPT_KIND_V1,
  MODEL_COUNCIL_REQUEST_KIND_V1,
  MODEL_COUNCIL_RESPONSE_KIND_V1,
  MODEL_COUNCIL_SCHEMA_VERSION_V1,
  PROVIDER_ANALYSIS_JSON_SCHEMA_V1,
  PROVIDER_ANALYSIS_KIND_V1,
  buildModelCouncilConsensusV1,
  digestModelCouncilPayloadV1,
  parseModelCouncilCatalogV1,
  parseModelCouncilPayloadV1,
  parseModelCouncilReceiptV1,
  parseModelCouncilRequestV1,
  parseModelCouncilResponseV1,
  prepareModelCouncilPayloadV1,
  serializeModelCouncilPayloadV1,
  validateProviderAnalysisV1,
  verifyModelCouncilRequestV1,
  type ModelCouncilCatalogV1,
  type ModelCouncilCompletedRunResultV1,
  type ModelCouncilReceiptV1,
  type ModelCouncilRunResultV1,
  type ModelCouncilSourceSegmentV1,
  type ModelCouncilProviderTargetV1,
  type ProviderAnalysisV1,
  type ProviderIdV1,
} from './index';

const REVISION_ID = 'revision.offer.v1';
const SOURCE_FINGERPRINT = 'a'.repeat(64);
const NOW = '2026-08-30T10:00:00.000Z';
const LATER = '2026-08-30T10:00:01.000Z';

const segments: readonly ModelCouncilSourceSegmentV1[] = [
  {
    sourceRevisionId: REVISION_ID,
    segmentId: 'segment.role',
    sequence: 0,
    page: 1,
    text: 'We are pleased to offer you the role of Senior Engineer, starting 2026-10-01 in Bengaluru.',
  },
  {
    sourceRevisionId: REVISION_ID,
    segmentId: 'segment.terms',
    sequence: 1,
    page: 1,
    text: 'Your annual base salary is USD 120,000. The probation period is 6 months.',
  },
  {
    sourceRevisionId: REVISION_ID,
    segmentId: 'segment.action',
    sequence: 2,
    page: 2,
    text: 'Please sign and return this letter by 2026-09-15.',
  },
];

function evidence(segmentId: string, page: number, quote: string) {
  return { sourceRevisionId: REVISION_ID, segmentId, page, quote };
}

function providerTargets(...providers: readonly ProviderIdV1[]): readonly ModelCouncilProviderTargetV1[] {
  return providers.map((provider) => ({
    provider,
    model: `${provider}-test-model`,
    recipient: `${provider} test API`,
  }));
}

function validAnalysis(): ProviderAnalysisV1 {
  return {
    kind: PROVIDER_ANALYSIS_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    documentType: 'employment_offer',
    sourceRevisionId: REVISION_ID,
    fields: {
      role: {
        value: { kind: 'text', text: 'Senior Engineer' },
        evidence: [evidence('segment.role', 1, 'role of Senior Engineer')],
      },
      acceptanceDeadline: {
        value: { kind: 'date', value: '2026-09-15' },
        evidence: [evidence('segment.action', 2, 'by 2026-09-15')],
      },
      startDate: {
        value: { kind: 'date', value: '2026-10-01' },
        evidence: [evidence('segment.role', 1, 'starting 2026-10-01')],
      },
      annualBaseSalary: {
        value: { kind: 'money', amount: '120000', currency: 'USD', basis: 'annual' },
        evidence: [evidence('segment.terms', 1, 'annual base salary is USD 120,000')],
      },
      workLocation: {
        value: { kind: 'text', text: 'Bengaluru' },
        evidence: [evidence('segment.role', 1, 'in Bengaluru')],
      },
      probation: {
        value: { kind: 'duration', value: 6, unit: 'month' },
        evidence: [evidence('segment.terms', 1, 'probation period is 6 months')],
      },
      actionRequired: {
        value: { kind: 'text', text: 'Sign and return this letter' },
        evidence: [evidence('segment.action', 2, 'sign and return this letter')],
      },
    },
  };
}

function mutableAnalysis(): Record<string, unknown> {
  return structuredClone(validAnalysis()) as unknown as Record<string, unknown>;
}

function issueCodes(result: ReturnType<typeof validateProviderAnalysisV1>) {
  assert.equal(result.ok, false, 'Expected provider output to be rejected.');
  return new Set(result.issues.map((issue) => issue.code));
}

function fieldRecord(analysis: Record<string, unknown>, field: string): Record<string, unknown> {
  const fields = analysis.fields as Record<string, unknown>;
  return fields[field] as Record<string, unknown>;
}

test('accepts the exact offer-letter output shape with source-backed fields', () => {
  const result = validateProviderAnalysisV1(validAnalysis(), segments);
  assert.equal(result.ok, true);
  assert.equal(result.value.fields.role?.value.text, 'Senior Engineer');
});

test('rejects unknown keys instead of accepting summaries, advice, or model-created actions', () => {
  const root = mutableAnalysis();
  root.summary = 'Looks good';
  assert.ok(issueCodes(validateProviderAnalysisV1(root, segments)).has('unknown_field'));

  const fields = mutableAnalysis();
  (fields.fields as Record<string, unknown>).suggestions = [];
  assert.ok(issueCodes(validateProviderAnalysisV1(fields, segments)).has('unknown_field'));

  const action = mutableAnalysis();
  fieldRecord(action, 'actionRequired').suggestedAction = 'Accept it';
  assert.ok(issueCodes(validateProviderAnalysisV1(action, segments)).has('unknown_field'));
});

test('rejects unsafe markup, control characters, invisible formatting, and non-normalized values', () => {
  const markup = mutableAnalysis();
  ((fieldRecord(markup, 'role').value as Record<string, unknown>)).text = '<img src=x onerror=alert(1)>';
  assert.ok(issueCodes(validateProviderAnalysisV1(markup, segments)).has('active_content'));

  const control = mutableAnalysis();
  ((fieldRecord(control, 'role').value as Record<string, unknown>)).text = 'Senior\u0000Engineer';
  assert.ok(issueCodes(validateProviderAnalysisV1(control, segments)).has('control_character'));

  const invisible = mutableAnalysis();
  ((fieldRecord(invisible, 'role').value as Record<string, unknown>)).text = 'Senior\u200bEngineer';
  assert.ok(issueCodes(validateProviderAnalysisV1(invisible, segments)).has('invisible_character'));

  const whitespace = mutableAnalysis();
  ((fieldRecord(whitespace, 'role').value as Record<string, unknown>)).text = ' Senior  Engineer ';
  assert.ok(issueCodes(validateProviderAnalysisV1(whitespace, segments)).has('not_normalized'));
});

test('binds every evidence quote to the exact revision, segment, and page', () => {
  const wrongQuote = mutableAnalysis();
  const quoteEvidence = (fieldRecord(wrongQuote, 'role').evidence as Record<string, unknown>[])[0];
  quoteEvidence.quote = 'role of Principal Engineer';
  assert.ok(issueCodes(validateProviderAnalysisV1(wrongQuote, segments)).has('quote_not_found'));

  const wrongPage = mutableAnalysis();
  const pageEvidence = (fieldRecord(wrongPage, 'role').evidence as Record<string, unknown>[])[0];
  pageEvidence.page = 2;
  assert.ok(issueCodes(validateProviderAnalysisV1(wrongPage, segments)).has('segment_page_mismatch'));

  const wrongRevision = mutableAnalysis();
  const revisionEvidence = (fieldRecord(wrongRevision, 'role').evidence as Record<string, unknown>[])[0];
  revisionEvidence.sourceRevisionId = 'revision.offer.v2';
  const revisionCodes = issueCodes(validateProviderAnalysisV1(wrongRevision, segments));
  assert.ok(revisionCodes.has('revision_mismatch'));
  assert.ok(revisionCodes.has('segment_revision_mismatch'));

  const wrongSegment = mutableAnalysis();
  const segmentEvidence = (fieldRecord(wrongSegment, 'role').evidence as Record<string, unknown>[])[0];
  segmentEvidence.segmentId = 'segment.missing';
  assert.ok(issueCodes(validateProviderAnalysisV1(wrongSegment, segments)).has('unknown_segment'));

  const inventedInstruction = mutableAnalysis();
  ((fieldRecord(inventedInstruction, 'actionRequired').value as Record<string, unknown>)).text = 'Accept this offer immediately';
  assert.ok(issueCodes(validateProviderAnalysisV1(inventedInstruction, segments)).has('text_not_quoted'));
});

test('enforces real dates and canonical money and duration formats', () => {
  const date = mutableAnalysis();
  ((fieldRecord(date, 'startDate').value as Record<string, unknown>)).value = '2026-02-30';
  assert.ok(issueCodes(validateProviderAnalysisV1(date, segments)).has('invalid_date'));

  const money = mutableAnalysis();
  ((fieldRecord(money, 'annualBaseSalary').value as Record<string, unknown>)).amount = '120000.00';
  assert.ok(issueCodes(validateProviderAnalysisV1(money, segments)).has('invalid_money'));

  const currency = mutableAnalysis();
  ((fieldRecord(currency, 'annualBaseSalary').value as Record<string, unknown>)).currency = 'usd';
  assert.ok(issueCodes(validateProviderAnalysisV1(currency, segments)).has('invalid_currency'));

  const duration = mutableAnalysis();
  ((fieldRecord(duration, 'probation').value as Record<string, unknown>)).value = 0;
  assert.ok(issueCodes(validateProviderAnalysisV1(duration, segments)).has('integer_out_of_range'));
});

test('normalized dates, money, and durations must be present in the same evidence quote', () => {
  const futureDate = mutableAnalysis();
  ((fieldRecord(futureDate, 'startDate').value as Record<string, unknown>)).value = '2099-10-01';
  assert.ok(issueCodes(validateProviderAnalysisV1(futureDate, segments)).has('date_not_quoted'));

  const differentMoney = mutableAnalysis();
  const moneyValue = fieldRecord(differentMoney, 'annualBaseSalary').value as Record<string, unknown>;
  moneyValue.amount = '999999';
  moneyValue.currency = 'EUR';
  assert.ok(issueCodes(validateProviderAnalysisV1(differentMoney, segments)).has('money_not_quoted'));

  const differentDuration = mutableAnalysis();
  const durationValue = fieldRecord(differentDuration, 'probation').value as Record<string, unknown>;
  durationValue.value = 120;
  durationValue.unit = 'year';
  assert.ok(issueCodes(validateProviderAnalysisV1(differentDuration, segments)).has('duration_not_quoted'));
});

test('unambiguous named-month dates and common-word durations remain source-bindable', () => {
  const namedSegments = structuredClone(segments) as unknown as Record<string, unknown>[];
  namedSegments[0].text = 'We are pleased to offer you the role of Senior Engineer, starting 1 October 2026 in Bengaluru.';
  namedSegments[1].text = 'Your annual base salary is USD 120,000. The probation period is six months.';
  const analysis = mutableAnalysis();
  const startEvidence = (fieldRecord(analysis, 'startDate').evidence as Record<string, unknown>[])[0];
  startEvidence.quote = 'starting 1 October 2026';
  const probationEvidence = (fieldRecord(analysis, 'probation').evidence as Record<string, unknown>[])[0];
  probationEvidence.quote = 'probation period is six months';
  assert.equal(
    validateProviderAnalysisV1(analysis, namedSegments as unknown as readonly ModelCouncilSourceSegmentV1[]).ok,
    true,
  );
});

test('provider JSON Schema is closed and contains only the seven website fields', () => {
  assert.equal(PROVIDER_ANALYSIS_JSON_SCHEMA_V1.additionalProperties, false);
  assert.equal(PROVIDER_ANALYSIS_JSON_SCHEMA_V1.properties.fields.additionalProperties, false);
  assert.deepEqual(
    PROVIDER_ANALYSIS_JSON_SCHEMA_V1.properties.fields.required,
    ['role', 'acceptanceDeadline', 'startDate', 'annualBaseSalary', 'workLocation', 'probation', 'actionRequired'],
  );
  assert.equal('summary' in PROVIDER_ANALYSIS_JSON_SCHEMA_V1.properties, false);
  assert.equal('actions' in PROVIDER_ANALYSIS_JSON_SCHEMA_V1.properties, false);
  assert.equal('suggestions' in PROVIDER_ANALYSIS_JSON_SCHEMA_V1.properties, false);
});

test('prepares a canonical exact payload and produces a WebCrypto SHA-256 receipt digest', async () => {
  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('ollama', 'deepseek', 'openai'),
    segments: segments.map(({ segmentId, page, text }) => ({ segmentId, page, text })),
  });
  assert.deepEqual(payload.providers, ['openai', 'deepseek', 'ollama']);
  assert.deepEqual(payload.providerTargets.map((target) => target.provider), payload.providers);
  assert.equal(payload.catalogVersion, MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1);
  assert.equal(payload.promptVersion, MODEL_COUNCIL_PROMPT_VERSION_V1);
  assert.deepEqual(payload.segments.map((segment) => segment.sequence), [0, 1, 2]);
  assert.ok(payload.segments.every((segment) => segment.sourceRevisionId === REVISION_ID));

  const serialized = serializeModelCouncilPayloadV1(payload);
  const digest = await digestModelCouncilPayloadV1(payload);
  assert.equal(digest.value, createHash('sha256').update(serialized).digest('hex'));
  assert.equal(digest.byteCount, Buffer.byteLength(serialized, 'utf8'));

  const changed = structuredClone(payload);
  (changed.segments as unknown as Record<string, unknown>[])[0].text = 'Changed source text';
  assert.notEqual((await digestModelCouncilPayloadV1(changed)).value, digest.value);

  const changedTarget = structuredClone(payload);
  (changedTarget.providerTargets as unknown as Record<string, unknown>[])[0].model = 'different-model';
  assert.notEqual((await digestModelCouncilPayloadV1(changedTarget)).value, digest.value);

  const changedRecipient = structuredClone(payload);
  (changedRecipient.providerTargets as unknown as Record<string, unknown>[])[0].recipient = 'Different API recipient';
  assert.notEqual((await digestModelCouncilPayloadV1(changedRecipient)).value, digest.value);
});

test('payload preparation rejects duplicate providers and unsafe segment content', () => {
  assert.throws(() => prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai', 'openai'),
    segments: [{ segmentId: 'segment.one', page: 1, text: 'Offer letter' }],
  }), /duplicate_value/);
  assert.throws(() => prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai'),
    segments: [{ segmentId: 'segment.one', page: 1, text: '<script>alert(1)</script>' }],
  }), /active_content/);
});

test('payload validation binds catalog, providers, models, and recipients in canonical order', () => {
  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('anthropic', 'openai'),
    segments: [{ segmentId: 'segment.one', page: 1, text: 'Offer letter' }],
  });
  assert.deepEqual(payload.providers, ['openai', 'anthropic']);

  const wrongCatalog = structuredClone(payload) as unknown as Record<string, unknown>;
  wrongCatalog.catalogVersion = 'stale-catalog';
  assert.equal(parseModelCouncilPayloadV1(wrongCatalog).ok, false);

  const wrongPrompt = structuredClone(payload) as unknown as Record<string, unknown>;
  wrongPrompt.promptVersion = 'changed-instructions';
  assert.equal(parseModelCouncilPayloadV1(wrongPrompt).ok, false);

  const wrongProvider = structuredClone(payload) as unknown as { providerTargets: Record<string, unknown>[] };
  wrongProvider.providerTargets[0].provider = 'deepseek';
  const providerResult = parseModelCouncilPayloadV1(wrongProvider);
  assert.equal(providerResult.ok, false);
  assert.ok(providerResult.issues.some((issue) => issue.code === 'provider_target_mismatch'));

  const unsafeTarget = structuredClone(payload) as unknown as { providerTargets: Record<string, unknown>[] };
  unsafeTarget.providerTargets[0].model = '<script>bad</script>';
  unsafeTarget.providerTargets[0].recipient = ' OpenAI  API ';
  const unsafeResult = parseModelCouncilPayloadV1(unsafeTarget);
  assert.equal(unsafeResult.ok, false);
  assert.ok(unsafeResult.issues.some((issue) => issue.code === 'active_content'));
  assert.ok(unsafeResult.issues.some((issue) => issue.code === 'not_normalized'));
});

test('payload and consent limits remain inside the gateway request cap', async () => {
  assert.throws(() => prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai'),
    segments: [
      ...Array.from({ length: 5 }, (_, index) => ({
        segmentId: `segment.large.${index}`,
        page: 1,
        text: 'A'.repeat(20_000),
      })),
      { segmentId: 'segment.large.final', page: 1, text: 'B' },
    ],
  }), /payload_too_large/);

  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai'),
    segments: [{ segmentId: 'segment.one', page: 1, text: 'Offer letter' }],
  });
  const digest = await digestModelCouncilPayloadV1(payload);
  const oversizedConsent = {
    kind: MODEL_COUNCIL_REQUEST_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: 'request.oversized.v1',
    payload,
    consent: {
      approvedBy: 'user',
      recordedAt: NOW,
      providers: payload.providers,
      previewDigest: { algorithm: digest.algorithm, value: digest.value },
      previewByteCount: MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1 + 1,
    },
  };
  const result = parseModelCouncilRequestV1(oversizedConsent);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'integer_out_of_range'));
});

test('request verification proves consent covers the exact canonical payload bytes', async () => {
  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai', 'anthropic'),
    segments: segments.map(({ segmentId, page, text }) => ({ segmentId, page, text })),
  });
  const digest = await digestModelCouncilPayloadV1(payload);
  const request = {
    kind: MODEL_COUNCIL_REQUEST_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: 'request.offer.v1',
    payload,
    consent: {
      approvedBy: 'user',
      recordedAt: NOW,
      providers: payload.providers,
      previewDigest: { algorithm: digest.algorithm, value: digest.value },
      previewByteCount: digest.byteCount,
    },
  } as const;
  assert.equal((await verifyModelCouncilRequestV1(request)).ok, true);

  const tampered = structuredClone(request) as unknown as {
    consent: { previewDigest: { value: string } };
  };
  tampered.consent.previewDigest.value = 'b'.repeat(64);
  const result = await verifyModelCouncilRequestV1(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'preview_digest_mismatch'));
});

function completed(provider: ProviderIdV1, analysis = validAnalysis()): ModelCouncilCompletedRunResultV1 {
  return {
    provider,
    model: `${provider}-test-model`,
    status: 'completed',
    startedAt: NOW,
    completedAt: LATER,
    validation: 'source_quotes_checked',
    analysis,
  };
}

function unavailable(provider: ProviderIdV1): ModelCouncilRunResultV1 {
  return {
    provider,
    model: `${provider}-test-model`,
    status: 'unavailable',
    issueCode: 'not_configured',
    retryable: false,
  };
}

test('consensus is deterministic, exact, and explicitly remains untrusted', () => {
  const openai = completed('openai');
  const anthropicAnalysis = structuredClone(validAnalysis());
  (anthropicAnalysis.fields.role as unknown as { evidence: ReturnType<typeof evidence>[] }).evidence = [
    evidence('segment.role', 1, 'Senior Engineer'),
  ];
  const anthropic = completed('anthropic', anthropicAnalysis);

  const forward = buildModelCouncilConsensusV1([openai, anthropic]);
  const reverse = buildModelCouncilConsensusV1([anthropic, openai]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.trust, 'untrusted_model_agreement');
  assert.equal(forward.fields.role.status, 'agreement');
  assert.deepEqual(forward.fields.role.agreedValue, { kind: 'text', text: 'Senior Engineer' });
  assert.equal(forward.fields.role.candidates.length, 1);
});

test('a majority never hides a dissenting provider', () => {
  const different = structuredClone(validAnalysis());
  (different.fields.role as unknown as { value: { kind: 'text'; text: string } }).value = {
    kind: 'text',
    text: 'Principal Engineer',
  };
  const consensus = buildModelCouncilConsensusV1([
    completed('openai'),
    completed('anthropic'),
    completed('mistral', different),
  ]);
  assert.equal(consensus.fields.role.status, 'disagreement');
  assert.equal(consensus.fields.role.agreedValue, null);
  assert.equal(consensus.fields.role.candidates.length, 2);
  assert.equal(consensus.fields.startDate.status, 'agreement');
});

test('consensus candidate ordering is deterministic for Unicode values', () => {
  const first = structuredClone(validAnalysis());
  (first.fields.role as unknown as { value: { kind: 'text'; text: string } }).value.text = 'Ångström Engineer';
  const second = structuredClone(validAnalysis());
  (second.fields.role as unknown as { value: { kind: 'text'; text: string } }).value.text = 'Zulu Engineer';
  const forward = buildModelCouncilConsensusV1([
    completed('openai', first),
    completed('anthropic', second),
  ]);
  const reverse = buildModelCouncilConsensusV1([
    completed('anthropic', second),
    completed('openai', first),
  ]);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.fields.role.candidates.map((candidate) => (
      candidate.value?.kind === 'text' ? candidate.value.text : null
    )),
    ['Zulu Engineer', 'Ångström Engineer'],
  );
});

test('single and missing model results cannot be presented as agreement', () => {
  const single = buildModelCouncilConsensusV1([completed('openai'), unavailable('anthropic')]);
  assert.equal(single.fields.role.status, 'single_result');
  assert.equal(single.fields.role.agreedValue, null);

  const none = buildModelCouncilConsensusV1([unavailable('openai'), unavailable('anthropic')]);
  assert.equal(none.fields.role.status, 'no_result');
  assert.equal(none.fields.role.providers.length, 0);
});

test('duplicate provider results are rejected instead of double-counted', () => {
  assert.throws(
    () => buildModelCouncilConsensusV1([completed('openai'), completed('openai')]),
    /Duplicate provider result/,
  );
});

function validCatalog(): ModelCouncilCatalogV1 {
  const common = {
    availability: 'configured' as const,
    model: 'configured-model',
    execution: 'provider_api' as const,
    structuredOutput: 'json_schema' as const,
    policyUrl: 'https://example.com/privacy',
  };
  return {
    kind: MODEL_COUNCIL_CATALOG_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    catalogVersion: MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
    enabled: true,
    generatedAt: NOW,
    providers: [
      { id: 'openai', displayName: 'OpenAI', access: 'commercial_api', recipient: 'OpenAI API', disclosure: 'Commercial proprietary API; API usage may cost money.', ...common },
      { id: 'anthropic', displayName: 'Claude by Anthropic', access: 'commercial_api', recipient: 'Anthropic API', disclosure: 'Commercial proprietary API; API usage may cost money.', ...common },
      { id: 'mistral', displayName: 'Mistral', access: 'hosted_api_model_license_varies', recipient: 'Mistral API', disclosure: 'Hosted model licensing varies with the configured model and inference may cost money.', ...common },
      { id: 'deepseek', displayName: 'DeepSeek', access: 'open_weight_hosted_api', recipient: 'DeepSeek API', disclosure: 'Hosted inference for an open-weight model family may cost money.', ...common, structuredOutput: 'json_object' },
      {
        id: 'ollama',
        displayName: 'Ollama',
        access: 'self_hosted',
        recipient: 'Configured Ollama host',
        disclosure: 'Runs on the configured self-hosted endpoint and uses your compute.',
        ...common,
        execution: 'self_hosted',
        policyUrl: null,
      },
    ],
  };
}

test('catalog truthfully distinguishes commercial, hosted open-weight, and self-hosted access', () => {
  assert.equal(parseModelCouncilCatalogV1(validCatalog()).ok, true);
  const catalog = structuredClone(validCatalog()) as unknown as { providers: Record<string, unknown>[] };
  catalog.providers[0].access = 'self_hosted';
  const result = parseModelCouncilCatalogV1(catalog);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'access_mismatch'));

  const mistral = structuredClone(validCatalog()) as unknown as { providers: Record<string, unknown>[] };
  mistral.providers[2].access = 'open_weight_hosted_api';
  const mistralResult = parseModelCouncilCatalogV1(mistral);
  assert.equal(mistralResult.ok, false);
  assert.ok(mistralResult.issues.some((issue) => issue.code === 'access_mismatch'));
});

function validReceipt(
  digest: { readonly algorithm: 'sha-256'; readonly value: string; readonly byteCount: number },
  providers: readonly ProviderIdV1[],
): ModelCouncilReceiptV1 {
  return {
    kind: MODEL_COUNCIL_RECEIPT_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    receiptId: 'receipt.offer.v1',
    requestId: 'request.offer.v1',
    consent: {
      approvedBy: 'user',
      recordedAt: NOW,
      providers,
      previewDigest: { algorithm: digest.algorithm, value: digest.value },
      previewByteCount: digest.byteCount,
    },
    gatewayTransfer: {
      recipient: 'PaperWork model gateway',
      status: 'completed',
      startedAt: NOW,
      completedAt: LATER,
      payloadDigest: { algorithm: digest.algorithm, value: digest.value },
      payloadByteCount: digest.byteCount,
    },
    transfers: providers.map((provider) => ({
      provider,
      model: `${provider}-test-model`,
      recipient: `${provider} test API`,
      channel: 'gateway_to_provider',
      status: 'completed',
      startedAt: NOW,
      completedAt: LATER,
      payloadDigest: { algorithm: digest.algorithm, value: digest.value },
      payloadByteCount: digest.byteCount,
      providerPolicy: {
        retention: 'provider_policy',
        trainingUse: 'unknown',
        assertedBy: 'Provider policy; verify before sending.',
        policyUrl: null,
      },
    })),
  };
}

test('receipt validates the gateway hop and every provider hop against the preview digest', async () => {
  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai', 'anthropic'),
    segments: segments.map(({ segmentId, page, text }) => ({ segmentId, page, text })),
  });
  const digest = await digestModelCouncilPayloadV1(payload);
  const receipt = validReceipt(digest, payload.providers);
  assert.equal(parseModelCouncilReceiptV1(receipt).ok, true);

  const tampered = structuredClone(receipt) as unknown as {
    gatewayTransfer: { payloadDigest: { value: string } };
  };
  tampered.gatewayTransfer.payloadDigest.value = 'b'.repeat(64);
  const result = parseModelCouncilReceiptV1(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'payload_digest_mismatch'));
});

test('receipt distinguishes browser-direct Ollama from gateway-routed providers', async () => {
  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: [{
      provider: 'ollama',
      model: 'ollama-test-model',
      recipient: 'Ollama at http://127.0.0.1:11434',
    }],
    segments: segments.map(({ segmentId, page, text }) => ({ segmentId, page, text })),
  });
  const digest = await digestModelCouncilPayloadV1(payload);
  const direct = structuredClone(validReceipt(digest, ['ollama'])) as unknown as {
    gatewayTransfer: { status: string; startedAt: string | null; completedAt: string | null };
    transfers: Array<{ channel: string; recipient: string }>;
  };
  direct.gatewayTransfer.status = 'not_sent';
  direct.gatewayTransfer.startedAt = null;
  direct.gatewayTransfer.completedAt = null;
  direct.transfers[0].channel = 'browser_to_provider';
  direct.transfers[0].recipient = 'Ollama at http://127.0.0.1:11434';
  assert.equal(parseModelCouncilReceiptV1(direct).ok, true);

  const falseHostedDirect = structuredClone(validReceipt(digest, ['openai'])) as unknown as {
    gatewayTransfer: { status: string; startedAt: string | null; completedAt: string | null };
    transfers: Array<{ channel: string; recipient: string }>;
  };
  falseHostedDirect.gatewayTransfer.status = 'not_sent';
  falseHostedDirect.gatewayTransfer.startedAt = null;
  falseHostedDirect.gatewayTransfer.completedAt = null;
  falseHostedDirect.transfers[0].channel = 'browser_to_provider';
  falseHostedDirect.transfers[0].recipient = 'Ollama at http://127.0.0.1:11434';
  const hostedResult = parseModelCouncilReceiptV1(falseHostedDirect);
  assert.equal(hostedResult.ok, false);
  assert.ok(hostedResult.issues.some((issue) => issue.code === 'browser_channel_provider_mismatch'
    || issue.code === 'direct_transport_provider_mismatch'));

  const falseGatewayAttempt = structuredClone(direct);
  falseGatewayAttempt.gatewayTransfer.status = 'completed';
  falseGatewayAttempt.gatewayTransfer.startedAt = NOW;
  falseGatewayAttempt.gatewayTransfer.completedAt = LATER;
  const gatewayResult = parseModelCouncilReceiptV1(falseGatewayAttempt);
  assert.equal(gatewayResult.ok, false);
  assert.ok(gatewayResult.issues.some((issue) => issue.code === 'transport_channel_mismatch'));

  const falseGatewayRoutedOllama = structuredClone(validReceipt(digest, ['ollama'])) as unknown as {
    transfers: Array<{ recipient: string }>;
  };
  falseGatewayRoutedOllama.transfers[0].recipient = 'Ollama at http://127.0.0.1:11434';
  const ollamaResult = parseModelCouncilReceiptV1(falseGatewayRoutedOllama);
  assert.equal(ollamaResult.ok, false);
  assert.ok(ollamaResult.issues.some((issue) => issue.code === 'ollama_channel_mismatch'));

  for (const recipient of [
    'Ollama at http://localhost:99999',
    'Ollama at http://localhost:00080',
    'Ollama at http://localhost:11434/path',
  ]) {
    const noncanonical = structuredClone(direct);
    noncanonical.transfers[0].recipient = recipient;
    const noncanonicalResult = parseModelCouncilReceiptV1(noncanonical);
    assert.equal(noncanonicalResult.ok, false, recipient);
    assert.ok(noncanonicalResult.issues.some((issue) => issue.code === 'browser_channel_recipient_mismatch'));
  }
});

test('response validation recomputes consensus and rechecks source evidence client-side', async () => {
  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai', 'anthropic'),
    segments: segments.map(({ segmentId, page, text }) => ({ segmentId, page, text })),
  });
  const digest = await digestModelCouncilPayloadV1(payload);
  const results = [completed('openai'), completed('anthropic')];
  const response = {
    kind: MODEL_COUNCIL_RESPONSE_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: 'request.offer.v1',
    results,
    consensus: buildModelCouncilConsensusV1(results),
    receipt: validReceipt(digest, payload.providers),
  } as const;
  const expectedRun = {
    requestId: response.requestId,
    previewDigest: { algorithm: digest.algorithm, value: digest.value },
    previewByteCount: digest.byteCount,
    providerTargets: payload.providerTargets,
  } as const;
  assert.equal(parseModelCouncilResponseV1(response, payload.segments, expectedRun).ok, true);

  const withoutSegments = parseModelCouncilResponseV1(response);
  assert.equal(withoutSegments.ok, false);
  assert.ok(withoutSegments.issues.some((issue) => issue.code === 'canonical_segments_required'));

  const tampered = structuredClone(response) as unknown as {
    consensus: { fields: { role: { status: string } } };
  };
  tampered.consensus.fields.role.status = 'disagreement';
  const result = parseModelCouncilResponseV1(tampered, payload.segments);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'consensus_mismatch' || issue.code === 'consensus_invariant'));
});

test('browser-owned response expectations reject self-consistent replay and changed targets', async () => {
  const payload = prepareModelCouncilPayloadV1({
    sourceRevisionId: REVISION_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    providerTargets: providerTargets('openai', 'anthropic'),
    segments: segments.map(({ segmentId, page, text }) => ({ segmentId, page, text })),
  });
  const digest = await digestModelCouncilPayloadV1(payload);
  const results = [completed('openai'), completed('anthropic')];
  const response = {
    kind: MODEL_COUNCIL_RESPONSE_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: 'request.offer.v1',
    results,
    consensus: buildModelCouncilConsensusV1(results),
    receipt: validReceipt(digest, payload.providers),
  };
  const expectation = {
    requestId: 'request.offer.v1',
    previewDigest: { algorithm: 'sha-256' as const, value: digest.value },
    previewByteCount: digest.byteCount,
    providerTargets: payload.providerTargets,
  };

  const replay = structuredClone(response);
  replay.requestId = 'request.replayed.v1';
  (replay.receipt as unknown as { requestId: string }).requestId = 'request.replayed.v1';
  const replayResult = parseModelCouncilResponseV1(replay, payload.segments, expectation);
  assert.equal(replayResult.ok, false);
  assert.ok(replayResult.issues.some((issue) => issue.code === 'expected_request_mismatch'));

  const changedDigest = structuredClone(response);
  (changedDigest.receipt.consent.previewDigest as unknown as { value: string }).value = 'b'.repeat(64);
  (changedDigest.receipt.gatewayTransfer.payloadDigest as unknown as { value: string }).value = 'b'.repeat(64);
  changedDigest.receipt.transfers.forEach((transfer) => {
    (transfer.payloadDigest as unknown as { value: string }).value = 'b'.repeat(64);
  });
  const digestResult = parseModelCouncilResponseV1(changedDigest, payload.segments, expectation);
  assert.equal(digestResult.ok, false);
  assert.ok(digestResult.issues.some((issue) => issue.code === 'expected_digest_mismatch'));

  const wrongSizeExpectation = { ...expectation, previewByteCount: digest.byteCount + 1 };
  const sizeResult = parseModelCouncilResponseV1(response, payload.segments, wrongSizeExpectation);
  assert.equal(sizeResult.ok, false);
  assert.ok(sizeResult.issues.some((issue) => issue.code === 'expected_size_mismatch'));

  const changedModel = structuredClone(response);
  (changedModel.results[1] as unknown as { model: string }).model = 'anthropic-changed-model';
  (changedModel.receipt.transfers[1] as unknown as { model: string }).model = 'anthropic-changed-model';
  const modelResult = parseModelCouncilResponseV1(changedModel, payload.segments, expectation);
  assert.equal(modelResult.ok, false);
  assert.ok(modelResult.issues.some((issue) => issue.code === 'expected_provider_target_mismatch'));

  const changedRecipient = structuredClone(response);
  (changedRecipient.receipt.transfers[1] as unknown as { recipient: string }).recipient = 'Changed recipient';
  const recipientResult = parseModelCouncilResponseV1(changedRecipient, payload.segments, expectation);
  assert.equal(recipientResult.ok, false);
  assert.ok(recipientResult.issues.some((issue) => issue.code === 'expected_provider_target_mismatch'));

  const changedProvider = structuredClone(response);
  (changedProvider.results[1] as unknown as { provider: ProviderIdV1; model: string }).provider = 'deepseek';
  (changedProvider.results[1] as unknown as { provider: ProviderIdV1; model: string }).model = 'deepseek-test-model';
  changedProvider.consensus = buildModelCouncilConsensusV1(changedProvider.results);
  (changedProvider.receipt.consent as unknown as { providers: ProviderIdV1[] }).providers = ['openai', 'deepseek'];
  (changedProvider.receipt.transfers[1] as unknown as {
    provider: ProviderIdV1;
    model: string;
    recipient: string;
  }).provider = 'deepseek';
  (changedProvider.receipt.transfers[1] as unknown as { model: string }).model = 'deepseek-test-model';
  (changedProvider.receipt.transfers[1] as unknown as { recipient: string }).recipient = 'deepseek test API';
  const providerResult = parseModelCouncilResponseV1(changedProvider, payload.segments, expectation);
  assert.equal(providerResult.ok, false);
  assert.ok(providerResult.issues.some((issue) => issue.code === 'expected_provider_target_mismatch'));
});

test('malformed request and response objects are rejected without throwing', () => {
  const malformedRequest = {
    kind: MODEL_COUNCIL_REQUEST_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: 'request.malformed.v1',
    payload: { providers: null, providerTargets: [{ provider: 'openai' }] },
    consent: { providers: null, previewDigest: null },
  };
  assert.doesNotThrow(() => parseModelCouncilRequestV1(malformedRequest));
  assert.equal(parseModelCouncilRequestV1(malformedRequest).ok, false);

  const malformedResponse = {
    kind: MODEL_COUNCIL_RESPONSE_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: 'request.malformed.v1',
    results: [{ status: 'completed', provider: null, analysis: null }],
    consensus: { fields: null },
    receipt: {
      consent: { providers: null, previewDigest: null },
      gatewayTransfer: { payloadDigest: null },
      transfers: [{ provider: null, providerPolicy: null }],
    },
  };
  assert.doesNotThrow(() => parseModelCouncilResponseV1(malformedResponse, segments));
  assert.equal(parseModelCouncilResponseV1(malformedResponse, segments).ok, false);

  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error('hostile prototype');
    },
  });
  assert.doesNotThrow(() => parseModelCouncilRequestV1(hostile));
  assert.doesNotThrow(() => parseModelCouncilResponseV1(hostile));

  const hostileNested = {
    kind: MODEL_COUNCIL_RESPONSE_KIND_V1,
    schemaVersion: MODEL_COUNCIL_SCHEMA_VERSION_V1,
    requestId: 'request.hostile.v1',
    get results(): never {
      throw new Error('hostile getter');
    },
    consensus: null,
    receipt: null,
  };
  assert.doesNotThrow(() => parseModelCouncilResponseV1(hostileNested));
  const hostileResult = parseModelCouncilResponseV1(hostileNested);
  assert.equal(hostileResult.ok, false);
  assert.ok(hostileResult.issues.some((issue) => issue.code === 'parser_exception'));
});
