import {
  ACTION_PACK_KIND_V1,
  ACTION_PACK_SCHEMA_VERSION_V1,
  MODEL_DRAFT_KIND_V1,
  VALIDATED_ANALYSIS_KIND_V1,
  type ActionDraftV1,
  type ActionPackV1,
  type ClaimDraftV1,
  type ClaimValidationV1,
  type EvidenceRefV1,
  type ModelDraftV1,
  type QuestionDraftV1,
  type SourceSegmentV1,
  type ValidatedActionV1,
  type ValidatedClaimV1,
} from '../contracts';

const SOURCE_ID = 'source.offer-letter';
const SOURCE_REVISION_ID = 'revision.offer-letter.v1';
const ANALYSIS_ID = 'analysis.offer-letter.v1';
const CREATED_AT = '2026-08-30T08:00:00.000Z';
const VALIDATED_AT = '2026-08-30T08:00:04.000Z';
const PACK_CREATED_AT = '2026-08-30T08:00:05.000Z';

const segmentTexts = {
  title: 'Offer of Employment — Northstar Tools Private Limited',
  role: 'We are pleased to offer you the position of Product Analyst, starting 15 September 2026.',
  salary: 'Your annual base salary will be INR 1,200,000, paid monthly.',
  acceptance: 'Please sign and return this letter by 5 September 2026.',
  probationLetter: 'The probation period is three months from your start date.',
  probationAnnex: 'Annex A states that the probation period is six months.',
  workLocation: 'Your primary work location is Bengaluru, with two remote days each week.',
} as const;

function sourceSegment(
  id: string,
  index: number,
  page: number,
  text: string,
): SourceSegmentV1 {
  return {
    id,
    sourceId: SOURCE_ID,
    sourceRevisionId: SOURCE_REVISION_ID,
    index,
    text,
    anchor: { kind: 'page_text', page, block: index },
    extraction: {
      method: 'sample',
      engine: 'paperwork-synthetic-fixture',
      version: ACTION_PACK_SCHEMA_VERSION_V1,
      extractedAt: '2026-08-30T08:00:01.000Z',
    },
  };
}

const sourceSegments = [
  sourceSegment('segment.title', 0, 1, segmentTexts.title),
  sourceSegment('segment.role', 1, 1, segmentTexts.role),
  sourceSegment('segment.salary', 2, 1, segmentTexts.salary),
  sourceSegment('segment.acceptance', 3, 1, segmentTexts.acceptance),
  sourceSegment('segment.probation-letter', 4, 1, segmentTexts.probationLetter),
  sourceSegment('segment.probation-annex', 5, 2, segmentTexts.probationAnnex),
  sourceSegment('segment.work-location', 6, 2, segmentTexts.workLocation),
] as const;

function evidence(segment: SourceSegmentV1): EvidenceRefV1 {
  return {
    sourceId: SOURCE_ID,
    sourceRevisionId: SOURCE_REVISION_ID,
    segmentId: segment.id,
    quote: segment.text,
    span: { start: 0, end: segment.text.length },
  };
}

const draftClaims = [
  {
    id: 'claim.document-title',
    provenance: 'source_fact',
    title: 'Document title',
    statement: 'This document is an offer of employment from Northstar Tools Private Limited.',
    materiality: 'material',
    normalizedValues: [],
    evidence: [evidence(sourceSegments[0])],
  },
  {
    id: 'claim.document-purpose',
    provenance: 'source_fact',
    title: 'Purpose',
    statement: 'The document offers the recipient a Product Analyst position.',
    materiality: 'material',
    normalizedValues: [],
    evidence: [evidence(sourceSegments[1])],
  },
  {
    id: 'claim.action-required',
    provenance: 'source_fact',
    title: 'Action required',
    statement: 'The letter asks the recipient to sign and return it.',
    materiality: 'material',
    normalizedValues: [],
    evidence: [evidence(sourceSegments[3])],
  },
  {
    id: 'claim.acceptance-deadline',
    provenance: 'source_fact',
    title: 'Acceptance deadline',
    statement: 'The stated deadline to sign and return the letter is 5 September 2026.',
    materiality: 'material',
    normalizedValues: [{ kind: 'date', value: '2026-09-05' }],
    evidence: [evidence(sourceSegments[3])],
  },
  {
    id: 'claim.role-and-start',
    provenance: 'source_fact',
    title: 'Role and start date',
    statement: 'The offered role is Product Analyst and the stated start date is 15 September 2026.',
    materiality: 'material',
    normalizedValues: [{ kind: 'date', value: '2026-09-15' }],
    evidence: [evidence(sourceSegments[1])],
  },
  {
    id: 'claim.base-salary',
    provenance: 'source_fact',
    title: 'Base salary',
    statement: 'The stated annual base salary is INR 1,200,000, paid monthly.',
    materiality: 'material',
    normalizedValues: [{ kind: 'money', amount: '1200000', currency: 'INR', basis: 'annual' }],
    evidence: [evidence(sourceSegments[2])],
  },
  {
    id: 'claim.response-window',
    provenance: 'inference',
    title: 'Response precedes start',
    statement: 'The stated acceptance deadline is before the stated employment start date.',
    materiality: 'supporting',
    normalizedValues: [],
    evidence: [evidence(sourceSegments[1]), evidence(sourceSegments[3])],
    basisClaimIds: ['claim.acceptance-deadline', 'claim.role-and-start'],
    rationale: 'The two explicit calendar dates can be compared without outside knowledge.',
  },
  {
    id: 'claim.review-suggestion',
    provenance: 'suggestion',
    title: 'Review before signing',
    statement: 'Consider reviewing the compensation and unresolved probation terms before choosing whether to sign.',
    materiality: 'supporting',
    normalizedValues: [],
    basisClaimIds: ['claim.base-salary', 'claim.probation-conflict'],
    rationale: 'The suggestion is grounded in stated compensation and conflicting probation terms.',
    sourceImposed: false,
    execution: 'manual_user_choice',
  },
  {
    id: 'claim.relocation-not-confirmed',
    provenance: 'not_confirmed',
    title: 'Relocation reimbursement',
    statement: 'Relocation-expense reimbursement is not confirmed by the supplied letter.',
    materiality: 'supporting',
    normalizedValues: [],
    evidence: [],
    reason: 'No supplied source segment states whether relocation expenses are reimbursed.',
  },
  {
    id: 'claim.late-response-consequence',
    provenance: 'not_confirmed',
    title: 'Late-response consequence',
    statement: 'The consequence of returning the letter after the stated deadline is not confirmed.',
    materiality: 'supporting',
    normalizedValues: [],
    evidence: [evidence(sourceSegments[3])],
    reason: 'The supplied letter states a deadline but does not state what happens after it passes.',
  },
  {
    id: 'claim.probation-conflict',
    provenance: 'conflict',
    title: 'Conflicting probation period',
    statement: 'The supplied letter contains conflicting probation-period terms.',
    materiality: 'material',
    normalizedValues: [],
    alternatives: [
      {
        statement: 'The main letter states a three-month probation period.',
        evidence: [evidence(sourceSegments[4])],
      },
      {
        statement: 'Annex A states a six-month probation period.',
        evidence: [evidence(sourceSegments[5])],
      },
    ],
    rationale: 'Two distinct anchored segments state different durations for the same probation period.',
  },
] as const satisfies readonly ClaimDraftV1[];

function claimValidation(claim: ClaimDraftV1): ClaimValidationV1 {
  if (claim.provenance === 'not_confirmed') {
    return {
      state: 'needs_review',
      validatorVersion: 'paperwork-fixture-review-1.0.0',
      validatedAt: VALIDATED_AT,
      issueCodes: ['missing_source_detail'],
      checks: {
        citation: claim.evidence.length > 0 ? 'passed' : 'not_applicable',
        semanticSupport: 'not_applicable',
      },
    };
  }
  if (claim.provenance === 'conflict') {
    return {
      state: 'needs_review',
      validatorVersion: 'paperwork-fixture-review-1.0.0',
      validatedAt: VALIDATED_AT,
      issueCodes: ['conflicting_source_terms'],
      checks: { citation: 'passed', semanticSupport: 'supported' },
    };
  }
  return {
    state: 'accepted',
    validatorVersion: 'paperwork-fixture-review-1.0.0',
    validatedAt: VALIDATED_AT,
    issueCodes: [],
    checks: claim.provenance === 'suggestion'
      ? { citation: 'not_applicable', semanticSupport: 'not_applicable' }
      : { citation: 'passed', semanticSupport: 'supported' },
  };
}

const validatedClaims: readonly ValidatedClaimV1[] = draftClaims.map((claim) => ({
  ...claim,
  validation: claimValidation(claim),
}));

const actions = [
  {
    id: 'action.sign-and-return',
    provenance: 'document_requirement',
    order: 0,
    priority: 'critical',
    title: 'Decide, sign, and return the letter',
    description: 'If you choose to accept, sign and return the letter by the stated deadline.',
    timing: {
      kind: 'calendar_date',
      date: '2026-09-05',
      basisClaimId: 'claim.acceptance-deadline',
    },
    basisClaimIds: ['claim.action-required', 'claim.acceptance-deadline'],
    requiredInputs: ['Your acceptance decision', 'A signed copy of the offer letter'],
    consequence: {
      text: 'The supplied letter does not confirm what happens if it is returned after the deadline.',
      basisClaimIds: ['claim.late-response-consequence'],
    },
    sourceImposed: true,
    execution: 'manual_user_choice',
  },
  {
    id: 'action.clarify-probation',
    provenance: 'paperwork_suggestion',
    order: 1,
    priority: 'high',
    title: 'Ask which probation term applies',
    description: 'Request written clarification of the three-month and six-month probation terms before signing.',
    timing: {
      kind: 'condition',
      label: 'Before deciding whether to sign',
      basisClaimId: 'claim.probation-conflict',
    },
    basisClaimIds: ['claim.probation-conflict'],
    requiredInputs: ['The main letter', 'Annex A'],
    sourceImposed: false,
    execution: 'manual_user_choice',
  },
] as const satisfies readonly ActionDraftV1[];

const validatedActions: readonly ValidatedActionV1[] = actions.map((action) => ({
  ...action,
  validation: {
    state: 'accepted',
    validatorVersion: 'paperwork-fixture-review-1.0.0',
    validatedAt: VALIDATED_AT,
    issueCodes: [],
    checks: {
      basis: 'passed',
      timing: 'passed',
      safety: 'passed',
    },
  },
}));

const questions = [
  {
    id: 'question.probation-term',
    text: 'Which probation duration is intended to govern the offer?',
    reason: 'The main letter and Annex A state different durations.',
    basisClaimIds: ['claim.probation-conflict'],
  },
  {
    id: 'question.relocation',
    text: 'Are relocation expenses reimbursed?',
    reason: 'The supplied letter does not confirm a relocation-expense policy.',
    basisClaimIds: ['claim.relocation-not-confirmed'],
  },
] as const satisfies readonly QuestionDraftV1[];

const document = {
  documentType: 'employment_offer',
  titleClaimId: 'claim.document-title',
  purposeClaimId: 'claim.document-purpose',
  actionRequiredClaimId: 'claim.action-required',
  nearestDeadlineClaimId: 'claim.acceptance-deadline',
  primaryActionId: 'action.sign-and-return',
} as const;

const sections = {
  briefClaimIds: [
    'claim.document-title',
    'claim.document-purpose',
    'claim.action-required',
    'claim.acceptance-deadline',
  ],
  factClaimIds: [
    'claim.document-title',
    'claim.document-purpose',
    'claim.action-required',
    'claim.acceptance-deadline',
    'claim.role-and-start',
    'claim.base-salary',
    'claim.response-window',
  ],
  attentionClaimIds: ['claim.acceptance-deadline', 'claim.probation-conflict'],
  missingInformationClaimIds: ['claim.relocation-not-confirmed', 'claim.late-response-consequence'],
  conflictClaimIds: ['claim.probation-conflict'],
  planActionIds: ['action.sign-and-return', 'action.clarify-probation'],
} as const;

export const offerLetterModelDraftV1 = {
  kind: MODEL_DRAFT_KIND_V1,
  schemaVersion: ACTION_PACK_SCHEMA_VERSION_V1,
  analysisId: ANALYSIS_ID,
  knowledgeMode: 'source_only',
  sourceRevisionIds: [SOURCE_REVISION_ID],
  document,
  claims: draftClaims,
  actions,
  questions,
  sections,
} as const satisfies ModelDraftV1;

export const offerLetterActionPackV1 = {
  kind: ACTION_PACK_KIND_V1,
  schemaVersion: ACTION_PACK_SCHEMA_VERSION_V1,
  packId: 'pack.offer-letter.v1',
  createdAt: PACK_CREATED_AT,
  runMode: 'sample_fixture',
  canonicalSources: {
    sources: [
      {
        id: SOURCE_ID,
        displayName: 'Northstar_Offer_Letter.pdf',
        kind: 'file',
        mediaType: 'application/pdf',
        byteSize: 4_096,
        pageCount: 3,
        origin: { kind: 'sample', fixtureId: 'fixture.offer-letter.v1' },
      },
    ],
    sourceRevisions: [
      {
        id: SOURCE_REVISION_ID,
        sourceId: SOURCE_ID,
        fingerprint: { algorithm: 'sha-256', value: 'a'.repeat(64) },
        createdAt: CREATED_AT,
        status: 'active',
      },
    ],
    sourceSegments,
  },
  analysis: {
    kind: VALIDATED_ANALYSIS_KIND_V1,
    schemaVersion: ACTION_PACK_SCHEMA_VERSION_V1,
    analysisId: ANALYSIS_ID,
    knowledgeMode: 'source_only',
    sourceRevisionIds: [SOURCE_REVISION_ID],
    document,
    claims: validatedClaims,
    actions: validatedActions,
    questions,
    sections,
  },
  receipt: {
    id: 'receipt.offer-letter.v1',
    createdAt: '2026-08-30T08:00:05.000Z',
    processingMode: 'sample',
    events: [
      {
        id: 'event.source-admitted',
        sequence: 0,
        occurredAt: CREATED_AT,
        type: 'source_admitted',
        status: 'completed',
        actor: { location: 'browser', name: 'Synthetic fixture construction' },
        relatedId: SOURCE_ID,
      },
      {
        id: 'event.extraction-completed',
        sequence: 1,
        occurredAt: '2026-08-30T08:00:01.000Z',
        type: 'extraction_completed',
        status: 'completed',
        actor: { location: 'browser', name: 'Synthetic fixture construction' },
        relatedId: SOURCE_REVISION_ID,
      },
      {
        id: 'event.analysis-completed',
        sequence: 2,
        occurredAt: '2026-08-30T08:00:03.000Z',
        type: 'analysis_completed',
        status: 'completed',
        actor: { location: 'browser', name: 'Synthetic fixture construction' },
        relatedId: ANALYSIS_ID,
      },
      {
        id: 'event.validation-completed',
        sequence: 3,
        occurredAt: VALIDATED_AT,
        type: 'validation_completed',
        status: 'completed',
        actor: { location: 'browser', name: 'Synthetic fixture review' },
        relatedId: ANALYSIS_ID,
      },
    ],
    consentRecords: [],
    transfers: [],
    retention: [
      {
        id: 'retention.browser',
        subject: 'browser',
        state: 'status_unavailable',
        assertedBy: 'PaperWork synthetic fixture',
        recordedAt: '2026-08-30T08:00:05.000Z',
      },
      {
        id: 'retention.provider',
        subject: 'provider',
        state: 'not_stored',
        assertedBy: 'No provider transfer occurred in sample mode',
        recordedAt: '2026-08-30T08:00:05.000Z',
      },
    ],
    components: [
      { component: 'paperwork', name: 'PaperWork', version: ACTION_PACK_SCHEMA_VERSION_V1 },
      { component: 'parser', name: 'Synthetic sample parser', version: ACTION_PACK_SCHEMA_VERSION_V1 },
      { component: 'citation_validator', name: 'Action Pack validator', version: ACTION_PACK_SCHEMA_VERSION_V1 },
    ],
    validationSummary: {
      totalClaims: 11,
      accepted: 8,
      needsReview: 3,
      blocked: 0,
      stale: 0,
      totalActions: 2,
      acceptedActions: 2,
      needsReviewActions: 0,
      blockedActions: 0,
      staleActions: 0,
    },
    externalReferences: [],
    correctionIds: [],
  },
  corrections: [],
  limitations: [
    'This is synthetic sample data and not a real employment offer.',
    'Its validation states and processing events are illustrative fixture records, not proof of a live observed run.',
    'PaperWork does not provide legal, financial, or employment advice.',
  ],
} satisfies ActionPackV1;
