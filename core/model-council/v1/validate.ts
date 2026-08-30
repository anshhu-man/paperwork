import {
  MODEL_COUNCIL_CATALOG_KIND_V1,
  MODEL_COUNCIL_CONSENSUS_KIND_V1,
  MODEL_COUNCIL_FIELD_IDS_V1,
  MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1,
  MODEL_COUNCIL_MAX_TOTAL_SEGMENT_CHARACTERS_V1,
  MODEL_COUNCIL_PAYLOAD_KIND_V1,
  MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1,
  MODEL_COUNCIL_PROMPT_VERSION_V1,
  MODEL_COUNCIL_RECEIPT_KIND_V1,
  MODEL_COUNCIL_REQUEST_KIND_V1,
  MODEL_COUNCIL_RESPONSE_KIND_V1,
  MODEL_COUNCIL_SCHEMA_VERSION_V1,
  PROVIDER_ANALYSIS_KIND_V1,
  PROVIDER_IDS_V1,
  type ModelCouncilCatalogV1,
  type ModelCouncilConsensusV1,
  type ModelCouncilConsentV1,
  type ModelCouncilDigestV1,
  type ModelCouncilFieldIdV1,
  type ModelCouncilFieldValueV1,
  type ModelCouncilPayloadV1,
  type ModelCouncilProviderTargetV1,
  type ModelCouncilReceiptV1,
  type ModelCouncilRequestV1,
  type ModelCouncilResponseV1,
  type ModelCouncilResponseExpectationV1,
  type ModelCouncilRunResultV1,
  type ModelCouncilSourceSegmentV1,
  type ProviderAnalysisV1,
  type ProviderIdV1,
} from './contracts';
import { buildModelCouncilConsensusV1 } from './consensus';

export interface ModelCouncilContractIssueV1 {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ModelCouncilParseResultV1<T> =
  | { readonly success: true; readonly data: T; readonly ok: true; readonly value: T }
  | { readonly success: false; readonly ok: false; readonly issues: readonly ModelCouncilContractIssueV1[] };

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{0,5}[1-9])?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BIDI_CONTROL_PATTERN = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const INVISIBLE_CHARACTER_PATTERN = /[\u200B-\u200D\u2060\uFEFF]/;
const ACTIVE_MARKUP_PATTERN = /<\s*\/?\s*[a-z!][^>]*>|javascript\s*:|\bon[a-z]+\s*=/i;

const MAX_SEGMENTS = 2_000;
const MAX_SEGMENT_CHARACTERS = 20_000;
const MAX_EVIDENCE_QUOTE_CHARACTERS = 2_000;

const FAILURE_CODES = [
  'council_disabled',
  'not_configured',
  'provider_timeout',
  'provider_rejected',
  'provider_unavailable',
  'network_failure',
  'invalid_provider_output',
  'internal_error',
] as const;

class IssueCollector {
  readonly issues: ModelCouncilContractIssueV1[] = [];

  add(path: string, code: string, message: string) {
    this.issues.push({ path, code, message });
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function objectAt(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  collector: IssueCollector,
): UnknownRecord | undefined {
  if (!isRecord(value)) {
    collector.add(path, 'invalid_type', 'Expected a plain object.');
    return undefined;
  }

  try {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        collector.add(`${path}.${key}`, 'unknown_field', 'Unknown fields are rejected.');
      }
    }
  } catch {
    collector.add(path, 'invalid_object', 'Object keys could not be inspected safely.');
    return undefined;
  }
  return value;
}

function arrayAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  minimum: number,
  maximum: number,
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) {
    collector.add(path, 'invalid_type', 'Expected an array.');
    return undefined;
  }
  if (value.length < minimum) collector.add(path, 'too_few_items', `Expected at least ${minimum} item(s).`);
  if (value.length > maximum) collector.add(path, 'too_many_items', `Expected no more than ${maximum} item(s).`);
  return value;
}

function stringAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  options: {
    readonly minimum?: number;
    readonly maximum?: number;
    readonly plainText?: boolean;
    readonly normalizedText?: boolean;
  } = {},
): value is string {
  if (typeof value !== 'string') {
    collector.add(path, 'invalid_type', 'Expected a string.');
    return false;
  }

  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? 2_000;
  if (value.length < minimum) collector.add(path, 'string_too_short', `Expected at least ${minimum} character(s).`);
  if (value.length > maximum) collector.add(path, 'string_too_long', `Expected no more than ${maximum} character(s).`);
  if (CONTROL_CHARACTER_PATTERN.test(value)) collector.add(path, 'control_character', 'Control characters are not allowed.');
  if (BIDI_CONTROL_PATTERN.test(value)) collector.add(path, 'bidi_control', 'Bidirectional control characters are not allowed.');
  if (INVISIBLE_CHARACTER_PATTERN.test(value)) collector.add(path, 'invisible_character', 'Invisible formatting characters are not allowed.');
  if (options.plainText && ACTIVE_MARKUP_PATTERN.test(value)) {
    collector.add(path, 'active_content', 'Content must be inert plain text, not markup or executable content.');
  }
  if (options.normalizedText && value !== normalizeModelCouncilTextV1(value)) {
    collector.add(path, 'not_normalized', 'Expected NFC, trimmed, single-line text with collapsed whitespace.');
  }
  if (options.normalizedText && /[<>]/.test(value)) {
    collector.add(path, 'active_content', 'Normalized values must not contain markup delimiters.');
  }
  return true;
}

function idAt(value: unknown, path: string, collector: IssueCollector): value is string {
  if (!stringAt(value, path, collector, { maximum: 128 })) return false;
  if (!ID_PATTERN.test(value)) collector.add(path, 'invalid_id', 'Expected a stable identifier.');
  return true;
}

function enumAt<const T extends string>(
  value: unknown,
  path: string,
  collector: IssueCollector,
  choices: readonly T[],
): value is T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    collector.add(path, 'invalid_enum', `Expected one of: ${choices.join(', ')}.`);
    return false;
  }
  return true;
}

function literalAt(value: unknown, path: string, collector: IssueCollector, literal: string) {
  if (value !== literal) collector.add(path, 'invalid_literal', `Expected ${JSON.stringify(literal)}.`);
}

function booleanAt(value: unknown, path: string, collector: IssueCollector): value is boolean {
  if (typeof value !== 'boolean') {
    collector.add(path, 'invalid_type', 'Expected a boolean.');
    return false;
  }
  return true;
}

function integerAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  minimum: number,
  maximum: number,
): value is number {
  if (!Number.isSafeInteger(value)) {
    collector.add(path, 'invalid_integer', 'Expected a finite safe integer.');
    return false;
  }
  const number = value as number;
  if (number < minimum || number > maximum) {
    collector.add(path, 'integer_out_of_range', `Expected a value from ${minimum} to ${maximum}.`);
  }
  return true;
}

function timestampAt(value: unknown, path: string, collector: IssueCollector): value is string {
  if (!stringAt(value, path, collector, { maximum: 24 })) return false;
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    collector.add(path, 'invalid_timestamp', 'Expected a canonical ISO 8601 UTC timestamp.');
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    collector.add(path, 'invalid_timestamp', 'Expected a real canonical ISO 8601 UTC timestamp.');
  }
  return true;
}

function calendarDateAt(value: unknown, path: string, collector: IssueCollector): value is string {
  if (!stringAt(value, path, collector, { maximum: 10 })) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!ISO_DATE_PATTERN.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    collector.add(path, 'invalid_date', 'Expected a real calendar date in YYYY-MM-DD format.');
  }
  return true;
}

const MONTH_NUMBERS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
});

const NAMED_MONTH_PATTERN = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';

function realIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function datesInQuote(quote: string) {
  const values = new Set<string>();
  for (const match of quote.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const date = realIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) values.add(date);
  }
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${NAMED_MONTH_PATTERN}\\s*,?\\s*(\\d{4})\\b`, 'gi');
  for (const match of quote.matchAll(dayFirst)) {
    const month = MONTH_NUMBERS[match[2].toLocaleLowerCase('en-US')];
    const date = month && realIsoDate(Number(match[3]), month, Number(match[1]));
    if (date) values.add(date);
  }
  const monthFirst = new RegExp(`\\b${NAMED_MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})\\b`, 'gi');
  for (const match of quote.matchAll(monthFirst)) {
    const month = MONTH_NUMBERS[match[1].toLocaleLowerCase('en-US')];
    const date = month && realIsoDate(Number(match[3]), month, Number(match[2]));
    if (date) values.add(date);
  }
  return values;
}

function canonicalQuotedAmount(value: string) {
  const [integer, fraction] = value.replace(/,/g, '').split('.');
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction?.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

const QUOTED_AMOUNT_PATTERN = '(?:[1-9]\\d{0,2}(?:,\\d{3})+|[1-9]\\d?(?:,\\d{2})+,\\d{3}|0|[1-9]\\d*)(?:\\.\\d+)?';

function quoteContainsAnnualMoney(
  quote: string,
  amount: string,
  currency: string,
) {
  if (!/\b(?:annual(?:ly)?|yearly|per\s+(?:annum|year)|a\s+year)\b/i.test(quote)) return false;
  const escapedCurrency = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const moneyPattern = new RegExp(
    `(?:\\b${escapedCurrency}\\b\\s*:?[\\s]*(?:[$€£₹]\\s*)?(${QUOTED_AMOUNT_PATTERN})(?![\\d,])|(?:^|[^\\d,])(?:[$€£₹]\\s*)?(${QUOTED_AMOUNT_PATTERN})\\s*\\b${escapedCurrency}\\b)`,
    'gi',
  );
  for (const match of quote.matchAll(moneyPattern)) {
    const quotedAmount = match[1] ?? match[2];
    if (quotedAmount && canonicalQuotedAmount(quotedAmount) === amount) return true;
  }
  return false;
}

const NUMBER_WORDS_UNDER_TWENTY = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const NUMBER_WORD_TENS: Readonly<Record<number, string>> = Object.freeze({
  20: 'twenty',
  30: 'thirty',
  40: 'forty',
  50: 'fifty',
  60: 'sixty',
  70: 'seventy',
  80: 'eighty',
  90: 'ninety',
});

function durationNumberWords(value: number): string | undefined {
  if (value > 0 && value < 20) return NUMBER_WORDS_UNDER_TWENTY[value];
  if (value < 100) {
    const tens = Math.floor(value / 10) * 10;
    const remainder = value % 10;
    return remainder === 0
      ? NUMBER_WORD_TENS[tens]
      : `${NUMBER_WORD_TENS[tens]} ${NUMBER_WORDS_UNDER_TWENTY[remainder]}`;
  }
  if (value >= 100 && value <= 120) {
    const remainder = value - 100;
    return remainder === 0
      ? 'one hundred'
      : `one hundred and ${durationNumberWords(remainder)}`;
  }
  return undefined;
}

function quoteContainsDuration(quote: string, value: number, unit: string) {
  const words = durationNumberWords(value)?.replace(/ /g, '[\\s-]+');
  const number = words ? `(?:${value}|${words})` : String(value);
  return new RegExp(`\\b${number}[\\s-]+${unit}s?\\b`, 'i').test(quote);
}

function httpsUrlAt(value: unknown, path: string, collector: IssueCollector) {
  if (value === null) return;
  if (!stringAt(value, path, collector, { maximum: 2_048 })) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe URL');
  } catch {
    collector.add(path, 'invalid_url', 'Expected an absolute HTTPS URL without credentials.');
  }
}

function digestAt(value: unknown, path: string, collector: IssueCollector): value is ModelCouncilDigestV1 {
  const object = objectAt(value, path, ['algorithm', 'value'], collector);
  if (!object) return false;
  literalAt(object.algorithm, `${path}.algorithm`, collector, 'sha-256');
  if (stringAt(object.value, `${path}.value`, collector, { minimum: 64, maximum: 64 }) && !SHA_256_PATTERN.test(object.value)) {
    collector.add(`${path}.value`, 'invalid_digest', 'Expected a lowercase SHA-256 hexadecimal digest.');
  }
  return true;
}

function providerAt(value: unknown, path: string, collector: IssueCollector): value is ProviderIdV1 {
  return enumAt(value, path, collector, PROVIDER_IDS_V1);
}

function uniqueStrings(values: readonly string[], path: string, collector: IssueCollector) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) collector.add(`${path}[${index}]`, 'duplicate_value', `Duplicate value ${JSON.stringify(value)}.`);
    seen.add(value);
  });
}

function validateCanonicalProviderOrder(values: readonly ProviderIdV1[], path: string, collector: IssueCollector) {
  const expected = [...values].sort((left, right) => PROVIDER_IDS_V1.indexOf(left) - PROVIDER_IDS_V1.indexOf(right));
  if (values.some((provider, index) => provider !== expected[index])) {
    collector.add(path, 'non_canonical_order', `Providers must follow canonical order: ${PROVIDER_IDS_V1.join(', ')}.`);
  }
}

function providerArrayAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  minimum = 1,
  maximum = PROVIDER_IDS_V1.length,
): readonly ProviderIdV1[] {
  const array = arrayAt(value, path, collector, minimum, maximum) ?? [];
  const providers: ProviderIdV1[] = [];
  array.forEach((item, index) => {
    if (providerAt(item, `${path}[${index}]`, collector)) providers.push(item);
  });
  uniqueStrings(providers, path, collector);
  validateCanonicalProviderOrder(providers, path, collector);
  return providers;
}

function validateProviderTarget(
  value: unknown,
  path: string,
  collector: IssueCollector,
): ModelCouncilProviderTargetV1 | undefined {
  const issueCount = collector.issues.length;
  const object = objectAt(value, path, ['provider', 'model', 'recipient'], collector);
  if (!object) return undefined;
  providerAt(object.provider, `${path}.provider`, collector);
  stringAt(object.model, `${path}.model`, collector, {
    maximum: 200,
    plainText: true,
    normalizedText: true,
  });
  stringAt(object.recipient, `${path}.recipient`, collector, {
    maximum: 300,
    plainText: true,
    normalizedText: true,
  });
  return collector.issues.length === issueCount
    ? object as unknown as ModelCouncilProviderTargetV1
    : undefined;
}

function providerTargetsAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
): readonly ModelCouncilProviderTargetV1[] {
  const array = arrayAt(value, path, collector, 1, PROVIDER_IDS_V1.length) ?? [];
  const targets: ModelCouncilProviderTargetV1[] = [];
  array.forEach((target, index) => {
    const validated = validateProviderTarget(target, `${path}[${index}]`, collector);
    if (validated) targets.push(validated);
  });
  const providers = targets.map((target) => target.provider);
  uniqueStrings(providers, path, collector);
  validateCanonicalProviderOrder(providers, path, collector);
  return targets;
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finish<T>(input: unknown, collector: IssueCollector): ModelCouncilParseResultV1<T> {
  return collector.issues.length > 0
    ? { success: false, ok: false, issues: collector.issues }
    : { success: true, data: input as T, ok: true, value: input as T };
}

function guardedParser<TArguments extends readonly unknown[], TValue>(
  parser: (...arguments_: TArguments) => ModelCouncilParseResultV1<TValue>,
) {
  return (...arguments_: TArguments): ModelCouncilParseResultV1<TValue> => {
    try {
      return parser(...arguments_);
    } catch {
      return {
        success: false,
        ok: false,
        issues: [{
          path: '$',
          code: 'parser_exception',
          message: 'Malformed input could not be inspected safely.',
        }],
      };
    }
  };
}

export function normalizeModelCouncilTextV1(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function validateSegment(
  value: unknown,
  path: string,
  collector: IssueCollector,
  expectedSequence?: number,
  expectedRevisionId?: string,
): ModelCouncilSourceSegmentV1 | undefined {
  const issueCount = collector.issues.length;
  const object = objectAt(value, path, ['sourceRevisionId', 'segmentId', 'sequence', 'page', 'text'], collector);
  if (!object) return undefined;
  idAt(object.sourceRevisionId, `${path}.sourceRevisionId`, collector);
  idAt(object.segmentId, `${path}.segmentId`, collector);
  integerAt(object.sequence, `${path}.sequence`, collector, 0, MAX_SEGMENTS - 1);
  integerAt(object.page, `${path}.page`, collector, 1, 500);
  stringAt(object.text, `${path}.text`, collector, {
    maximum: MAX_SEGMENT_CHARACTERS,
    plainText: true,
  });
  if (expectedSequence !== undefined && object.sequence !== expectedSequence) {
    collector.add(`${path}.sequence`, 'non_canonical_sequence', `Expected sequence ${expectedSequence}.`);
  }
  if (expectedRevisionId !== undefined && object.sourceRevisionId !== expectedRevisionId) {
    collector.add(`${path}.sourceRevisionId`, 'revision_mismatch', 'Segment revision must match the payload revision.');
  }
  return collector.issues.length === issueCount
    ? object as unknown as ModelCouncilSourceSegmentV1
    : undefined;
}

function validateSegments(
  value: unknown,
  path: string,
  collector: IssueCollector,
  expectedRevisionId?: string,
): readonly ModelCouncilSourceSegmentV1[] {
  const array = arrayAt(value, path, collector, 1, MAX_SEGMENTS) ?? [];
  const segments: ModelCouncilSourceSegmentV1[] = [];
  let totalCharacters = 0;
  array.forEach((item, index) => {
    const segment = validateSegment(item, `${path}[${index}]`, collector, index, expectedRevisionId);
    if (segment) {
      segments.push(segment);
      if (typeof segment.text === 'string') totalCharacters += segment.text.length;
    }
  });
  uniqueStrings(segments.map((segment) => segment.segmentId), path, collector);
  if (totalCharacters > MODEL_COUNCIL_MAX_TOTAL_SEGMENT_CHARACTERS_V1) {
    collector.add(path, 'payload_too_large', `Segment text exceeds ${MODEL_COUNCIL_MAX_TOTAL_SEGMENT_CHARACTERS_V1} characters.`);
  }
  return segments;
}

function validateEvidence(
  value: unknown,
  path: string,
  collector: IssueCollector,
  analysisRevisionId: unknown,
  segmentIndex: ReadonlyMap<string, ModelCouncilSourceSegmentV1>,
): UnknownRecord | undefined {
  const issueCount = collector.issues.length;
  const object = objectAt(value, path, ['sourceRevisionId', 'segmentId', 'page', 'quote'], collector);
  if (!object) return undefined;
  const revisionIsValid = idAt(object.sourceRevisionId, `${path}.sourceRevisionId`, collector);
  const segmentIdIsValid = idAt(object.segmentId, `${path}.segmentId`, collector);
  const pageIsValid = integerAt(object.page, `${path}.page`, collector, 1, 500);
  const quoteIsValid = stringAt(object.quote, `${path}.quote`, collector, {
    maximum: MAX_EVIDENCE_QUOTE_CHARACTERS,
    plainText: true,
  });
  if (revisionIsValid && object.sourceRevisionId !== analysisRevisionId) {
    collector.add(`${path}.sourceRevisionId`, 'revision_mismatch', 'Evidence must reference the analyzed source revision.');
  }
  const segment = segmentIdIsValid ? segmentIndex.get(object.segmentId as string) : undefined;
  if (segmentIdIsValid && !segment) {
    collector.add(`${path}.segmentId`, 'unknown_segment', 'Evidence must identify a canonical payload segment.');
    return undefined;
  }
  if (!segment) return undefined;
  if (revisionIsValid && object.sourceRevisionId !== segment.sourceRevisionId) {
    collector.add(`${path}.sourceRevisionId`, 'segment_revision_mismatch', 'Evidence revision does not match the identified segment.');
  }
  if (pageIsValid && object.page !== segment.page) {
    collector.add(`${path}.page`, 'segment_page_mismatch', 'Evidence page does not match the identified segment.');
  }
  if (quoteIsValid && !segment.text.includes(object.quote as string)) {
    collector.add(`${path}.quote`, 'quote_not_found', 'Evidence quote must occur exactly in the identified canonical segment.');
  }
  return collector.issues.length === issueCount ? object : undefined;
}

type ExpectedValueKind = ModelCouncilFieldValueV1['kind'];

function validateFieldValue(
  value: unknown,
  path: string,
  collector: IssueCollector,
  expectedKind: ExpectedValueKind,
): UnknownRecord | undefined {
  const issueCount = collector.issues.length;
  switch (expectedKind) {
    case 'text': {
      const object = objectAt(value, path, ['kind', 'text'], collector);
      if (!object) return undefined;
      literalAt(object.kind, `${path}.kind`, collector, 'text');
      stringAt(object.text, `${path}.text`, collector, {
        maximum: 500,
        plainText: true,
        normalizedText: true,
      });
      return collector.issues.length === issueCount ? object : undefined;
    }
    case 'date': {
      const object = objectAt(value, path, ['kind', 'value'], collector);
      if (!object) return undefined;
      literalAt(object.kind, `${path}.kind`, collector, 'date');
      calendarDateAt(object.value, `${path}.value`, collector);
      return collector.issues.length === issueCount ? object : undefined;
    }
    case 'money': {
      const object = objectAt(value, path, ['kind', 'amount', 'currency', 'basis'], collector);
      if (!object) return undefined;
      literalAt(object.kind, `${path}.kind`, collector, 'money');
      if (stringAt(object.amount, `${path}.amount`, collector, { maximum: 32 }) && !DECIMAL_AMOUNT_PATTERN.test(object.amount)) {
        collector.add(`${path}.amount`, 'invalid_money', 'Expected a canonical decimal amount without separators or redundant zeroes.');
      }
      if (stringAt(object.currency, `${path}.currency`, collector, { maximum: 3 }) && !CURRENCY_PATTERN.test(object.currency)) {
        collector.add(`${path}.currency`, 'invalid_currency', 'Expected an uppercase three-letter currency code.');
      }
      literalAt(object.basis, `${path}.basis`, collector, 'annual');
      return collector.issues.length === issueCount ? object : undefined;
    }
    case 'duration': {
      const object = objectAt(value, path, ['kind', 'value', 'unit'], collector);
      if (!object) return undefined;
      literalAt(object.kind, `${path}.kind`, collector, 'duration');
      integerAt(object.value, `${path}.value`, collector, 1, 120);
      enumAt(object.unit, `${path}.unit`, collector, ['day', 'week', 'month', 'year'] as const);
      return collector.issues.length === issueCount ? object : undefined;
    }
  }
}

function validateNullableSourceBackedField(
  value: unknown,
  path: string,
  collector: IssueCollector,
  expectedKind: ExpectedValueKind,
  analysisRevisionId: unknown,
  segmentIndex: ReadonlyMap<string, ModelCouncilSourceSegmentV1>,
) {
  if (value === null) return;
  const object = objectAt(value, path, ['value', 'evidence'], collector);
  if (!object) return;
  const validatedValue = validateFieldValue(object.value, `${path}.value`, collector, expectedKind);
  const evidence = arrayAt(object.evidence, `${path}.evidence`, collector, 1, 5) ?? [];
  const evidenceKeys: string[] = [];
  const validatedEvidence: UnknownRecord[] = [];
  evidence.forEach((item, index) => {
    const validated = validateEvidence(item, `${path}.evidence[${index}]`, collector, analysisRevisionId, segmentIndex);
    if (validated) validatedEvidence.push(validated);
    if (isRecord(item) && typeof item.segmentId === 'string' && typeof item.quote === 'string') {
      evidenceKeys.push(`${item.segmentId}\u0000${item.quote}`);
    }
  });
  uniqueStrings(evidenceKeys, `${path}.evidence`, collector);
  if (!validatedValue) return;
  const quotes = validatedEvidence
    .map((item) => item.quote)
    .filter((quote): quote is string => typeof quote === 'string');
  if (expectedKind === 'text' && typeof validatedValue.text === 'string') {
    const normalizedValue = normalizeModelCouncilTextV1(validatedValue.text).toLocaleLowerCase('en-US');
    if (!quotes.some((quote) => (
      normalizeModelCouncilTextV1(quote).toLocaleLowerCase('en-US').includes(normalizedValue)
    ))) {
      collector.add(`${path}.value.text`, 'text_not_quoted', 'Text values must appear directly in at least one exact evidence quote.');
    }
  }
  if (expectedKind === 'date' && typeof validatedValue.value === 'string'
      && !quotes.some((quote) => datesInQuote(quote).has(validatedValue.value as string))) {
    collector.add(`${path}.value.value`, 'date_not_quoted', 'The normalized date must occur in ISO or unambiguous named-month form in one evidence quote.');
  }
  if (expectedKind === 'money' && typeof validatedValue.amount === 'string'
      && typeof validatedValue.currency === 'string'
      && !quotes.some((quote) => quoteContainsAnnualMoney(
        quote,
        validatedValue.amount as string,
        validatedValue.currency as string,
      ))) {
    collector.add(`${path}.value`, 'money_not_quoted', 'One evidence quote must contain the same amount, explicit currency code, and annual wording.');
  }
  if (expectedKind === 'duration' && typeof validatedValue.value === 'number'
      && typeof validatedValue.unit === 'string'
      && !quotes.some((quote) => quoteContainsDuration(
        quote,
        validatedValue.value as number,
        validatedValue.unit as string,
      ))) {
    collector.add(`${path}.value`, 'duration_not_quoted', 'One evidence quote must contain the same numeric or common-word duration and unit.');
  }
}

function validateProviderAnalysisV1Impl(
  input: unknown,
  segmentsInput: readonly ModelCouncilSourceSegmentV1[],
): ModelCouncilParseResultV1<ProviderAnalysisV1> {
  const collector = new IssueCollector();
  const segments = validateSegments(segmentsInput, '$segments', collector);
  const segmentIndex = new Map(segments.map((segment) => [segment.segmentId, segment]));
  const object = objectAt(
    input,
    '$',
    ['kind', 'schemaVersion', 'documentType', 'sourceRevisionId', 'fields'],
    collector,
  );
  if (!object) return finish(input, collector);
  literalAt(object.kind, '$.kind', collector, PROVIDER_ANALYSIS_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', collector, MODEL_COUNCIL_SCHEMA_VERSION_V1);
  literalAt(object.documentType, '$.documentType', collector, 'employment_offer');
  const revisionValid = idAt(object.sourceRevisionId, '$.sourceRevisionId', collector);
  if (revisionValid && segments.some((segment) => segment.sourceRevisionId !== object.sourceRevisionId)) {
    collector.add('$.sourceRevisionId', 'revision_mismatch', 'Analysis revision must match every canonical segment.');
  }

  const fields = objectAt(
    object.fields,
    '$.fields',
    MODEL_COUNCIL_FIELD_IDS_V1,
    collector,
  );
  if (fields) {
    validateNullableSourceBackedField(fields.role, '$.fields.role', collector, 'text', object.sourceRevisionId, segmentIndex);
    validateNullableSourceBackedField(fields.acceptanceDeadline, '$.fields.acceptanceDeadline', collector, 'date', object.sourceRevisionId, segmentIndex);
    validateNullableSourceBackedField(fields.startDate, '$.fields.startDate', collector, 'date', object.sourceRevisionId, segmentIndex);
    validateNullableSourceBackedField(fields.annualBaseSalary, '$.fields.annualBaseSalary', collector, 'money', object.sourceRevisionId, segmentIndex);
    validateNullableSourceBackedField(fields.workLocation, '$.fields.workLocation', collector, 'text', object.sourceRevisionId, segmentIndex);
    validateNullableSourceBackedField(fields.probation, '$.fields.probation', collector, 'duration', object.sourceRevisionId, segmentIndex);
    validateNullableSourceBackedField(fields.actionRequired, '$.fields.actionRequired', collector, 'text', object.sourceRevisionId, segmentIndex);
  }
  return finish(input, collector);
}

export const validateProviderAnalysisV1 = guardedParser(validateProviderAnalysisV1Impl);

function parseModelCouncilPayloadV1Impl(input: unknown): ModelCouncilParseResultV1<ModelCouncilPayloadV1> {
  const collector = new IssueCollector();
  const object = objectAt(
    input,
    '$',
    [
      'kind',
      'schemaVersion',
      'catalogVersion',
      'promptVersion',
      'sourceRevisionId',
      'sourceFingerprint',
      'providers',
      'providerTargets',
      'segments',
    ],
    collector,
  );
  if (!object) return finish(input, collector);
  literalAt(object.kind, '$.kind', collector, MODEL_COUNCIL_PAYLOAD_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', collector, MODEL_COUNCIL_SCHEMA_VERSION_V1);
  literalAt(object.catalogVersion, '$.catalogVersion', collector, MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1);
  literalAt(object.promptVersion, '$.promptVersion', collector, MODEL_COUNCIL_PROMPT_VERSION_V1);
  const revisionValid = idAt(object.sourceRevisionId, '$.sourceRevisionId', collector);
  digestAt(object.sourceFingerprint, '$.sourceFingerprint', collector);
  const providers = providerArrayAt(object.providers, '$.providers', collector);
  const targets = providerTargetsAt(object.providerTargets, '$.providerTargets', collector);
  if (!sameStringArray(providers, targets.map((target) => target.provider))) {
    collector.add(
      '$.providerTargets',
      'provider_target_mismatch',
      'Provider targets must exactly match the ordered provider list.',
    );
  }
  validateSegments(object.segments, '$.segments', collector, revisionValid ? object.sourceRevisionId as string : undefined);
  if (collector.issues.length === 0) {
    const payloadByteCount = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    if (payloadByteCount > MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1) {
      collector.add('$', 'payload_too_large', `Canonical payload exceeds ${MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1} UTF-8 bytes.`);
    }
  }
  return finish(input, collector);
}

export const parseModelCouncilPayloadV1 = guardedParser(parseModelCouncilPayloadV1Impl);

function validateConsent(
  value: unknown,
  path: string,
  collector: IssueCollector,
): ModelCouncilConsentV1 | undefined {
  const issueCount = collector.issues.length;
  const object = objectAt(value, path, ['approvedBy', 'recordedAt', 'providers', 'previewDigest', 'previewByteCount'], collector);
  if (!object) return undefined;
  literalAt(object.approvedBy, `${path}.approvedBy`, collector, 'user');
  timestampAt(object.recordedAt, `${path}.recordedAt`, collector);
  providerArrayAt(object.providers, `${path}.providers`, collector);
  digestAt(object.previewDigest, `${path}.previewDigest`, collector);
  integerAt(object.previewByteCount, `${path}.previewByteCount`, collector, 1, MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1);
  return collector.issues.length === issueCount
    ? object as unknown as ModelCouncilConsentV1
    : undefined;
}

function parseModelCouncilRequestV1Impl(input: unknown): ModelCouncilParseResultV1<ModelCouncilRequestV1> {
  const collector = new IssueCollector();
  const object = objectAt(input, '$', ['kind', 'schemaVersion', 'requestId', 'payload', 'consent'], collector);
  if (!object) return finish(input, collector);
  literalAt(object.kind, '$.kind', collector, MODEL_COUNCIL_REQUEST_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', collector, MODEL_COUNCIL_SCHEMA_VERSION_V1);
  idAt(object.requestId, '$.requestId', collector);
  const payloadResult = parseModelCouncilPayloadV1(object.payload);
  if (!payloadResult.success) {
    payloadResult.issues.forEach((issue) => collector.add(`$.payload${issue.path.slice(1)}`, issue.code, issue.message));
  }
  const consent = validateConsent(object.consent, '$.consent', collector);
  if (payloadResult.success && consent && !sameStringArray(payloadResult.data.providers, consent.providers)) {
    collector.add('$.consent.providers', 'provider_mismatch', 'Consent providers must exactly match the previewed payload providers.');
  }
  return finish(input, collector);
}

export const parseModelCouncilRequestV1 = guardedParser(parseModelCouncilRequestV1Impl);

function validateRunResult(
  value: unknown,
  path: string,
  collector: IssueCollector,
  segments: readonly ModelCouncilSourceSegmentV1[],
): ModelCouncilRunResultV1 | undefined {
  const issueCount = collector.issues.length;
  if (!isRecord(value)) {
    collector.add(path, 'invalid_type', 'Expected a provider result object.');
    return undefined;
  }
  switch (value.status) {
    case 'completed': {
      const object = objectAt(value, path, ['provider', 'model', 'status', 'startedAt', 'completedAt', 'validation', 'analysis'], collector);
      if (!object) return undefined;
      providerAt(object.provider, `${path}.provider`, collector);
      stringAt(object.model, `${path}.model`, collector, { maximum: 200, plainText: true, normalizedText: true });
      literalAt(object.validation, `${path}.validation`, collector, 'source_quotes_checked');
      const started = timestampAt(object.startedAt, `${path}.startedAt`, collector);
      const completed = timestampAt(object.completedAt, `${path}.completedAt`, collector);
      if (started && completed && typeof object.completedAt === 'string' && typeof object.startedAt === 'string'
          && object.completedAt < object.startedAt) {
        collector.add(`${path}.completedAt`, 'time_order', 'Completion cannot precede start.');
      }
      const analysisResult = validateProviderAnalysisV1(object.analysis, segments);
      if (!analysisResult.success) {
        analysisResult.issues.forEach((issue) => collector.add(`${path}.analysis${issue.path.slice(1)}`, issue.code, issue.message));
      }
      return collector.issues.length === issueCount
        ? object as unknown as ModelCouncilRunResultV1
        : undefined;
    }
    case 'failed': {
      const object = objectAt(value, path, ['provider', 'model', 'status', 'startedAt', 'completedAt', 'issueCode', 'retryable'], collector);
      if (!object) return undefined;
      providerAt(object.provider, `${path}.provider`, collector);
      stringAt(object.model, `${path}.model`, collector, { maximum: 200, plainText: true, normalizedText: true });
      const started = timestampAt(object.startedAt, `${path}.startedAt`, collector);
      const completed = timestampAt(object.completedAt, `${path}.completedAt`, collector);
      if (started && completed && typeof object.completedAt === 'string' && typeof object.startedAt === 'string'
          && object.completedAt < object.startedAt) {
        collector.add(`${path}.completedAt`, 'time_order', 'Completion cannot precede start.');
      }
      enumAt(object.issueCode, `${path}.issueCode`, collector, FAILURE_CODES);
      booleanAt(object.retryable, `${path}.retryable`, collector);
      return collector.issues.length === issueCount
        ? object as unknown as ModelCouncilRunResultV1
        : undefined;
    }
    case 'unavailable': {
      const object = objectAt(value, path, ['provider', 'model', 'status', 'issueCode', 'retryable'], collector);
      if (!object) return undefined;
      providerAt(object.provider, `${path}.provider`, collector);
      stringAt(object.model, `${path}.model`, collector, { maximum: 200, plainText: true, normalizedText: true });
      enumAt(object.issueCode, `${path}.issueCode`, collector, ['council_disabled', 'not_configured', 'provider_unavailable'] as const);
      booleanAt(object.retryable, `${path}.retryable`, collector);
      return collector.issues.length === issueCount
        ? object as unknown as ModelCouncilRunResultV1
        : undefined;
    }
    default:
      objectAt(value, path, ['status'], collector);
      enumAt(value.status, `${path}.status`, collector, ['completed', 'failed', 'unavailable'] as const);
      return undefined;
  }
}

function parseModelCouncilRunResultV1Impl(
  input: unknown,
  segments: readonly ModelCouncilSourceSegmentV1[],
): ModelCouncilParseResultV1<ModelCouncilRunResultV1> {
  const collector = new IssueCollector();
  validateRunResult(input, '$', collector, segments);
  return finish(input, collector);
}

export const parseModelCouncilRunResultV1 = guardedParser(parseModelCouncilRunResultV1Impl);

function validateFieldValueOrNull(
  value: unknown,
  path: string,
  collector: IssueCollector,
  expectedKind: ExpectedValueKind,
) {
  if (value === null) return;
  validateFieldValue(value, path, collector, expectedKind);
}

function stableValueKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValueKey(record[key])}`).join(',')}}`;
}

function expectedKindForField(field: ModelCouncilFieldIdV1): ExpectedValueKind {
  if (field === 'acceptanceDeadline' || field === 'startDate') return 'date';
  if (field === 'annualBaseSalary') return 'money';
  if (field === 'probation') return 'duration';
  return 'text';
}

function validateConsensusField(
  value: unknown,
  path: string,
  collector: IssueCollector,
  field: ModelCouncilFieldIdV1,
) {
  const object = objectAt(value, path, ['field', 'status', 'agreedValue', 'providers', 'candidates'], collector);
  if (!object) return;
  literalAt(object.field, `${path}.field`, collector, field);
  const statusValid = enumAt(object.status, `${path}.status`, collector, ['no_result', 'single_result', 'agreement', 'disagreement'] as const);
  const providers = providerArrayAt(object.providers, `${path}.providers`, collector, 0);
  const expectedKind = expectedKindForField(field);
  validateFieldValueOrNull(object.agreedValue, `${path}.agreedValue`, collector, expectedKind);
  const candidates = arrayAt(object.candidates, `${path}.candidates`, collector, 0, PROVIDER_IDS_V1.length) ?? [];
  const candidateKeys: string[] = [];
  const candidateProviders: ProviderIdV1[] = [];
  candidates.forEach((candidate, index) => {
    const candidatePath = `${path}.candidates[${index}]`;
    const candidateObject = objectAt(candidate, candidatePath, ['value', 'providers'], collector);
    if (!candidateObject) return;
    validateFieldValueOrNull(candidateObject.value, `${candidatePath}.value`, collector, expectedKind);
    const providersForCandidate = providerArrayAt(candidateObject.providers, `${candidatePath}.providers`, collector);
    candidateProviders.push(...providersForCandidate);
    candidateKeys.push(stableValueKey(candidateObject.value));
  });
  uniqueStrings(candidateKeys, `${path}.candidates`, collector);
  uniqueStrings(candidateProviders, `${path}.candidates`, collector);
  if (!sameStringArray([...candidateProviders].sort((a, b) => PROVIDER_IDS_V1.indexOf(a) - PROVIDER_IDS_V1.indexOf(b)), providers)) {
    collector.add(`${path}.candidates`, 'provider_partition_mismatch', 'Candidate providers must partition the field provider list.');
  }
  if (!statusValid) return;
  if (object.status === 'no_result' && (providers.length !== 0 || candidates.length !== 0 || object.agreedValue !== null)) {
    collector.add(path, 'consensus_invariant', 'No-result fields cannot contain providers, candidates, or an agreed value.');
  }
  if (object.status === 'single_result' && (providers.length !== 1 || candidates.length !== 1 || object.agreedValue !== null)) {
    collector.add(path, 'consensus_invariant', 'Single-result fields require one candidate and no agreed value.');
  }
  if (object.status === 'agreement' && (providers.length < 2 || candidates.length !== 1)) {
    collector.add(path, 'consensus_invariant', 'Agreement requires at least two providers and exactly one candidate.');
  }
  if (object.status === 'agreement' && candidates.length === 1 && isRecord(candidates[0])
      && stableValueKey(object.agreedValue) !== stableValueKey(candidates[0].value)) {
    collector.add(`${path}.agreedValue`, 'agreement_value_mismatch', 'Agreed value must equal the sole candidate value.');
  }
  if (object.status === 'disagreement' && (providers.length < 2 || candidates.length < 2 || object.agreedValue !== null)) {
    collector.add(path, 'consensus_invariant', 'Disagreement requires at least two providers, multiple candidates, and no agreed value.');
  }
}

function parseModelCouncilConsensusV1Impl(input: unknown): ModelCouncilParseResultV1<ModelCouncilConsensusV1> {
  const collector = new IssueCollector();
  const object = objectAt(input, '$', ['kind', 'schemaVersion', 'trust', 'fields'], collector);
  if (!object) return finish(input, collector);
  literalAt(object.kind, '$.kind', collector, MODEL_COUNCIL_CONSENSUS_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', collector, MODEL_COUNCIL_SCHEMA_VERSION_V1);
  literalAt(object.trust, '$.trust', collector, 'untrusted_model_agreement');
  const fields = objectAt(object.fields, '$.fields', MODEL_COUNCIL_FIELD_IDS_V1, collector);
  if (fields) {
    MODEL_COUNCIL_FIELD_IDS_V1.forEach((field) => {
      validateConsensusField(fields[field], `$.fields.${field}`, collector, field);
    });
  }
  return finish(input, collector);
}

export const parseModelCouncilConsensusV1 = guardedParser(parseModelCouncilConsensusV1Impl);

function validateProviderPolicy(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['retention', 'trainingUse', 'assertedBy', 'policyUrl'], collector);
  if (!object) return;
  enumAt(object.retention, `${path}.retention`, collector, ['provider_policy', 'unknown'] as const);
  enumAt(object.trainingUse, `${path}.trainingUse`, collector, ['not_used', 'may_be_used', 'unknown'] as const);
  stringAt(object.assertedBy, `${path}.assertedBy`, collector, { maximum: 300, plainText: true, normalizedText: true });
  httpsUrlAt(object.policyUrl, `${path}.policyUrl`, collector);
}

function isCanonicalBrowserOllamaRecipient(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('Ollama at ')) return false;
  const origin = value.slice('Ollama at '.length);
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && parsed.origin === origin;
  } catch {
    return false;
  }
}

function parseModelCouncilReceiptV1Impl(input: unknown): ModelCouncilParseResultV1<ModelCouncilReceiptV1> {
  const collector = new IssueCollector();
  const object = objectAt(
    input,
    '$',
    ['kind', 'schemaVersion', 'receiptId', 'requestId', 'consent', 'gatewayTransfer', 'transfers'],
    collector,
  );
  if (!object) return finish(input, collector);
  literalAt(object.kind, '$.kind', collector, MODEL_COUNCIL_RECEIPT_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', collector, MODEL_COUNCIL_SCHEMA_VERSION_V1);
  idAt(object.receiptId, '$.receiptId', collector);
  idAt(object.requestId, '$.requestId', collector);
  const consent = validateConsent(object.consent, '$.consent', collector);
  let gatewayStatus: 'completed' | 'failed' | 'not_sent' | undefined;
  const gatewayTransfer = objectAt(
    object.gatewayTransfer,
    '$.gatewayTransfer',
    ['recipient', 'status', 'startedAt', 'completedAt', 'payloadDigest', 'payloadByteCount'],
    collector,
  );
  if (gatewayTransfer) {
    literalAt(gatewayTransfer.recipient, '$.gatewayTransfer.recipient', collector, 'PaperWork model gateway');
    const gatewayStatusValid = enumAt(
      gatewayTransfer.status,
      '$.gatewayTransfer.status',
      collector,
      ['completed', 'failed', 'not_sent'] as const,
    );
    if (gatewayStatusValid) gatewayStatus = gatewayTransfer.status as typeof gatewayStatus;
    if (gatewayTransfer.startedAt !== null) {
      timestampAt(gatewayTransfer.startedAt, '$.gatewayTransfer.startedAt', collector);
    }
    if (gatewayTransfer.completedAt !== null) {
      timestampAt(gatewayTransfer.completedAt, '$.gatewayTransfer.completedAt', collector);
    }
    if (gatewayStatusValid && gatewayTransfer.status === 'not_sent'
        && (gatewayTransfer.startedAt !== null || gatewayTransfer.completedAt !== null)) {
      collector.add('$.gatewayTransfer', 'transfer_time_mismatch', 'A gateway transfer marked not sent cannot have transfer timestamps.');
    }
    if (gatewayStatusValid && gatewayTransfer.status !== 'not_sent'
        && (gatewayTransfer.startedAt === null || gatewayTransfer.completedAt === null)) {
      collector.add('$.gatewayTransfer', 'transfer_time_mismatch', 'An attempted gateway transfer requires start and completion timestamps.');
    }
    if (typeof gatewayTransfer.completedAt === 'string'
        && typeof gatewayTransfer.startedAt === 'string'
        && gatewayTransfer.completedAt < gatewayTransfer.startedAt) {
      collector.add('$.gatewayTransfer.completedAt', 'time_order', 'Completion cannot precede start.');
    }
    digestAt(gatewayTransfer.payloadDigest, '$.gatewayTransfer.payloadDigest', collector);
    integerAt(gatewayTransfer.payloadByteCount, '$.gatewayTransfer.payloadByteCount', collector, 1, MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1);
    if (consent && isRecord(gatewayTransfer.payloadDigest)) {
      if (gatewayTransfer.payloadDigest.algorithm !== consent.previewDigest.algorithm
          || gatewayTransfer.payloadDigest.value !== consent.previewDigest.value) {
        collector.add('$.gatewayTransfer.payloadDigest', 'payload_digest_mismatch', 'Gateway digest must match the consented preview digest.');
      }
      if (gatewayTransfer.payloadByteCount !== consent.previewByteCount) {
        collector.add('$.gatewayTransfer.payloadByteCount', 'payload_size_mismatch', 'Gateway byte count must match the consented preview size.');
      }
    }
  }
  const transfers = arrayAt(object.transfers, '$.transfers', collector, 1, PROVIDER_IDS_V1.length) ?? [];
  const transferProviders: ProviderIdV1[] = [];
  const transferChannels: Array<'gateway_to_provider' | 'browser_to_provider'> = [];
  transfers.forEach((transfer, index) => {
    const path = `$.transfers[${index}]`;
    const transferObject = objectAt(
      transfer,
      path,
      ['provider', 'model', 'recipient', 'channel', 'status', 'startedAt', 'completedAt', 'payloadDigest', 'payloadByteCount', 'providerPolicy'],
      collector,
    );
    if (!transferObject) return;
    const providerValue = transferObject.provider;
    const providerValid = providerAt(providerValue, `${path}.provider`, collector);
    if (providerValid) transferProviders.push(providerValue);
    stringAt(transferObject.model, `${path}.model`, collector, { maximum: 200, plainText: true, normalizedText: true });
    stringAt(transferObject.recipient, `${path}.recipient`, collector, { maximum: 300, plainText: true, normalizedText: true });
    const channelValid = enumAt(
      transferObject.channel,
      `${path}.channel`,
      collector,
      ['gateway_to_provider', 'browser_to_provider'] as const,
    );
    if (channelValid) transferChannels.push(transferObject.channel as 'gateway_to_provider' | 'browser_to_provider');
    if (channelValid && providerValid && providerValue === 'ollama'
        && transferObject.channel !== 'browser_to_provider') {
      collector.add(`${path}.channel`, 'ollama_channel_mismatch', 'Ollama receipts must report the browser-direct channel.');
    }
    if (channelValid && providerValid && providerValue !== 'ollama'
        && transferObject.channel !== 'gateway_to_provider') {
      collector.add(`${path}.channel`, 'hosted_channel_mismatch', 'Hosted provider receipts must report the gateway channel.');
    }
    if (channelValid && transferObject.channel === 'browser_to_provider') {
      if (transferObject.provider !== 'ollama') {
        collector.add(`${path}.channel`, 'browser_channel_provider_mismatch', 'Browser-direct model transport is limited to Ollama.');
      }
      if (!isCanonicalBrowserOllamaRecipient(transferObject.recipient)) {
        collector.add(`${path}.recipient`, 'browser_channel_recipient_mismatch', 'Browser-direct Ollama requires an exact HTTP loopback recipient.');
      }
    }
    const statusValid = enumAt(transferObject.status, `${path}.status`, collector, ['completed', 'failed', 'not_sent'] as const);
    if (transferObject.startedAt !== null) timestampAt(transferObject.startedAt, `${path}.startedAt`, collector);
    if (transferObject.completedAt !== null) timestampAt(transferObject.completedAt, `${path}.completedAt`, collector);
    if (statusValid && transferObject.status === 'not_sent' && (transferObject.startedAt !== null || transferObject.completedAt !== null)) {
      collector.add(path, 'transfer_time_mismatch', 'A transfer marked not sent cannot have transfer timestamps.');
    }
    if (statusValid && transferObject.status !== 'not_sent' && (transferObject.startedAt === null || transferObject.completedAt === null)) {
      collector.add(path, 'transfer_time_mismatch', 'Attempted transfers require start and completion timestamps.');
    }
    if (typeof transferObject.startedAt === 'string' && typeof transferObject.completedAt === 'string'
        && transferObject.completedAt < transferObject.startedAt) {
      collector.add(`${path}.completedAt`, 'time_order', 'Completion cannot precede start.');
    }
    digestAt(transferObject.payloadDigest, `${path}.payloadDigest`, collector);
    integerAt(transferObject.payloadByteCount, `${path}.payloadByteCount`, collector, 1, MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1);
    validateProviderPolicy(transferObject.providerPolicy, `${path}.providerPolicy`, collector);
    if (consent && isRecord(transferObject.payloadDigest)) {
      if (transferObject.payloadDigest.algorithm !== consent.previewDigest.algorithm
          || transferObject.payloadDigest.value !== consent.previewDigest.value) {
        collector.add(`${path}.payloadDigest`, 'payload_digest_mismatch', 'Transfer digest must match the consented preview digest.');
      }
      if (transferObject.payloadByteCount !== consent.previewByteCount) {
        collector.add(`${path}.payloadByteCount`, 'payload_size_mismatch', 'Transfer byte count must match the consented preview size.');
      }
    }
  });
  uniqueStrings(transferProviders, '$.transfers', collector);
  validateCanonicalProviderOrder(transferProviders, '$.transfers', collector);
  if (consent && !sameStringArray(transferProviders, consent.providers)) {
    collector.add('$.transfers', 'provider_mismatch', 'Receipt transfers must cover exactly the consented providers.');
  }
  if (gatewayStatus === 'not_sent') {
    if (!consent || !sameStringArray(consent.providers, ['ollama'])) {
      collector.add('$.gatewayTransfer.status', 'direct_transport_provider_mismatch', 'A bypassed gateway is valid only for one browser-direct Ollama transfer.');
    }
    if (transferChannels.some((channel) => channel !== 'browser_to_provider')) {
      collector.add('$.transfers', 'transport_channel_mismatch', 'A bypassed gateway requires browser-to-provider transfer receipts.');
    }
  } else if (gatewayStatus && transferChannels.some((channel) => channel !== 'gateway_to_provider')) {
    collector.add('$.transfers', 'transport_channel_mismatch', 'A completed or failed gateway hop requires gateway-to-provider transfer receipts.');
  }
  return finish(input, collector);
}

export const parseModelCouncilReceiptV1 = guardedParser(parseModelCouncilReceiptV1Impl);

function parseModelCouncilCatalogV1Impl(input: unknown): ModelCouncilParseResultV1<ModelCouncilCatalogV1> {
  const collector = new IssueCollector();
  const object = objectAt(input, '$', ['kind', 'schemaVersion', 'catalogVersion', 'enabled', 'generatedAt', 'providers'], collector);
  if (!object) return finish(input, collector);
  literalAt(object.kind, '$.kind', collector, MODEL_COUNCIL_CATALOG_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', collector, MODEL_COUNCIL_SCHEMA_VERSION_V1);
  literalAt(object.catalogVersion, '$.catalogVersion', collector, MODEL_COUNCIL_PROVIDER_CATALOG_VERSION_V1);
  booleanAt(object.enabled, '$.enabled', collector);
  timestampAt(object.generatedAt, '$.generatedAt', collector);
  const providers = arrayAt(object.providers, '$.providers', collector, PROVIDER_IDS_V1.length, PROVIDER_IDS_V1.length) ?? [];
  providers.forEach((provider, index) => {
    const path = `$.providers[${index}]`;
    const providerObject = objectAt(
      provider,
      path,
      ['id', 'displayName', 'availability', 'model', 'execution', 'access', 'recipient', 'structuredOutput', 'policyUrl', 'disclosure'],
      collector,
    );
    if (!providerObject) return;
    providerAt(providerObject.id, `${path}.id`, collector);
    if (providerObject.id !== PROVIDER_IDS_V1[index]) {
      collector.add(`${path}.id`, 'non_canonical_order', `Expected provider ${PROVIDER_IDS_V1[index]}.`);
    }
    stringAt(providerObject.displayName, `${path}.displayName`, collector, { maximum: 100, plainText: true, normalizedText: true });
    const availabilityValid = enumAt(providerObject.availability, `${path}.availability`, collector, ['configured', 'not_configured', 'disabled'] as const);
    if (providerObject.model !== null) {
      stringAt(providerObject.model, `${path}.model`, collector, {
        maximum: 200,
        plainText: true,
        normalizedText: true,
      });
    }
    if (availabilityValid && providerObject.availability === 'configured' && providerObject.model === null) {
      collector.add(`${path}.model`, 'configured_model_missing', 'Configured providers must expose the configured model identifier.');
    }
    const executionValid = enumAt(providerObject.execution, `${path}.execution`, collector, ['provider_api', 'self_hosted'] as const);
    if (executionValid && providerObject.id === 'ollama' && providerObject.execution !== 'self_hosted') {
      collector.add(`${path}.execution`, 'execution_mismatch', 'The Ollama adapter is represented as self-hosted.');
    }
    if (executionValid && providerObject.id !== 'ollama' && providerObject.execution !== 'provider_api') {
      collector.add(`${path}.execution`, 'execution_mismatch', 'Hosted providers must be represented as provider APIs.');
    }
    const accessValid = enumAt(
      providerObject.access,
      `${path}.access`,
      collector,
      ['commercial_api', 'open_weight_hosted_api', 'hosted_api_model_license_varies', 'self_hosted'] as const,
    );
    if (accessValid && ['openai', 'anthropic'].includes(String(providerObject.id))
        && providerObject.access !== 'commercial_api') {
      collector.add(`${path}.access`, 'access_mismatch', 'OpenAI and Anthropic adapters use commercial proprietary APIs.');
    }
    if (accessValid && providerObject.id === 'mistral'
        && providerObject.access !== 'hosted_api_model_license_varies') {
      collector.add(`${path}.access`, 'access_mismatch', 'Mistral API model licensing varies with the configured model.');
    }
    if (accessValid && providerObject.id === 'deepseek'
        && providerObject.access !== 'open_weight_hosted_api') {
      collector.add(`${path}.access`, 'access_mismatch', 'DeepSeek uses hosted API access for its open-weight model family.');
    }
    if (accessValid && providerObject.id === 'ollama' && providerObject.access !== 'self_hosted') {
      collector.add(`${path}.access`, 'access_mismatch', 'The Ollama adapter is self-hosted.');
    }
    stringAt(providerObject.recipient, `${path}.recipient`, collector, { maximum: 300, plainText: true, normalizedText: true });
    enumAt(providerObject.structuredOutput, `${path}.structuredOutput`, collector, ['json_schema', 'json_object'] as const);
    httpsUrlAt(providerObject.policyUrl, `${path}.policyUrl`, collector);
    stringAt(providerObject.disclosure, `${path}.disclosure`, collector, { maximum: 500, plainText: true, normalizedText: true });
  });
  return finish(input, collector);
}

export const parseModelCouncilCatalogV1 = guardedParser(parseModelCouncilCatalogV1Impl);

function validateResponseExpectation(
  value: unknown,
  path: string,
  collector: IssueCollector,
): ModelCouncilResponseExpectationV1 | undefined {
  const issueCount = collector.issues.length;
  const object = objectAt(
    value,
    path,
    ['requestId', 'previewDigest', 'previewByteCount', 'providerTargets'],
    collector,
  );
  if (!object) return undefined;
  idAt(object.requestId, `${path}.requestId`, collector);
  digestAt(object.previewDigest, `${path}.previewDigest`, collector);
  integerAt(object.previewByteCount, `${path}.previewByteCount`, collector, 1, MODEL_COUNCIL_MAX_PREVIEW_BYTES_V1);
  providerTargetsAt(object.providerTargets, `${path}.providerTargets`, collector);
  return collector.issues.length === issueCount
    ? object as unknown as ModelCouncilResponseExpectationV1
    : undefined;
}

function parseModelCouncilResponseV1Impl(
  input: unknown,
  segmentsInput?: readonly ModelCouncilSourceSegmentV1[],
  expectedRunInput?: ModelCouncilResponseExpectationV1,
): ModelCouncilParseResultV1<ModelCouncilResponseV1> {
  const collector = new IssueCollector();
  const segments = segmentsInput ?? [];
  const expectedRun = expectedRunInput === undefined
    ? undefined
    : validateResponseExpectation(expectedRunInput, '$expectedRun', collector);
  const object = objectAt(input, '$', ['kind', 'schemaVersion', 'requestId', 'results', 'consensus', 'receipt'], collector);
  if (!object) return finish(input, collector);
  literalAt(object.kind, '$.kind', collector, MODEL_COUNCIL_RESPONSE_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', collector, MODEL_COUNCIL_SCHEMA_VERSION_V1);
  const requestIdValid = idAt(object.requestId, '$.requestId', collector);
  if (expectedRun && requestIdValid && object.requestId !== expectedRun.requestId) {
    collector.add('$.requestId', 'expected_request_mismatch', 'Response request does not match the browser-owned run expectation.');
  }
  const resultsInput = arrayAt(object.results, '$.results', collector, 1, PROVIDER_IDS_V1.length) ?? [];
  if (!segmentsInput && resultsInput.some((result) => isRecord(result) && result.status === 'completed')) {
    collector.add('$segments', 'canonical_segments_required', 'Canonical preview segments are required to verify completed provider evidence.');
  }
  const results: ModelCouncilRunResultV1[] = [];
  resultsInput.forEach((result, index) => {
    const parsed = validateRunResult(result, `$.results[${index}]`, collector, segments);
    if (parsed) results.push(parsed);
  });
  const resultProviders = results.map((result) => result.provider);
  uniqueStrings(resultProviders, '$.results', collector);
  validateCanonicalProviderOrder(resultProviders, '$.results', collector);
  const resultsAreCompleteAndUnique = results.length === resultsInput.length
    && new Set(resultProviders).size === resultProviders.length;

  const consensusResult = parseModelCouncilConsensusV1(object.consensus);
  if (!consensusResult.success) {
    consensusResult.issues.forEach((issue) => collector.add(`$.consensus${issue.path.slice(1)}`, issue.code, issue.message));
  } else if (resultsAreCompleteAndUnique) {
    const expected = buildModelCouncilConsensusV1(results);
    if (stableValueKey(expected) !== stableValueKey(consensusResult.data)) {
      collector.add('$.consensus', 'consensus_mismatch', 'Consensus must be the deterministic result of the provider results.');
    }
  }

  const receiptResult = parseModelCouncilReceiptV1(object.receipt);
  if (!receiptResult.success) {
    receiptResult.issues.forEach((issue) => collector.add(`$.receipt${issue.path.slice(1)}`, issue.code, issue.message));
  } else {
    if (receiptResult.data.requestId !== object.requestId) {
      collector.add('$.receipt.requestId', 'request_mismatch', 'Receipt request must match the response request.');
    }
    if (resultsAreCompleteAndUnique && !sameStringArray(receiptResult.data.consent.providers, resultProviders)) {
      collector.add('$.receipt.consent.providers', 'provider_mismatch', 'Receipt providers must match response results.');
    }
    if (expectedRun) {
      if (receiptResult.data.consent.previewDigest.algorithm !== expectedRun.previewDigest.algorithm
          || receiptResult.data.consent.previewDigest.value !== expectedRun.previewDigest.value) {
        collector.add('$.receipt.consent.previewDigest', 'expected_digest_mismatch', 'Response digest does not match the browser-owned preview.');
      }
      if (receiptResult.data.consent.previewByteCount !== expectedRun.previewByteCount) {
        collector.add('$.receipt.consent.previewByteCount', 'expected_size_mismatch', 'Response byte count does not match the browser-owned preview.');
      }
      const expectedProviders = expectedRun.providerTargets.map((target) => target.provider);
      if (!sameStringArray(receiptResult.data.consent.providers, expectedProviders)) {
        collector.add('$.receipt.consent.providers', 'expected_provider_target_mismatch', 'Receipt providers do not match the approved targets.');
      }
    }
    if (resultsAreCompleteAndUnique) results.forEach((result, index) => {
      const transfer = receiptResult.data.transfers[index];
      if (!transfer || transfer.provider !== result.provider || transfer.model !== result.model) {
        collector.add(`$.receipt.transfers[${index}]`, 'result_transfer_mismatch', 'Transfer must identify the same provider and model as its result.');
        return;
      }
      const expectedStatus = result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'not_sent';
      if (transfer.status !== expectedStatus) {
        collector.add(`$.receipt.transfers[${index}].status`, 'result_transfer_mismatch', `Expected transfer status ${expectedStatus}.`);
      }
      const expectedTarget = expectedRun?.providerTargets[index];
      if (expectedTarget && (
        result.provider !== expectedTarget.provider
        || result.model !== expectedTarget.model
        || transfer.provider !== expectedTarget.provider
        || transfer.model !== expectedTarget.model
        || transfer.recipient !== expectedTarget.recipient
      )) {
        collector.add(
          `$.receipt.transfers[${index}]`,
          'expected_provider_target_mismatch',
          'Result and transfer must exactly match the approved provider, model, and recipient.',
        );
      }
    });
  }
  return finish(input, collector);
}

export const parseModelCouncilResponseV1 = guardedParser(parseModelCouncilResponseV1Impl);

export function formatModelCouncilIssuesV1(issues: readonly ModelCouncilContractIssueV1[]) {
  return issues.map((issue) => `${issue.path}: [${issue.code}] ${issue.message}`).join('\n');
}

export class ModelCouncilContractErrorV1 extends TypeError {
  readonly issues: readonly ModelCouncilContractIssueV1[];

  constructor(issues: readonly ModelCouncilContractIssueV1[]) {
    super(`PaperWork model-council contract failed validation:\n${formatModelCouncilIssuesV1(issues)}`);
    this.name = 'ModelCouncilContractErrorV1';
    this.issues = issues;
  }
}
