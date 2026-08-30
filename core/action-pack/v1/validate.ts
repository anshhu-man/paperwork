import {
  ACTION_PACK_KIND_V1,
  ACTION_PACK_SCHEMA_VERSION_V1,
  MODEL_DRAFT_KIND_V1,
  VALIDATED_ANALYSIS_KIND_V1,
  type ActionPackV1,
  type CanonicalSourceContextV1,
  type ClaimDraftV1,
  type ModelDraftV1,
  type SourceDescriptorV1,
  type SourceRevisionV1,
  type SourceSegmentV1,
  type StructurallyValidActionPackV1,
  type ValidatedActionV1,
  type ValidatedAnalysisV1,
  type ValidatedClaimV1,
} from './contracts';

export interface ContractIssueV1 {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ContractParseResultV1<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ContractIssueV1[] };

type UnknownRecord = Record<string, unknown>;

interface CanonicalIndexV1 {
  readonly sources: Map<string, SourceDescriptorV1>;
  readonly revisions: Map<string, SourceRevisionV1>;
  readonly segments: Map<string, SourceSegmentV1>;
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const TOKEN_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ACTIVE_MARKUP_PATTERN = /<\s*\/?\s*[a-z!][^>]*>|javascript\s*:|\bon[a-z]+\s*=/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const MAX = {
  actions: 200,
  claims: 500,
  corrections: 500,
  events: 1_000,
  evidencePerClaim: 50,
  externalReferences: 100,
  questions: 100,
  receiptRecords: 1_000,
  revisions: 100,
  segments: 10_000,
  sources: 20,
  string: 20_000,
} as const;

class IssueCollector {
  readonly issues: ContractIssueV1[] = [];

  add(path: string, code: string, message: string) {
    this.issues.push({ path, code, message });
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      collector.add(`${path}.${key}`, 'unknown_field', 'Unknown fields are rejected.');
    }
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
  if (value.length < minimum) {
    collector.add(path, 'too_few_items', `Expected at least ${minimum} item(s).`);
  }
  if (value.length > maximum) {
    collector.add(path, 'too_many_items', `Expected no more than ${maximum} item(s).`);
  }
  return value;
}

function stringAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  options: { minimum?: number; maximum?: number; plainText?: boolean } = {},
): value is string {
  if (typeof value !== 'string') {
    collector.add(path, 'invalid_type', 'Expected a string.');
    return false;
  }
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? MAX.string;
  if (value.length < minimum) collector.add(path, 'string_too_short', `Expected at least ${minimum} character(s).`);
  if (value.length > maximum) collector.add(path, 'string_too_long', `Expected no more than ${maximum} character(s).`);
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    collector.add(path, 'control_character', 'Control characters are not allowed.');
  }
  if (options.plainText && ACTIVE_MARKUP_PATTERN.test(value)) {
    collector.add(path, 'active_content', 'Content must be inert plain text, not markup or executable content.');
  }
  return true;
}

function idAt(value: unknown, path: string, collector: IssueCollector): value is string {
  if (!stringAt(value, path, collector, { maximum: 128 })) return false;
  if (!ID_PATTERN.test(value)) collector.add(path, 'invalid_id', 'Expected a stable identifier.');
  return true;
}

function tokenAt(value: unknown, path: string, collector: IssueCollector): value is string {
  if (!stringAt(value, path, collector, { maximum: 128 })) return false;
  if (!TOKEN_PATTERN.test(value)) collector.add(path, 'invalid_token', 'Expected a lowercase machine-readable token.');
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
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
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

function finiteNumberAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  minimum: number,
  maximum: number,
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    collector.add(path, 'invalid_number', 'Expected a finite number.');
    return false;
  }
  if (value < minimum || value > maximum) {
    collector.add(path, 'number_out_of_range', `Expected a value from ${minimum} to ${maximum}.`);
  }
  return true;
}

function timestampAt(value: unknown, path: string, collector: IssueCollector): value is string {
  if (!stringAt(value, path, collector, { maximum: 64 })) return false;
  if (!Number.isFinite(Date.parse(value)) || !value.includes('T')) {
    collector.add(path, 'invalid_timestamp', 'Expected an ISO 8601 date-time.');
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

function urlAt(value: unknown, path: string, collector: IssueCollector): value is string {
  if (!stringAt(value, path, collector, { maximum: 2_048 })) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported scheme');
    if (url.username || url.password) collector.add(path, 'url_credentials', 'URLs must not contain credentials.');
  } catch {
    collector.add(path, 'invalid_url', 'Expected an absolute HTTP or HTTPS URL.');
  }
  return true;
}

function digestAt(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['algorithm', 'value'], collector);
  if (!object) return;
  literalAt(object.algorithm, `${path}.algorithm`, collector, 'sha-256');
  if (stringAt(object.value, `${path}.value`, collector, { minimum: 64, maximum: 64 }) && !SHA_256_PATTERN.test(object.value)) {
    collector.add(`${path}.value`, 'invalid_digest', 'Expected a lowercase SHA-256 hex digest.');
  }
}

function stringArrayAt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  options: { minimum?: number; maximum?: number; ids?: boolean; tokens?: boolean; plainText?: boolean } = {},
): readonly string[] {
  const array = arrayAt(value, path, collector, options.minimum ?? 0, options.maximum ?? MAX.string) ?? [];
  const strings: string[] = [];
  array.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const valid = options.ids
      ? idAt(item, itemPath, collector)
      : options.tokens
        ? tokenAt(item, itemPath, collector)
        : stringAt(item, itemPath, collector, { maximum: 2_000, plainText: options.plainText });
    if (valid && typeof item === 'string') strings.push(item);
  });
  validateUnique(strings, path, collector);
  return strings;
}

function validateUnique(values: readonly string[], path: string, collector: IssueCollector) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) collector.add(`${path}[${index}]`, 'duplicate_id', `Duplicate value ${JSON.stringify(value)}.`);
    seen.add(value);
  });
}

function validateSourceOrigin(value: unknown, path: string, collector: IssueCollector) {
  if (!isRecord(value)) {
    collector.add(path, 'invalid_type', 'Expected a source origin object.');
    return;
  }
  switch (value.kind) {
    case 'upload':
    case 'camera':
    case 'paste': {
      objectAt(value, path, ['kind'], collector);
      break;
    }
    case 'url': {
      const object = objectAt(value, path, ['kind', 'url'], collector);
      if (object) urlAt(object.url, `${path}.url`, collector);
      break;
    }
    case 'sample': {
      const object = objectAt(value, path, ['kind', 'fixtureId'], collector);
      if (object) idAt(object.fixtureId, `${path}.fixtureId`, collector);
      break;
    }
    default:
      objectAt(value, path, ['kind'], collector);
      enumAt(value.kind, `${path}.kind`, collector, ['upload', 'camera', 'url', 'paste', 'sample'] as const);
  }
}

function validateSourceDescriptor(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'displayName', 'kind', 'mediaType', 'byteSize', 'pageCount', 'origin'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  stringAt(object.displayName, `${path}.displayName`, collector, { maximum: 255, plainText: true });
  enumAt(object.kind, `${path}.kind`, collector, ['file', 'image', 'url', 'text'] as const);
  if (stringAt(object.mediaType, `${path}.mediaType`, collector, { maximum: 127 }) && !MEDIA_TYPE_PATTERN.test(object.mediaType)) {
    collector.add(`${path}.mediaType`, 'invalid_media_type', 'Expected an Internet media type.');
  }
  if ('byteSize' in object) integerAt(object.byteSize, `${path}.byteSize`, collector, 0);
  if ('pageCount' in object) integerAt(object.pageCount, `${path}.pageCount`, collector, 1, 100_000);
  validateSourceOrigin(object.origin, `${path}.origin`, collector);
  if (object.kind === 'url' && isRecord(object.origin) && object.origin.kind !== 'url') {
    collector.add(`${path}.origin.kind`, 'origin_mismatch', 'URL sources require a URL origin.');
  }
}

function validateSourceRevision(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'sourceId', 'fingerprint', 'createdAt', 'status', 'supersedesRevisionId'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  idAt(object.sourceId, `${path}.sourceId`, collector);
  digestAt(object.fingerprint, `${path}.fingerprint`, collector);
  timestampAt(object.createdAt, `${path}.createdAt`, collector);
  enumAt(object.status, `${path}.status`, collector, ['active', 'superseded'] as const);
  if ('supersedesRevisionId' in object) idAt(object.supersedesRevisionId, `${path}.supersedesRevisionId`, collector);
}

function validateRegion(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['unit', 'x', 'y', 'width', 'height'], collector);
  if (!object) return;
  literalAt(object.unit, `${path}.unit`, collector, 'normalized');
  finiteNumberAt(object.x, `${path}.x`, collector, 0, 1);
  finiteNumberAt(object.y, `${path}.y`, collector, 0, 1);
  finiteNumberAt(object.width, `${path}.width`, collector, Number.EPSILON, 1);
  finiteNumberAt(object.height, `${path}.height`, collector, Number.EPSILON, 1);
  if (typeof object.x === 'number' && typeof object.width === 'number' && object.x + object.width > 1) {
    collector.add(path, 'region_out_of_bounds', 'Region width extends beyond the normalized page.');
  }
  if (typeof object.y === 'number' && typeof object.height === 'number' && object.y + object.height > 1) {
    collector.add(path, 'region_out_of_bounds', 'Region height extends beyond the normalized page.');
  }
}

function validateAnchor(value: unknown, path: string, collector: IssueCollector) {
  if (!isRecord(value)) {
    collector.add(path, 'invalid_type', 'Expected an anchor object.');
    return;
  }
  switch (value.kind) {
    case 'page_text': {
      const object = objectAt(value, path, ['kind', 'page', 'block'], collector);
      if (object) {
        integerAt(object.page, `${path}.page`, collector, 1, 100_000);
        integerAt(object.block, `${path}.block`, collector, 0);
      }
      break;
    }
    case 'page_region': {
      const object = objectAt(value, path, ['kind', 'page', 'region'], collector);
      if (object) {
        integerAt(object.page, `${path}.page`, collector, 1, 100_000);
        validateRegion(object.region, `${path}.region`, collector);
      }
      break;
    }
    case 'plain_text': {
      const object = objectAt(value, path, ['kind', 'characterStart', 'characterEnd'], collector);
      if (object) {
        integerAt(object.characterStart, `${path}.characterStart`, collector, 0);
        integerAt(object.characterEnd, `${path}.characterEnd`, collector, 1);
        if (typeof object.characterStart === 'number' && typeof object.characterEnd === 'number' && object.characterStart >= object.characterEnd) {
          collector.add(path, 'invalid_span', 'Plain-text anchor start must be before end.');
        }
      }
      break;
    }
    case 'web': {
      const object = objectAt(value, path, ['kind', 'url', 'selector'], collector);
      if (object) {
        urlAt(object.url, `${path}.url`, collector);
        if ('selector' in object) stringAt(object.selector, `${path}.selector`, collector, { maximum: 1_000, plainText: true });
      }
      break;
    }
    default:
      objectAt(value, path, ['kind'], collector);
      enumAt(value.kind, `${path}.kind`, collector, ['page_text', 'page_region', 'plain_text', 'web'] as const);
  }
}

function validateExtraction(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['method', 'engine', 'version', 'extractedAt'], collector);
  if (!object) return;
  enumAt(object.method, `${path}.method`, collector, ['native_text', 'ocr', 'web', 'manual', 'sample'] as const);
  stringAt(object.engine, `${path}.engine`, collector, { maximum: 128, plainText: true });
  stringAt(object.version, `${path}.version`, collector, { maximum: 128, plainText: true });
  timestampAt(object.extractedAt, `${path}.extractedAt`, collector);
}

function validateSourceSegment(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'sourceId', 'sourceRevisionId', 'index', 'text', 'anchor', 'extraction'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  idAt(object.sourceId, `${path}.sourceId`, collector);
  idAt(object.sourceRevisionId, `${path}.sourceRevisionId`, collector);
  integerAt(object.index, `${path}.index`, collector, 0);
  // Canonical source text is untrusted evidence, not executable UI content.
  // Preserve it exactly and rely on renderers to escape it.
  stringAt(object.text, `${path}.text`, collector, { maximum: 200_000 });
  validateAnchor(object.anchor, `${path}.anchor`, collector);
  validateExtraction(object.extraction, `${path}.extraction`, collector);
}

function mapById<T extends { readonly id: string }>(
  values: readonly T[],
  path: string,
  collector: IssueCollector,
): Map<string, T> {
  const map = new Map<string, T>();
  values.forEach((value, index) => {
    if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) return;
    if (map.has(value.id)) collector.add(`${path}[${index}].id`, 'duplicate_id', `Duplicate identifier ${JSON.stringify(value.id)}.`);
    else map.set(value.id, value);
  });
  return map;
}

function validateCanonicalContext(
  value: unknown,
  path: string,
  collector: IssueCollector,
): CanonicalIndexV1 | undefined {
  const object = objectAt(value, path, ['sources', 'sourceRevisions', 'sourceSegments'], collector);
  if (!object) return undefined;
  const rawSources = arrayAt(object.sources, `${path}.sources`, collector, 1, MAX.sources) ?? [];
  const rawRevisions = arrayAt(object.sourceRevisions, `${path}.sourceRevisions`, collector, 1, MAX.revisions) ?? [];
  const rawSegments = arrayAt(object.sourceSegments, `${path}.sourceSegments`, collector, 1, MAX.segments) ?? [];
  rawSources.forEach((item, index) => validateSourceDescriptor(item, `${path}.sources[${index}]`, collector));
  rawRevisions.forEach((item, index) => validateSourceRevision(item, `${path}.sourceRevisions[${index}]`, collector));
  rawSegments.forEach((item, index) => validateSourceSegment(item, `${path}.sourceSegments[${index}]`, collector));

  const sources = mapById(rawSources.filter(isRecord) as unknown as SourceDescriptorV1[], `${path}.sources`, collector);
  const revisions = mapById(rawRevisions.filter(isRecord) as unknown as SourceRevisionV1[], `${path}.sourceRevisions`, collector);
  const segments = mapById(rawSegments.filter(isRecord) as unknown as SourceSegmentV1[], `${path}.sourceSegments`, collector);

  for (const [revisionId, revision] of revisions) {
    if (!sources.has(revision.sourceId)) {
      collector.add(`${path}.sourceRevisions`, 'dangling_source', `Revision ${revisionId} references an unknown source.`);
    }
    if (revision.supersedesRevisionId) {
      const prior = revisions.get(revision.supersedesRevisionId);
      if (!prior) collector.add(`${path}.sourceRevisions`, 'dangling_revision', `Revision ${revisionId} supersedes an unknown revision.`);
      else if (prior.sourceId !== revision.sourceId) collector.add(`${path}.sourceRevisions`, 'revision_source_mismatch', 'A revision may only supersede a revision of the same source.');
      if (revision.supersedesRevisionId === revisionId) collector.add(`${path}.sourceRevisions`, 'revision_cycle', 'A revision cannot supersede itself.');
    }
  }

  const segmentIndexes = new Set<string>();
  for (const [segmentId, segment] of segments) {
    const source = sources.get(segment.sourceId);
    const revision = revisions.get(segment.sourceRevisionId);
    const anchor = isRecord(segment.anchor) ? segment.anchor : undefined;
    const extraction = isRecord(segment.extraction) ? segment.extraction : undefined;
    if (!source) collector.add(`${path}.sourceSegments`, 'dangling_source', `Segment ${segmentId} references an unknown source.`);
    if (!revision) collector.add(`${path}.sourceSegments`, 'dangling_revision', `Segment ${segmentId} references an unknown revision.`);
    else if (revision.sourceId !== segment.sourceId) collector.add(`${path}.sourceSegments`, 'segment_revision_mismatch', `Segment ${segmentId} does not match its revision source.`);
    const indexKey = `${segment.sourceRevisionId}:${segment.index}`;
    if (segmentIndexes.has(indexKey)) collector.add(`${path}.sourceSegments`, 'duplicate_segment_index', `Duplicate segment index ${segment.index} in revision ${segment.sourceRevisionId}.`);
    segmentIndexes.add(indexKey);

    if (
      typeof source?.pageCount === 'number'
      && anchor
      && (anchor.kind === 'page_text' || anchor.kind === 'page_region')
      && typeof anchor.page === 'number'
      && anchor.page > source.pageCount
    ) {
      collector.add(`${path}.sourceSegments`, 'page_out_of_bounds', `Segment ${segmentId} references page ${anchor.page}, beyond the source page count.`);
    }
    if (extraction?.method === 'ocr' && anchor?.kind !== 'page_region') {
      collector.add(`${path}.sourceSegments`, 'ocr_region_required', `OCR segment ${segmentId} must preserve a page-region anchor.`);
    }
  }

  return { sources, revisions, segments };
}

function validateEvidenceRef(
  value: unknown,
  path: string,
  collector: IssueCollector,
  canonical: CanonicalIndexV1,
  allowedRevisionIds: ReadonlySet<string>,
) {
  const object = objectAt(value, path, ['sourceId', 'sourceRevisionId', 'segmentId', 'quote', 'span'], collector);
  if (!object) return;
  const sourceValid = idAt(object.sourceId, `${path}.sourceId`, collector);
  const revisionValid = idAt(object.sourceRevisionId, `${path}.sourceRevisionId`, collector);
  const segmentValid = idAt(object.segmentId, `${path}.segmentId`, collector);
  // Evidence quotes may faithfully contain markup-like source text. They are
  // data and must be escaped by the UI, not rewritten by the contract parser.
  const quoteValid = stringAt(object.quote, `${path}.quote`, collector, { maximum: 8_000 });
  const span = objectAt(object.span, `${path}.span`, ['start', 'end'], collector);
  const startValid = span ? integerAt(span.start, `${path}.span.start`, collector, 0) : false;
  const endValid = span ? integerAt(span.end, `${path}.span.end`, collector, 1) : false;
  if (span && startValid && endValid && (span.start as number) >= (span.end as number)) {
    collector.add(`${path}.span`, 'invalid_span', 'Evidence start must be before end.');
  }
  if (!sourceValid || !revisionValid || !segmentValid) return;

  const sourceId = object.sourceId as string;
  const revisionId = object.sourceRevisionId as string;
  const segmentId = object.segmentId as string;
  const segment = canonical.segments.get(segmentId);
  const revision = canonical.revisions.get(revisionId);
  if (!canonical.sources.has(sourceId)) collector.add(`${path}.sourceId`, 'dangling_source', 'Evidence references an unknown source.');
  if (!revision) collector.add(`${path}.sourceRevisionId`, 'dangling_revision', 'Evidence references an unknown source revision.');
  if (!allowedRevisionIds.has(revisionId)) collector.add(`${path}.sourceRevisionId`, 'revision_not_analyzed', 'Evidence must use a revision included in this analysis.');
  if (!segment) collector.add(`${path}.segmentId`, 'dangling_segment', 'Evidence references an unknown source segment.');
  if (revision && revision.status !== 'active') collector.add(`${path}.sourceRevisionId`, 'stale_revision', 'Renderable evidence cannot use a superseded source revision.');
  if (segment) {
    if (segment.sourceId !== sourceId || segment.sourceRevisionId !== revisionId) {
      collector.add(path, 'evidence_source_mismatch', 'Evidence source, revision, and segment must describe the same canonical content.');
    }
    const extraction = isRecord(segment.extraction) ? segment.extraction : undefined;
    const anchor = isRecord(segment.anchor) ? segment.anchor : undefined;
    if (extraction?.method === 'ocr' && anchor?.kind !== 'page_region') {
      collector.add(path, 'ocr_region_required', 'OCR evidence must retain its source image region.');
    }
    if (quoteValid && span && startValid && endValid && typeof segment.text === 'string') {
      const start = span.start as number;
      const end = span.end as number;
      if (end > segment.text.length) collector.add(`${path}.span.end`, 'span_out_of_bounds', 'Evidence span extends beyond the canonical segment.');
      else if (segment.text.slice(start, end) !== object.quote) collector.add(`${path}.quote`, 'quote_mismatch', 'Evidence quote must exactly match the canonical segment at the declared UTF-16 offsets.');
    }
  }
}

function validateEvidenceArray(
  value: unknown,
  path: string,
  collector: IssueCollector,
  canonical: CanonicalIndexV1,
  allowedRevisionIds: ReadonlySet<string>,
  minimum: number,
): readonly UnknownRecord[] {
  const array = arrayAt(value, path, collector, minimum, MAX.evidencePerClaim) ?? [];
  array.forEach((item, index) => validateEvidenceRef(item, `${path}[${index}]`, collector, canonical, allowedRevisionIds));
  return array.filter(isRecord);
}

function validateNormalizedValues(value: unknown, path: string, collector: IssueCollector): readonly UnknownRecord[] {
  const values = arrayAt(value, path, collector, 0, 100) ?? [];
  values.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      collector.add(itemPath, 'invalid_type', 'Expected a normalized claim value object.');
      return;
    }
    switch (item.kind) {
      case 'date': {
        const object = objectAt(item, itemPath, ['kind', 'value'], collector);
        if (object) calendarDateAt(object.value, `${itemPath}.value`, collector);
        break;
      }
      case 'money': {
        const object = objectAt(item, itemPath, ['kind', 'amount', 'currency', 'basis'], collector);
        if (!object) break;
        if (stringAt(object.amount, `${itemPath}.amount`, collector, { maximum: 100 }) && !DECIMAL_AMOUNT_PATTERN.test(object.amount)) {
          collector.add(`${itemPath}.amount`, 'invalid_decimal_amount', 'Expected a non-negative base-10 amount without grouping separators.');
        }
        if (stringAt(object.currency, `${itemPath}.currency`, collector, { minimum: 3, maximum: 3 }) && !CURRENCY_PATTERN.test(object.currency)) {
          collector.add(`${itemPath}.currency`, 'invalid_currency', 'Expected a three-letter uppercase ISO 4217 currency code.');
        }
        if ('basis' in object) enumAt(object.basis, `${itemPath}.basis`, collector, ['annual', 'monthly', 'weekly', 'daily', 'one_time'] as const);
        break;
      }
      case 'duration': {
        const object = objectAt(item, itemPath, ['kind', 'value', 'unit'], collector);
        if (object) {
          finiteNumberAt(object.value, `${itemPath}.value`, collector, Number.EPSILON, 1_000_000);
          enumAt(object.unit, `${itemPath}.unit`, collector, ['day', 'week', 'month', 'year'] as const);
        }
        break;
      }
      default:
        objectAt(item, itemPath, ['kind'], collector);
        enumAt(item.kind, `${itemPath}.kind`, collector, ['date', 'money', 'duration'] as const);
    }
  });
  return values.filter(isRecord);
}

function validateClaimValidation(value: unknown, path: string, collector: IssueCollector, provenance: unknown) {
  const object = objectAt(value, path, ['state', 'validatorVersion', 'validatedAt', 'issueCodes', 'checks'], collector);
  if (!object) return;
  const stateValid = enumAt(object.state, `${path}.state`, collector, ['accepted', 'needs_review', 'blocked', 'stale'] as const);
  stringAt(object.validatorVersion, `${path}.validatorVersion`, collector, { maximum: 128, plainText: true });
  timestampAt(object.validatedAt, `${path}.validatedAt`, collector);
  const issueCodes = stringArrayAt(object.issueCodes, `${path}.issueCodes`, collector, { maximum: 100, tokens: true });
  const checks = objectAt(object.checks, `${path}.checks`, ['citation', 'semanticSupport'], collector);
  if (checks) {
    enumAt(checks.citation, `${path}.checks.citation`, collector, ['passed', 'failed', 'not_applicable'] as const);
    enumAt(checks.semanticSupport, `${path}.checks.semanticSupport`, collector, ['supported', 'partial', 'unsupported', 'not_applicable'] as const);
  }
  if (stateValid && object.state === 'accepted' && issueCodes.length > 0) {
    collector.add(`${path}.issueCodes`, 'accepted_with_issues', 'Accepted claims cannot retain validation issue codes.');
  }
  if (stateValid && ['needs_review', 'blocked', 'stale'].includes(object.state as string) && issueCodes.length === 0) {
    collector.add(`${path}.issueCodes`, 'missing_issue_code', 'Non-accepted claims require at least one machine-readable issue code.');
  }
  if (['not_confirmed', 'conflict'].includes(provenance as string) && object.state === 'accepted') {
    collector.add(`${path}.state`, 'unsupported_state', 'Not-confirmed and unresolved conflict claims cannot be marked accepted.');
  }
  if (stateValid && object.state === 'accepted' && checks) {
    if (['source_fact', 'inference', 'conflict'].includes(provenance as string) && checks.citation !== 'passed') {
      collector.add(`${path}.checks.citation`, 'accepted_without_citation_check', 'Accepted evidence-backed claims require a passed citation check.');
    }
    if (['source_fact', 'inference'].includes(provenance as string) && checks.semanticSupport !== 'supported') {
      collector.add(`${path}.checks.semanticSupport`, 'accepted_without_semantic_support', 'Accepted factual claims require trusted semantic-support validation.');
    }
    if (provenance === 'suggestion' && checks.semanticSupport !== 'not_applicable') {
      collector.add(`${path}.checks.semanticSupport`, 'invalid_suggestion_support_check', 'Suggestion safety is validated on its action; semantic entailment is not applicable.');
    }
  }
}

function validateClaim(
  value: unknown,
  path: string,
  collector: IssueCollector,
  canonical: CanonicalIndexV1,
  allowedRevisionIds: ReadonlySet<string>,
  validated: boolean,
) {
  if (!isRecord(value)) {
    collector.add(path, 'invalid_type', 'Expected a claim object.');
    return;
  }
  const validationKey = validated ? ['validation'] : [];
  const baseKeys = ['id', 'provenance', 'title', 'statement', 'materiality', 'normalizedValues', ...validationKey];
  switch (value.provenance) {
    case 'source_fact': {
      const object = objectAt(value, path, [...baseKeys, 'evidence'], collector);
      if (object) validateEvidenceArray(object.evidence, `${path}.evidence`, collector, canonical, allowedRevisionIds, 1);
      break;
    }
    case 'inference': {
      const object = objectAt(value, path, [...baseKeys, 'evidence', 'basisClaimIds', 'rationale'], collector);
      if (object) {
        validateEvidenceArray(object.evidence, `${path}.evidence`, collector, canonical, allowedRevisionIds, 1);
        stringArrayAt(object.basisClaimIds, `${path}.basisClaimIds`, collector, { minimum: 1, maximum: 100, ids: true });
        stringAt(object.rationale, `${path}.rationale`, collector, { maximum: 4_000, plainText: true });
      }
      break;
    }
    case 'suggestion': {
      const object = objectAt(value, path, [...baseKeys, 'basisClaimIds', 'rationale', 'sourceImposed', 'execution'], collector);
      if (object) {
        stringArrayAt(object.basisClaimIds, `${path}.basisClaimIds`, collector, { minimum: 1, maximum: 100, ids: true });
        stringAt(object.rationale, `${path}.rationale`, collector, { maximum: 4_000, plainText: true });
        if (booleanAt(object.sourceImposed, `${path}.sourceImposed`, collector) && object.sourceImposed !== false) {
          collector.add(`${path}.sourceImposed`, 'suggestion_not_source_imposed', 'Suggestions must explicitly state that they are not source-imposed.');
        }
        literalAt(object.execution, `${path}.execution`, collector, 'manual_user_choice');
      }
      break;
    }
    case 'not_confirmed': {
      const object = objectAt(value, path, [...baseKeys, 'evidence', 'reason'], collector);
      if (object) {
        validateEvidenceArray(object.evidence, `${path}.evidence`, collector, canonical, allowedRevisionIds, 0);
        stringAt(object.reason, `${path}.reason`, collector, { maximum: 4_000, plainText: true });
      }
      break;
    }
    case 'conflict': {
      const object = objectAt(value, path, [...baseKeys, 'alternatives', 'rationale'], collector);
      if (object) {
        const alternatives = arrayAt(object.alternatives, `${path}.alternatives`, collector, 2, 20) ?? [];
        const segmentIds = new Set<string>();
        alternatives.forEach((alternative, index) => {
          const alternativePath = `${path}.alternatives[${index}]`;
          const alternativeObject = objectAt(alternative, alternativePath, ['statement', 'evidence'], collector);
          if (!alternativeObject) return;
          stringAt(alternativeObject.statement, `${alternativePath}.statement`, collector, { maximum: 4_000, plainText: true });
          const refs = validateEvidenceArray(alternativeObject.evidence, `${alternativePath}.evidence`, collector, canonical, allowedRevisionIds, 1);
          refs.forEach((ref) => {
            if (typeof ref.segmentId === 'string') segmentIds.add(ref.segmentId);
          });
        });
        if (segmentIds.size < 2) collector.add(`${path}.alternatives`, 'conflict_needs_distinct_evidence', 'A conflict requires at least two distinct anchored source segments.');
        stringAt(object.rationale, `${path}.rationale`, collector, { maximum: 4_000, plainText: true });
      }
      break;
    }
    default:
      objectAt(value, path, baseKeys, collector);
      enumAt(value.provenance, `${path}.provenance`, collector, ['source_fact', 'inference', 'suggestion', 'not_confirmed', 'conflict'] as const);
  }

  idAt(value.id, `${path}.id`, collector);
  stringAt(value.title, `${path}.title`, collector, { maximum: 300, plainText: true });
  stringAt(value.statement, `${path}.statement`, collector, { maximum: 8_000, plainText: true });
  enumAt(value.materiality, `${path}.materiality`, collector, ['material', 'supporting'] as const);
  const normalizedValues = validateNormalizedValues(value.normalizedValues, `${path}.normalizedValues`, collector);
  if (['suggestion', 'not_confirmed'].includes(value.provenance as string) && normalizedValues.length > 0) {
    collector.add(`${path}.normalizedValues`, 'asserted_value_not_allowed', 'Suggestions and not-confirmed claims cannot carry normalized asserted values.');
  }
  if (validated) validateClaimValidation(value.validation, `${path}.validation`, collector, value.provenance);
}

function validateActionValidation(value: unknown, path: string, collector: IssueCollector, timingKind: unknown) {
  const object = objectAt(value, path, ['state', 'validatorVersion', 'validatedAt', 'issueCodes', 'checks'], collector);
  if (!object) return;
  const stateValid = enumAt(object.state, `${path}.state`, collector, ['accepted', 'needs_review', 'blocked', 'stale'] as const);
  stringAt(object.validatorVersion, `${path}.validatorVersion`, collector, { maximum: 128, plainText: true });
  timestampAt(object.validatedAt, `${path}.validatedAt`, collector);
  const issueCodes = stringArrayAt(object.issueCodes, `${path}.issueCodes`, collector, { maximum: 100, tokens: true });
  const checks = objectAt(object.checks, `${path}.checks`, ['basis', 'timing', 'safety'], collector);
  if (checks) {
    enumAt(checks.basis, `${path}.checks.basis`, collector, ['passed', 'failed'] as const);
    enumAt(checks.timing, `${path}.checks.timing`, collector, ['passed', 'failed', 'not_applicable'] as const);
    enumAt(checks.safety, `${path}.checks.safety`, collector, ['passed', 'failed', 'needs_review'] as const);
  }
  if (stateValid && object.state === 'accepted' && issueCodes.length > 0) {
    collector.add(`${path}.issueCodes`, 'accepted_with_issues', 'Accepted actions cannot retain validation issue codes.');
  }
  if (stateValid && ['needs_review', 'blocked', 'stale'].includes(object.state as string) && issueCodes.length === 0) {
    collector.add(`${path}.issueCodes`, 'missing_issue_code', 'Non-accepted actions require at least one machine-readable issue code.');
  }
  if (stateValid && object.state === 'accepted' && checks) {
    if (checks.basis !== 'passed') collector.add(`${path}.checks.basis`, 'accepted_without_basis_check', 'Accepted actions require a passed claim-basis check.');
    if (checks.safety !== 'passed') collector.add(`${path}.checks.safety`, 'accepted_without_safety_check', 'Accepted actions require a passed safety check.');
    const expectedTiming = timingKind === 'none' ? 'not_applicable' : 'passed';
    if (checks.timing !== expectedTiming) collector.add(`${path}.checks.timing`, 'accepted_without_timing_check', `Accepted actions require timing check ${expectedTiming}.`);
  }
}

function validateAction(value: unknown, path: string, collector: IssueCollector, validated: boolean) {
  const validationKey = validated ? ['validation'] : [];
  const object = objectAt(value, path, [
    'id', 'provenance', 'order', 'priority', 'title', 'description', 'timing', 'basisClaimIds',
    'requiredInputs', 'consequence', 'sourceImposed', 'execution', ...validationKey,
  ], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  enumAt(object.provenance, `${path}.provenance`, collector, ['document_requirement', 'paperwork_suggestion'] as const);
  integerAt(object.order, `${path}.order`, collector, 0, MAX.actions);
  enumAt(object.priority, `${path}.priority`, collector, ['critical', 'high', 'normal', 'low'] as const);
  stringAt(object.title, `${path}.title`, collector, { maximum: 300, plainText: true });
  stringAt(object.description, `${path}.description`, collector, { maximum: 4_000, plainText: true });
  stringArrayAt(object.basisClaimIds, `${path}.basisClaimIds`, collector, { minimum: 1, maximum: 100, ids: true });
  stringArrayAt(object.requiredInputs, `${path}.requiredInputs`, collector, { maximum: 100, plainText: true });
  if ('consequence' in object) {
    const consequence = objectAt(object.consequence, `${path}.consequence`, ['text', 'basisClaimIds'], collector);
    if (consequence) {
      stringAt(consequence.text, `${path}.consequence.text`, collector, { maximum: 2_000, plainText: true });
      stringArrayAt(consequence.basisClaimIds, `${path}.consequence.basisClaimIds`, collector, { minimum: 1, maximum: 100, ids: true });
    }
  }
  if (booleanAt(object.sourceImposed, `${path}.sourceImposed`, collector)) {
    if (object.provenance === 'document_requirement' && object.sourceImposed !== true) {
      collector.add(`${path}.sourceImposed`, 'requirement_not_source_imposed', 'Document requirements must be explicitly source-imposed.');
    }
    if (object.provenance === 'paperwork_suggestion' && object.sourceImposed !== false) {
      collector.add(`${path}.sourceImposed`, 'suggestion_source_imposed', 'PaperWork suggestions cannot be marked source-imposed.');
    }
  }
  literalAt(object.execution, `${path}.execution`, collector, 'manual_user_choice');

  if (!isRecord(object.timing)) {
    collector.add(`${path}.timing`, 'invalid_type', 'Expected a timing object.');
    return;
  }
  switch (object.timing.kind) {
    case 'calendar_date': {
      const timing = objectAt(object.timing, `${path}.timing`, ['kind', 'date', 'basisClaimId'], collector);
      if (timing) {
        calendarDateAt(timing.date, `${path}.timing.date`, collector);
        idAt(timing.basisClaimId, `${path}.timing.basisClaimId`, collector);
      }
      break;
    }
    case 'condition': {
      const timing = objectAt(object.timing, `${path}.timing`, ['kind', 'label', 'basisClaimId'], collector);
      if (timing) {
        stringAt(timing.label, `${path}.timing.label`, collector, { maximum: 300, plainText: true });
        idAt(timing.basisClaimId, `${path}.timing.basisClaimId`, collector);
      }
      break;
    }
    case 'none':
      objectAt(object.timing, `${path}.timing`, ['kind'], collector);
      break;
    default:
      objectAt(object.timing, `${path}.timing`, ['kind'], collector);
      enumAt(object.timing.kind, `${path}.timing.kind`, collector, ['calendar_date', 'condition', 'none'] as const);
  }
  if (validated) validateActionValidation(object.validation, `${path}.validation`, collector, object.timing.kind);
}

function validateQuestion(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'text', 'reason', 'basisClaimIds'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  stringAt(object.text, `${path}.text`, collector, { maximum: 1_000, plainText: true });
  stringAt(object.reason, `${path}.reason`, collector, { maximum: 2_000, plainText: true });
  stringArrayAt(object.basisClaimIds, `${path}.basisClaimIds`, collector, { maximum: 100, ids: true });
}

function validateDocument(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['documentType', 'titleClaimId', 'purposeClaimId', 'actionRequiredClaimId', 'nearestDeadlineClaimId', 'primaryActionId'], collector);
  if (!object) return;
  tokenAt(object.documentType, `${path}.documentType`, collector);
  idAt(object.titleClaimId, `${path}.titleClaimId`, collector);
  idAt(object.purposeClaimId, `${path}.purposeClaimId`, collector);
  idAt(object.actionRequiredClaimId, `${path}.actionRequiredClaimId`, collector);
  if ('nearestDeadlineClaimId' in object) idAt(object.nearestDeadlineClaimId, `${path}.nearestDeadlineClaimId`, collector);
  if ('primaryActionId' in object) idAt(object.primaryActionId, `${path}.primaryActionId`, collector);
}

function validateSections(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['briefClaimIds', 'factClaimIds', 'attentionClaimIds', 'missingInformationClaimIds', 'conflictClaimIds', 'planActionIds'], collector);
  if (!object) return;
  for (const key of ['briefClaimIds', 'factClaimIds', 'attentionClaimIds', 'missingInformationClaimIds', 'conflictClaimIds', 'planActionIds'] as const) {
    stringArrayAt(object[key], `${path}.${key}`, collector, { maximum: MAX.claims, ids: true });
  }
}

function claimIsRenderable(claim: ClaimDraftV1 | ValidatedClaimV1, validated: boolean) {
  if (!validated) return true;
  if (!('validation' in claim) || !isRecord(claim.validation)) return false;
  return claim.validation.state === 'accepted' || claim.validation.state === 'needs_review';
}

function actionIsRenderable(action: UnknownRecord, validated: boolean) {
  if (!validated) return true;
  if (!isRecord(action.validation)) return false;
  return action.validation.state === 'accepted' || action.validation.state === 'needs_review';
}

function validateAnalysisRelations(
  object: UnknownRecord,
  path: string,
  collector: IssueCollector,
  claims: readonly (ClaimDraftV1 | ValidatedClaimV1)[],
  actions: readonly UnknownRecord[],
  questions: readonly UnknownRecord[],
  validated: boolean,
) {
  const claimMap = mapById(claims, `${path}.claims`, collector);
  const actionMap = mapById(actions as unknown as { id: string }[], `${path}.actions`, collector);

  const referenceClaim = (id: unknown, referencePath: string) => {
    if (typeof id !== 'string') return undefined;
    const claim = claimMap.get(id);
    if (!claim) collector.add(referencePath, 'dangling_claim', `Unknown claim ${JSON.stringify(id)}.`);
    else if (!claimIsRenderable(claim, validated)) collector.add(referencePath, 'blocked_claim_reference', 'Blocked or stale claims cannot drive renderable output.');
    return claim;
  };

  const inferenceGraph = new Map<string, readonly string[]>();
  claims.forEach((claim, claimIndex) => {
    if (claim.provenance === 'inference') {
      const basisIds = Array.isArray(claim.basisClaimIds)
        ? claim.basisClaimIds.filter((basisId): basisId is string => typeof basisId === 'string')
        : [];
      if (typeof claim.id === 'string') inferenceGraph.set(claim.id, basisIds);
      basisIds.forEach((basisId, index) => {
        const basis = referenceClaim(basisId, `${path}.claims[${claimIndex}].basisClaimIds[${index}]`);
        if (basis && !['source_fact', 'inference'].includes(basis.provenance)) {
          collector.add(`${path}.claims[${claimIndex}].basisClaimIds[${index}]`, 'invalid_inference_basis', 'Inferences may only depend on source facts or other inferences.');
        }
      });
    } else if (claim.provenance === 'suggestion') {
      const basisIds = Array.isArray(claim.basisClaimIds)
        ? claim.basisClaimIds.filter((basisId): basisId is string => typeof basisId === 'string')
        : [];
      basisIds.forEach((basisId, index) => {
        const basis = referenceClaim(basisId, `${path}.claims[${claimIndex}].basisClaimIds[${index}]`);
        if (basis?.provenance === 'suggestion') {
          collector.add(`${path}.claims[${claimIndex}].basisClaimIds[${index}]`, 'suggestion_chain', 'Suggestions must be grounded in non-suggestion claims.');
        }
      });
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      collector.add(`${path}.claims`, 'claim_cycle', `Inference dependency cycle detected at ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const basisId of inferenceGraph.get(id) ?? []) {
      if (inferenceGraph.has(basisId)) visit(basisId);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of inferenceGraph.keys()) visit(id);

  actions.forEach((action, actionIndex) => {
    const basisIds = Array.isArray(action.basisClaimIds) ? action.basisClaimIds : [];
    basisIds.forEach((basisId, index) => {
      const claim = referenceClaim(basisId, `${path}.actions[${actionIndex}].basisClaimIds[${index}]`);
      if (action.provenance === 'document_requirement' && claim && claim.provenance !== 'source_fact') {
        collector.add(`${path}.actions[${actionIndex}].basisClaimIds[${index}]`, 'requirement_needs_source_fact', 'A document requirement must be justified only by directly stated source facts.');
      }
    });
    if (isRecord(action.timing) && typeof action.timing.basisClaimId === 'string') {
      const timing = action.timing;
      const timingClaim = referenceClaim(timing.basisClaimId, `${path}.actions[${actionIndex}].timing.basisClaimId`);
      if (!basisIds.includes(timing.basisClaimId)) {
        collector.add(`${path}.actions[${actionIndex}].timing.basisClaimId`, 'timing_basis_missing', 'The timing claim must also justify the action.');
      }
      if (timing.kind === 'calendar_date' && timingClaim?.provenance !== 'source_fact') {
        collector.add(`${path}.actions[${actionIndex}].timing.basisClaimId`, 'date_needs_source_fact', 'A calendar deadline must be anchored to a directly stated source fact.');
      }
      if (timing.kind === 'calendar_date' && timingClaim?.provenance === 'source_fact' && typeof timing.date === 'string') {
        const values = Array.isArray(timingClaim.normalizedValues) ? timingClaim.normalizedValues : [];
        const dateMatches = values.some((value) => isRecord(value) && value.kind === 'date' && value.value === timing.date);
        if (!dateMatches) {
          collector.add(`${path}.actions[${actionIndex}].timing.date`, 'timing_value_mismatch', 'The action date must exactly match a normalized date on its source-fact basis claim.');
        }
      }
    }
    if (isRecord(action.consequence) && Array.isArray(action.consequence.basisClaimIds)) {
      action.consequence.basisClaimIds.forEach((basisId, index) => {
        referenceClaim(basisId, `${path}.actions[${actionIndex}].consequence.basisClaimIds[${index}]`);
      });
    }
  });

  questions.forEach((question, questionIndex) => {
    const basisIds = Array.isArray(question.basisClaimIds) ? question.basisClaimIds : [];
    basisIds.forEach((basisId, index) => referenceClaim(basisId, `${path}.questions[${questionIndex}].basisClaimIds[${index}]`));
  });

  const document = isRecord(object.document) ? object.document : {};
  for (const key of ['titleClaimId', 'purposeClaimId', 'actionRequiredClaimId', 'nearestDeadlineClaimId'] as const) {
    if (typeof document[key] === 'string') {
      const claim = referenceClaim(document[key], `${path}.document.${key}`);
      if (claim?.provenance === 'suggestion') collector.add(`${path}.document.${key}`, 'invalid_document_pointer', 'Document identity and requirements cannot point to a PaperWork suggestion.');
      if (key === 'nearestDeadlineClaimId' && claim && !['source_fact', 'inference'].includes(claim.provenance)) {
        collector.add(`${path}.document.${key}`, 'invalid_deadline_pointer', 'Nearest deadline must point to a sourced fact or grounded inference.');
      }
    }
  }
  if (typeof document.primaryActionId === 'string') {
    const primaryAction = actionMap.get(document.primaryActionId) as unknown as UnknownRecord | undefined;
    if (!primaryAction) collector.add(`${path}.document.primaryActionId`, 'dangling_action', 'Primary action must reference an existing action.');
    else if (!actionIsRenderable(primaryAction, validated)) collector.add(`${path}.document.primaryActionId`, 'blocked_action_reference', 'Blocked or stale actions cannot be primary actions.');
  }

  const sections = isRecord(object.sections) ? object.sections : {};
  const sectionRules: ReadonlyArray<[string, readonly string[] | undefined]> = [
    ['briefClaimIds', undefined],
    ['factClaimIds', ['source_fact', 'inference']],
    ['attentionClaimIds', undefined],
    ['missingInformationClaimIds', ['not_confirmed']],
    ['conflictClaimIds', ['conflict']],
  ];
  for (const [key, allowedProvenance] of sectionRules) {
    const ids = Array.isArray(sections[key]) ? sections[key] : [];
    ids.forEach((id, index) => {
      const claim = referenceClaim(id, `${path}.sections.${key}[${index}]`);
      if (key === 'briefClaimIds' && claim?.provenance === 'suggestion') {
        collector.add(`${path}.sections.${key}[${index}]`, 'suggestion_in_brief', 'The document brief cannot silently include PaperWork suggestions.');
      }
      if (claim && allowedProvenance && !allowedProvenance.includes(claim.provenance)) {
        collector.add(`${path}.sections.${key}[${index}]`, 'wrong_section_provenance', `Claim provenance ${claim.provenance} is not allowed in ${key}.`);
      }
    });
  }
  const planActionIds = Array.isArray(sections.planActionIds) ? sections.planActionIds : [];
  planActionIds.forEach((id, index) => {
    if (typeof id !== 'string') return;
    const action = actionMap.get(id) as unknown as UnknownRecord | undefined;
    if (!action) collector.add(`${path}.sections.planActionIds[${index}]`, 'dangling_action', `Unknown action ${JSON.stringify(id)}.`);
    else if (!actionIsRenderable(action, validated)) collector.add(`${path}.sections.planActionIds[${index}]`, 'blocked_action_reference', 'Blocked or stale actions cannot appear in the renderable plan.');
  });
}

function validateAnalysis(
  value: unknown,
  path: string,
  collector: IssueCollector,
  canonical: CanonicalIndexV1,
  validated: boolean,
) {
  const object = objectAt(value, path, ['kind', 'schemaVersion', 'analysisId', 'knowledgeMode', 'sourceRevisionIds', 'document', 'claims', 'actions', 'questions', 'sections'], collector);
  if (!object) return;
  literalAt(object.kind, `${path}.kind`, collector, validated ? VALIDATED_ANALYSIS_KIND_V1 : MODEL_DRAFT_KIND_V1);
  literalAt(object.schemaVersion, `${path}.schemaVersion`, collector, ACTION_PACK_SCHEMA_VERSION_V1);
  idAt(object.analysisId, `${path}.analysisId`, collector);
  literalAt(object.knowledgeMode, `${path}.knowledgeMode`, collector, 'source_only');
  const revisionIds = stringArrayAt(object.sourceRevisionIds, `${path}.sourceRevisionIds`, collector, { minimum: 1, maximum: MAX.revisions, ids: true });
  const allowedRevisionIds = new Set(revisionIds);
  revisionIds.forEach((revisionId, index) => {
    const revision = canonical.revisions.get(revisionId);
    if (!revision) collector.add(`${path}.sourceRevisionIds[${index}]`, 'dangling_revision', 'Analysis references an unknown source revision.');
    else if (revision.status !== 'active') collector.add(`${path}.sourceRevisionIds[${index}]`, 'stale_revision', 'Analysis must use active source revisions.');
  });
  validateDocument(object.document, `${path}.document`, collector);
  const rawClaims = arrayAt(object.claims, `${path}.claims`, collector, 1, MAX.claims) ?? [];
  rawClaims.forEach((claim, index) => validateClaim(claim, `${path}.claims[${index}]`, collector, canonical, allowedRevisionIds, validated));
  const rawActions = arrayAt(object.actions, `${path}.actions`, collector, 0, MAX.actions) ?? [];
  rawActions.forEach((action, index) => validateAction(action, `${path}.actions[${index}]`, collector, validated));
  const rawQuestions = arrayAt(object.questions, `${path}.questions`, collector, 0, MAX.questions) ?? [];
  rawQuestions.forEach((question, index) => validateQuestion(question, `${path}.questions[${index}]`, collector));
  validateSections(object.sections, `${path}.sections`, collector);
  validateAnalysisRelations(
    object,
    path,
    collector,
    rawClaims.filter(isRecord) as unknown as (ClaimDraftV1 | ValidatedClaimV1)[],
    rawActions.filter(isRecord),
    rawQuestions.filter(isRecord),
    validated,
  );
}

function validateProcessingEvent(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'sequence', 'occurredAt', 'type', 'status', 'actor', 'relatedId'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  integerAt(object.sequence, `${path}.sequence`, collector, 0, MAX.events);
  timestampAt(object.occurredAt, `${path}.occurredAt`, collector);
  enumAt(object.type, `${path}.type`, collector, [
    'local_read_authorized', 'local_plan_authorized', 'source_admitted', 'extraction_completed', 'payload_previewed', 'consent_recorded', 'transfer_started',
    'transfer_completed', 'analysis_completed', 'validation_completed', 'correction_recorded',
    'deletion_requested', 'deletion_reported', 'local_cleanup_completed', 'run_cancelled', 'run_failed',
  ] as const);
  enumAt(object.status, `${path}.status`, collector, ['completed', 'failed', 'cancelled'] as const);
  const actor = objectAt(object.actor, `${path}.actor`, ['location', 'name'], collector);
  if (actor) {
    enumAt(actor.location, `${path}.actor.location`, collector, ['browser', 'device', 'paperwork_service', 'provider'] as const);
    stringAt(actor.name, `${path}.actor.name`, collector, { maximum: 128, plainText: true });
  }
  if ('relatedId' in object) idAt(object.relatedId, `${path}.relatedId`, collector);
  const requiresRelatedId = [
    'local_read_authorized', 'local_plan_authorized', 'source_admitted', 'extraction_completed', 'payload_previewed', 'consent_recorded',
    'transfer_started', 'transfer_completed', 'analysis_completed', 'validation_completed',
    'correction_recorded', 'deletion_requested', 'deletion_reported', 'local_cleanup_completed',
  ].includes(object.type as string);
  if (requiresRelatedId && !('relatedId' in object)) {
    collector.add(`${path}.relatedId`, 'related_id_required', 'This processing event must identify the record or analysis it describes.');
  }
}

function validateContentCategories(value: unknown, path: string, collector: IssueCollector) {
  const array = arrayAt(value, path, collector, 1, 10) ?? [];
  const categories: string[] = [];
  array.forEach((item, index) => {
    if (enumAt(item, `${path}[${index}]`, collector, ['full_file', 'page_images', 'extracted_text', 'redacted_text', 'document_metadata', 'user_question'] as const)) {
      categories.push(item);
    }
  });
  validateUnique(categories, path, collector);
  return categories;
}

function validateConsent(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'recordedAt', 'approvedBy', 'recipient', 'provider', 'model', 'sourceRevisionIds', 'segmentIds', 'contentCategories', 'previewDigest', 'redactions'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  timestampAt(object.recordedAt, `${path}.recordedAt`, collector);
  literalAt(object.approvedBy, `${path}.approvedBy`, collector, 'user');
  stringAt(object.recipient, `${path}.recipient`, collector, { maximum: 255, plainText: true });
  if ('provider' in object) stringAt(object.provider, `${path}.provider`, collector, { maximum: 255, plainText: true });
  if ('model' in object) stringAt(object.model, `${path}.model`, collector, { maximum: 255, plainText: true });
  stringArrayAt(object.sourceRevisionIds, `${path}.sourceRevisionIds`, collector, { maximum: MAX.revisions, ids: true });
  stringArrayAt(object.segmentIds, `${path}.segmentIds`, collector, { maximum: MAX.segments, ids: true });
  validateContentCategories(object.contentCategories, `${path}.contentCategories`, collector);
  digestAt(object.previewDigest, `${path}.previewDigest`, collector);
  stringArrayAt(object.redactions, `${path}.redactions`, collector, { maximum: 500, plainText: true });
}

function validateProviderPolicy(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['retention', 'trainingUse', 'assertedBy', 'policyUrl'], collector);
  if (!object) return;
  enumAt(object.retention, `${path}.retention`, collector, ['none', 'temporary', 'provider_policy', 'unknown'] as const);
  enumAt(object.trainingUse, `${path}.trainingUse`, collector, ['not_used', 'may_be_used', 'unknown'] as const);
  stringAt(object.assertedBy, `${path}.assertedBy`, collector, { maximum: 255, plainText: true });
  if ('policyUrl' in object) urlAt(object.policyUrl, `${path}.policyUrl`, collector);
}

function validateTransfer(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, [
    'id', 'consentId', 'startedAt', 'completedAt', 'recipient', 'provider', 'model', 'executionLocation',
    'sourceRevisionIds', 'segmentIds', 'contentCategories', 'payloadDigest', 'payloadByteCount', 'redactions', 'providerPolicy',
  ], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  idAt(object.consentId, `${path}.consentId`, collector);
  timestampAt(object.startedAt, `${path}.startedAt`, collector);
  if ('completedAt' in object) timestampAt(object.completedAt, `${path}.completedAt`, collector);
  stringAt(object.recipient, `${path}.recipient`, collector, { maximum: 255, plainText: true });
  if ('provider' in object) stringAt(object.provider, `${path}.provider`, collector, { maximum: 255, plainText: true });
  if ('model' in object) stringAt(object.model, `${path}.model`, collector, { maximum: 255, plainText: true });
  enumAt(object.executionLocation, `${path}.executionLocation`, collector, ['browser', 'device', 'paperwork_service', 'provider'] as const);
  stringArrayAt(object.sourceRevisionIds, `${path}.sourceRevisionIds`, collector, { maximum: MAX.revisions, ids: true });
  stringArrayAt(object.segmentIds, `${path}.segmentIds`, collector, { maximum: MAX.segments, ids: true });
  validateContentCategories(object.contentCategories, `${path}.contentCategories`, collector);
  digestAt(object.payloadDigest, `${path}.payloadDigest`, collector);
  integerAt(object.payloadByteCount, `${path}.payloadByteCount`, collector, 1);
  stringArrayAt(object.redactions, `${path}.redactions`, collector, { maximum: 500, plainText: true });
  validateProviderPolicy(object.providerPolicy, `${path}.providerPolicy`, collector);
}

function validateRetention(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'subject', 'state', 'assertedBy', 'recordedAt', 'eventId'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  enumAt(object.subject, `${path}.subject`, collector, ['browser', 'device', 'paperwork', 'provider'] as const);
  enumAt(object.state, `${path}.state`, collector, ['not_stored', 'deletion_requested', 'provider_reported_deleted', 'locally_cleared', 'status_unavailable'] as const);
  stringAt(object.assertedBy, `${path}.assertedBy`, collector, { maximum: 255, plainText: true });
  timestampAt(object.recordedAt, `${path}.recordedAt`, collector);
  if ('eventId' in object) idAt(object.eventId, `${path}.eventId`, collector);
  if (['deletion_requested', 'provider_reported_deleted', 'locally_cleared'].includes(object.state as string) && !('eventId' in object)) {
    collector.add(`${path}.eventId`, 'retention_event_required', 'This retention state requires a corresponding observed event.');
  }
}

function validateComponent(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['component', 'name', 'version'], collector);
  if (!object) return;
  enumAt(object.component, `${path}.component`, collector, ['paperwork', 'parser', 'ocr', 'prompt_template', 'provider_model', 'citation_validator'] as const);
  stringAt(object.name, `${path}.name`, collector, { maximum: 255, plainText: true });
  stringAt(object.version, `${path}.version`, collector, { maximum: 128, plainText: true });
}

function validateSummary(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, [
    'totalClaims', 'accepted', 'needsReview', 'blocked', 'stale',
    'totalActions', 'acceptedActions', 'needsReviewActions', 'blockedActions', 'staleActions',
  ], collector);
  if (!object) return;
  for (const key of ['totalClaims', 'accepted', 'needsReview', 'blocked', 'stale'] as const) {
    integerAt(object[key], `${path}.${key}`, collector, 0, MAX.claims);
  }
  for (const key of ['totalActions', 'acceptedActions', 'needsReviewActions', 'blockedActions', 'staleActions'] as const) {
    integerAt(object[key], `${path}.${key}`, collector, 0, MAX.actions);
  }
}

function validateExternalReference(value: unknown, path: string, collector: IssueCollector) {
  const object = objectAt(value, path, ['id', 'url', 'title', 'accessedAt'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  urlAt(object.url, `${path}.url`, collector);
  stringAt(object.title, `${path}.title`, collector, { maximum: 500, plainText: true });
  timestampAt(object.accessedAt, `${path}.accessedAt`, collector);
}

function sameStrings(left: unknown, right: unknown) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return [...left].sort().join('\u0000') === [...right].sort().join('\u0000');
}

function digestValue(value: unknown) {
  return isRecord(value) && value.algorithm === 'sha-256' && typeof value.value === 'string' ? value.value : undefined;
}

function validateReceipt(
  value: unknown,
  path: string,
  collector: IssueCollector,
  canonical: CanonicalIndexV1,
  analysis: UnknownRecord | undefined,
) {
  const object = objectAt(value, path, ['id', 'createdAt', 'processingMode', 'events', 'consentRecords', 'transfers', 'retention', 'components', 'validationSummary', 'externalReferences', 'correctionIds'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  timestampAt(object.createdAt, `${path}.createdAt`, collector);
  enumAt(object.processingMode, `${path}.processingMode`, collector, ['sample', 'browser_local', 'desktop_local', 'cloud_redacted', 'cloud_full'] as const);

  const events = arrayAt(object.events, `${path}.events`, collector, 1, MAX.events) ?? [];
  events.forEach((event, index) => validateProcessingEvent(event, `${path}.events[${index}]`, collector));
  const eventObjects = events.filter(isRecord);
  const eventMap = mapById(eventObjects as unknown as { id: string }[], `${path}.events`, collector);
  let previousSequence = -1;
  let previousOccurredAt = Number.NEGATIVE_INFINITY;
  eventObjects.forEach((event, index) => {
    if (typeof event.sequence === 'number') {
      if (event.sequence <= previousSequence) collector.add(`${path}.events[${index}].sequence`, 'event_order', 'Event sequences must be unique and strictly increasing.');
      previousSequence = event.sequence;
    }
    if (typeof event.occurredAt === 'string') {
      const occurredAt = Date.parse(event.occurredAt);
      if (Number.isFinite(occurredAt) && occurredAt < previousOccurredAt) {
        collector.add(`${path}.events[${index}].occurredAt`, 'event_time_order', 'Event timestamps must not move backwards as sequence numbers increase.');
      }
      if (Number.isFinite(occurredAt)) previousOccurredAt = occurredAt;
    }
  });
  if (typeof object.createdAt === 'string' && Number.isFinite(previousOccurredAt) && Date.parse(object.createdAt) < previousOccurredAt) {
    collector.add(`${path}.createdAt`, 'receipt_time_order', 'Receipt creation cannot precede its latest observed event.');
  }

  const analysisId = typeof analysis?.analysisId === 'string' ? analysis.analysisId : undefined;
  const completedAnalysisEvent = analysisId
    ? eventObjects.find((event) => event.type === 'analysis_completed' && event.relatedId === analysisId && event.status === 'completed')
    : undefined;
  const completedValidationEvent = analysisId
    ? eventObjects.find((event) => event.type === 'validation_completed' && event.relatedId === analysisId && event.status === 'completed')
    : undefined;
  if (analysisId && !completedAnalysisEvent) {
    collector.add(`${path}.events`, 'analysis_event_missing', 'A final Action Pack receipt requires a completed analysis event for this analysis.');
  }
  if (analysisId && !completedValidationEvent) {
    collector.add(`${path}.events`, 'validation_event_missing', 'A final Action Pack receipt requires a completed validation event for this analysis.');
  }
  if (completedValidationEvent && isRecord(completedValidationEvent.actor) && completedValidationEvent.actor.location === 'provider') {
    collector.add(`${path}.events`, 'untrusted_validation_actor', 'Provider output cannot attest its own PaperWork validation.');
  }
  if (
    typeof completedAnalysisEvent?.sequence === 'number'
    && typeof completedValidationEvent?.sequence === 'number'
    && completedValidationEvent.sequence <= completedAnalysisEvent.sequence
  ) {
    collector.add(`${path}.events`, 'validation_before_analysis', 'Validation must complete after analysis.');
  }
  if (completedValidationEvent && typeof completedValidationEvent.occurredAt === 'string') {
    const validationTimestamp = completedValidationEvent.occurredAt;
    const validatedRecords = [
      ...(Array.isArray(analysis?.claims) ? analysis.claims : []),
      ...(Array.isArray(analysis?.actions) ? analysis.actions : []),
    ];
    validatedRecords.forEach((record, index) => {
      if (isRecord(record) && isRecord(record.validation) && record.validation.validatedAt !== validationTimestamp) {
        collector.add(`${path}.events`, 'validation_time_mismatch', `Validated record ${index} does not match the completed validation event time.`);
      }
    });
  }

  const consents = arrayAt(object.consentRecords, `${path}.consentRecords`, collector, 0, MAX.receiptRecords) ?? [];
  consents.forEach((consent, index) => validateConsent(consent, `${path}.consentRecords[${index}]`, collector));
  const consentObjects = consents.filter(isRecord);
  const consentMap = mapById(consentObjects as unknown as { id: string }[], `${path}.consentRecords`, collector);
  consentObjects.forEach((consent, index) => {
    const event = eventObjects.find((candidate) => candidate.type === 'consent_recorded' && candidate.relatedId === consent.id && candidate.status === 'completed');
    if (!event) collector.add(`${path}.consentRecords[${index}]`, 'consent_event_missing', 'Consent must be backed by a completed trusted processing event.');
    else if (event.occurredAt !== consent.recordedAt) collector.add(`${path}.consentRecords[${index}].recordedAt`, 'consent_event_time_mismatch', 'Consent time must match its observed processing event.');
  });

  const transfers = arrayAt(object.transfers, `${path}.transfers`, collector, 0, MAX.receiptRecords) ?? [];
  transfers.forEach((transfer, index) => validateTransfer(transfer, `${path}.transfers[${index}]`, collector));
  const transferObjects = transfers.filter(isRecord);
  mapById(transferObjects as unknown as { id: string }[], `${path}.transfers`, collector);
  transferObjects.forEach((transfer, index) => {
    const transferPath = `${path}.transfers[${index}]`;
    const consent = typeof transfer.consentId === 'string' ? consentMap.get(transfer.consentId) as UnknownRecord | undefined : undefined;
    if (!consent) collector.add(`${transferPath}.consentId`, 'transfer_without_consent', 'Every transfer requires an existing consent record.');
    else {
      for (const field of ['recipient', 'provider', 'model'] as const) {
        if (transfer[field] !== consent[field]) collector.add(`${transferPath}.${field}`, 'consent_mismatch', `Transfer ${field} differs from the consented preview.`);
      }
      for (const field of ['sourceRevisionIds', 'segmentIds', 'contentCategories', 'redactions'] as const) {
        if (!sameStrings(transfer[field], consent[field])) collector.add(`${transferPath}.${field}`, 'consent_mismatch', `Transfer ${field} differs from the consented preview.`);
      }
      if (digestValue(transfer.payloadDigest) !== digestValue(consent.previewDigest)) {
        collector.add(`${transferPath}.payloadDigest`, 'payload_digest_mismatch', 'The transmitted payload digest must equal the consented preview digest.');
      }
      if (typeof transfer.startedAt === 'string' && typeof consent.recordedAt === 'string' && Date.parse(transfer.startedAt) < Date.parse(consent.recordedAt)) {
        collector.add(`${transferPath}.startedAt`, 'transfer_before_consent', 'A transfer cannot start before consent is recorded.');
      }
    }
    const startEvent = eventObjects.find((event) => event.type === 'transfer_started' && event.relatedId === transfer.id && event.status === 'completed');
    if (!startEvent) collector.add(transferPath, 'transfer_event_missing', 'A transfer must be backed by a completed transfer-started event.');
    else if (startEvent.occurredAt !== transfer.startedAt) collector.add(`${transferPath}.startedAt`, 'transfer_event_time_mismatch', 'Transfer start time must match its observed event.');
    if (typeof transfer.completedAt !== 'string') {
      collector.add(`${transferPath}.completedAt`, 'transfer_completion_required', 'A final Action Pack cannot report an incomplete transfer.');
    } else {
      if (typeof transfer.startedAt === 'string' && Date.parse(transfer.completedAt) < Date.parse(transfer.startedAt)) {
        collector.add(`${transferPath}.completedAt`, 'transfer_time_order', 'Transfer completion cannot precede transfer start.');
      }
      const completionEvent = eventObjects.find((event) => event.type === 'transfer_completed' && event.relatedId === transfer.id && event.status === 'completed');
      if (!completionEvent) collector.add(transferPath, 'transfer_completion_event_missing', 'A completed transfer requires a completed transfer event.');
      else {
        if (completionEvent.occurredAt !== transfer.completedAt) collector.add(`${transferPath}.completedAt`, 'transfer_event_time_mismatch', 'Transfer completion time must match its observed event.');
        if (completionEvent.actor && isRecord(completionEvent.actor) && completionEvent.actor.location !== transfer.executionLocation) {
          collector.add(transferPath, 'transfer_actor_mismatch', 'Transfer completion actor location must match the recorded execution location.');
        }
        if (typeof startEvent?.sequence === 'number' && typeof completionEvent.sequence === 'number' && completionEvent.sequence <= startEvent.sequence) {
          collector.add(transferPath, 'transfer_event_order', 'Transfer completion must occur after transfer start.');
        }
      }
    }
  });

  if (['sample', 'browser_local', 'desktop_local'].includes(object.processingMode as string) && transferObjects.length > 0) {
    collector.add(`${path}.transfers`, 'unexpected_external_transfer', 'Local and sample processing modes cannot contain external transfers.');
  }
  if (['cloud_redacted', 'cloud_full'].includes(object.processingMode as string) && transferObjects.length === 0) {
    collector.add(`${path}.transfers`, 'missing_external_transfer', 'Cloud processing modes require at least one transfer record.');
  }
  transferObjects.forEach((transfer, index) => {
    const categories = Array.isArray(transfer.contentCategories) ? transfer.contentCategories : [];
    const redactions = Array.isArray(transfer.redactions) ? transfer.redactions : [];
    if (object.processingMode === 'cloud_redacted') {
      if (categories.some((category) => ['full_file', 'page_images', 'extracted_text'].includes(category as string))) {
        collector.add(`${path}.transfers[${index}].contentCategories`, 'redacted_mode_content_mismatch', 'Redacted cloud mode cannot transmit full files, page images, or unredacted extracted text.');
      }
      if (!categories.includes('redacted_text') || redactions.length === 0) {
        collector.add(`${path}.transfers[${index}]`, 'redacted_mode_disclosure_missing', 'Redacted cloud mode requires redacted text and a non-empty redaction disclosure.');
      }
    }
    if (object.processingMode === 'cloud_full' && !categories.some((category) => ['full_file', 'page_images', 'extracted_text'].includes(category as string))) {
      collector.add(`${path}.transfers[${index}].contentCategories`, 'full_mode_content_mismatch', 'Full cloud mode must identify the full file, page images, or extracted text that was transmitted.');
    }
  });

  const retention = arrayAt(object.retention, `${path}.retention`, collector, 1, MAX.receiptRecords) ?? [];
  retention.forEach((record, index) => validateRetention(record, `${path}.retention[${index}]`, collector));
  mapById(retention.filter(isRecord) as unknown as { id: string }[], `${path}.retention`, collector);
  retention.filter(isRecord).forEach((record, index) => {
    if (typeof record.eventId !== 'string') return;
    const event = eventMap.get(record.eventId) as UnknownRecord | undefined;
    if (!event) {
      collector.add(`${path}.retention[${index}].eventId`, 'dangling_event', 'Retention state references an unknown processing event.');
      return;
    }
    const expectedEvent: Record<string, string> = {
      deletion_requested: 'deletion_requested',
      provider_reported_deleted: 'deletion_reported',
      locally_cleared: 'local_cleanup_completed',
    };
    if (typeof record.state === 'string' && expectedEvent[record.state] && event.type !== expectedEvent[record.state]) {
      collector.add(`${path}.retention[${index}].eventId`, 'retention_event_mismatch', 'Retention state does not match its processing event.');
    }
    if (event.status !== 'completed') {
      collector.add(`${path}.retention[${index}].eventId`, 'retention_event_not_completed', 'A failed or cancelled event cannot prove a retention state.');
    }
    if (event.occurredAt !== record.recordedAt) {
      collector.add(`${path}.retention[${index}].recordedAt`, 'retention_event_time_mismatch', 'Retention record time must match its observed event.');
    }
    const actor = isRecord(event.actor) ? event.actor : undefined;
    if (record.state === 'locally_cleared') {
      if (!actor || !['browser', 'device'].includes(actor.location as string)) {
        collector.add(`${path}.retention[${index}].eventId`, 'retention_actor_mismatch', 'Local cleanup must be observed by the browser or device actor.');
      }
      const analyzedRevisionIds = Array.isArray(analysis?.sourceRevisionIds) ? analysis.sourceRevisionIds : [];
      if (!analyzedRevisionIds.includes(event.relatedId)) {
        collector.add(`${path}.retention[${index}].eventId`, 'retention_subject_mismatch', 'Local cleanup must identify an analyzed source revision.');
      }
    }
    if (record.state === 'provider_reported_deleted') {
      if (!actor || actor.location !== 'provider') {
        collector.add(`${path}.retention[${index}].eventId`, 'retention_actor_mismatch', 'Provider-reported deletion must be attributed to a provider actor.');
      }
      const transferIds = new Set(transferObjects.map((transfer) => transfer.id).filter((id): id is string => typeof id === 'string'));
      if (!transferIds.has(event.relatedId as string)) {
        collector.add(`${path}.retention[${index}].eventId`, 'retention_subject_mismatch', 'Provider deletion must identify a recorded transfer.');
      }
    }
  });

  const components = arrayAt(object.components, `${path}.components`, collector, 1, 50) ?? [];
  components.forEach((component, index) => validateComponent(component, `${path}.components[${index}]`, collector));
  const componentKinds = components.filter(isRecord).map((component) => component.component).filter((component): component is string => typeof component === 'string');
  if (!componentKinds.includes('paperwork')) collector.add(`${path}.components`, 'paperwork_version_missing', 'Receipt must identify the PaperWork version.');
  if (!componentKinds.includes('citation_validator')) collector.add(`${path}.components`, 'validator_version_missing', 'Receipt must identify the citation validator version.');

  validateSummary(object.validationSummary, `${path}.validationSummary`, collector);
  const externalReferences = arrayAt(object.externalReferences, `${path}.externalReferences`, collector, 0, MAX.externalReferences) ?? [];
  externalReferences.forEach((reference, index) => validateExternalReference(reference, `${path}.externalReferences[${index}]`, collector));
  if (analysis?.knowledgeMode === 'source_only' && externalReferences.length > 0) {
    collector.add(`${path}.externalReferences`, 'external_reference_in_source_only_mode', 'Source-only analysis cannot use external references.');
  }
  stringArrayAt(object.correctionIds, `${path}.correctionIds`, collector, { maximum: MAX.corrections, ids: true });

  const claims = Array.isArray(analysis?.claims) ? analysis.claims.filter(isRecord) : [];
  const derived = { accepted: 0, needsReview: 0, blocked: 0, stale: 0 };
  claims.forEach((claim) => {
    if (!isRecord(claim.validation)) return;
    if (claim.validation.state === 'accepted') derived.accepted += 1;
    if (claim.validation.state === 'needs_review') derived.needsReview += 1;
    if (claim.validation.state === 'blocked') derived.blocked += 1;
    if (claim.validation.state === 'stale') derived.stale += 1;
  });
  const actions = Array.isArray(analysis?.actions) ? analysis.actions.filter(isRecord) : [];
  const derivedActions = { acceptedActions: 0, needsReviewActions: 0, blockedActions: 0, staleActions: 0 };
  actions.forEach((action) => {
    if (!isRecord(action.validation)) return;
    if (action.validation.state === 'accepted') derivedActions.acceptedActions += 1;
    if (action.validation.state === 'needs_review') derivedActions.needsReviewActions += 1;
    if (action.validation.state === 'blocked') derivedActions.blockedActions += 1;
    if (action.validation.state === 'stale') derivedActions.staleActions += 1;
  });
  if (isRecord(object.validationSummary)) {
    const expected: Record<string, number> = {
      totalClaims: claims.length,
      ...derived,
      totalActions: actions.length,
      ...derivedActions,
    };
    for (const [key, count] of Object.entries(expected)) {
      if (object.validationSummary[key] !== count) collector.add(`${path}.validationSummary.${key}`, 'summary_mismatch', `Expected derived count ${count}.`);
    }
  }

  const revisionIds = new Set(Array.isArray(analysis?.sourceRevisionIds) ? analysis.sourceRevisionIds.filter((id): id is string => typeof id === 'string') : []);
  for (const collection of [consentObjects, transferObjects]) {
    collection.forEach((record) => {
      const recordRevisionIds = Array.isArray(record.sourceRevisionIds) ? record.sourceRevisionIds : [];
      recordRevisionIds.forEach((revisionId) => {
        if (typeof revisionId === 'string' && (!canonical.revisions.has(revisionId) || !revisionIds.has(revisionId))) {
          collector.add(path, 'receipt_revision_mismatch', `Receipt references revision ${revisionId} outside the analyzed source set.`);
        }
      });
      const segmentIds = Array.isArray(record.segmentIds) ? record.segmentIds : [];
      segmentIds.forEach((segmentId) => {
        if (typeof segmentId !== 'string') return;
        const segment = canonical.segments.get(segmentId);
        if (!segment) collector.add(path, 'receipt_segment_mismatch', `Receipt references unknown segment ${segmentId}.`);
        else if (!recordRevisionIds.includes(segment.sourceRevisionId)) {
          collector.add(path, 'receipt_segment_revision_mismatch', `Receipt segment ${segmentId} is not part of its declared source revisions.`);
        }
      });
    });
  }
}

function validateCorrection(
  value: unknown,
  path: string,
  collector: IssueCollector,
  canonical: CanonicalIndexV1,
  claims: ReadonlyMap<string, UnknownRecord>,
  events: readonly UnknownRecord[],
) {
  const object = objectAt(value, path, ['id', 'sourceId', 'priorRevisionId', 'targetSegmentId', 'targetSpan', 'originalText', 'replacement', 'actor', 'createdAt', 'resultingRevisionId', 'invalidatedClaimIds', 'regeneratedClaimIds'], collector);
  if (!object) return;
  idAt(object.id, `${path}.id`, collector);
  idAt(object.sourceId, `${path}.sourceId`, collector);
  idAt(object.priorRevisionId, `${path}.priorRevisionId`, collector);
  idAt(object.targetSegmentId, `${path}.targetSegmentId`, collector);
  const targetSpan = objectAt(object.targetSpan, `${path}.targetSpan`, ['start', 'end'], collector);
  const startValid = targetSpan ? integerAt(targetSpan.start, `${path}.targetSpan.start`, collector, 0) : false;
  const endValid = targetSpan ? integerAt(targetSpan.end, `${path}.targetSpan.end`, collector, 1) : false;
  if (targetSpan && startValid && endValid && (targetSpan.start as number) >= (targetSpan.end as number)) {
    collector.add(`${path}.targetSpan`, 'invalid_span', 'Correction target start must be before end.');
  }
  stringAt(object.originalText, `${path}.originalText`, collector, { maximum: 20_000 });
  // A user correction replaces evidence text; preserve it as inert data.
  stringAt(object.replacement, `${path}.replacement`, collector, { maximum: 20_000 });
  literalAt(object.actor, `${path}.actor`, collector, 'user');
  timestampAt(object.createdAt, `${path}.createdAt`, collector);
  idAt(object.resultingRevisionId, `${path}.resultingRevisionId`, collector);
  stringArrayAt(object.invalidatedClaimIds, `${path}.invalidatedClaimIds`, collector, { minimum: 1, maximum: MAX.claims, ids: true });
  const regenerated = stringArrayAt(object.regeneratedClaimIds, `${path}.regeneratedClaimIds`, collector, { maximum: MAX.claims, ids: true });

  const source = typeof object.sourceId === 'string' ? canonical.sources.get(object.sourceId) : undefined;
  const prior = typeof object.priorRevisionId === 'string' ? canonical.revisions.get(object.priorRevisionId) : undefined;
  const resulting = typeof object.resultingRevisionId === 'string' ? canonical.revisions.get(object.resultingRevisionId) : undefined;
  const segment = typeof object.targetSegmentId === 'string' ? canonical.segments.get(object.targetSegmentId) : undefined;
  if (!source) collector.add(`${path}.sourceId`, 'dangling_source', 'Correction references an unknown source.');
  if (!prior) collector.add(`${path}.priorRevisionId`, 'dangling_revision', 'Correction references an unknown prior revision.');
  else if (prior.status !== 'superseded') collector.add(`${path}.priorRevisionId`, 'prior_revision_not_superseded', 'A corrected prior revision must be marked superseded.');
  if (!resulting) collector.add(`${path}.resultingRevisionId`, 'dangling_revision', 'Correction references an unknown resulting revision.');
  else if (resulting.status !== 'active') collector.add(`${path}.resultingRevisionId`, 'resulting_revision_not_active', 'A correction must produce an active source revision.');
  if (prior && resulting && (prior.sourceId !== resulting.sourceId || resulting.supersedesRevisionId !== prior.id)) {
    collector.add(path, 'correction_revision_mismatch', 'Correction revisions must form one source revision chain.');
  }
  if (prior && typeof object.sourceId === 'string' && prior.sourceId !== object.sourceId) {
    collector.add(`${path}.sourceId`, 'correction_source_mismatch', 'Correction source must match its prior revision.');
  }
  if (resulting && typeof object.sourceId === 'string' && resulting.sourceId !== object.sourceId) {
    collector.add(`${path}.sourceId`, 'correction_source_mismatch', 'Correction source must match its resulting revision.');
  }
  if (prior && resulting && prior.fingerprint?.value === resulting.fingerprint?.value) {
    collector.add(path, 'unchanged_revision_fingerprint', 'A correction must produce a different source fingerprint.');
  }
  if (!segment || (prior && segment.sourceRevisionId !== prior.id)) collector.add(`${path}.targetSegmentId`, 'correction_segment_mismatch', 'Correction target must belong to the prior source revision.');
  if (segment && typeof segment.text === 'string' && targetSpan && startValid && endValid) {
    const start = targetSpan.start as number;
    const end = targetSpan.end as number;
    if (end > segment.text.length) collector.add(`${path}.targetSpan.end`, 'span_out_of_bounds', 'Correction span extends beyond the canonical segment.');
    else if (segment.text.slice(start, end) !== object.originalText) collector.add(`${path}.originalText`, 'correction_text_mismatch', 'Correction original text must exactly match the prior canonical segment.');
  }
  regenerated.forEach((claimId, index) => {
    const claim = claims.get(claimId);
    if (!claim) {
      collector.add(`${path}.regeneratedClaimIds[${index}]`, 'dangling_claim', 'Regenerated claim must exist in the validated analysis.');
      return;
    }
    const evidenceRefs = claim.provenance === 'conflict'
      ? (Array.isArray(claim.alternatives) ? claim.alternatives.filter(isRecord).flatMap((alternative) => Array.isArray(alternative.evidence) ? alternative.evidence.filter(isRecord) : []) : [])
      : (Array.isArray(claim.evidence) ? claim.evidence.filter(isRecord) : []);
    if (!evidenceRefs.some((reference) => reference.sourceRevisionId === object.resultingRevisionId)) {
      collector.add(`${path}.regeneratedClaimIds[${index}]`, 'regenerated_claim_revision_mismatch', 'Regenerated claims must cite the resulting source revision.');
    }
  });
  if (typeof object.id === 'string') {
    const event = events.find((candidate) => candidate.type === 'correction_recorded' && candidate.relatedId === object.id && candidate.status === 'completed');
    if (!event) collector.add(path, 'correction_event_missing', 'A correction must be backed by a completed correction event.');
    else {
      if (event.occurredAt !== object.createdAt) collector.add(`${path}.createdAt`, 'correction_event_time_mismatch', 'Correction time must match its observed event.');
      const eventActor = isRecord(event.actor) ? event.actor : undefined;
      if (!eventActor || !['browser', 'device'].includes(eventActor.location as string)) {
        collector.add(path, 'correction_actor_mismatch', 'A user correction must be recorded by the browser or device boundary.');
      }
    }
  }
}

function cloneAndFreeze<T>(value: unknown): T {
  const clone = structuredClone(value) as T;
  const freeze = (item: unknown): unknown => {
    if (typeof item !== 'object' || item === null || Object.isFrozen(item)) return item;
    Object.freeze(item);
    Object.values(item).forEach(freeze);
    return item;
  };
  return freeze(clone) as T;
}

function parserException(error: unknown): ContractParseResultV1<never> {
  return {
    success: false,
    issues: [{
      path: '$',
      code: 'parser_exception',
      message: `Input could not be safely inspected: ${error instanceof Error ? error.name : 'unknown exception'}.`,
    }],
  };
}

export function parseCanonicalSourceContextV1(input: unknown): ContractParseResultV1<CanonicalSourceContextV1> {
  try {
    const collector = new IssueCollector();
    validateCanonicalContext(input, '$', collector);
    if (collector.issues.length > 0) return { success: false, issues: collector.issues };
    return { success: true, data: cloneAndFreeze<CanonicalSourceContextV1>(input) };
  } catch (error) {
    return parserException(error);
  }
}

export function parseModelDraftV1(
  input: unknown,
  canonicalSources: unknown,
): ContractParseResultV1<ModelDraftV1> {
  try {
    const collector = new IssueCollector();
    const canonical = validateCanonicalContext(canonicalSources, '$context', collector);
    if (canonical) validateAnalysis(input, '$', collector, canonical, false);
    if (collector.issues.length > 0) return { success: false, issues: collector.issues };
    return { success: true, data: cloneAndFreeze<ModelDraftV1>(input) };
  } catch (error) {
    return parserException(error);
  }
}

export function parseActionPackV1(input: unknown): ContractParseResultV1<StructurallyValidActionPackV1> {
  try {
    const collector = new IssueCollector();
    const object = objectAt(input, '$', ['kind', 'schemaVersion', 'packId', 'createdAt', 'runMode', 'canonicalSources', 'analysis', 'receipt', 'corrections', 'limitations'], collector);
    if (object) {
    literalAt(object.kind, '$.kind', collector, ACTION_PACK_KIND_V1);
    literalAt(object.schemaVersion, '$.schemaVersion', collector, ACTION_PACK_SCHEMA_VERSION_V1);
    idAt(object.packId, '$.packId', collector);
    timestampAt(object.createdAt, '$.createdAt', collector);
    enumAt(object.runMode, '$.runMode', collector, ['sample_fixture', 'live'] as const);
    const canonical = validateCanonicalContext(object.canonicalSources, '$.canonicalSources', collector);
    if (canonical) {
      validateAnalysis(object.analysis, '$.analysis', collector, canonical, true);
      const analysis = isRecord(object.analysis) ? object.analysis : undefined;
      validateReceipt(object.receipt, '$.receipt', collector, canonical, analysis);
      const claims = Array.isArray(analysis?.claims) ? analysis.claims.filter(isRecord) : [];
      const claimMap = new Map(claims
        .filter((claim) => typeof claim.id === 'string')
        .map((claim) => [claim.id as string, claim] as const));
      const receiptEvents = isRecord(object.receipt) && Array.isArray(object.receipt.events)
        ? object.receipt.events.filter(isRecord)
        : [];
      const corrections = arrayAt(object.corrections, '$.corrections', collector, 0, MAX.corrections) ?? [];
      corrections.forEach((correction, index) => validateCorrection(correction, `$.corrections[${index}]`, collector, canonical, claimMap, receiptEvents));
      const correctionIds = corrections.filter(isRecord).map((correction) => correction.id).filter((id): id is string => typeof id === 'string');
      validateUnique(correctionIds, '$.corrections', collector);
      const receipt = isRecord(object.receipt) ? object.receipt : undefined;
      if (
        typeof object.createdAt === 'string'
        && typeof receipt?.createdAt === 'string'
        && Date.parse(object.createdAt) < Date.parse(receipt.createdAt)
      ) {
        collector.add('$.createdAt', 'pack_time_order', 'Action Pack creation cannot precede its receipt.');
      }
      if (receipt && !sameStrings(receipt.correctionIds, correctionIds)) collector.add('$.receipt.correctionIds', 'correction_receipt_mismatch', 'Receipt correction IDs must exactly match the Action Pack correction ledger.');
      // `runMode` describes whether the source bytes are a recognized fixture;
      // `processingMode` independently records where this particular run occurred.
      if (object.runMode === 'live' && receipt?.processingMode === 'sample') collector.add('$.receipt.processingMode', 'run_mode_mismatch', 'Live runs cannot use sample receipt mode.');
    }
    stringArrayAt(object.limitations, '$.limitations', collector, { minimum: 1, maximum: 100, plainText: true });
    }
    if (collector.issues.length > 0) return { success: false, issues: collector.issues };
    return { success: true, data: cloneAndFreeze<StructurallyValidActionPackV1>(input) };
  } catch (error) {
    return parserException(error);
  }
}

export function isStructurallyValidActionPackV1(input: unknown): input is StructurallyValidActionPackV1 {
  return parseActionPackV1(input).success;
}

/** @deprecated Prefer isStructurallyValidActionPackV1; shape validity is not trust. */
export const isActionPackV1 = isStructurallyValidActionPackV1;

export function formatContractIssuesV1(issues: readonly ContractIssueV1[]) {
  return issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join('\n');
}

export class ActionPackContractErrorV1 extends Error {
  readonly issues: readonly ContractIssueV1[];

  constructor(issues: readonly ContractIssueV1[]) {
    super(`PaperWork Action Pack failed validation:\n${formatContractIssuesV1(issues)}`);
    this.name = 'ActionPackContractErrorV1';
    this.issues = issues;
  }
}

export function assertActionPackV1(input: unknown): asserts input is StructurallyValidActionPackV1 {
  const result = parseActionPackV1(input);
  if (!result.success) throw new ActionPackContractErrorV1(result.issues);
}

export type {
  ActionPackV1,
  ModelDraftV1,
  StructurallyValidActionPackV1,
  ValidatedActionV1,
  ValidatedAnalysisV1,
};
