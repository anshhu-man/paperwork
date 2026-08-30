export interface PdfTextLineV1 {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TextItemLikeV1 {
  readonly str: string;
  readonly dir?: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly hasEOL?: boolean;
}

interface MutableLineV1 {
  parts: string[];
  direction: string;
  baseline: number;
  fontHeight: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  previousStart: number;
  previousEnd: number;
}

export class PdfLayoutAmbiguityErrorV1 extends Error {
  readonly reason: 'invalid_text_geometry' | 'non_monotonic_text_order' | 'overlapping_text';

  constructor(reason: PdfLayoutAmbiguityErrorV1['reason']) {
    super(reason);
    this.name = 'PdfLayoutAmbiguityErrorV1';
    this.reason = reason;
  }
}

function multiplyTransform(left: readonly number[], right: readonly number[]) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ] as const;
}

function flushLine(line: MutableLineV1 | undefined, output: PdfTextLineV1[]) {
  if (!line) return;
  const text = line.parts.join('').replace(/[ \t]+/g, ' ').trim();
  if (!text) return;
  output.push({
    text,
    x: line.x0,
    y: line.y0,
    width: Math.max(0.01, line.x1 - line.x0),
    height: Math.max(0.01, line.y1 - line.y0),
  });
}

/** Pure, deterministic line grouping used by the browser extractor and unit tests. */
export function groupPdfTextItemsV1(
  rawItems: readonly unknown[],
  viewportTransform: readonly number[],
): readonly PdfTextLineV1[] {
  if (
    viewportTransform.length !== 6
    || viewportTransform.some((value) => !Number.isFinite(value))
    || Math.hypot(viewportTransform[0], viewportTransform[1]) <= 0
  ) throw new PdfLayoutAmbiguityErrorV1('invalid_text_geometry');

  const output: PdfTextLineV1[] = [];
  let current: MutableLineV1 | undefined;

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object' || !('str' in rawItem)) continue;
    const item = rawItem as TextItemLikeV1;
    if (typeof item.str !== 'string') continue;
    if (
      !Array.isArray(item.transform)
      || item.transform.length !== 6
      || item.transform.some((value) => !Number.isFinite(value))
      || !Number.isFinite(item.width)
      || !Number.isFinite(item.height)
      || item.width < 0
      || item.height < 0
    ) throw new PdfLayoutAmbiguityErrorV1('invalid_text_geometry');
    const text = item.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (!text.trim() && !item.hasEOL) continue;

    const transform = multiplyTransform(viewportTransform, item.transform);
    if (transform.some((value) => !Number.isFinite(value))) {
      throw new PdfLayoutAmbiguityErrorV1('invalid_text_geometry');
    }
    const x = transform[4];
    const baseline = transform[5];
    const fontHeight = Math.max(1, Math.abs(transform[3]), Math.abs(transform[2]), Math.abs(item.height || 0));
    const renderedWidth = Math.max(0.01, Math.abs((item.width || text.length * fontHeight * 0.45) * Math.hypot(viewportTransform[0], viewportTransform[1])));
    if (!Number.isFinite(fontHeight) || !Number.isFinite(renderedWidth)) {
      throw new PdfLayoutAmbiguityErrorV1('invalid_text_geometry');
    }
    const y0 = baseline - fontHeight;
    const y1 = baseline + fontHeight * 0.18;
    const direction = item.dir || 'ltr';

    const startsNewLine = current && (
      direction !== current.direction
      || Math.abs(baseline - current.baseline) > Math.max(2, Math.max(fontHeight, current.fontHeight) * 0.7)
    );
    if (startsNewLine) {
      flushLine(current, output);
      current = undefined;
    }

    if (current) {
      const orderTolerance = Math.max(2, Math.max(fontHeight, current.fontHeight) * 0.35);
      const overlapTolerance = Math.max(1, Math.max(fontHeight, current.fontHeight) * 0.15);
      const movesBackwards = direction === 'rtl'
        ? x > current.previousStart + orderTolerance
        : x < current.previousStart - orderTolerance;
      if (movesBackwards) throw new PdfLayoutAmbiguityErrorV1('non_monotonic_text_order');

      const overlapsPrior = direction !== 'rtl'
        && x >= current.previousStart - orderTolerance
        && x < current.previousEnd - overlapTolerance;
      if (overlapsPrior) throw new PdfLayoutAmbiguityErrorV1('overlapping_text');

      // A very large visual gap is safer as a new segment. It commonly marks
      // columns, headers, or label/value cells that must not become one quote.
      const geometricGap = direction === 'rtl' ? current.previousStart - (x + renderedWidth) : x - current.previousEnd;
      if (geometricGap > Math.max(24, Math.max(fontHeight, current.fontHeight) * 6)) {
        flushLine(current, output);
        current = undefined;
      }
    }

    if (!current) {
      current = {
        parts: [],
        direction,
        baseline,
        fontHeight,
        x0: x,
        y0,
        x1: x + renderedWidth,
        y1,
        previousStart: x,
        previousEnd: x,
      };
    }

    if (current.parts.length > 0) {
      const prior = current.parts[current.parts.length - 1];
      const geometricGap = x - current.previousEnd;
      if (!/\s$/.test(prior) && !/^\s/.test(text) && geometricGap > Math.max(0.5, fontHeight * 0.08)) current.parts.push(' ');
    }
    current.parts.push(text);
    current.baseline = baseline;
    current.fontHeight = Math.max(current.fontHeight, fontHeight);
    current.x0 = Math.min(current.x0, x);
    current.y0 = Math.min(current.y0, y0);
    current.x1 = Math.max(current.x1, x + renderedWidth);
    current.y1 = Math.max(current.y1, y1);
    current.previousStart = x;
    current.previousEnd = x + renderedWidth;

    if (item.hasEOL) {
      flushLine(current, output);
      current = undefined;
    }
  }

  flushLine(current, output);
  return output;
}
