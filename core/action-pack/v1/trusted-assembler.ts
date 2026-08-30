import {
  ACTION_PACK_KIND_V1,
  ACTION_PACK_SCHEMA_VERSION_V1,
  MODEL_DRAFT_KIND_V1,
  VALIDATED_ANALYSIS_KIND_V1,
  type ActionDraftV1,
  type ActionPackV1,
  type ClaimDraftV1,
  type EvidenceRefV1,
  type NonEmptyArray,
  type ProcessingEventV1,
  type SourceSegmentV1,
  type TrustedActionPackV1,
  type ValidatedActionV1,
  type ValidatedClaimV1,
} from './contracts';
import {
  formatContractIssuesV1,
  parseActionPackV1,
  parseModelDraftV1,
} from './validate';

import type {
  LocalPdfExtractionV1,
  LocalPdfFailureCodeV1,
  LocalPdfProgressV1,
} from '../../local-analysis/v1/pdf';

const RULESET_VERSION = 'offer-letter-rules-1.1.0';
const VALIDATOR_VERSION = 'trusted-local-assembler-1.1.0';
const AUTHORIZATION_WINDOW_MS = 15 * 60 * 1_000;
const NORTHSTAR_SAMPLE_FINGERPRINT = '15bf178404e1bd788975b102a5c083f9c2a61c9d91123afdac0377fd81c63e0f';
const NORTHSTAR_SAMPLE_FIXTURE_ID = 'northstar-offer-letter-v1';
const trustedActionPacksV1 = new WeakSet<object>();
const usedRunIdsV1 = new Set<string>();

export interface LocalRunAuthorizationV1 {
  readonly runId: string;
  readonly readApprovedAt: string;
  readonly planApprovedAt: string;
}

export type LocalAnalysisProgressV1 =
  | LocalPdfProgressV1
  | { readonly stage: 'assembling' }
  | { readonly stage: 'validating' };

export type LocalAnalysisIssueCodeV1 =
  | LocalPdfFailureCodeV1
  | 'authorization_required'
  | 'unsupported_document'
  | 'required_term_not_found'
  | 'unsafe_source_value'
  | 'claim_validation_failed'
  | 'action_safety_failed'
  | 'event_ledger_failed'
  | 'contract_validation_failed'
  | 'assembly_failed';

export interface LocalAnalysisIssueV1 {
  readonly code: LocalAnalysisIssueCodeV1;
}

export type LocalOfferLetterResultV1 =
  | { readonly ok: true; readonly pack: TrustedActionPackV1 }
  | {
      readonly ok: false;
      readonly stage:
        | 'authorization'
        | 'extraction'
        | 'classification'
        | 'claim_validation'
        | 'action_safety'
        | 'event_ledger'
        | 'contract'
        | 'cancelled';
      readonly issues: NonEmptyArray<LocalAnalysisIssueV1>;
    };

interface ParsedDateV1 {
  readonly iso: string;
  readonly display: string;
}

interface ParsedMoneyV1 {
  readonly amount: string;
  readonly currency: string;
  readonly display: string;
}

interface ParsedDurationV1 {
  readonly value: number;
  readonly segment: SourceSegmentV1;
}

interface OfferLetterFactsV1 {
  readonly sampleFixtureId?: string;
  readonly titleSegment: SourceSegmentV1;
  readonly roleSegment: SourceSegmentV1;
  readonly role: string;
  readonly actionSegment: SourceSegmentV1;
  readonly deadline?: { readonly value: ParsedDateV1; readonly segment: SourceSegmentV1 };
  readonly startDate?: { readonly value: ParsedDateV1; readonly segment: SourceSegmentV1 };
  readonly salary?: { readonly value: ParsedMoneyV1; readonly segment: SourceSegmentV1 };
  readonly location?: { readonly value: string; readonly segment: SourceSegmentV1 };
  readonly probation: readonly ParsedDurationV1[];
}

class AssemblyAuthorityErrorV1 extends Error {
  readonly stage: Exclude<LocalOfferLetterResultV1, { ok: true }>['stage'];
  readonly code: LocalAnalysisIssueCodeV1;

  constructor(
    stage: Exclude<LocalOfferLetterResultV1, { ok: true }>['stage'],
    code: LocalAnalysisIssueCodeV1,
  ) {
    super(code);
    this.name = 'AssemblyAuthorityErrorV1';
    this.stage = stage;
    this.code = code;
  }
}

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
} as const;

const DURATION_WORDS: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
});

function parseNamedDate(text: string): ParsedDateV1 | undefined {
  const match = text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (!match) return undefined;
  const day = Number(match[1]);
  const monthName = match[2].toLowerCase() as keyof typeof MONTHS;
  const month = MONTHS[monthName];
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return undefined;
  return {
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    display: `${day} ${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()} ${year}`,
  };
}

function hasExtractionDisqualifier(text: string) {
  return /\b(?:not|need\s+not|no\s+obligation|cannot|can't|never|may|might|could|unless|except|optional|non-binding|proposed|tentative|expected|subject\s+to|conditional|void|revoked|withdrawn|superseded)\b/i.test(text);
}

function hasGlobalDisclaimer(text: string) {
  return /\b(?:not\s+(?:an?\s+)?(?:real\s+)?(?:offer\s+of\s+employment|employment\s+offer)|(?:does\s+not\s+create\s+an?|creates\s+no)\s+employment\s+relationship|template\s+only|illustrative\s+(?:sample|example)|sample\s+(?:document|fixture)|draft\s+only|offer\s+(?:is|was)\s+(?:void|revoked|withdrawn|superseded))\b/i.test(text);
}

function parseRole(text: string) {
  if (hasExtractionDisqualifier(text)) return undefined;
  const match = text.match(/\boffer\s+you\s+(?:the\s+)?position\s+of\s+(.+?)(?=,?\s+(?:starting|effective|with\s+effect)|[.;]|$)/i);
  return match?.[1].trim();
}

function parseLocation(text: string) {
  if (hasExtractionDisqualifier(text)) return undefined;
  const match = text.match(/\b(?:primary\s+)?work\s+location\s+is\s+(.+?)(?=,\s+with\b|[.;]|$)/i);
  return match?.[1].trim();
}

function isSignAndReturnInstruction(text: string) {
  if (hasExtractionDisqualifier(text)) return false;
  if (!/\bsign\b/i.test(text) || !/\breturn\b/i.test(text)) return false;
  return /\b(?:please|must|required\s+to|to\s+accept(?:\s+this\s+offer)?[, ]+)\b/i.test(text);
}

function parseSalary(text: string): ParsedMoneyV1 | undefined {
  if (hasExtractionDisqualifier(text) || !/\bannual\s+base\s+salary\b/i.test(text)) return undefined;
  const match = text.match(/\b(INR|USD|EUR|GBP)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i)
    ?? text.match(/(₹|\$|€|£)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (!match) return undefined;
  const currencies: Readonly<Record<string, string>> = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP' };
  const currency = currencies[match[1]] ?? match[1].toUpperCase();
  const amount = match[2].replace(/,/g, '');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) return undefined;
  return { amount, currency, display: `${currency} ${match[2]}` };
}

function parseProbation(text: string): number | undefined {
  if (hasExtractionDisqualifier(text)) return undefined;
  const match = text.match(/\bprobation\s+period\s+is\s+([a-z]+|\d+)\s+months?\b/i);
  if (!match) return undefined;
  const token = match[1].toLowerCase();
  const value = /^\d+$/.test(token) ? Number(token) : DURATION_WORDS[token];
  if (!Number.isInteger(value) || value < 1 || value > 24) return undefined;
  return value;
}

function safeInterpolatedValue(value: string) {
  if (!value || value.length > 180) return false;
  if (/[\u0000-\u001f\u007f<>]/.test(value)) return false;
  if (/javascript\s*:|\bon[a-z]+\s*=/i.test(value)) return false;
  return true;
}

function evidence(extraction: LocalPdfExtractionV1, segment: SourceSegmentV1): EvidenceRefV1 {
  return {
    sourceId: extraction.sourceId,
    sourceRevisionId: extraction.sourceRevisionId,
    segmentId: segment.id,
    quote: segment.text,
    span: { start: 0, end: segment.text.length },
  };
}

function claimText(facts: OfferLetterFactsV1) {
  const sample = Boolean(facts.sampleFixtureId);
  return {
    documentTitle: sample
      ? 'The recognized synthetic fixture is formatted as an employment offer.'
      : 'The supplied PDF identifies itself as an employment offer.',
    purpose: sample
      ? `The synthetic fixture describes the recipient role as ${facts.role}.`
      : `The document offers the recipient the role of ${facts.role}.`,
    actionRequired: sample
      ? 'The synthetic fixture contains an instruction to sign and return it.'
      : 'The letter asks the recipient to sign and return it.',
    offeredRole: sample
      ? `The role stated in the synthetic fixture is ${facts.role}.`
      : `The offered role is ${facts.role}.`,
    deadline: facts.deadline
      ? sample
        ? `The sign-and-return date shown in the synthetic fixture is ${facts.deadline.value.display}.`
        : `The stated deadline to sign and return the letter is ${facts.deadline.value.display}.`
      : undefined,
    startDate: facts.startDate
      ? sample
        ? `The employment start date shown in the synthetic fixture is ${facts.startDate.value.display}.`
        : `The stated employment start date is ${facts.startDate.value.display}.`
      : undefined,
    salary: facts.salary
      ? sample
        ? `The annual base salary shown in the synthetic fixture is ${facts.salary.value.display}.`
        : `The stated annual base salary is ${facts.salary.value.display}.`
      : undefined,
    location: facts.location
      ? sample
        ? `The primary work location shown in the synthetic fixture is ${facts.location.value}.`
        : `The stated primary work location is ${facts.location.value}.`
      : undefined,
    lateConsequence: 'This ruleset did not establish a consequence for returning the letter after the deadline.',
  } as const;
}

function extractOfferLetterFacts(extraction: LocalPdfExtractionV1): OfferLetterFactsV1 {
  const segments = extraction.canonicalSources.sourceSegments;
  const sampleFixtureId = extraction.fingerprint === NORTHSTAR_SAMPLE_FINGERPRINT
    ? NORTHSTAR_SAMPLE_FIXTURE_ID
    : undefined;
  if (!sampleFixtureId && segments.some((segment) => hasGlobalDisclaimer(segment.text))) {
    throw new AssemblyAuthorityErrorV1('classification', 'unsupported_document');
  }
  const titleSegment = segments.find((segment) => /^\s*offer\s+of\s+employment\s*$/i.test(segment.text))
    ?? segments.find((segment) => /\boffer\s+of\s+employment\b/i.test(segment.text))
    ?? segments.find((segment) => (
      /\bemployment\s+offer\b|\boffer\s+letter\b/i.test(segment.text)
      && !/\bnot\b.{0,30}\bemployment\s+offer\b/i.test(segment.text)
    ));
  if (!titleSegment) throw new AssemblyAuthorityErrorV1('classification', 'unsupported_document');

  const roleSegment = segments.find((segment) => parseRole(segment.text));
  const role = roleSegment && parseRole(roleSegment.text);
  if (!roleSegment || !role) throw new AssemblyAuthorityErrorV1('classification', 'required_term_not_found');
  if (!safeInterpolatedValue(role)) throw new AssemblyAuthorityErrorV1('classification', 'unsafe_source_value');

  const actionSegment = segments.find((segment) => isSignAndReturnInstruction(segment.text));
  if (!actionSegment) throw new AssemblyAuthorityErrorV1('classification', 'required_term_not_found');

  const deadlineSegment = segments.find((segment) => (
    /\b(?:by|no\s+later\s+than)\b/i.test(segment.text)
    && isSignAndReturnInstruction(segment.text)
    && parseNamedDate(segment.text)
  ));
  if (!deadlineSegment) throw new AssemblyAuthorityErrorV1('classification', 'required_term_not_found');
  const startSegment = segments.find((segment) => (
    /\b(?:employment\s+will\s+begin|starting|start\s+date|commence)\b/i.test(segment.text)
    && !hasExtractionDisqualifier(segment.text)
    && parseNamedDate(segment.text)
  ));
  const salarySegment = segments.find((segment) => parseSalary(segment.text));
  const locationSegment = segments.find((segment) => parseLocation(segment.text));
  const location = locationSegment && parseLocation(locationSegment.text);
  if (location && !safeInterpolatedValue(location)) throw new AssemblyAuthorityErrorV1('classification', 'unsafe_source_value');

  const probation = segments
    .map((segment) => ({ value: parseProbation(segment.text), segment }))
    .filter((item): item is ParsedDurationV1 => typeof item.value === 'number');

  return {
    sampleFixtureId,
    titleSegment,
    roleSegment,
    role,
    actionSegment,
    deadline: deadlineSegment ? { value: parseNamedDate(deadlineSegment.text)!, segment: deadlineSegment } : undefined,
    startDate: startSegment ? { value: parseNamedDate(startSegment.text)!, segment: startSegment } : undefined,
    salary: salarySegment ? { value: parseSalary(salarySegment.text)!, segment: salarySegment } : undefined,
    location: locationSegment && location ? { value: location, segment: locationSegment } : undefined,
    probation,
  };
}

function buildClaims(
  extraction: LocalPdfExtractionV1,
  facts: OfferLetterFactsV1,
): readonly ClaimDraftV1[] {
  const text = claimText(facts);
  const claims: ClaimDraftV1[] = [
    {
      id: 'claim.document-title',
      provenance: 'source_fact',
      title: 'Document type',
      statement: text.documentTitle,
      materiality: 'material',
      normalizedValues: [],
      evidence: [evidence(extraction, facts.titleSegment)],
    },
    {
      id: 'claim.document-purpose',
      provenance: 'source_fact',
      title: 'Purpose',
      statement: text.purpose,
      materiality: 'material',
      normalizedValues: [],
      evidence: [evidence(extraction, facts.roleSegment)],
    },
    {
      id: 'claim.action-required',
      provenance: 'source_fact',
      title: 'Action required',
      statement: text.actionRequired,
      materiality: 'material',
      normalizedValues: [],
      evidence: [evidence(extraction, facts.actionSegment)],
    },
    {
      id: 'claim.offered-role',
      provenance: 'source_fact',
      title: 'Offered role',
      statement: text.offeredRole,
      materiality: 'material',
      normalizedValues: [],
      evidence: [evidence(extraction, facts.roleSegment)],
    },
  ];

  if (facts.deadline) {
    claims.push({
      id: 'claim.acceptance-deadline',
      provenance: 'source_fact',
      title: 'Acceptance deadline',
      statement: text.deadline!,
      materiality: 'material',
      normalizedValues: [{ kind: 'date', value: facts.deadline.value.iso }],
      evidence: [evidence(extraction, facts.deadline.segment)],
    });
  }
  if (facts.startDate) {
    claims.push({
      id: 'claim.start-date',
      provenance: 'source_fact',
      title: 'Start date',
      statement: text.startDate!,
      materiality: 'material',
      normalizedValues: [{ kind: 'date', value: facts.startDate.value.iso }],
      evidence: [evidence(extraction, facts.startDate.segment)],
    });
  }
  if (facts.salary) {
    claims.push({
      id: 'claim.base-salary',
      provenance: 'source_fact',
      title: 'Annual base salary',
      statement: text.salary!,
      materiality: 'material',
      normalizedValues: [{ kind: 'money', amount: facts.salary.value.amount, currency: facts.salary.value.currency, basis: 'annual' }],
      evidence: [evidence(extraction, facts.salary.segment)],
    });
  }
  if (facts.location) {
    claims.push({
      id: 'claim.work-location',
      provenance: 'source_fact',
      title: 'Work location',
      statement: text.location!,
      materiality: 'material',
      normalizedValues: [],
      evidence: [evidence(extraction, facts.location.segment)],
    });
  }

  const uniqueProbation = new Map<number, ParsedDurationV1>();
  facts.probation.forEach((item) => { if (!uniqueProbation.has(item.value)) uniqueProbation.set(item.value, item); });
  if (uniqueProbation.size === 1) {
    const item = [...uniqueProbation.values()][0];
    claims.push({
      id: 'claim.probation-period',
      provenance: 'source_fact',
      title: 'Probation period',
      statement: facts.sampleFixtureId
        ? `A synthetic-fixture passage states a ${item.value}-month probation period.`
        : `A source passage states a ${item.value}-month probation period.`,
      materiality: 'material',
      normalizedValues: [{ kind: 'duration', value: item.value, unit: 'month' }],
      evidence: [evidence(extraction, item.segment)],
    });
  } else if (uniqueProbation.size > 1) {
    const alternatives = [...uniqueProbation.values()].map((item, index) => ({
      statement: `${index === 0 ? 'One' : 'Another'} source passage states a ${item.value}-month probation period.`,
      evidence: [evidence(extraction, item.segment)] as NonEmptyArray<EvidenceRefV1>,
    })) as [
      { readonly statement: string; readonly evidence: NonEmptyArray<EvidenceRefV1> },
      { readonly statement: string; readonly evidence: NonEmptyArray<EvidenceRefV1> },
      ...{ readonly statement: string; readonly evidence: NonEmptyArray<EvidenceRefV1> }[],
    ];
    claims.push({
      id: 'claim.probation-conflict',
      provenance: 'conflict',
      title: 'Conflicting probation period',
      statement: facts.sampleFixtureId
        ? 'The synthetic fixture contains conflicting probation-period terms.'
        : 'The supplied PDF contains conflicting probation-period terms.',
      materiality: 'material',
      normalizedValues: [],
      alternatives,
      rationale: 'Distinct source passages state different durations for the same probation period.',
    });
  }

  claims.push({
    id: 'claim.late-response-consequence',
    provenance: 'not_confirmed',
    title: 'Late-response consequence',
    statement: text.lateConsequence,
    materiality: 'supporting',
    normalizedValues: [],
    evidence: [],
    reason: 'The current deterministic rules do not interpret late-response consequence language; review the source or ask the issuer rather than treating this as proof of absence.',
  });
  return claims;
}

function verifyEvidence(extraction: LocalPdfExtractionV1, reference: EvidenceRefV1) {
  const segment = extraction.canonicalSources.sourceSegments.find((item) => item.id === reference.segmentId);
  return Boolean(
    segment
    && segment.sourceId === extraction.sourceId
    && segment.sourceRevisionId === extraction.sourceRevisionId
    && segment.text.slice(reference.span.start, reference.span.end) === reference.quote
  );
}

function hasVerificationDisqualifier(text: string) {
  return /\b(?:not|need\s+not|no\s+obligation|cannot|can't|never|may|might|could|unless|except|optional|non-binding|proposed|tentative|expected|subject\s+to|conditional|void|revoked|withdrawn|superseded)\b/i.test(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function independentlyVerifyTitleQuote(quote: string) {
  return !hasVerificationDisqualifier(quote)
    && /^(?:\s*offer\s+of\s+employment\s*|.*\bemployment\s+offer\b.*|.*\boffer\s+letter\b.*)$/i.test(quote);
}

function independentlyVerifyRoleQuote(quote: string, expectedRole: string) {
  if (hasVerificationDisqualifier(quote)) return false;
  const role = escapeRegExp(expectedRole);
  return new RegExp(`\\boffer\\s+you\\s+(?:the\\s+)?position\\s+of\\s+${role}(?=,?\\s+(?:starting|effective|with\\s+effect)|[.;]|$)`, 'i').test(quote);
}

function independentlyVerifyActionQuote(quote: string) {
  if (hasVerificationDisqualifier(quote)) return false;
  return /\b(?:please\s+|must\s+|required\s+to\s+|to\s+accept(?:\s+this\s+offer)?[, ]+)[^.]*\bsign\b[^.]*\breturn\b/i.test(quote);
}

function independentlyReadNamedDate(quote: string) {
  const match = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i.exec(quote);
  if (!match) return undefined;
  const monthTokens = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = monthTokens.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function independentlyVerifyDeadlineQuote(quote: string, expectedIso: string) {
  return independentlyVerifyActionQuote(quote)
    && /\b(?:by|no\s+later\s+than)\b/i.test(quote)
    && independentlyReadNamedDate(quote) === expectedIso;
}

function independentlyVerifyStartQuote(quote: string, expectedIso: string) {
  return !hasVerificationDisqualifier(quote)
    && /\b(?:employment\s+will\s+begin|starting|start\s+date\s+is|commence(?:s|ment)?\s+on)\b/i.test(quote)
    && independentlyReadNamedDate(quote) === expectedIso;
}

function independentlyVerifySalaryQuote(quote: string, expected: ParsedMoneyV1) {
  if (hasVerificationDisqualifier(quote) || !/\bannual\s+base\s+salary\b/i.test(quote)) return false;
  const match = /\b(INR|USD|EUR|GBP)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(quote)
    ?? /(₹|\$|€|£)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/.exec(quote);
  if (!match) return false;
  const currencies: Readonly<Record<string, string>> = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP' };
  return (currencies[match[1]] ?? match[1].toUpperCase()) === expected.currency
    && match[2].replace(/,/g, '') === expected.amount;
}

function independentlyVerifyLocationQuote(quote: string, expectedLocation: string) {
  if (hasVerificationDisqualifier(quote)) return false;
  const location = escapeRegExp(expectedLocation);
  return new RegExp(`\\b(?:primary\\s+)?work\\s+location\\s+is\\s+${location}(?=,\\s+with\\b|[.;]|$)`, 'i').test(quote);
}

function independentlyVerifyProbationQuote(quote: string, expectedMonths: number) {
  if (hasVerificationDisqualifier(quote)) return false;
  const match = /\bprobation\s+period\s+is\s+([a-z]+|\d+)\s+months?\b/i.exec(quote);
  if (!match) return false;
  const token = match[1].toLowerCase();
  const value = /^\d+$/.test(token) ? Number(token) : DURATION_WORDS[token];
  return value === expectedMonths;
}

function verifyClaimSemantics(
  extraction: LocalPdfExtractionV1,
  facts: OfferLetterFactsV1,
  claims: readonly ClaimDraftV1[],
) {
  if (!facts.deadline) return false;
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  if (byId.size !== claims.length) return false;
  const text = claimText(facts);
  const expected = new Map<string, string>([
    ['claim.document-title', text.documentTitle],
    ['claim.document-purpose', text.purpose],
    ['claim.action-required', text.actionRequired],
    ['claim.offered-role', text.offeredRole],
    ['claim.late-response-consequence', text.lateConsequence],
  ]);
  if (facts.deadline) expected.set('claim.acceptance-deadline', text.deadline!);
  if (facts.startDate) expected.set('claim.start-date', text.startDate!);
  if (facts.salary) expected.set('claim.base-salary', text.salary!);
  if (facts.location) expected.set('claim.work-location', text.location!);
  const probationClaimId = new Set(facts.probation.map((item) => item.value)).size > 1
    ? 'claim.probation-conflict'
    : facts.probation.length > 0 ? 'claim.probation-period' : undefined;
  const allowedClaimIds = new Set([...expected.keys(), ...(probationClaimId ? [probationClaimId] : [])]);
  if (claims.some((claim) => !allowedClaimIds.has(claim.id)) || claims.length !== allowedClaimIds.size) return false;

  for (const [id, statement] of expected) {
    const claim = byId.get(id);
    if (!claim || claim.statement !== statement) return false;
  }

  for (const claim of claims) {
    if (claim.provenance === 'source_fact' || claim.provenance === 'inference' || claim.provenance === 'not_confirmed') {
      if (!claim.evidence.every((reference) => verifyEvidence(extraction, reference))) return false;
    }
    if (claim.provenance === 'conflict') {
      const durations = claim.alternatives.map((alternative, index) => {
        if (!alternative.evidence.every((reference) => verifyEvidence(extraction, reference))) return undefined;
        const durationMatch = /\bprobation\s+period\s+is\s+([a-z]+|\d+)\s+months?\b/i.exec(alternative.evidence[0].quote);
        const token = durationMatch?.[1].toLowerCase();
        const duration = token ? (/^\d+$/.test(token) ? Number(token) : DURATION_WORDS[token]) : undefined;
        if (duration === undefined || !independentlyVerifyProbationQuote(alternative.evidence[0].quote, duration)) return undefined;
        if (alternative.statement !== `${index === 0 ? 'One' : 'Another'} source passage states a ${duration}-month probation period.`) return undefined;
        return duration;
      });
      if (durations.some((value) => value === undefined) || new Set(durations).size < 2) return false;
      if (claim.statement !== (facts.sampleFixtureId
        ? 'The synthetic fixture contains conflicting probation-period terms.'
        : 'The supplied PDF contains conflicting probation-period terms.')) return false;
    }
  }

  const titleClaim = byId.get('claim.document-title');
  if (
    titleClaim?.provenance !== 'source_fact'
    || !independentlyVerifyTitleQuote(titleClaim.evidence[0].quote)
  ) return false;
  const purposeClaim = byId.get('claim.document-purpose');
  if (purposeClaim?.provenance !== 'source_fact' || !independentlyVerifyRoleQuote(purposeClaim.evidence[0].quote, facts.role)) return false;
  const actionClaim = byId.get('claim.action-required');
  if (actionClaim?.provenance !== 'source_fact' || !independentlyVerifyActionQuote(actionClaim.evidence[0].quote)) return false;
  const roleClaim = byId.get('claim.offered-role');
  if (roleClaim?.provenance !== 'source_fact' || !independentlyVerifyRoleQuote(roleClaim.evidence[0].quote, facts.role)) return false;
  const deadlineClaim = byId.get('claim.acceptance-deadline');
  if (
    deadlineClaim?.provenance !== 'source_fact'
    || !independentlyVerifyDeadlineQuote(deadlineClaim.evidence[0].quote, facts.deadline.value.iso)
    || deadlineClaim.normalizedValues.length !== 1
    || deadlineClaim.normalizedValues[0]?.kind !== 'date'
    || deadlineClaim.normalizedValues[0].value !== facts.deadline.value.iso
  ) return false;
  const startClaim = byId.get('claim.start-date');
  if (facts.startDate && (
    startClaim?.provenance !== 'source_fact'
    || !independentlyVerifyStartQuote(startClaim.evidence[0].quote, facts.startDate.value.iso)
    || startClaim.normalizedValues.length !== 1
    || startClaim.normalizedValues[0]?.kind !== 'date'
    || startClaim.normalizedValues[0].value !== facts.startDate.value.iso
  )) return false;
  const salaryClaim = byId.get('claim.base-salary');
  if (facts.salary) {
    const normalizedSalary = salaryClaim?.normalizedValues[0];
    if (
      salaryClaim?.provenance !== 'source_fact'
      || !independentlyVerifySalaryQuote(salaryClaim.evidence[0].quote, facts.salary.value)
      || salaryClaim?.normalizedValues.length !== 1
      || normalizedSalary?.kind !== 'money'
      || normalizedSalary.amount !== facts.salary.value.amount
      || normalizedSalary.currency !== facts.salary.value.currency
      || normalizedSalary.basis !== 'annual'
    ) return false;
  }
  const locationClaim = byId.get('claim.work-location');
  if (facts.location && (
    locationClaim?.provenance !== 'source_fact'
    || !independentlyVerifyLocationQuote(locationClaim.evidence[0].quote, facts.location.value)
    || locationClaim.normalizedValues.length !== 0
  )) return false;
  const probationClaim = byId.get('claim.probation-period');
  if (probationClaim?.provenance === 'source_fact') {
    const normalizedDuration = probationClaim.normalizedValues[0];
    if (
      normalizedDuration?.kind !== 'duration'
      || !independentlyVerifyProbationQuote(probationClaim.evidence[0].quote, normalizedDuration.value)
      || normalizedDuration.unit !== 'month'
    ) return false;
  }
  return true;
}

function validateClaims(claims: readonly ClaimDraftV1[], validatedAt: string): readonly ValidatedClaimV1[] {
  return claims.map((claim) => {
    if (claim.provenance === 'not_confirmed') {
      return {
        ...claim,
        validation: {
          state: 'needs_review',
          validatorVersion: VALIDATOR_VERSION,
          validatedAt,
          issueCodes: ['missing_source_detail'],
          checks: {
            citation: claim.evidence.length > 0 ? 'passed' : 'not_applicable',
            semanticSupport: 'not_applicable',
          },
        },
      };
    }
    if (claim.provenance === 'conflict') {
      return {
        ...claim,
        validation: {
          state: 'needs_review',
          validatorVersion: VALIDATOR_VERSION,
          validatedAt,
          issueCodes: ['conflicting_source_terms'],
          checks: { citation: 'passed', semanticSupport: 'supported' },
        },
      };
    }
    return {
      ...claim,
      validation: {
        state: 'accepted',
        validatorVersion: VALIDATOR_VERSION,
        validatedAt,
        issueCodes: [],
        checks: { citation: 'passed', semanticSupport: 'supported' },
      },
    };
  });
}

function buildActionDrafts(facts: OfferLetterFactsV1): readonly ActionDraftV1[] {
  if (facts.sampleFixtureId) {
    return [{
      id: 'action.inspect-sample',
      provenance: 'paperwork_suggestion',
      order: 0,
      priority: 'normal',
      title: 'Explore this synthetic example',
      description: 'Review the extracted claims and citations; do not sign or submit this fixture.',
      timing: { kind: 'none' },
      basisClaimIds: ['claim.document-title'],
      requiredInputs: [],
      sourceImposed: false,
      execution: 'manual_user_choice',
    }];
  }
  const signAction: ActionDraftV1 = {
    id: 'action.sign-and-return',
    provenance: 'document_requirement',
    order: 0,
    priority: 'critical',
    title: 'Decide, sign, and return the letter',
    description: facts.deadline
      ? 'If you choose to accept, sign and return the letter by the stated deadline.'
      : 'If you choose to accept, sign and return the letter as requested.',
    timing: facts.deadline
      ? { kind: 'calendar_date', date: facts.deadline.value.iso, basisClaimId: 'claim.acceptance-deadline' }
      : { kind: 'none' },
    basisClaimIds: facts.deadline
      ? ['claim.action-required', 'claim.acceptance-deadline']
      : ['claim.action-required'],
    requiredInputs: ['Your acceptance decision', 'A signed copy of this PDF'],
    consequence: {
      text: 'PaperWork did not establish a consequence for returning the letter after the deadline.',
      basisClaimIds: ['claim.late-response-consequence'],
    },
    sourceImposed: true,
    execution: 'manual_user_choice',
  };
  const drafts: ActionDraftV1[] = [signAction];
  if (new Set(facts.probation.map((item) => item.value)).size > 1) {
    drafts.push({
      id: 'action.clarify-probation',
      provenance: 'paperwork_suggestion',
      order: 1,
      priority: 'high',
      title: 'Ask which probation term applies',
      description: 'Request written clarification of the conflicting probation durations before signing.',
      timing: { kind: 'condition', label: 'Before deciding whether to sign', basisClaimId: 'claim.probation-conflict' },
      basisClaimIds: ['claim.probation-conflict'],
      requiredInputs: ['The conflicting probation passages'],
      sourceImposed: false,
      execution: 'manual_user_choice',
    });
  }
  return drafts;
}

function validateActions(actions: readonly ActionDraftV1[], validatedAt: string): readonly ValidatedActionV1[] {
  return actions.map((action) => ({
    ...action,
    validation: {
      state: 'accepted',
      validatorVersion: VALIDATOR_VERSION,
      validatedAt,
      issueCodes: [],
      checks: {
        basis: 'passed',
        timing: action.timing.kind === 'none' ? 'not_applicable' : 'passed',
        safety: 'passed',
      },
    },
  }));
}

function verifyActionSafety(actions: readonly ActionDraftV1[], facts: OfferLetterFactsV1) {
  const allowedIds = new Set(['action.sign-and-return', 'action.clarify-probation', 'action.inspect-sample']);
  const forbiddenInput = /password|credential|bank|identity|aadhaar|passport|upload|recipient|url/i;
  const probationConflict = new Set(facts.probation.map((item) => item.value)).size > 1;
  if (actions.length !== (facts.sampleFixtureId ? 1 : probationConflict ? 2 : 1)) return false;
  for (const action of actions) {
    if (!allowedIds.has(action.id) || action.execution !== 'manual_user_choice') return false;
    if (action.requiredInputs.some((input) => forbiddenInput.test(input))) return false;
    if (action.id === 'action.inspect-sample') {
      if (
        !facts.sampleFixtureId
        || action.provenance !== 'paperwork_suggestion'
        || action.sourceImposed !== false
        || action.order !== 0
        || action.priority !== 'normal'
        || action.title !== 'Explore this synthetic example'
        || action.description !== 'Review the extracted claims and citations; do not sign or submit this fixture.'
        || action.timing.kind !== 'none'
        || JSON.stringify(action.basisClaimIds) !== JSON.stringify(['claim.document-title'])
        || action.requiredInputs.length !== 0
        || action.consequence !== undefined
      ) return false;
      continue;
    }
    if (facts.sampleFixtureId) return false;
    if (action.id === 'action.sign-and-return') {
      if (action.provenance !== 'document_requirement' || action.sourceImposed !== true) return false;
      if (
        action.order !== 0
        || action.priority !== 'critical'
        || action.title !== 'Decide, sign, and return the letter'
        || action.description !== (facts.deadline
          ? 'If you choose to accept, sign and return the letter by the stated deadline.'
          : 'If you choose to accept, sign and return the letter as requested.')
        || JSON.stringify(action.basisClaimIds) !== JSON.stringify(facts.deadline
          ? ['claim.action-required', 'claim.acceptance-deadline']
          : ['claim.action-required'])
        || JSON.stringify(action.requiredInputs) !== JSON.stringify(['Your acceptance decision', 'A signed copy of this PDF'])
        || action.consequence?.text !== 'PaperWork did not establish a consequence for returning the letter after the deadline.'
        || JSON.stringify(action.consequence.basisClaimIds) !== JSON.stringify(['claim.late-response-consequence'])
      ) return false;
      if (facts.deadline) {
        if (action.timing.kind !== 'calendar_date' || action.timing.date !== facts.deadline.value.iso) return false;
      } else if (action.timing.kind !== 'none') return false;
    }
    if (action.id === 'action.clarify-probation') {
      if (action.provenance !== 'paperwork_suggestion' || action.sourceImposed !== false) return false;
      if (
        !probationConflict
        || action.order !== 1
        || action.priority !== 'high'
        || action.title !== 'Ask which probation term applies'
        || action.description !== 'Request written clarification of the conflicting probation durations before signing.'
        || action.timing.kind !== 'condition'
        || action.timing.label !== 'Before deciding whether to sign'
        || action.timing.basisClaimId !== 'claim.probation-conflict'
        || JSON.stringify(action.basisClaimIds) !== JSON.stringify(['claim.probation-conflict'])
        || JSON.stringify(action.requiredInputs) !== JSON.stringify(['The conflicting probation passages'])
        || action.consequence !== undefined
      ) return false;
    }
  }
  return true;
}

function validationSummary(claims: readonly ValidatedClaimV1[], actions: readonly ValidatedActionV1[]) {
  return {
    totalClaims: claims.length,
    accepted: claims.filter((claim) => claim.validation.state === 'accepted').length,
    needsReview: claims.filter((claim) => claim.validation.state === 'needs_review').length,
    blocked: claims.filter((claim) => claim.validation.state === 'blocked').length,
    stale: claims.filter((claim) => claim.validation.state === 'stale').length,
    totalActions: actions.length,
    acceptedActions: actions.filter((action) => action.validation.state === 'accepted').length,
    needsReviewActions: actions.filter((action) => action.validation.state === 'needs_review').length,
    blockedActions: actions.filter((action) => action.validation.state === 'blocked').length,
    staleActions: actions.filter((action) => action.validation.state === 'stale').length,
  };
}

interface ValidatedLocalAuthorizationV1 extends LocalRunAuthorizationV1 {
  readonly ledgerRunId: string;
}

function validateLocalAuthorization(
  authorization: LocalRunAuthorizationV1 | undefined,
  observedAt = Date.now(),
): ValidatedLocalAuthorizationV1 | undefined {
  if (!authorization || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authorization.runId)) return undefined;
  const readAt = Date.parse(authorization.readApprovedAt);
  const planAt = Date.parse(authorization.planApprovedAt);
  if (!Number.isFinite(readAt) || !Number.isFinite(planAt)) return undefined;
  if (readAt > planAt || planAt > observedAt) return undefined;
  if (readAt < observedAt - AUTHORIZATION_WINDOW_MS || planAt < observedAt - AUTHORIZATION_WINDOW_MS) return undefined;
  if (usedRunIdsV1.has(authorization.runId)) return undefined;
  return {
    runId: authorization.runId,
    ledgerRunId: `run.${authorization.runId}`,
    readApprovedAt: new Date(readAt).toISOString(),
    planApprovedAt: new Date(planAt).toISOString(),
  };
}

function verifyEventLedger(
  events: readonly ProcessingEventV1[],
  extraction: LocalPdfExtractionV1,
  analysisId: string,
  authorization: ValidatedLocalAuthorizationV1,
) {
  const expected = ['local_read_authorized', 'local_plan_authorized', 'source_admitted', 'extraction_completed', 'analysis_completed', 'validation_completed'];
  const expectedActors = [
    'PaperWork local read authorization',
    'PaperWork local plan authorization',
    'PaperWork local PDF admission',
    'PaperWork local PDF extractor',
    'PaperWork deterministic offer-letter rules',
    'PaperWork independent trusted assembler',
  ];
  if (events.length !== expected.length) return false;
  if (events.some((event, index) => (
    event.sequence !== index
    || event.type !== expected[index]
    || event.status !== 'completed'
    || event.actor.name !== expectedActors[index]
  ))) return false;
  if (events.some((event, index) => index > 0 && Date.parse(event.occurredAt) < Date.parse(events[index - 1].occurredAt))) return false;
  if (events[0].relatedId !== authorization.ledgerRunId || events[1].relatedId !== authorization.ledgerRunId) return false;
  if (events[0].occurredAt !== authorization.readApprovedAt || events[1].occurredAt !== authorization.planApprovedAt) return false;
  if (events[2].relatedId !== extraction.sourceId || events[3].relatedId !== extraction.sourceRevisionId) return false;
  if (events[2].occurredAt !== extraction.admittedAt || events[3].occurredAt !== extraction.extractedAt) return false;
  if (events[2].id !== extraction.observedEvents[0].id || events[3].id !== extraction.observedEvents[1].id) return false;
  if (events[4].relatedId !== analysisId || events[5].relatedId !== analysisId) return false;
  if (events.some((event) => event.actor.location !== 'browser')) return false;
  return true;
}

function finalAuthorityGate(
  pack: ActionPackV1,
  extraction: LocalPdfExtractionV1,
  authorization: ValidatedLocalAuthorizationV1,
  sampleFixtureId?: string,
) {
  if (pack.runMode !== (sampleFixtureId ? 'sample_fixture' : 'live') || pack.receipt.processingMode !== 'browser_local') return false;
  if (pack.receipt.transfers.length > 0 || pack.receipt.consentRecords.length > 0 || pack.receipt.externalReferences.length > 0) return false;
  if (pack.corrections.length > 0 || pack.receipt.correctionIds.length > 0) return false;
  if (
    pack.canonicalSources.sources.length !== 1
    || pack.canonicalSources.sources[0].origin.kind !== (sampleFixtureId ? 'sample' : 'upload')
    || pack.canonicalSources.sources[0].id !== extraction.sourceId
    || pack.canonicalSources.sources[0].mediaType !== 'application/pdf'
  ) return false;
  if (
    sampleFixtureId
    && (pack.canonicalSources.sources[0].origin.kind !== 'sample'
      || pack.canonicalSources.sources[0].origin.fixtureId !== sampleFixtureId
      || extraction.fingerprint !== NORTHSTAR_SAMPLE_FINGERPRINT)
  ) return false;
  if (
    pack.canonicalSources.sourceRevisions.length !== 1
    || pack.canonicalSources.sourceRevisions[0].id !== extraction.sourceRevisionId
    || pack.canonicalSources.sourceRevisions[0].status !== 'active'
    || pack.canonicalSources.sourceRevisions[0].fingerprint.value !== extraction.fingerprint
  ) return false;
  if (
    pack.canonicalSources.sourceSegments.some((segment) => (
      segment.sourceId !== extraction.sourceId
      || segment.sourceRevisionId !== extraction.sourceRevisionId
      || segment.anchor.kind !== 'page_region'
      || segment.extraction.method !== 'native_text'
      || segment.extraction.engine !== 'pdfjs-dist'
      || segment.extraction.version !== extraction.parserVersion
    ))
  ) return false;
  if (!verifyEventLedger(pack.receipt.events, extraction, pack.analysis.analysisId, authorization)) return false;
  const validationCompletedAt = pack.receipt.events[5]?.occurredAt;
  if (
    !validationCompletedAt
    || pack.createdAt !== pack.receipt.createdAt
    || Date.parse(pack.createdAt) < Date.parse(validationCompletedAt)
    || pack.analysis.sourceRevisionIds.length !== 1
    || pack.analysis.sourceRevisionIds[0] !== extraction.sourceRevisionId
    || pack.analysis.claims.some((claim) => claim.validation.validatedAt !== validationCompletedAt)
    || pack.analysis.actions.some((action) => action.validation.validatedAt !== validationCompletedAt)
  ) return false;
  if (pack.analysis.claims.some((claim) => claim.validation.state === 'blocked' || claim.validation.state === 'stale')) return false;
  if (pack.analysis.actions.some((action) => action.validation.state !== 'accepted')) return false;
  const browserRetention = pack.receipt.retention.filter((record) => record.subject === 'browser');
  if (browserRetention.length !== 1 || browserRetention[0].state !== 'status_unavailable') return false;
  const componentKinds = new Set(pack.receipt.components.map((component) => component.component));
  if (componentKinds.has('provider_model') || componentKinds.has('ocr')) return false;
  return componentKinds.has('paperwork') && componentKinds.has('parser') && componentKinds.has('citation_validator');
}

export async function analyzeLocalOfferLetterPdfV1(
  file: File,
  options: {
    readonly authorization: LocalRunAuthorizationV1;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: LocalAnalysisProgressV1) => void;
  },
): Promise<LocalOfferLetterResultV1> {
  const authorization = validateLocalAuthorization(options.authorization);
  if (!authorization) {
    return { ok: false, stage: 'authorization', issues: [{ code: 'authorization_required' }] };
  }
  usedRunIdsV1.add(authorization.runId);

  let pdfModule: typeof import('../../local-analysis/v1/pdf');
  try {
    pdfModule = await import('../../local-analysis/v1/pdf');
  } catch {
    return { ok: false, stage: 'extraction', issues: [{ code: 'extractor_unavailable' }] };
  }

  try {
    const { LocalPdfExtractionErrorV1, extractLocalPdfV1 } = pdfModule;
    let extraction: LocalPdfExtractionV1;
    try {
      extraction = await extractLocalPdfV1(file, {
        signal: options.signal,
        onProgress: options.onProgress,
      });
    } catch (error) {
      if (error instanceof LocalPdfExtractionErrorV1) {
        return {
          ok: false,
          stage: error.code === 'cancelled' ? 'cancelled' : 'extraction',
          issues: [{ code: error.code }],
        };
      }
      return { ok: false, stage: 'extraction', issues: [{ code: 'extraction_failed' }] };
    }

    options.onProgress?.({ stage: 'assembling' });
    const facts = extractOfferLetterFacts(extraction);
    const canonicalSources = facts.sampleFixtureId ? {
      ...extraction.canonicalSources,
      sources: extraction.canonicalSources.sources.map((source) => ({
        ...source,
        origin: { kind: 'sample' as const, fixtureId: facts.sampleFixtureId! },
      })),
    } : extraction.canonicalSources;
    const claimDrafts = buildClaims(extraction, facts);
    if (!verifyClaimSemantics(extraction, facts, claimDrafts)) {
      throw new AssemblyAuthorityErrorV1('claim_validation', 'claim_validation_failed');
    }
    const actionDrafts = buildActionDrafts(facts);
    if (!verifyActionSafety(actionDrafts, facts)) {
      throw new AssemblyAuthorityErrorV1('action_safety', 'action_safety_failed');
    }

    const runFragment = authorization.runId.slice(0, 8);
    const analysisId = `analysis.${extraction.fingerprint.slice(0, 16)}.${runFragment}`;
    const conflictPresent = claimDrafts.some((claim) => claim.id === 'claim.probation-conflict');
    const factClaimIds = claimDrafts
      .filter((claim) => claim.provenance === 'source_fact' || claim.provenance === 'inference')
      .map((claim) => claim.id);
    const briefClaimIds = ['claim.document-title', 'claim.document-purpose', 'claim.action-required'];
    if (facts.deadline) briefClaimIds.push('claim.acceptance-deadline');
    const attentionClaimIds = facts.deadline ? ['claim.acceptance-deadline'] : [];
    if (conflictPresent) attentionClaimIds.push('claim.probation-conflict');
    const planActionIds = actionDrafts.map((action) => action.id);
    const document = {
      documentType: facts.sampleFixtureId ? 'synthetic_employment_offer_fixture' : 'employment_offer',
      titleClaimId: 'claim.document-title',
      purposeClaimId: 'claim.document-purpose',
      actionRequiredClaimId: 'claim.action-required',
      ...(facts.deadline ? { nearestDeadlineClaimId: 'claim.acceptance-deadline' } : {}),
      primaryActionId: facts.sampleFixtureId ? 'action.inspect-sample' : 'action.sign-and-return',
    };
    const questions = conflictPresent && !facts.sampleFixtureId ? [{
      id: 'question.probation-term',
      text: 'Which probation duration is intended to govern this offer?',
      reason: 'Distinct passages state different probation durations.',
      basisClaimIds: ['claim.probation-conflict'],
    }] : [];
    const sections = {
      briefClaimIds,
      factClaimIds,
      attentionClaimIds,
      missingInformationClaimIds: ['claim.late-response-consequence'],
      conflictClaimIds: conflictPresent ? ['claim.probation-conflict'] : [],
      planActionIds,
    };

    const draft = {
      kind: MODEL_DRAFT_KIND_V1,
      schemaVersion: ACTION_PACK_SCHEMA_VERSION_V1,
      analysisId,
      knowledgeMode: 'source_only',
      sourceRevisionIds: [extraction.sourceRevisionId] as const,
      document,
      claims: claimDrafts,
      actions: actionDrafts,
      questions,
      sections,
    };
    const parsedDraft = parseModelDraftV1(draft, canonicalSources);
    if (!parsedDraft.success) {
      void formatContractIssuesV1(parsedDraft.issues);
      throw new AssemblyAuthorityErrorV1('contract', 'contract_validation_failed');
    }

    const analysisAt = new Date(Math.max(Date.now(), Date.parse(extraction.extractedAt))).toISOString();
    options.onProgress?.({ stage: 'validating' });
    const validatedAt = new Date(Math.max(Date.now(), Date.parse(analysisAt))).toISOString();
    const claims = validateClaims(claimDrafts, validatedAt);
    const actions = validateActions(actionDrafts, validatedAt);
    const events = [
      {
        id: `event.${authorization.ledgerRunId}.read`,
        sequence: 0,
        occurredAt: authorization.readApprovedAt,
        type: 'local_read_authorized',
        status: 'completed',
        actor: { location: 'browser', name: 'PaperWork local read authorization' },
        relatedId: authorization.ledgerRunId,
      },
      {
        id: `event.${authorization.ledgerRunId}.plan`,
        sequence: 1,
        occurredAt: authorization.planApprovedAt,
        type: 'local_plan_authorized',
        status: 'completed',
        actor: { location: 'browser', name: 'PaperWork local plan authorization' },
        relatedId: authorization.ledgerRunId,
      },
      { ...extraction.observedEvents[0], sequence: 2 },
      { ...extraction.observedEvents[1], sequence: 3 },
      {
        id: `event.${extraction.fingerprint.slice(0, 12)}.${runFragment}.analysis`,
        sequence: 4,
        occurredAt: analysisAt,
        type: 'analysis_completed',
        status: 'completed',
        actor: { location: 'browser', name: 'PaperWork deterministic offer-letter rules' },
        relatedId: analysisId,
      },
      {
        id: `event.${extraction.fingerprint.slice(0, 12)}.${runFragment}.validation`,
        sequence: 5,
        occurredAt: validatedAt,
        type: 'validation_completed',
        status: 'completed',
        actor: { location: 'browser', name: 'PaperWork independent trusted assembler' },
        relatedId: analysisId,
      },
    ] as const satisfies readonly ProcessingEventV1[];
    if (!verifyEventLedger(events, extraction, analysisId, authorization)) {
      throw new AssemblyAuthorityErrorV1('event_ledger', 'event_ledger_failed');
    }

    const assembledAt = new Date(Math.max(Date.now(), Date.parse(validatedAt))).toISOString();
    const packCandidate: ActionPackV1 = {
      kind: ACTION_PACK_KIND_V1,
      schemaVersion: ACTION_PACK_SCHEMA_VERSION_V1,
      packId: `pack.${extraction.fingerprint.slice(0, 16)}.${runFragment}`,
      createdAt: assembledAt,
      runMode: facts.sampleFixtureId ? 'sample_fixture' : 'live',
      canonicalSources,
      analysis: {
        kind: VALIDATED_ANALYSIS_KIND_V1,
        schemaVersion: ACTION_PACK_SCHEMA_VERSION_V1,
        analysisId,
        knowledgeMode: 'source_only',
        sourceRevisionIds: [extraction.sourceRevisionId],
        document,
        claims,
        actions,
        questions,
        sections,
      },
      receipt: {
        id: `receipt.${extraction.fingerprint.slice(0, 16)}.${runFragment}`,
        createdAt: assembledAt,
        processingMode: 'browser_local',
        events,
        consentRecords: [],
        transfers: [],
        retention: [
          {
            id: `retention.${extraction.fingerprint.slice(0, 12)}.${runFragment}.browser`,
            subject: 'browser',
            state: 'status_unavailable',
            assertedBy: 'PaperWork local run observer',
            recordedAt: assembledAt,
          },
          {
            id: `retention.${extraction.fingerprint.slice(0, 12)}.${runFragment}.provider`,
            subject: 'provider',
            state: 'not_stored',
            assertedBy: 'No provider transfer occurred',
            recordedAt: assembledAt,
          },
        ],
        components: [
          { component: 'paperwork', name: 'PaperWork local analyzer', version: ACTION_PACK_SCHEMA_VERSION_V1 },
          { component: 'parser', name: 'pdfjs-dist', version: extraction.parserVersion },
          { component: 'prompt_template', name: 'Deterministic offer-letter rules', version: RULESET_VERSION },
          { component: 'citation_validator', name: 'PaperWork trusted assembler', version: VALIDATOR_VERSION },
        ],
        validationSummary: validationSummary(claims, actions),
        externalReferences: [],
        correctionIds: [],
      },
      corrections: [],
      limitations: [
        ...(facts.sampleFixtureId ? ['This recognized synthetic fixture is for demonstration only; do not sign or submit it.'] : []),
        'This first local ruleset recognizes explicit English-language employment-offer terms only.',
        'Scanned PDFs and ambiguous numeric dates are withheld because OCR and date disambiguation are not enabled.',
        'PaperWork provides source-grounded organization, not legal, financial, or employment advice.',
      ],
    };

    const parsedPack = parseActionPackV1(packCandidate);
    if (!parsedPack.success) {
      void formatContractIssuesV1(parsedPack.issues);
      throw new AssemblyAuthorityErrorV1('contract', 'contract_validation_failed');
    }
    if (!finalAuthorityGate(parsedPack.data, extraction, authorization, facts.sampleFixtureId)) {
      throw new AssemblyAuthorityErrorV1('contract', 'contract_validation_failed');
    }

    trustedActionPacksV1.add(parsedPack.data);
    return { ok: true, pack: parsedPack.data as TrustedActionPackV1 };
  } catch (error) {
    if (error instanceof AssemblyAuthorityErrorV1) {
      return { ok: false, stage: error.stage, issues: [{ code: error.code }] };
    }
    if (options.signal?.aborted) return { ok: false, stage: 'cancelled', issues: [{ code: 'cancelled' }] };
    return { ok: false, stage: 'contract', issues: [{ code: 'assembly_failed' }] };
  }
}

export function isTrustedActionPackV1(input: unknown): input is TrustedActionPackV1 {
  return typeof input === 'object' && input !== null && trustedActionPacksV1.has(input);
}

export function assertTrustedActionPackV1(input: unknown): asserts input is TrustedActionPackV1 {
  if (!isTrustedActionPackV1(input)) {
    throw new Error('PaperWork refused to render an Action Pack without independent trusted-ledger assembly.');
  }
}
