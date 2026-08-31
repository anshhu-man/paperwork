import type { DocumentAgentSourceSegmentV1 } from './contracts';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function uniqueSpan(text: string, quote: string) {
  if (!quote) return undefined;
  const start = text.indexOf(quote);
  if (start < 0 || text.indexOf(quote, start + 1) >= 0) return undefined;
  return { start, end: start + quote.length };
}

function groundEvidence(
  value: unknown,
  segments: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
) {
  if (!isRecord(value)) return;
  const segment = typeof value.segmentId === 'string' ? segments.get(value.segmentId) : undefined;
  if (
    !segment
    || value.sourceRevisionId !== segment.sourceRevisionId
    || value.page !== segment.page
    || typeof value.quote !== 'string'
  ) return;
  const span = uniqueSpan(segment.text, value.quote);
  if (span) value.span = span;
}

function groundEvidenceArray(
  value: unknown,
  segments: ReadonlyMap<string, DocumentAgentSourceSegmentV1>,
) {
  if (!Array.isArray(value)) return;
  value.forEach((item) => groundEvidence(item, segments));
}

/**
 * Models are unreliable character counters. This discards provider-authored
 * offsets only when the provider's exact quote occurs once in the claimed,
 * revision/page-matched canonical segment. The strict validator still checks
 * the resulting full contract and rejects absent or ambiguous quotes.
 */
export function canonicalizeProviderEvidenceSpansV1(
  value: unknown,
  segmentsInput: readonly DocumentAgentSourceSegmentV1[],
): unknown {
  if (!isRecord(value)) return value;
  const clone = structuredClone(value) as JsonRecord;
  const segments = new Map(segmentsInput.map((segment) => [segment.segmentId, segment]));

  groundEvidenceArray(clone.documentTypeEvidence, segments);
  if (Array.isArray(clone.findings)) {
    clone.findings.forEach((finding) => {
      if (isRecord(finding)) groundEvidenceArray(finding.evidence, segments);
    });
  }
  if (Array.isArray(clone.requirements)) {
    clone.requirements.forEach((requirement) => {
      if (isRecord(requirement)) groundEvidenceArray(requirement.evidence, segments);
    });
  }
  if (Array.isArray(clone.conflicts)) {
    clone.conflicts.forEach((conflict) => {
      if (!isRecord(conflict) || !Array.isArray(conflict.alternatives)) return;
      conflict.alternatives.forEach((alternative) => {
        if (isRecord(alternative)) groundEvidenceArray(alternative.evidence, segments);
      });
    });
  }
  return clone;
}
