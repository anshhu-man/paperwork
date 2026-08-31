import { PROVIDER_IDS_V1, type ProviderIdV1 } from '../../model-council/v1';
import {
  DOCUMENT_AGENT_MAX_PREVIEW_BYTES_V1,
  DOCUMENT_AGENT_MAX_TOTAL_SEGMENT_CHARACTERS_V1,
  DOCUMENT_AGENT_OUTPUT_CONTRACT_V1,
  DOCUMENT_AGENT_PAYLOAD_KIND_V1,
  DOCUMENT_AGENT_PROMPT_VERSION_V1,
  DOCUMENT_AGENT_RECEIPT_KIND_V1,
  DOCUMENT_AGENT_REQUEST_KIND_V1,
  DOCUMENT_AGENT_RESPONSE_KIND_V1,
  DOCUMENT_AGENT_SCHEMA_VERSION_V1,
  DOCUMENT_FIELD_IDS_V1,
  DOCUMENT_GROUP_KINDS_V1,
  DOCUMENT_REQUIREMENT_OPERATIONS_V1,
  DOCUMENT_SUGGESTION_INTENTS_V1,
  DOCUMENT_TYPES_V1,
  PROVIDER_DOCUMENT_ANALYSIS_KIND_V1,
  type DocumentAgentConsentV1,
  type DocumentAgentPayloadV1,
  type DocumentAgentReceiptV1,
  type DocumentAgentRequestV1,
  type DocumentAgentResponseExpectationV1,
  type DocumentAgentResponseV1,
  type DocumentAgentRunResultV1,
  type DocumentAgentSourceSegmentV1,
  type DocumentEvidenceV1,
  type DocumentFieldIdV1,
  type DocumentFieldValueV1,
  type DocumentGroupRefV1,
  type DocumentRequirementOperationV1,
  type DocumentTypeV1,
  type ProviderDocumentAnalysisV1,
  type ProviderDocumentConflictV1,
  type ProviderDocumentFindingV1,
  type ProviderDocumentRequirementV1,
  type ProviderDocumentSuggestionV1,
} from './contracts';

export interface DocumentAgentIssueV1 {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type DocumentAgentParseResultV1<T> =
  | { readonly ok: true; readonly success: true; readonly value: T; readonly issues: readonly [] }
  | { readonly ok: false; readonly success: false; readonly issues: readonly DocumentAgentIssueV1[] };

type UnknownRecord = Record<string, unknown>;

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const CONTROL_OR_BIDI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const ACTIVE_MARKUP = /<\s*\/?\s*[a-z!][^>]*>|javascript\s*:|\bon[a-z]+\s*=/i;
const MAX = {
  findings: 64,
  requirements: 32,
  conflicts: 16,
  suggestions: 8,
  evidence: 4,
  alternatives: 8,
  segments: 10_000,
  quote: 2_000,
  text: 1_000,
} as const;

const REPEATABLE_FINDING_FIELDS = new Set<DocumentFieldIdV1>([
  'resume.experience_description',
  'resume.skill',
  'resume.project',
  'resume.certification',
  'resume.achievement',
  'resume.language',
  'offer.benefit',
  'contract.party',
  'contract.obligation',
  'invoice.line_item_description',
  'generic.party',
  'generic.date',
  'generic.deadline',
  'generic.money',
  'generic.percentage',
  'generic.identifier',
  'generic.location',
  'generic.duration',
  'generic.contact',
  'generic.term',
]);

class Collector {
  readonly issues: DocumentAgentIssueV1[] = [];
  add(path: string, code: string, message: string) { this.issues.push({ path, code, message }); }
}

function isRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectAt(value: unknown, path: string, allowed: readonly string[], issues: Collector) {
  if (!isRecord(value)) {
    issues.add(path, 'invalid_type', 'Expected a plain object.');
    return undefined;
  }
  const keys = new Set(allowed);
  Object.keys(value).forEach((key) => {
    if (!keys.has(key)) issues.add(`${path}.${key}`, 'unknown_field', 'Unknown fields are rejected.');
  });
  return value;
}

function arrayAt(value: unknown, path: string, issues: Collector, minimum: number, maximum: number) {
  if (!Array.isArray(value)) {
    issues.add(path, 'invalid_type', 'Expected an array.');
    return [] as readonly unknown[];
  }
  if (value.length < minimum) issues.add(path, 'too_few_items', `Expected at least ${minimum} item(s).`);
  if (value.length > maximum) issues.add(path, 'too_many_items', `Expected no more than ${maximum} item(s).`);
  return value;
}

function stringAt(
  value: unknown,
  path: string,
  issues: Collector,
  options: { minimum?: number; maximum?: number; inert?: boolean; nfc?: boolean } = {},
): value is string {
  if (typeof value !== 'string') {
    issues.add(path, 'invalid_type', 'Expected a string.');
    return false;
  }
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? MAX.text;
  if (value.length < minimum) issues.add(path, 'string_too_short', `Expected at least ${minimum} character(s).`);
  if (value.length > maximum) issues.add(path, 'string_too_long', `Expected no more than ${maximum} character(s).`);
  if (CONTROL_OR_BIDI.test(value)) issues.add(path, 'unsafe_character', 'Control, bidi, and invisible format characters are rejected.');
  if (options.inert && ACTIVE_MARKUP.test(value)) issues.add(path, 'active_content', 'Active markup and executable-looking content are rejected.');
  if (options.nfc !== false && value.normalize('NFC') !== value) issues.add(path, 'not_nfc', 'Text must use NFC normalization.');
  return true;
}

function idAt(value: unknown, path: string, issues: Collector): value is string {
  if (!stringAt(value, path, issues, { maximum: 128 })) return false;
  if (!ID.test(value)) issues.add(path, 'invalid_id', 'Expected a stable identifier.');
  return true;
}

function integerAt(value: unknown, path: string, issues: Collector, minimum: number, maximum: number): value is number {
  if (!Number.isSafeInteger(value)) {
    issues.add(path, 'invalid_integer', 'Expected a finite safe integer.');
    return false;
  }
  const numeric = value as number;
  if (numeric < minimum || numeric > maximum) issues.add(path, 'integer_out_of_range', `Expected ${minimum}–${maximum}.`);
  return true;
}

function enumAt<const T extends string>(value: unknown, path: string, issues: Collector, choices: readonly T[]): value is T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    issues.add(path, 'invalid_enum', `Expected one of: ${choices.join(', ')}.`);
    return false;
  }
  return true;
}

function literalAt(value: unknown, path: string, issues: Collector, expected: string) {
  if (value !== expected) issues.add(path, 'invalid_literal', `Expected ${JSON.stringify(expected)}.`);
}

function timestampAt(value: unknown, path: string, issues: Collector): value is string {
  if (!stringAt(value, path, issues, { maximum: 64 })) return false;
  const parsed = new Date(value);
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    issues.add(path, 'invalid_timestamp', 'Expected a canonical UTC timestamp with milliseconds.');
  }
  return true;
}

function dateAt(value: unknown, path: string, issues: Collector): value is string {
  if (!stringAt(value, path, issues, { maximum: 10 })) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!ISO_DATE.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    issues.add(path, 'invalid_date', 'Expected a real YYYY-MM-DD date.');
  }
  return true;
}

function finish<T>(issues: Collector, value: T): DocumentAgentParseResultV1<T> {
  if (issues.issues.length > 0) return { ok: false, success: false, issues: issues.issues };
  return { ok: true, success: true, value: structuredClone(value), issues: [] };
}

function pageForSegment(segment: DocumentAgentSourceSegmentV1) { return segment.page; }

function evidenceAt(
  value: unknown,
  path: string,
  issues: Collector,
  segments: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
  revisionId: string,
): DocumentEvidenceV1 | undefined {
  const object = objectAt(value, path, ['sourceRevisionId', 'segmentId', 'page', 'span', 'quote'], issues);
  if (!object) return undefined;
  const sourceRevisionId = idAt(object.sourceRevisionId, `${path}.sourceRevisionId`, issues) ? object.sourceRevisionId : '';
  const segmentId = idAt(object.segmentId, `${path}.segmentId`, issues) ? object.segmentId : '';
  const page = integerAt(object.page, `${path}.page`, issues, 1, 100_000) ? object.page : 0;
  const spanObject = objectAt(object.span, `${path}.span`, ['start', 'end'], issues);
  const start = spanObject && integerAt(spanObject.start, `${path}.span.start`, issues, 0, 1_000_000) ? spanObject.start : 0;
  const end = spanObject && integerAt(spanObject.end, `${path}.span.end`, issues, 1, 1_000_000) ? spanObject.end : 0;
  const quote = stringAt(object.quote, `${path}.quote`, issues, { maximum: MAX.quote, nfc: false }) ? object.quote : '';
  const segment = segments.get(segmentId);
  if (sourceRevisionId !== revisionId) issues.add(`${path}.sourceRevisionId`, 'revision_mismatch', 'Evidence must use the analyzed revision.');
  if (!segment) issues.add(`${path}.segmentId`, 'unknown_segment', 'Evidence segment was not in the approved payload.');
  if (segment && page !== pageForSegment(segment)) issues.add(`${path}.page`, 'page_mismatch', 'Evidence page differs from the canonical segment.');
  if (end <= start) issues.add(`${path}.span`, 'invalid_span', 'Evidence span must be non-empty.');
  if (segment && (end > segment.text.length || segment.text.slice(start, end) !== quote)) {
    issues.add(`${path}.quote`, 'quote_mismatch', 'Quote must exactly equal the cited segment span.');
  }
  return { sourceRevisionId, segmentId, page, span: { start, end }, quote };
}

function evidenceArrayAt(
  value: unknown,
  path: string,
  issues: Collector,
  segments: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
  revisionId: string,
  minimum = 1,
) {
  const array = arrayAt(value, path, issues, minimum, MAX.evidence);
  const evidence = array.flatMap((item, index) => {
    const parsed = evidenceAt(item, `${path}[${index}]`, issues, segments, revisionId);
    return parsed ? [parsed] : [];
  });
  const seen = new Set<string>();
  evidence.forEach((item, index) => {
    const key = `${item.segmentId}:${item.span.start}:${item.span.end}`;
    if (seen.has(key)) issues.add(`${path}[${index}]`, 'duplicate_evidence', 'Duplicate evidence is rejected.');
    seen.add(key);
  });
  return evidence;
}

function groupAt(value: unknown, path: string, issues: Collector): DocumentGroupRefV1 | null {
  if (value === null) return null;
  const object = objectAt(value, path, ['kind', 'index'], issues);
  if (!object) return null;
  const kind = enumAt(object.kind, `${path}.kind`, issues, DOCUMENT_GROUP_KINDS_V1) ? object.kind : 'contract_clause';
  const index = integerAt(object.index, `${path}.index`, issues, 0, 1_000) ? object.index : 0;
  return { kind, index };
}

function dateSupported(value: string, quotes: string) {
  if (new RegExp(`(?:^|[^0-9])${value.replace(/-/g, '\\-')}(?:$|[^0-9])`).test(quotes)) return true;
  const [year, month, day] = value.split('-').map(Number);
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthNames = months.join('|');
  const candidates: Array<{ year: number; month: number; day: number }> = [];
  for (const match of quotes.matchAll(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|\\s+)(\\d{4})\\b`, 'gi'))) {
    candidates.push({ year: Number(match[3]), month: months.indexOf(match[1]!.toLowerCase()) + 1, day: Number(match[2]) });
  }
  for (const match of quotes.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\s*,?\\s*(\\d{4})\\b`, 'gi'))) {
    candidates.push({ year: Number(match[3]), month: months.indexOf(match[2]!.toLowerCase()) + 1, day: Number(match[1]) });
  }
  return candidates.some((candidate) => candidate.year === year && candidate.month === month && candidate.day === day);
}

function canonicalDecimal(value: string) {
  if (!DECIMAL.test(value)) return undefined;
  const [integer, fraction = ''] = value.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

function numericTokenSupported(value: string, quote: string, percentage = false) {
  const expected = canonicalDecimal(value);
  if (!expected) return false;
  const pattern = /\d+(?:[,_]\d+)*(?:\.\d{1,6})?/g;
  for (const match of quote.matchAll(pattern)) {
    const normalized = match[0].replace(/[,_]/g, '');
    if (canonicalDecimal(normalized) !== expected) continue;
    if (!percentage || /^\s*%/.test(quote.slice((match.index ?? 0) + match[0].length))) return true;
  }
  return false;
}

interface MoneyMarker<T extends string> { readonly value: T; readonly start: number; readonly end: number }

function currencyMarkers(quote: string): readonly MoneyMarker<string>[] {
  const markers: MoneyMarker<string>[] = [];
  for (const match of quote.matchAll(/\b[A-Z]{3}\b/gi)) {
    markers.push({ value: match[0].toUpperCase(), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  const named: ReadonlyArray<readonly [string, RegExp]> = [
    ['USD', /\b(?:us|u\.s\.)\s+dollars?\b/gi],
    ['INR', /\b(?:indian\s+rupees?|rupees?)\b/gi],
    ['EUR', /\beuros?\b/gi],
    ['GBP', /\b(?:pounds?\s+sterling|british\s+pounds?)\b/gi],
    ['JPY', /\bjapanese\s+yen\b/gi],
    ['CNY', /\b(?:chinese\s+yuan|renminbi)\b/gi],
  ];
  named.forEach(([code, pattern]) => {
    for (const match of quote.matchAll(pattern)) markers.push({ value: code, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  });
  const symbols: ReadonlyArray<readonly [string, RegExp]> = [
    ['AUD', /A\$/g], ['CAD', /C\$/g], ['SGD', /S\$/g], ['HKD', /HK\$/g], ['NZD', /NZ\$/g],
    ['INR', /₹/g], ['EUR', /€/g], ['GBP', /£/g], ['JPY', /¥/g], ['USD', /(?<![A-Z])\$/g],
  ];
  symbols.forEach(([code, pattern]) => {
    for (const match of quote.matchAll(pattern)) markers.push({ value: code, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  });
  return markers;
}

function basisMarkers(quote: string): readonly MoneyMarker<string>[] {
  const definitions: ReadonlyArray<readonly [string, RegExp]> = [
    ['hourly', /\b(?:hourly|per\s+hour|an\s+hour)\b/gi],
    ['monthly', /\b(?:monthly|per\s+month|a\s+month)\b/gi],
    ['annual', /\b(?:annual|annually|per\s+year|a\s+year|per\s+annum)\b/gi],
    ['subtotal', /\bsub\s*total\b/gi],
    ['tax', /\b(?:tax|gst|vat)\b/gi],
    ['discount', /\bdiscount\b/gi],
    ['amount_due', /\b(?:amount|balance)\s+due\b/gi],
    ['total', /(?<!sub )\btotal\b/gi],
  ];
  return definitions.flatMap(([basis, pattern]) => Array.from(quote.matchAll(pattern), (match) => ({
    value: basis,
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  })));
}

function markerDistance(marker: MoneyMarker<string>, start: number, end: number) {
  if (marker.end <= start) return start - marker.end;
  if (marker.start >= end) return marker.start - end;
  return 0;
}

function nearestMarker(markers: readonly MoneyMarker<string>[], start: number, end: number, maximumDistance: number) {
  const ranked = markers.map((marker) => ({ marker, distance: markerDistance(marker, start, end) }))
    .filter((candidate) => candidate.distance <= maximumDistance)
    .sort((left, right) => left.distance - right.distance);
  if (ranked.length === 0) return undefined;
  const nearest = ranked[0]!;
  if (ranked.some((candidate) => candidate.distance <= nearest.distance + 4 && candidate.marker.value !== nearest.marker.value)) return undefined;
  return nearest.marker;
}

function moneyClauses(text: string) {
  return text.split(/\b(?:and|but|or|plus|because|since|while|whereas|although|however|therefore|then|versus|vs\.?|rather\s+than)\b|[;\/\n]|,(?!\d)|(?<!\d)\.(?!\d)/gi)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function currencyAmountAdjacent(currency: MoneyMarker<string>, amountStart: number, amountEnd: number, clause: string) {
  const between = currency.end <= amountStart
    ? clause.slice(currency.end, amountStart)
    : clause.slice(amountEnd, currency.start);
  return /^[\s:=-]*$/.test(between);
}

function basisRelatesToAmount(
  basis: string,
  marker: MoneyMarker<string>,
  clusterStart: number,
  clusterEnd: number,
  clause: string,
) {
  const recurring = basis === 'hourly' || basis === 'monthly' || basis === 'annual';
  const invoiceBasis = basis === 'subtotal' || basis === 'tax' || basis === 'discount' || basis === 'total' || basis === 'amount_due';
  if (marker.end <= clusterStart) {
    const between = clause.slice(marker.end, clusterStart);
    const after = clause.slice(clusterEnd);
    if (!/^[\s.)\],:=-]*$/.test(after)) return false;
    if (recurring) {
      return /^\s*(?:(?:base|gross|net|total)\s+)?(?:salary|compensation|pay|rate|wage|fee|rent|cost|price|amount)?(?:\s+(?:is|of|at))?\s*[:=-]?\s*$/i.test(between);
    }
    return invoiceBasis && /^\s*(?:is\s+|of\s+|at\s+)?[:=-]?\s*$/i.test(between);
  }
  if (marker.start >= clusterEnd) {
    const between = clause.slice(clusterEnd, marker.start);
    const after = clause.slice(marker.end);
    return /^[\s()\[\],:/=-]*$/.test(between) && /^[\s.)\],:=-]*$/.test(after);
  }
  return false;
}

function moneySupportedTogether(amount: string, currency: string, basis: string, quote: string) {
  const expected = canonicalDecimal(amount);
  if (!expected) return false;
  for (const clause of moneyClauses(quote)) {
    const currencies = currencyMarkers(clause);
    const bases = basisMarkers(clause);
    const pattern = /\d+(?:[,_]\d+)*(?:\.\d{1,6})?/g;
    for (const match of clause.matchAll(pattern)) {
      const normalized = canonicalDecimal(match[0].replace(/[,_]/g, ''));
      if (normalized !== expected) continue;
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const nearestCurrency = nearestMarker(currencies, start, end, 32);
      if (!nearestCurrency || nearestCurrency.value !== currency || !currencyAmountAdjacent(nearestCurrency, start, end, clause)) continue;
      const nearestBasis = nearestMarker(bases, start, end, 64);
      if (basis === 'one_time' && nearestBasis === undefined) return true;
      if (!nearestBasis || nearestBasis.value !== basis) continue;
      const clusterStart = Math.min(start, nearestCurrency.start);
      const clusterEnd = Math.max(end, nearestCurrency.end);
      if (basisRelatesToAmount(basis, nearestBasis, clusterStart, clusterEnd, clause)) return true;
    }
  }
  return false;
}

function valueAt(
  value: unknown,
  path: string,
  issues: Collector,
  evidence: readonly DocumentEvidenceV1[],
  segments?: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
): DocumentFieldValueV1 | undefined {
  const object = objectAt(value, path, ['kind', 'text', 'value', 'amount', 'currency', 'basis', 'unit'], issues);
  if (!object) return undefined;
  const kind = object.kind;
  if (kind === 'text') {
    const text = stringAt(object.text, `${path}.text`, issues, { maximum: MAX.text, inert: true }) ? object.text : '';
    for (const key of ['value', 'amount', 'currency', 'basis', 'unit']) if (object[key] !== undefined) issues.add(`${path}.${key}`, 'unknown_field', 'Field is not valid for a text value.');
    if (text && !evidence.some((item) => item.quote.includes(text))) issues.add(`${path}.text`, 'value_not_in_evidence', 'A text value must occur inside one cited source span.');
    return { kind: 'text', text };
  }
  if (kind === 'date') {
    const parsed = dateAt(object.value, `${path}.value`, issues) ? object.value : '';
    for (const key of ['text', 'amount', 'currency', 'basis', 'unit']) if (object[key] !== undefined) issues.add(`${path}.${key}`, 'unknown_field', 'Field is not valid for a date value.');
    if (parsed && !evidence.some((item) => dateSupported(parsed, item.quote))) issues.add(`${path}.value`, 'value_not_in_evidence', 'A normalized date must be supported inside one cited source span.');
    return { kind: 'date', value: parsed };
  }
  if (kind === 'money') {
    const amount = stringAt(object.amount, `${path}.amount`, issues, { maximum: 64 }) ? object.amount : '';
    const currency = stringAt(object.currency, `${path}.currency`, issues, { minimum: 3, maximum: 3 }) ? object.currency : '';
    const bases = ['one_time', 'hourly', 'monthly', 'annual', 'subtotal', 'tax', 'discount', 'total', 'amount_due'] as const;
    const basis = enumAt(object.basis, `${path}.basis`, issues, bases) ? object.basis : 'one_time';
    for (const key of ['text', 'value', 'unit']) if (object[key] !== undefined) issues.add(`${path}.${key}`, 'unknown_field', 'Field is not valid for a money value.');
    if (!DECIMAL.test(amount)) issues.add(`${path}.amount`, 'invalid_decimal', 'Money amount must be canonical decimal text.');
    if (!CURRENCY.test(currency)) issues.add(`${path}.currency`, 'invalid_currency', 'Currency must be an uppercase ISO-style code.');
    if (amount && currency && !evidence.some((item) => {
      const segment = segments?.get(item.segmentId);
      const context = segment ? enclosingSourceContext(segment, item) : item.quote;
      return moneySupportedTogether(amount, currency, basis, item.quote)
        && moneySupportedTogether(amount, currency, basis, context);
    })) {
      issues.add(path, 'value_not_in_evidence', 'Money amount, currency, and basis must be supported together inside one cited source span.');
    }
    return { kind: 'money', amount, currency, basis };
  }
  if (kind === 'duration') {
    const duration = integerAt(object.value, `${path}.value`, issues, 1, 10_000) ? object.value : 1;
    const units = ['day', 'week', 'month', 'year'] as const;
    const unit = enumAt(object.unit, `${path}.unit`, issues, units) ? object.unit : 'day';
    for (const key of ['text', 'amount', 'currency', 'basis']) if (object[key] !== undefined) issues.add(`${path}.${key}`, 'unknown_field', 'Field is not valid for a duration value.');
    const pattern = new RegExp(`\\b${duration}\\s*${unit}s?\\b`, 'i');
    if (!evidence.some((item) => pattern.test(item.quote))) issues.add(path, 'value_not_in_evidence', 'Duration must be supported inside one cited source span.');
    return { kind: 'duration', value: duration, unit };
  }
  if (kind === 'decimal' || kind === 'percentage') {
    const parsed = stringAt(object.value, `${path}.value`, issues, { maximum: 64 }) ? object.value : '';
    for (const key of ['text', 'amount', 'currency', 'basis', 'unit']) if (object[key] !== undefined) issues.add(`${path}.${key}`, 'unknown_field', 'Field is not valid for this numeric value.');
    if (!DECIMAL.test(parsed)) issues.add(`${path}.value`, 'invalid_decimal', 'Expected canonical decimal text.');
    if (parsed && !evidence.some((item) => numericTokenSupported(parsed, item.quote, kind === 'percentage'))) issues.add(`${path}.value`, 'value_not_in_evidence', 'Numeric value must be supported inside one cited source span.');
    return kind === 'decimal' ? { kind, value: parsed } : { kind, value: parsed };
  }
  issues.add(`${path}.kind`, 'invalid_enum', 'Unknown field value kind.');
  return undefined;
}

function allowedPrefix(documentType: DocumentTypeV1, fieldId: DocumentFieldIdV1) {
  if (fieldId.startsWith('document.')) return true;
  if (documentType === 'resume') return fieldId.startsWith('resume.');
  if (documentType === 'employment_offer') return fieldId.startsWith('offer.');
  if (documentType === 'contract') return fieldId.startsWith('contract.');
  if (documentType === 'invoice') return fieldId.startsWith('invoice.');
  return fieldId.startsWith('generic.');
}

function compatibleValueKind(fieldId: DocumentFieldIdV1, kind: DocumentFieldValueV1['kind']) {
  const dateField = fieldId.endsWith('_date') || fieldId.endsWith('.date') || fieldId.endsWith('deadline');
  const moneyField = /(?:salary|compensation|price|amount|subtotal|tax|discount|total|money)$/.test(fieldId);
  const durationField = /(?:probation|duration)$/.test(fieldId);
  const decimalField = fieldId.endsWith('quantity');
  if (fieldId === 'generic.percentage') return kind === 'percentage';
  if (fieldId === 'invoice.tax' || fieldId === 'invoice.discount') return kind === 'money' || kind === 'percentage';
  if (dateField) return kind === 'date';
  if (moneyField) return kind === 'money';
  if (durationField) return kind === 'duration';
  if (decimalField) return kind === 'decimal';
  return kind === 'text';
}

function compatibleGroup(fieldId: DocumentFieldIdV1, group: DocumentGroupRefV1 | null) {
  if (fieldId.startsWith('resume.experience_')) return group?.kind === 'resume_experience';
  if (fieldId.startsWith('resume.education_')) return group?.kind === 'resume_education';
  if (fieldId === 'resume.project') return group?.kind === 'resume_project';
  if (fieldId.startsWith('invoice.line_item_')) return group?.kind === 'invoice_line_item';
  if (fieldId === 'contract.party') return group === null || group.kind === 'contract_party';
  if (fieldId.startsWith('contract.')) return group === null || group.kind === 'contract_clause';
  if (fieldId === 'invoice.seller' || fieldId === 'invoice.buyer') return group === null || group.kind === 'invoice_party';
  return group === null;
}

function findingAt(
  value: unknown,
  path: string,
  issues: Collector,
  documentType: DocumentTypeV1,
  segments: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
  revisionId: string,
): ProviderDocumentFindingV1 | undefined {
  const object = objectAt(value, path, ['fieldId', 'group', 'value', 'evidence'], issues);
  if (!object) return undefined;
  const fieldId = enumAt(object.fieldId, `${path}.fieldId`, issues, DOCUMENT_FIELD_IDS_V1) ? object.fieldId : 'document.title';
  const group = groupAt(object.group, `${path}.group`, issues);
  const evidence = evidenceArrayAt(object.evidence, `${path}.evidence`, issues, segments, revisionId);
  const parsedValue = valueAt(object.value, `${path}.value`, issues, evidence, segments);
  if (!allowedPrefix(documentType, fieldId)) issues.add(`${path}.fieldId`, 'field_document_mismatch', 'Field is not allowed for this document type.');
  if (!compatibleGroup(fieldId, group)) issues.add(`${path}.group`, 'field_group_mismatch', 'Group is incompatible with this field.');
  if (parsedValue && !compatibleValueKind(fieldId, parsedValue.kind)) issues.add(`${path}.value.kind`, 'field_value_mismatch', 'Value kind is incompatible with this field.');
  return parsedValue ? { fieldId, group, value: parsedValue, evidence: [evidence[0], ...evidence.slice(1)] } : undefined;
}

const UNSAFE_REQUIREMENT_CONTEXT = /\b(?:do not|don't|must not|shall not|not required|no need|not obligated|optional|proposed|draft|revoked|withdrawn|cancelled|canceled|superseded|if|unless|subject to|provided that)\b|\b(?:may|might|could)\s+(?:be|required|need|choose|elect|request|submit|pay|sign|terminate|cancel|provide|notify|deliver|renew|respond|retain|comply)\b/i;

const REQUIREMENT_OPERATION_LANGUAGE: Readonly<Record<DocumentRequirementOperationV1, RegExp>> = {
  accept: /\baccept(?:ance|ed|ing)?\b/i,
  sign: /\b(?:sign|signed|signing|signature)\b/i,
  return: /\b(?:return|returned|returning|send\s+back)\b/i,
  pay: /\b(?:pay|paid|payment|remit|remittance|amount\s+due|balance\s+due)\b/i,
  submit: /\b(?:submit|submitted|submitting|submission|file|filing|upload)\b/i,
  provide: /\b(?:provide|provided|providing|furnish|supply)\b/i,
  notify: /\b(?:notify|notification|notice|inform)\b/i,
  deliver: /\b(?:deliver|delivered|delivery)\b/i,
  renew: /\b(?:renew|renewed|renewal)\b/i,
  terminate: /\b(?:terminate|terminated|termination)\b/i,
  respond: /\b(?:respond|response|reply)\b/i,
  retain: /\b(?:retain|retained|retention|keep)\b/i,
  comply: /\b(?:comply|compliance)\b/i,
};

const REQUIREMENT_ACTION_LANGUAGE: Readonly<Record<DocumentRequirementOperationV1, RegExp>> = {
  accept: /\baccept(?:ed|ing)?\b/i,
  sign: /\bsign(?:ed|ing)?\b/i,
  return: /\b(?:return(?:ed|ing)?|send\s+back)\b/i,
  pay: /\b(?:pay|paid|paying|remit(?:ted|ting)?)\b/i,
  submit: /\b(?:submit(?:ted|ting)?|file|filing|upload(?:ed|ing)?)\b/i,
  provide: /\b(?:provide[ds]?|providing|furnish(?:ed|ing)?|supply|supplied|supplying)\b/i,
  notify: /\b(?:notify|notified|notifying|inform(?:ed|ing)?)\b/i,
  deliver: /\bdeliver(?:ed|ing)?\b/i,
  renew: /\brenew(?:ed|ing)?\b/i,
  terminate: /\bterminate[ds]?|\bterminating\b/i,
  respond: /\b(?:respond(?:ed|ing)?|reply|replied|replying)\b/i,
  retain: /\b(?:retain(?:ed|ing)?|keep|keeping)\b/i,
  comply: /\b(?:comply|complied|complying)\b/i,
};

const POSITIVE_OBLIGATION_LANGUAGE = /\b(?:must|shall|required\s+to|is\s+required|are\s+required|need\s+to|needs\s+to|is\s+obligated|are\s+obligated|agree(?:s)?\s+to|undertake(?:s)?\s+to|responsible\s+for|please)\b/i;
const REQUIREMENT_IMPERATIVE_START: Readonly<Record<DocumentRequirementOperationV1, RegExp>> = {
  accept: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?accept\b/i,
  sign: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?sign\b/i,
  return: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?(?:return|send\s+back)\b/i,
  pay: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?(?:pay|remit)\b/i,
  submit: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?(?:submit|file|upload)\b/i,
  provide: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?(?:provide|furnish|supply)\b/i,
  notify: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?(?:notify|inform)\b/i,
  deliver: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?deliver\b/i,
  renew: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?renew\b/i,
  terminate: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?terminate\b/i,
  respond: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?(?:respond|reply)\b/i,
  retain: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?(?:retain|keep)\b/i,
  comply: /^(?:[-*•]\s*|\d+[.)]\s*)?(?:please\s+)?comply\b/i,
};

function requirementClauses(context: string) {
  return context.split(/\b(?:and|but|or|plus|however|while|whereas)\b|[;,/\n]/gi)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function positiveRequirementSupported(operation: DocumentRequirementOperationV1, context: string) {
  return requirementClauses(context).some((clause) => {
    if (!REQUIREMENT_OPERATION_LANGUAGE[operation].test(clause)) return false;
    if (
      REQUIREMENT_ACTION_LANGUAGE[operation].test(clause)
      && (POSITIVE_OBLIGATION_LANGUAGE.test(clause) || REQUIREMENT_IMPERATIVE_START[operation].test(clause))
    ) return true;
    if (operation === 'pay' && /\bpayment\s+(?:must|shall|is\s+required\s+to|needs\s+to)\s+be\s+(?:made|remitted)\b/i.test(clause)) return true;
    if (operation === 'pay' && /\b(?:payment|amount|balance)\s+(?:is\s+)?due\b|\bdue\s+(?:date|by)\b/i.test(clause)) return true;
    if (operation === 'sign' && /\bsignature\s+(?:is\s+)?required\b/i.test(clause)) return true;
    if (operation === 'respond' && /\bresponse\s+(?:is\s+)?required\b/i.test(clause)) return true;
    return false;
  });
}

function enclosingSourceContext(segment: DocumentAgentSourceSegmentV1, evidence: DocumentEvidenceV1) {
  const before = segment.text.slice(Math.max(0, evidence.span.start - 240), evidence.span.start);
  const after = segment.text.slice(evidence.span.end, Math.min(segment.text.length, evidence.span.end + 240));
  const previousBoundary = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  const followingBoundaries = [after.indexOf('\n'), after.indexOf('.'), after.indexOf('!'), after.indexOf('?')].filter((index) => index >= 0);
  const nextBoundary = followingBoundaries.length > 0 ? Math.min(...followingBoundaries) + 1 : after.length;
  return `${before.slice(previousBoundary + 1)}${evidence.quote}${after.slice(0, nextBoundary)}`.trim();
}

function requirementAt(
  value: unknown,
  path: string,
  issues: Collector,
  segments: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
  revisionId: string,
): ProviderDocumentRequirementV1 | undefined {
  const object = objectAt(value, path, ['operation', 'text', 'due', 'evidence'], issues);
  if (!object) return undefined;
  const operation = enumAt(object.operation, `${path}.operation`, issues, DOCUMENT_REQUIREMENT_OPERATIONS_V1)
    ? object.operation as DocumentRequirementOperationV1 : 'respond';
  const text = stringAt(object.text, `${path}.text`, issues, { maximum: MAX.text, inert: true }) ? object.text : '';
  const evidence = evidenceArrayAt(object.evidence, `${path}.evidence`, issues, segments, revisionId);
  const supportingEvidence = evidence.filter((item) => item.quote.includes(text));
  if (text && supportingEvidence.length === 0) issues.add(`${path}.text`, 'requirement_not_in_evidence', 'Requirement text must be an exact cited substring.');
  if (text && supportingEvidence.length > 0 && supportingEvidence.every((item) => {
    const segment = segments.get(item.segmentId);
    return !segment || UNSAFE_REQUIREMENT_CONTEXT.test(enclosingSourceContext(segment, item));
  })) {
    issues.add(`${path}.evidence`, 'unsafe_requirement_context', 'Negated, optional, proposed, revoked, or conditional language cannot become a definite action.');
  }
  if (text && supportingEvidence.length > 0 && !positiveRequirementSupported(operation, text)) {
    issues.add(`${path}.evidence`, 'requirement_not_source_imposed', 'A document requirement needs positive obligation language matching the selected operation.');
  }
  let due: ProviderDocumentRequirementV1['due'] = null;
  if (object.due !== null) {
    const parsed = valueAt(object.due, `${path}.due`, issues, evidence, segments);
    if (parsed?.kind === 'date' || parsed?.kind === 'duration') due = parsed;
    else issues.add(`${path}.due`, 'invalid_due', 'Requirement due must be a date, duration, or null.');
  }
  return { operation, text, due, evidence: [evidence[0], ...evidence.slice(1)] };
}

function conflictAt(
  value: unknown,
  path: string,
  issues: Collector,
  documentType: DocumentTypeV1,
  segments: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
  revisionId: string,
): ProviderDocumentConflictV1 | undefined {
  const object = objectAt(value, path, ['fieldId', 'group', 'alternatives'], issues);
  if (!object) return undefined;
  const fieldId = enumAt(object.fieldId, `${path}.fieldId`, issues, DOCUMENT_FIELD_IDS_V1) ? object.fieldId : 'document.title';
  const group = groupAt(object.group, `${path}.group`, issues);
  const alternativesInput = arrayAt(object.alternatives, `${path}.alternatives`, issues, 2, MAX.alternatives);
  const alternatives = alternativesInput.flatMap((item, index) => {
    const itemPath = `${path}.alternatives[${index}]`;
    const alternative = objectAt(item, itemPath, ['value', 'evidence'], issues);
    if (!alternative) return [];
    const evidence = evidenceArrayAt(alternative.evidence, `${itemPath}.evidence`, issues, segments, revisionId);
    const parsedValue = valueAt(alternative.value, `${itemPath}.value`, issues, evidence, segments);
    return parsedValue ? [{
      value: parsedValue,
      evidence: [evidence[0], ...evidence.slice(1)] as [DocumentEvidenceV1, ...DocumentEvidenceV1[]],
    }] : [];
  });
  if (!allowedPrefix(documentType, fieldId)) issues.add(`${path}.fieldId`, 'field_document_mismatch', 'Conflict field is not allowed for this document type.');
  if (!compatibleGroup(fieldId, group)) issues.add(`${path}.group`, 'field_group_mismatch', 'Group is incompatible with this field.');
  const keys = new Set(alternatives.map((item) => JSON.stringify(item.value)));
  if (keys.size !== alternatives.length) issues.add(`${path}.alternatives`, 'duplicate_alternative', 'Conflict alternatives must contain distinct values.');
  if (alternatives.some((item) => !compatibleValueKind(fieldId, item.value.kind))) issues.add(`${path}.alternatives`, 'field_value_mismatch', 'Conflict value kind is incompatible with the field.');
  return alternatives.length >= 2
    ? { fieldId, group, alternatives: [alternatives[0], alternatives[1], ...alternatives.slice(2)] }
    : undefined;
}

export function validateProviderDocumentAnalysisV1(
  value: unknown,
  segmentsInput: readonly DocumentAgentSourceSegmentV1[],
): DocumentAgentParseResultV1<ProviderDocumentAnalysisV1> {
  const issues = new Collector();
  const object = objectAt(value, '$', ['kind', 'schemaVersion', 'sourceRevisionId', 'documentType', 'documentTypeEvidence', 'findings', 'requirements', 'conflicts', 'suggestions'], issues);
  if (!object) return { ok: false, success: false, issues: issues.issues };
  literalAt(object.kind, '$.kind', issues, PROVIDER_DOCUMENT_ANALYSIS_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', issues, DOCUMENT_AGENT_SCHEMA_VERSION_V1);
  const sourceRevisionId = idAt(object.sourceRevisionId, '$.sourceRevisionId', issues) ? object.sourceRevisionId : '';
  const documentType = enumAt(object.documentType, '$.documentType', issues, DOCUMENT_TYPES_V1) ? object.documentType : 'other';
  const segments = new Map<string, DocumentAgentSourceSegmentV1>();
  segmentsInput.forEach((segment) => {
    if (segments.has(segment.segmentId)) issues.add('$.segments', 'duplicate_segment', 'Approved source segments must be unique.');
    segments.set(segment.segmentId, segment);
  });
  if (segmentsInput.some((segment) => segment.sourceRevisionId !== sourceRevisionId)) issues.add('$.sourceRevisionId', 'revision_mismatch', 'Analysis revision differs from the approved passages.');
  const documentTypeEvidence = evidenceArrayAt(object.documentTypeEvidence, '$.documentTypeEvidence', issues, segments, sourceRevisionId, documentType === 'other' ? 0 : 1);
  if (documentType === 'other' && documentTypeEvidence.length > 0) issues.add('$.documentTypeEvidence', 'unexpected_evidence', 'Other documents must not claim a proved specific classification.');
  const findings = arrayAt(object.findings, '$.findings', issues, 1, MAX.findings).flatMap((item, index) => {
    const finding = findingAt(item, `$.findings[${index}]`, issues, documentType, segments, sourceRevisionId);
    return finding ? [finding] : [];
  });
  const seenFindingKeys = new Set<string>();
  findings.forEach((finding, index) => {
    const key = `${finding.fieldId}:${finding.group?.kind ?? ''}:${finding.group?.index ?? ''}`;
    if (!REPEATABLE_FINDING_FIELDS.has(finding.fieldId) && seenFindingKeys.has(key)) {
      issues.add(`$.findings[${index}]`, 'duplicate_scalar_finding', 'Repeated scalar fields must be represented as a conflict instead of separate findings.');
    }
    seenFindingKeys.add(key);
  });
  const requirements = arrayAt(object.requirements, '$.requirements', issues, 0, MAX.requirements).flatMap((item, index) => {
    const requirement = requirementAt(item, `$.requirements[${index}]`, issues, segments, sourceRevisionId);
    return requirement ? [requirement] : [];
  });
  if (documentType === 'resume' && requirements.length > 0) issues.add('$.requirements', 'resume_requirement', 'Résumés cannot impose source requirements.');
  const conflicts = arrayAt(object.conflicts, '$.conflicts', issues, 0, MAX.conflicts).flatMap((item, index) => {
    const conflict = conflictAt(item, `$.conflicts[${index}]`, issues, documentType, segments, sourceRevisionId);
    return conflict ? [conflict] : [];
  });
  const findingKeys = new Set(findings.map((finding) => `${finding.fieldId}:${finding.group?.kind ?? ''}:${finding.group?.index ?? ''}`));
  conflicts.forEach((conflict, index) => {
    const key = `${conflict.fieldId}:${conflict.group?.kind ?? ''}:${conflict.group?.index ?? ''}`;
    if (findingKeys.has(key)) issues.add(`$.conflicts[${index}]`, 'conflict_duplicate_finding', 'A conflicted field cannot also be an ordinary finding.');
  });
  const suggestions = arrayAt(object.suggestions, '$.suggestions', issues, 0, MAX.suggestions).flatMap((item, index) => {
    const path = `$.suggestions[${index}]`;
    const suggestion = objectAt(item, path, ['intent', 'basisFindingIndexes'], issues);
    if (!suggestion) return [];
    const intent = enumAt(suggestion.intent, `${path}.intent`, issues, DOCUMENT_SUGGESTION_INTENTS_V1)
      ? suggestion.intent : 'review';
    const basis = arrayAt(suggestion.basisFindingIndexes, `${path}.basisFindingIndexes`, issues, 1, 8).flatMap((basisIndex, basisPosition) => (
      integerAt(basisIndex, `${path}.basisFindingIndexes[${basisPosition}]`, issues, 0, Math.max(0, findings.length - 1))
        ? [basisIndex] : []
    ));
    if (new Set(basis).size !== basis.length) issues.add(`${path}.basisFindingIndexes`, 'duplicate_basis', 'Suggestion basis indexes must be unique.');
    return [{ intent, basisFindingIndexes: [basis[0], ...basis.slice(1)] } as ProviderDocumentSuggestionV1];
  });
  return finish(issues, {
    kind: PROVIDER_DOCUMENT_ANALYSIS_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    sourceRevisionId,
    documentType,
    documentTypeEvidence,
    findings,
    requirements,
    conflicts,
    suggestions,
  } as ProviderDocumentAnalysisV1);
}

function digestAt(value: unknown, path: string, issues: Collector) {
  const object = objectAt(value, path, ['algorithm', 'value'], issues);
  if (!object) return { algorithm: 'sha-256' as const, value: '' };
  literalAt(object.algorithm, `${path}.algorithm`, issues, 'sha-256');
  const digest = stringAt(object.value, `${path}.value`, issues, { minimum: 64, maximum: 64 }) ? object.value : '';
  if (digest && !SHA256.test(digest)) issues.add(`${path}.value`, 'invalid_digest', 'Expected lowercase SHA-256 hexadecimal text.');
  return { algorithm: 'sha-256' as const, value: digest };
}

function targetAt(value: unknown, path: string, issues: Collector) {
  const object = objectAt(value, path, ['provider', 'model', 'recipient'], issues);
  if (!object) return { provider: 'ollama' as ProviderIdV1, model: '', recipient: '' };
  const provider = enumAt(object.provider, `${path}.provider`, issues, PROVIDER_IDS_V1) ? object.provider : 'ollama';
  const model = stringAt(object.model, `${path}.model`, issues, { maximum: 256, inert: true }) ? object.model : '';
  const recipient = stringAt(object.recipient, `${path}.recipient`, issues, { maximum: 512, inert: true }) ? object.recipient : '';
  return { provider, model, recipient };
}

export function parseDocumentAgentPayloadV1(value: unknown): DocumentAgentParseResultV1<DocumentAgentPayloadV1> {
  const issues = new Collector();
  const object = objectAt(value, '$', ['kind', 'schemaVersion', 'promptVersion', 'outputContract', 'requestId', 'consentRecordedAt', 'sourceRevisionId', 'sourceFingerprint', 'providerTarget', 'segments'], issues);
  if (!object) return { ok: false, success: false, issues: issues.issues };
  literalAt(object.kind, '$.kind', issues, DOCUMENT_AGENT_PAYLOAD_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', issues, DOCUMENT_AGENT_SCHEMA_VERSION_V1);
  literalAt(object.promptVersion, '$.promptVersion', issues, DOCUMENT_AGENT_PROMPT_VERSION_V1);
  literalAt(object.outputContract, '$.outputContract', issues, DOCUMENT_AGENT_OUTPUT_CONTRACT_V1);
  const requestId = idAt(object.requestId, '$.requestId', issues) ? object.requestId : '';
  const consentRecordedAt = timestampAt(object.consentRecordedAt, '$.consentRecordedAt', issues) ? object.consentRecordedAt : '';
  const sourceRevisionId = idAt(object.sourceRevisionId, '$.sourceRevisionId', issues) ? object.sourceRevisionId : '';
  const sourceFingerprint = digestAt(object.sourceFingerprint, '$.sourceFingerprint', issues);
  const providerTarget = targetAt(object.providerTarget, '$.providerTarget', issues);
  const segmentInputs = arrayAt(object.segments, '$.segments', issues, 1, MAX.segments);
  let total = 0;
  const seen = new Set<string>();
  const segments = segmentInputs.flatMap((item, index) => {
    const path = `$.segments[${index}]`;
    const segment = objectAt(item, path, ['sourceRevisionId', 'segmentId', 'sequence', 'page', 'text'], issues);
    if (!segment) return [];
    const revision = idAt(segment.sourceRevisionId, `${path}.sourceRevisionId`, issues) ? segment.sourceRevisionId : '';
    const segmentId = idAt(segment.segmentId, `${path}.segmentId`, issues) ? segment.segmentId : '';
    const sequence = integerAt(segment.sequence, `${path}.sequence`, issues, 0, MAX.segments - 1) ? segment.sequence : index;
    const page = integerAt(segment.page, `${path}.page`, issues, 1, 100_000) ? segment.page : 1;
    const text = stringAt(segment.text, `${path}.text`, issues, { maximum: 20_000, nfc: false }) ? segment.text : '';
    total += text.length;
    if (revision !== sourceRevisionId) issues.add(`${path}.sourceRevisionId`, 'revision_mismatch', 'Segment must use the payload revision.');
    if (sequence !== index) issues.add(`${path}.sequence`, 'sequence_mismatch', 'Segments must use canonical consecutive ordering.');
    if (seen.has(segmentId)) issues.add(`${path}.segmentId`, 'duplicate_segment', 'Segment identifiers must be unique.');
    seen.add(segmentId);
    return [{ sourceRevisionId: revision, segmentId, sequence, page, text }];
  });
  if (total > DOCUMENT_AGENT_MAX_TOTAL_SEGMENT_CHARACTERS_V1) issues.add('$.segments', 'payload_too_large', 'Selected passage text exceeds the document-agent limit.');
  return finish(issues, {
    kind: DOCUMENT_AGENT_PAYLOAD_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    promptVersion: DOCUMENT_AGENT_PROMPT_VERSION_V1,
    outputContract: DOCUMENT_AGENT_OUTPUT_CONTRACT_V1,
    requestId,
    consentRecordedAt,
    sourceRevisionId,
    sourceFingerprint,
    providerTarget,
    segments,
  });
}

function consentAt(value: unknown, path: string, issues: Collector): DocumentAgentConsentV1 {
  const object = objectAt(value, path, ['approvedBy', 'recordedAt', 'provider', 'previewDigest', 'previewByteCount'], issues);
  if (!object) return { approvedBy: 'user', recordedAt: '', provider: 'ollama', previewDigest: { algorithm: 'sha-256', value: '' }, previewByteCount: 0 };
  literalAt(object.approvedBy, `${path}.approvedBy`, issues, 'user');
  const recordedAt = timestampAt(object.recordedAt, `${path}.recordedAt`, issues) ? object.recordedAt : '';
  const provider = enumAt(object.provider, `${path}.provider`, issues, PROVIDER_IDS_V1) ? object.provider : 'ollama';
  const previewDigest = digestAt(object.previewDigest, `${path}.previewDigest`, issues);
  const previewByteCount = integerAt(object.previewByteCount, `${path}.previewByteCount`, issues, 1, DOCUMENT_AGENT_MAX_PREVIEW_BYTES_V1)
    ? object.previewByteCount : 0;
  return { approvedBy: 'user', recordedAt, provider, previewDigest, previewByteCount };
}

export function parseDocumentAgentRequestV1(value: unknown): DocumentAgentParseResultV1<DocumentAgentRequestV1> {
  const issues = new Collector();
  const object = objectAt(value, '$', ['kind', 'schemaVersion', 'requestId', 'payload', 'consent'], issues);
  if (!object) return { ok: false, success: false, issues: issues.issues };
  literalAt(object.kind, '$.kind', issues, DOCUMENT_AGENT_REQUEST_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', issues, DOCUMENT_AGENT_SCHEMA_VERSION_V1);
  const requestId = idAt(object.requestId, '$.requestId', issues) ? object.requestId : '';
  const payloadResult = parseDocumentAgentPayloadV1(object.payload);
  if (!payloadResult.ok) payloadResult.issues.forEach((issue) => issues.add(`$.payload${issue.path.slice(1)}`, issue.code, issue.message));
  const consent = consentAt(object.consent, '$.consent', issues);
  const payload = payloadResult.ok ? payloadResult.value : object.payload as DocumentAgentPayloadV1;
  if (payloadResult.ok && payload.requestId !== requestId) issues.add('$.payload.requestId', 'request_mismatch', 'The digest-bound payload request ID must match the outer request.');
  if (payloadResult.ok && payload.consentRecordedAt !== consent.recordedAt) issues.add('$.payload.consentRecordedAt', 'consent_time_mismatch', 'The digest-bound approval time must match consent.');
  return finish(issues, { kind: DOCUMENT_AGENT_REQUEST_KIND_V1, schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1, requestId, payload, consent });
}

function policyAt(value: unknown, path: string, issues: Collector) {
  const object = objectAt(value, path, ['retention', 'trainingUse', 'assertedBy', 'policyUrl'], issues);
  if (!object) return { retention: 'unknown' as const, trainingUse: 'unknown' as const, assertedBy: '', policyUrl: null };
  const retention = enumAt(object.retention, `${path}.retention`, issues, ['provider_policy', 'unknown'] as const) ? object.retention : 'unknown';
  const trainingUse = enumAt(object.trainingUse, `${path}.trainingUse`, issues, ['not_used', 'may_be_used', 'unknown'] as const) ? object.trainingUse : 'unknown';
  const assertedBy = stringAt(object.assertedBy, `${path}.assertedBy`, issues, { maximum: 256, inert: true }) ? object.assertedBy : '';
  let policyUrl: string | null = null;
  if (object.policyUrl !== null) {
    if (stringAt(object.policyUrl, `${path}.policyUrl`, issues, { maximum: 2_048 })) {
      try {
        const parsed = new URL(object.policyUrl);
        if (parsed.protocol !== 'https:') throw new Error('HTTPS required');
        policyUrl = object.policyUrl;
      } catch { issues.add(`${path}.policyUrl`, 'invalid_url', 'Expected an absolute HTTPS URL or null.'); }
    }
  }
  return { retention, trainingUse, assertedBy, policyUrl };
}

function runResultAt(
  value: unknown,
  path: string,
  issues: Collector,
  segments: readonly DocumentAgentSourceSegmentV1[],
): DocumentAgentRunResultV1 {
  if (!isRecord(value)) {
    issues.add(path, 'invalid_type', 'Expected a result object.');
    return { provider: 'ollama', model: 'not-configured', status: 'unavailable', issueCode: 'provider_unavailable', retryable: false };
  }
  const status = value.status;
  const common = objectAt(value, path, status === 'completed'
    ? ['provider', 'model', 'status', 'startedAt', 'completedAt', 'validation', 'analysis']
    : status === 'failed'
      ? ['provider', 'model', 'status', 'startedAt', 'completedAt', 'issueCode', 'retryable']
      : ['provider', 'model', 'status', 'issueCode', 'retryable'], issues)!;
  const provider = enumAt(common.provider, `${path}.provider`, issues, PROVIDER_IDS_V1) ? common.provider : 'ollama';
  const model = stringAt(common.model, `${path}.model`, issues, { maximum: 256, inert: true }) ? common.model : 'not-configured';
  if (status === 'completed') {
    literalAt(common.validation, `${path}.validation`, issues, 'schema_and_source_spans_checked');
    const startedAt = timestampAt(common.startedAt, `${path}.startedAt`, issues) ? common.startedAt : '';
    const completedAt = timestampAt(common.completedAt, `${path}.completedAt`, issues) ? common.completedAt : '';
    if (startedAt && completedAt && Date.parse(completedAt) < Date.parse(startedAt)) issues.add(`${path}.completedAt`, 'invalid_time_order', 'Completion cannot precede the model start.');
    const analysisResult = validateProviderDocumentAnalysisV1(common.analysis, segments);
    if (!analysisResult.ok) analysisResult.issues.forEach((issue) => issues.add(`${path}.analysis${issue.path.slice(1)}`, issue.code, issue.message));
    return { provider, model, status: 'completed', startedAt, completedAt, validation: 'schema_and_source_spans_checked', analysis: analysisResult.ok ? analysisResult.value : common.analysis as ProviderDocumentAnalysisV1 };
  }
  const failureCodes = ['agent_disabled', 'not_configured', 'provider_timeout', 'provider_rejected', 'provider_unavailable', 'network_failure', 'invalid_provider_output', 'internal_error'] as const;
  const issueCode = enumAt(common.issueCode, `${path}.issueCode`, issues, failureCodes) ? common.issueCode : 'internal_error';
  const retryable = typeof common.retryable === 'boolean' ? common.retryable : (issues.add(`${path}.retryable`, 'invalid_type', 'Expected a boolean.'), false);
  if (status === 'failed') {
    const startedAt = timestampAt(common.startedAt, `${path}.startedAt`, issues) ? common.startedAt : '';
    const completedAt = timestampAt(common.completedAt, `${path}.completedAt`, issues) ? common.completedAt : '';
    if (startedAt && completedAt && Date.parse(completedAt) < Date.parse(startedAt)) issues.add(`${path}.completedAt`, 'invalid_time_order', 'Completion cannot precede the model start.');
    return { provider, model, status, startedAt, completedAt, issueCode, retryable };
  }
  if (status !== 'unavailable') issues.add(`${path}.status`, 'invalid_enum', 'Expected completed, failed, or unavailable.');
  const unavailableCode = issueCode === 'agent_disabled' || issueCode === 'not_configured' || issueCode === 'provider_unavailable' ? issueCode : 'provider_unavailable';
  if (unavailableCode !== issueCode) issues.add(`${path}.issueCode`, 'invalid_unavailable_code', 'Unavailable results use a bounded issue code.');
  return { provider, model, status: 'unavailable', issueCode: unavailableCode, retryable };
}

export function parseDocumentAgentResponseV1(
  value: unknown,
  segments: readonly DocumentAgentSourceSegmentV1[],
  expected?: DocumentAgentResponseExpectationV1,
): DocumentAgentParseResultV1<DocumentAgentResponseV1> {
  const issues = new Collector();
  const object = objectAt(value, '$', ['kind', 'schemaVersion', 'requestId', 'result', 'receipt'], issues);
  if (!object) return { ok: false, success: false, issues: issues.issues };
  literalAt(object.kind, '$.kind', issues, DOCUMENT_AGENT_RESPONSE_KIND_V1);
  literalAt(object.schemaVersion, '$.schemaVersion', issues, DOCUMENT_AGENT_SCHEMA_VERSION_V1);
  const requestId = idAt(object.requestId, '$.requestId', issues) ? object.requestId : '';
  const result = runResultAt(object.result, '$.result', issues, segments);
  const receiptObject = objectAt(object.receipt, '$.receipt', ['kind', 'schemaVersion', 'receiptId', 'requestId', 'consent', 'gatewayTransfer', 'transfer'], issues);
  const fallbackConsent: DocumentAgentConsentV1 = { approvedBy: 'user', recordedAt: '', provider: result.provider, previewDigest: { algorithm: 'sha-256', value: '' }, previewByteCount: 0 };
  let receipt: DocumentAgentReceiptV1 = {
    kind: DOCUMENT_AGENT_RECEIPT_KIND_V1,
    schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
    receiptId: '', requestId, consent: fallbackConsent,
    gatewayTransfer: { recipient: 'PaperWork model gateway', status: 'not_sent', startedAt: null, completedAt: null, payloadDigest: fallbackConsent.previewDigest, payloadByteCount: 0 },
    transfer: { provider: result.provider, model: result.model, recipient: '', channel: 'browser_to_provider', status: 'not_sent', startedAt: null, completedAt: null, payloadDigest: fallbackConsent.previewDigest, payloadByteCount: 0, providerPolicy: { retention: 'unknown', trainingUse: 'unknown', assertedBy: '', policyUrl: null } },
  };
  if (receiptObject) {
    literalAt(receiptObject.kind, '$.receipt.kind', issues, DOCUMENT_AGENT_RECEIPT_KIND_V1);
    literalAt(receiptObject.schemaVersion, '$.receipt.schemaVersion', issues, DOCUMENT_AGENT_SCHEMA_VERSION_V1);
    const receiptId = idAt(receiptObject.receiptId, '$.receipt.receiptId', issues) ? receiptObject.receiptId : '';
    const receiptRequestId = idAt(receiptObject.requestId, '$.receipt.requestId', issues) ? receiptObject.requestId : '';
    const consent = consentAt(receiptObject.consent, '$.receipt.consent', issues);
    const gateway = objectAt(receiptObject.gatewayTransfer, '$.receipt.gatewayTransfer', ['recipient', 'status', 'startedAt', 'completedAt', 'payloadDigest', 'payloadByteCount'], issues);
    const gatewayStatus = gateway && enumAt(gateway.status, '$.receipt.gatewayTransfer.status', issues, ['completed', 'failed', 'not_sent'] as const) ? gateway.status : 'not_sent';
    if (gateway) literalAt(gateway.recipient, '$.receipt.gatewayTransfer.recipient', issues, 'PaperWork model gateway');
    const gatewayStartedAt = gateway?.startedAt === null ? null : gateway && timestampAt(gateway.startedAt, '$.receipt.gatewayTransfer.startedAt', issues) ? gateway.startedAt : null;
    const gatewayCompletedAt = gateway?.completedAt === null ? null : gateway && timestampAt(gateway.completedAt, '$.receipt.gatewayTransfer.completedAt', issues) ? gateway.completedAt : null;
    const gatewayDigest = gateway ? digestAt(gateway.payloadDigest, '$.receipt.gatewayTransfer.payloadDigest', issues) : consent.previewDigest;
    const gatewayBytes = gateway && integerAt(gateway.payloadByteCount, '$.receipt.gatewayTransfer.payloadByteCount', issues, 1, DOCUMENT_AGENT_MAX_PREVIEW_BYTES_V1) ? gateway.payloadByteCount : 0;
    const transferObject = objectAt(receiptObject.transfer, '$.receipt.transfer', ['provider', 'model', 'recipient', 'channel', 'status', 'startedAt', 'completedAt', 'payloadDigest', 'payloadByteCount', 'providerPolicy'], issues);
    const transferProvider = transferObject && enumAt(transferObject.provider, '$.receipt.transfer.provider', issues, PROVIDER_IDS_V1) ? transferObject.provider : result.provider;
    const transferModel = transferObject && stringAt(transferObject.model, '$.receipt.transfer.model', issues, { maximum: 256, inert: true }) ? transferObject.model : result.model;
    const transferRecipient = transferObject && stringAt(transferObject.recipient, '$.receipt.transfer.recipient', issues, { maximum: 512, inert: true }) ? transferObject.recipient : '';
    const channel = transferObject && enumAt(transferObject.channel, '$.receipt.transfer.channel', issues, ['gateway_to_provider', 'browser_to_provider'] as const) ? transferObject.channel : 'browser_to_provider';
    const transferStatus = transferObject && enumAt(transferObject.status, '$.receipt.transfer.status', issues, ['completed', 'failed', 'not_sent'] as const) ? transferObject.status : 'not_sent';
    const transferStartedAt = transferObject?.startedAt === null ? null : transferObject && timestampAt(transferObject.startedAt, '$.receipt.transfer.startedAt', issues) ? transferObject.startedAt : null;
    const transferCompletedAt = transferObject?.completedAt === null ? null : transferObject && timestampAt(transferObject.completedAt, '$.receipt.transfer.completedAt', issues) ? transferObject.completedAt : null;
    const transferDigest = transferObject ? digestAt(transferObject.payloadDigest, '$.receipt.transfer.payloadDigest', issues) : consent.previewDigest;
    const transferBytes = transferObject && integerAt(transferObject.payloadByteCount, '$.receipt.transfer.payloadByteCount', issues, 1, DOCUMENT_AGENT_MAX_PREVIEW_BYTES_V1) ? transferObject.payloadByteCount : 0;
    const providerPolicy = transferObject ? policyAt(transferObject.providerPolicy, '$.receipt.transfer.providerPolicy', issues) : { retention: 'unknown' as const, trainingUse: 'unknown' as const, assertedBy: '', policyUrl: null };
    receipt = {
      kind: DOCUMENT_AGENT_RECEIPT_KIND_V1,
      schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1,
      receiptId,
      requestId: receiptRequestId,
      consent,
      gatewayTransfer: { recipient: 'PaperWork model gateway', status: gatewayStatus, startedAt: gatewayStartedAt, completedAt: gatewayCompletedAt, payloadDigest: gatewayDigest, payloadByteCount: gatewayBytes },
      transfer: { provider: transferProvider, model: transferModel, recipient: transferRecipient, channel, status: transferStatus, startedAt: transferStartedAt, completedAt: transferCompletedAt, payloadDigest: transferDigest, payloadByteCount: transferBytes, providerPolicy },
    };
  }
  if (receipt.requestId !== requestId) issues.add('$.receipt.requestId', 'request_mismatch', 'Receipt must identify this response request.');
  if (receipt.consent.provider !== result.provider || receipt.transfer.provider !== result.provider) issues.add('$.receipt.transfer.provider', 'provider_mismatch', 'Result, consent, and transfer providers must match.');
  if (receipt.transfer.model !== result.model) issues.add('$.receipt.transfer.model', 'model_mismatch', 'Result and transfer models must match.');
  if (receipt.gatewayTransfer.payloadDigest.value !== receipt.consent.previewDigest.value || receipt.transfer.payloadDigest.value !== receipt.consent.previewDigest.value) issues.add('$.receipt', 'digest_mismatch', 'Every receipt hop must use the consented digest.');
  if (receipt.gatewayTransfer.payloadByteCount !== receipt.consent.previewByteCount || receipt.transfer.payloadByteCount !== receipt.consent.previewByteCount) issues.add('$.receipt', 'byte_count_mismatch', 'Every receipt hop must use the consented payload size.');
  const gatewayHasTimes = receipt.gatewayTransfer.startedAt !== null && receipt.gatewayTransfer.completedAt !== null;
  const transferHasTimes = receipt.transfer.startedAt !== null && receipt.transfer.completedAt !== null;
  if ((receipt.gatewayTransfer.status === 'not_sent' && gatewayHasTimes)
      || (receipt.gatewayTransfer.status !== 'not_sent' && !gatewayHasTimes)) {
    issues.add('$.receipt.gatewayTransfer', 'status_time_mismatch', 'Gateway status and timestamps must describe the same observed event.');
  }
  if ((receipt.transfer.status === 'not_sent' && transferHasTimes)
      || (receipt.transfer.status !== 'not_sent' && !transferHasTimes)) {
    issues.add('$.receipt.transfer', 'status_time_mismatch', 'Provider status and timestamps must describe the same observed event.');
  }
  if (receipt.gatewayTransfer.startedAt && receipt.gatewayTransfer.completedAt
      && Date.parse(receipt.gatewayTransfer.completedAt) < Date.parse(receipt.gatewayTransfer.startedAt)) {
    issues.add('$.receipt.gatewayTransfer.completedAt', 'invalid_time_order', 'Gateway completion cannot precede its start.');
  }
  if (receipt.transfer.startedAt && receipt.transfer.completedAt
      && Date.parse(receipt.transfer.completedAt) < Date.parse(receipt.transfer.startedAt)) {
    issues.add('$.receipt.transfer.completedAt', 'invalid_time_order', 'Provider completion cannot precede its start.');
  }
  const expectedTransferStatus = result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'not_sent';
  if (receipt.transfer.status !== expectedTransferStatus) issues.add('$.receipt.transfer.status', 'result_status_mismatch', 'Provider transfer status must match the model run result.');
  if (result.status === 'unavailable') {
    if (transferHasTimes) issues.add('$.receipt.transfer', 'unavailable_has_transfer', 'An unavailable model cannot have provider transfer timestamps.');
  } else if (receipt.transfer.startedAt !== result.startedAt || receipt.transfer.completedAt !== result.completedAt) {
    issues.add('$.receipt.transfer', 'result_time_mismatch', 'Provider receipt timestamps must exactly match the model result.');
  }
  if (result.provider === 'ollama') {
    if (receipt.gatewayTransfer.status !== 'not_sent' || gatewayHasTimes || receipt.transfer.channel !== 'browser_to_provider') issues.add('$.receipt', 'invalid_transport', 'Ollama must be browser-direct with no gateway transfer.');
  } else if (receipt.transfer.channel !== 'gateway_to_provider' || receipt.gatewayTransfer.status !== 'completed' || !gatewayHasTimes) {
    issues.add('$.receipt', 'invalid_transport', 'Hosted providers must use the PaperWork gateway.');
  }
  if (expected) {
    if (requestId !== expected.requestId) issues.add('$.requestId', 'request_mismatch', 'Response request ID changed.');
    if (receipt.consent.previewDigest.value !== expected.previewDigest.value || receipt.consent.previewByteCount !== expected.previewByteCount) issues.add('$.receipt.consent', 'preview_mismatch', 'Response receipt does not match the approved preview.');
    if (result.provider !== expected.providerTarget.provider || result.model !== expected.providerTarget.model || receipt.transfer.recipient !== expected.providerTarget.recipient) issues.add('$.receipt.transfer', 'target_mismatch', 'Response target differs from the approved provider target.');
  }
  return finish(issues, { kind: DOCUMENT_AGENT_RESPONSE_KIND_V1, schemaVersion: DOCUMENT_AGENT_SCHEMA_VERSION_V1, requestId, result, receipt });
}
