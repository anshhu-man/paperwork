import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';

import { getDocument, version as pdfJsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type {
  CanonicalSourceContextV1,
  ProcessingEventV1,
  SourceSegmentV1,
} from './contracts';
import { offerLetterActionPackV1 } from './fixtures/offer-letter';
import { parseCanonicalSourceContextV1 } from './validate';
import { groupPdfTextItemsV1 } from '../../local-analysis/v1/pdf-lines';
import type {
  LocalPdfExtractionV1,
  LocalPdfFailureCodeV1,
  LocalPdfProgressV1,
} from '../../local-analysis/v1/pdf';

interface TestPageLineV1 {
  readonly page: number;
  readonly text: string;
}

const lineOverrides = new WeakMap<File, readonly TestPageLineV1[]>();
let extractionCalls = 0;

class MockLocalPdfExtractionErrorV1 extends Error {
  readonly code: LocalPdfFailureCodeV1;

  constructor(code: LocalPdfFailureCodeV1) {
    super(code);
    this.name = 'LocalPdfExtractionErrorV1';
    this.code = code;
  }
}

function fingerprint(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function linesFromRealPdf(file: File): Promise<readonly TestPageLineV1[]> {
  const input = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data: input.slice(),
    stopAtErrors: true,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    maxImageSize: 16_777_216,
    useWorkerFetch: false,
    verbosity: 0,
  });

  try {
    const pdf = await loadingTask.promise;
    const lines: TestPageLineV1[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      groupPdfTextItemsV1(content.items, viewport.transform).forEach((line) => {
        lines.push({ page: pageNumber, text: line.text });
      });
      page.cleanup();
    }
    return lines;
  } finally {
    await loadingTask.destroy();
  }
}

async function buildExtraction(
  file: File,
  onProgress?: (progress: LocalPdfProgressV1) => void,
): Promise<LocalPdfExtractionV1> {
  const input = new Uint8Array(await file.arrayBuffer());
  const digest = fingerprint(input);
  const sourceId = `source.${digest.slice(0, 24)}`;
  const sourceRevisionId = `revision.${digest.slice(0, 24)}`;
  const admittedAt = new Date().toISOString();
  onProgress?.({ stage: 'opening' });

  const lines = lineOverrides.get(file) ?? await linesFromRealPdf(file);
  const pageCount = Math.max(...lines.map((line) => line.page));
  const extractedAt = new Date().toISOString();
  const segments: SourceSegmentV1[] = lines.map((line, index) => ({
    id: `segment.${digest.slice(0, 12)}.p${line.page}.b${index}`,
    sourceId,
    sourceRevisionId,
    index,
    text: line.text,
    anchor: {
      kind: 'page_region',
      page: line.page,
      region: { unit: 'normalized', x: 0.05, y: 0.05, width: 0.9, height: 0.02 },
    },
    extraction: {
      method: 'native_text',
      engine: 'pdfjs-dist',
      version: pdfJsVersion,
      extractedAt,
    },
  }));
  onProgress?.({ stage: 'extracting', page: pageCount, totalPages: pageCount });

  const canonicalCandidate: CanonicalSourceContextV1 = {
    sources: [{
      id: sourceId,
      displayName: file.name,
      kind: 'file',
      mediaType: 'application/pdf',
      byteSize: file.size,
      pageCount,
      origin: { kind: 'upload' },
    }],
    sourceRevisions: [{
      id: sourceRevisionId,
      sourceId,
      fingerprint: { algorithm: 'sha-256', value: digest },
      createdAt: admittedAt,
      status: 'active',
    }],
    sourceSegments: segments,
  };
  const canonical = parseCanonicalSourceContextV1(canonicalCandidate);
  assert.equal(canonical.success, true);
  if (!canonical.success) throw new MockLocalPdfExtractionErrorV1('invalid_extractor_output');

  const observedEvents = [
    {
      id: `event.${digest.slice(0, 12)}.source`,
      sequence: 0,
      occurredAt: admittedAt,
      type: 'source_admitted',
      status: 'completed',
      actor: { location: 'browser', name: 'PaperWork local PDF admission' },
      relatedId: sourceId,
    },
    {
      id: `event.${digest.slice(0, 12)}.extraction`,
      sequence: 1,
      occurredAt: extractedAt,
      type: 'extraction_completed',
      status: 'completed',
      actor: { location: 'browser', name: 'PaperWork local PDF extractor' },
      relatedId: sourceRevisionId,
    },
  ] as const satisfies readonly [ProcessingEventV1, ProcessingEventV1];

  return {
    canonicalSources: canonical.data,
    sourceId,
    sourceRevisionId,
    fingerprint: digest,
    parserVersion: pdfJsVersion,
    admittedAt,
    extractedAt,
    observedEvents,
  };
}

mock.module('../../local-analysis/v1/pdf', {
  namedExports: {
    LocalPdfExtractionErrorV1: MockLocalPdfExtractionErrorV1,
    extractLocalPdfV1: async (
      file: File,
      options: {
        readonly signal?: AbortSignal;
        readonly onProgress?: (progress: LocalPdfProgressV1) => void;
      } = {},
    ) => {
      extractionCalls += 1;
      if (options.signal?.aborted) throw new MockLocalPdfExtractionErrorV1('cancelled');
      return buildExtraction(file, options.onProgress);
    },
  },
});

const {
  analyzeLocalOfferLetterPdfV1,
  isTrustedActionPackV1,
} = await import('./trusted-assembler');

function validAuthorization() {
  const now = Date.now();
  return {
    runId: randomUUID(),
    readApprovedAt: new Date(now - 2_000).toISOString(),
    planApprovedAt: new Date(now - 1_000).toISOString(),
  } as const;
}

function offerFile(
  name: string,
  lines: readonly string[],
  additionalPages: ReadonlyArray<readonly string[]> = [],
) {
  const allLines = [lines, ...additionalPages].flatMap((pageLines, pageIndex) => (
    pageLines.map((text) => ({ page: pageIndex + 1, text }))
  ));
  const body = `%PDF-1.7\n${allLines.map((line) => line.text).join('\n')}`;
  const file = new File([body], name, { type: 'application/pdf' });
  lineOverrides.set(file, allLines);
  return file;
}

const BASE_OFFER_LINES = [
  'Offer of Employment',
  'We are pleased to offer you the position of Product Analyst.',
  'Your employment will begin on 15 September 2026.',
  'Your annual base salary will be INR 1,200,000, paid monthly.',
  'Your primary work location is Bengaluru, with two remote days each week.',
  'The probation period is three months from your start date.',
  'Please sign and return this letter by 5 September 2026.',
] as const;

test('local analysis refuses to read a File without valid explicit authorization', async () => {
  const before = extractionCalls;
  const file = offerFile('tracking.pdf', BASE_OFFER_LINES);
  const result = await analyzeLocalOfferLetterPdfV1(file, {
    authorization: {
      runId: 'run.test',
      readApprovedAt: 'not-a-date',
      planApprovedAt: 'not-a-date',
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, 'authorization');
    assert.equal(result.issues[0].code, 'authorization_required');
  }
  assert.equal(extractionCalls, before);
});

test('authorization must be ordered, recent, non-future, and checked before extraction', async () => {
  const now = Date.now();
  const invalidAuthorizations = [
    {
      label: 'reversed',
      authorization: {
        runId: randomUUID(),
        readApprovedAt: new Date(now - 1_000).toISOString(),
        planApprovedAt: new Date(now - 2_000).toISOString(),
      },
    },
    {
      label: 'future',
      authorization: {
        runId: randomUUID(),
        readApprovedAt: new Date(now + 60_000).toISOString(),
        planApprovedAt: new Date(now + 61_000).toISOString(),
      },
    },
    {
      label: 'stale',
      authorization: {
        runId: randomUUID(),
        readApprovedAt: new Date(now - 24 * 60 * 60 * 1_000).toISOString(),
        planApprovedAt: new Date(now - 24 * 60 * 60 * 1_000 + 1_000).toISOString(),
      },
    },
  ] as const;

  for (const { authorization, label } of invalidAuthorizations) {
    const before = extractionCalls;
    const result = await analyzeLocalOfferLetterPdfV1(
      offerFile(`${label}.pdf`, BASE_OFFER_LINES),
      { authorization },
    );
    assert.equal(result.ok, false, `${label} authorization must be rejected`);
    if (!result.ok) assert.equal(result.stage, 'authorization');
    assert.equal(extractionCalls, before, `${label} authorization must be rejected before file extraction`);
  }
});

test('a local authorization run ID is single-use and replay is rejected before extraction', async () => {
  const authorization = validAuthorization();
  const first = await analyzeLocalOfferLetterPdfV1(
    offerFile('first-authorized-run.pdf', BASE_OFFER_LINES),
    { authorization },
  );
  assert.equal(first.ok, true, JSON.stringify(first));

  const beforeReplay = extractionCalls;
  const replay = await analyzeLocalOfferLetterPdfV1(
    offerFile('replayed-authorization.pdf', BASE_OFFER_LINES),
    { authorization },
  );
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.stage, 'authorization');
  assert.equal(extractionCalls, beforeReplay);
});

test('the real downloadable PDF completes trusted assembly and binds local authorization to its ledger', async () => {
  const sampleBytes = await readFile(new URL('../../../public/samples/Northstar_Offer_Letter.pdf', import.meta.url));
  const file = new File([sampleBytes], 'Northstar_Offer_Letter.pdf', { type: 'application/pdf' });
  const authorization = validAuthorization();
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(isTrustedActionPackV1(result.pack), true);
  assert.equal(Object.isFrozen(result.pack), true);
  assert.equal(isTrustedActionPackV1(structuredClone(result.pack)), false);
  assert.equal(result.pack.canonicalSources.sources[0].pageCount, 2);
  assert.equal(result.pack.runMode, 'sample_fixture');
  assert.equal(result.pack.canonicalSources.sources[0].origin.kind, 'sample');
  assert.deepEqual(result.pack.analysis.actions.map((action) => action.id), ['action.inspect-sample']);
  assert.equal(result.pack.receipt.transfers.length, 0);

  const ledger = JSON.stringify(result.pack.receipt.events);
  assert.ok(ledger.includes(authorization.runId));
  assert.ok(ledger.includes(authorization.readApprovedAt));
  assert.ok(ledger.includes(authorization.planApprovedAt));
});

test('a structured résumé receives a trusted source-only Action Pack', async () => {
  const file = offerFile('Resume.pdf', [
    'Professional Experience',
    'Product Analyst — Northstar Labs',
    'Education',
    'Bachelor of Technology',
    'Technical Skills',
    'SQL, research, and data visualization',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(isTrustedActionPackV1(result.pack), true);
  assert.equal(result.pack.analysis.document.documentType, 'resume');
  assert.equal(result.pack.analysis.document.primaryActionId, 'action.review-resume');
  assert.deepEqual(result.pack.analysis.actions.map((action) => action.id), ['action.review-resume']);
  const documentType = result.pack.analysis.claims.find((claim) => claim.id === 'claim.document-title');
  assert.equal(documentType?.provenance, 'inference');
  if (documentType?.provenance === 'inference') {
    assert.deepEqual(documentType.basisClaimIds, [
      'claim.resume-section-experience',
      'claim.resume-section-education',
      'claim.resume-section-skills',
    ]);
    assert.match(documentType.rationale, /classified.*section headings/i);
  }
  assert.equal(result.pack.analysis.claims.some((claim) => claim.id === 'claim.resume-section-experience'), true);
  assert.equal(result.pack.analysis.claims.some((claim) => claim.id === 'claim.resume-section-education'), true);
  assert.equal(result.pack.analysis.claims.some((claim) => claim.id === 'claim.resume-section-skills'), true);
  assert.equal(result.pack.receipt.transfers.length, 0);
  assert.equal(
    result.pack.receipt.components.find((component) => component.component === 'prompt_template')?.name,
    'Deterministic résumé structure rules',
  );
});

test('a generic PDF is not mislabeled as a résumé from one heading', async () => {
  const file = offerFile('report.pdf', [
    'Quarterly report',
    'Education',
    'This report summarizes training activity.',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, 'classification');
    assert.equal(result.issues[0].code, 'unsupported_document');
  }
});

test('a résumé-like filename cannot replace the required three-heading evidence pattern', async () => {
  const file = offerFile('Resume.pdf', [
    'Experience',
    'One role',
    'Education',
    'One degree',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues[0].code, 'unsupported_document');
});

test('a negated role cannot mint trusted offer and sign claims', async () => {
  const file = offerFile('negated-role.pdf', [
    ...BASE_OFFER_LINES.filter((line) => !line.includes('offer you the position')),
    'We do not offer you the position of Product Analyst.',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(['classification', 'claim_validation'].includes(result.stage));
});

test('a negated sign-and-return sentence cannot become a document requirement', async () => {
  const file = offerFile('negated-sign.pdf', [
    ...BASE_OFFER_LINES.filter((line) => !line.includes('sign and return')),
    'You must not sign and return this letter by 5 September 2026.',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.stage, 'classification');
});

test('a negated start date is not accepted as the employment start date', async () => {
  const file = offerFile('negated-start.pdf', [
    ...BASE_OFFER_LINES.filter((line) => !line.includes('employment will begin')),
    'The start date is not 15 September 2026.',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pack.analysis.claims.some((claim) => claim.id === 'claim.start-date'), false);
});

test('annual CTC is not relabelled as annual base salary', async () => {
  const file = offerFile('ctc.pdf', [
    ...BASE_OFFER_LINES.filter((line) => !line.includes('annual base salary')),
    'Your annual CTC is INR 1,200,000, including variable pay and benefits.',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pack.analysis.claims.some((claim) => claim.id === 'claim.base-salary'), false);
});

test('a disclaimer-only title is not evidence that the document is an offer', async () => {
  const file = offerFile('disclaimer-only.pdf', [
    ...BASE_OFFER_LINES.filter((line) => line !== 'Offer of Employment'),
    'This is not an offer of employment and creates no employment relationship.',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(['classification', 'claim_validation'].includes(result.stage));
});

test('consequence wording reports the ruleset limit rather than claiming the PDF is silent', async () => {
  const file = offerFile('explicit-consequence.pdf', [
    ...BASE_OFFER_LINES,
    'If we do not receive the signed letter by 5 September 2026, this offer will automatically lapse.',
  ]);
  const result = await analyzeLocalOfferLetterPdfV1(file, { authorization: validAuthorization() });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const consequenceClaim = result.pack.analysis.claims.find((claim) => claim.id === 'claim.late-response-consequence');
  assert.equal(consequenceClaim?.provenance, 'not_confirmed');
  assert.match(consequenceClaim?.statement ?? '', /ruleset did not establish/i);
  assert.doesNotMatch(consequenceClaim?.statement ?? '', /PDF (?:does not|did not)|source (?:does not|did not)/i);
  const signAction = result.pack.analysis.actions.find((action) => action.id === 'action.sign-and-return');
  assert.match(signAction?.consequence?.text ?? '', /PaperWork did not establish/i);
  assert.doesNotMatch(signAction?.consequence?.text ?? '', /PDF (?:does not|did not)|source (?:does not|did not)/i);
});

test('fixtures, parsed-looking objects, and clones cannot self-register as trusted', () => {
  assert.equal(isTrustedActionPackV1(offerLetterActionPackV1), false);
  assert.equal(isTrustedActionPackV1(structuredClone(offerLetterActionPackV1)), false);
  assert.equal(isTrustedActionPackV1(Object.freeze({ ...offerLetterActionPackV1 })), false);
});
