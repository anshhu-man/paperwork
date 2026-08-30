import {
  getDocument,
  type PDFDocumentLoadingTask,
  PDFWorker as PdfJsPdfWorker,
  version as pdfJsVersion,
} from 'pdfjs-dist';
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

import type {
  CanonicalSourceContextV1,
  ProcessingEventV1,
  SourceSegmentV1,
} from '../../action-pack/v1/contracts';
import { parseCanonicalSourceContextV1 } from '../../action-pack/v1/validate';
import {
  PdfLayoutAmbiguityErrorV1,
  groupPdfTextItemsV1,
} from './pdf-lines';

export const LOCAL_PDF_LIMITS_V1 = Object.freeze({
  maximumBytes: 10 * 1024 * 1024,
  maximumPages: 50,
  maximumSegments: 10_000,
  maximumCharacters: 2_000_000,
  maximumCharactersPerPage: 200_000,
  maximumTextItemsPerPage: 25_000,
  maximumDurationMs: 30_000,
});

const LOCAL_PDF_CLEANUP_GRACE_MS_V1 = 1_000;

export type LocalPdfFailureCodeV1 =
  | 'empty_file'
  | 'file_too_large'
  | 'unsupported_file_type'
  | 'page_limit_exceeded'
  | 'password_required'
  | 'malformed_pdf'
  | 'unsupported_pdf'
  | 'ocr_required'
  | 'extraction_limit_exceeded'
  | 'cancelled'
  | 'timed_out'
  | 'extractor_unavailable'
  | 'invalid_extractor_output'
  | 'extraction_failed';

export type LocalPdfProgressV1 =
  | { readonly stage: 'opening' }
  | { readonly stage: 'extracting'; readonly page: number; readonly totalPages: number };

export class LocalPdfExtractionErrorV1 extends Error {
  readonly code: LocalPdfFailureCodeV1;

  constructor(code: LocalPdfFailureCodeV1) {
    super(code);
    this.name = 'LocalPdfExtractionErrorV1';
    this.code = code;
  }
}

export interface LocalPdfExtractionV1 {
  readonly canonicalSources: CanonicalSourceContextV1;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly fingerprint: string;
  readonly parserVersion: string;
  readonly admittedAt: string;
  readonly extractedAt: string;
  readonly observedEvents: readonly [ProcessingEventV1, ProcessingEventV1];
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new LocalPdfExtractionErrorV1('cancelled');
}

function safeFileName(name: string) {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f<>]/g, '_')
    .replace(/javascript\s*:/gi, 'javascript_')
    .replace(/\bon[a-z]+\s*=/gi, 'attribute_')
    .trim()
    .slice(0, 300);
  return cleaned || 'document.pdf';
}

function bytesContainPdfSignature(bytes: Uint8Array) {
  const limit = Math.min(bytes.length - 4, 1_024);
  for (let index = 0; index <= limit; index += 1) {
    if (
      bytes[index] === 0x25
      && bytes[index + 1] === 0x50
      && bytes[index + 2] === 0x44
      && bytes[index + 3] === 0x46
      && bytes[index + 4] === 0x2d
    ) return true;
  }
  return false;
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function repeatedLineKey(text: string) {
  return text
    .toLowerCase()
    .replace(/\bpage\s+\d+\b/g, 'page #')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractionErrorCode(error: unknown, signal?: AbortSignal): LocalPdfFailureCodeV1 {
  if (signal?.aborted) return 'cancelled';
  if (error instanceof LocalPdfExtractionErrorV1) return error.code;
  if (error instanceof PdfLayoutAmbiguityErrorV1) return 'unsupported_pdf';
  if (error instanceof Error && error.name === 'PasswordException') return 'password_required';
  if (error instanceof Error && (error.name === 'InvalidPDFException' || error.name === 'MissingPDFException')) return 'malformed_pdf';
  if (error instanceof Error && error.name === 'UnknownErrorException') return 'unsupported_pdf';
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  return 'extraction_failed';
}

function localPdfRuntimeAvailableV1() {
  const promiseConstructor = Promise as PromiseConstructor & { readonly withResolvers?: unknown };
  return (
    typeof Worker !== 'undefined'
    && typeof globalThis.location?.href === 'string'
    && typeof globalThis.crypto?.subtle?.digest === 'function'
    && typeof globalThis.structuredClone === 'function'
    && typeof promiseConstructor.withResolvers === 'function'
  );
}

interface LocalPdfOperationGuardV1 {
  readonly wait: <T>(promise: PromiseLike<T>) => Promise<T>;
  readonly throwIfStopped: () => void;
  readonly stop: (code: 'cancelled' | 'timed_out' | 'extractor_unavailable') => void;
  readonly addStopHandler: (handler: () => void) => () => void;
  readonly dispose: () => void;
}

function createLocalPdfOperationGuardV1(signal?: AbortSignal): LocalPdfOperationGuardV1 {
  let stoppedError: LocalPdfExtractionErrorV1 | undefined;
  let rejectStop!: (error: LocalPdfExtractionErrorV1) => void;
  const stopHandlers = new Set<() => void>();
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });

  const stop = (code: 'cancelled' | 'timed_out' | 'extractor_unavailable') => {
    if (stoppedError) return;
    stoppedError = new LocalPdfExtractionErrorV1(code);
    for (const handler of stopHandlers) {
      try { handler(); } catch { /* best-effort forced cleanup */ }
    }
    rejectStop(stoppedError);
  };
  const abort = () => stop('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('timed_out'), LOCAL_PDF_LIMITS_V1.maximumDurationMs);

  return {
    wait: async <T>(promise: PromiseLike<T>) => Promise.race([Promise.resolve(promise), stopped]),
    throwIfStopped: () => { if (stoppedError) throw stoppedError; },
    stop,
    addStopHandler: (handler) => {
      stopHandlers.add(handler);
      if (stoppedError) handler();
      return () => stopHandlers.delete(handler);
    },
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      stopHandlers.clear();
    },
  };
}

async function settleWithinV1(promise: Promise<unknown>, maximumMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, maximumMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function extractLocalPdfV1(
  file: File,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: LocalPdfProgressV1) => void;
  } = {},
): Promise<LocalPdfExtractionV1> {
  const { signal, onProgress } = options;
  abortIfNeeded(signal);
  if (file.size === 0) throw new LocalPdfExtractionErrorV1('empty_file');
  if (file.size > LOCAL_PDF_LIMITS_V1.maximumBytes) throw new LocalPdfExtractionErrorV1('file_too_large');
  if (!localPdfRuntimeAvailableV1()) throw new LocalPdfExtractionErrorV1('extractor_unavailable');

  const guard = createLocalPdfOperationGuardV1(signal);
  let workerPort: Worker | undefined;
  let pdfWorker: InstanceType<typeof PdfJsPdfWorker> | undefined;
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let loadingTaskDestroy: Promise<void> | undefined;
  let activeReaderCancel: (() => Promise<void>) | undefined;
  let forcedStop = false;
  let workerErrorHandler: (() => void) | undefined;

  const beginLoadingTaskDestroy = () => {
    if (!loadingTask) return undefined;
    loadingTaskDestroy ??= loadingTask.destroy().then(() => undefined, () => undefined);
    return loadingTaskDestroy;
  };
  const unregisterForcedStop = guard.addStopHandler(() => {
    forcedStop = true;
    void activeReaderCancel?.();
    try { workerPort?.terminate(); } catch { /* already terminated */ }
    try { pdfWorker?.destroy(); } catch { /* best-effort hard stop */ }
    void beginLoadingTaskDestroy();
  });

  try {
    onProgress?.({ stage: 'opening' });
    const inputBuffer = await guard.wait(file.arrayBuffer());
    guard.throwIfStopped();
    const inputBytes = new Uint8Array(inputBuffer);
    if (!bytesContainPdfSignature(inputBytes)) throw new LocalPdfExtractionErrorV1('unsupported_file_type');

    const fingerprint = toHex(await guard.wait(crypto.subtle.digest('SHA-256', inputBytes)));
    guard.throwIfStopped();
    const admittedAt = new Date().toISOString();
    const sourceId = `source.${fingerprint.slice(0, 24)}`;
    const sourceRevisionId = `revision.${fingerprint.slice(0, 24)}`;

    try {
      if (globalThis.location.origin === 'null') {
        throw new LocalPdfExtractionErrorV1('extractor_unavailable');
      }
      workerPort = new PdfJsWorker({ name: 'paperwork-pdf-extractor' });
      workerErrorHandler = () => guard.stop('extractor_unavailable');
      workerPort.addEventListener('error', workerErrorHandler, { once: true });
      workerPort.addEventListener('messageerror', workerErrorHandler, { once: true });
      pdfWorker = PdfJsPdfWorker.create({ port: workerPort });
    } catch (error) {
      if (error instanceof LocalPdfExtractionErrorV1) throw error;
      throw new LocalPdfExtractionErrorV1('extractor_unavailable');
    }

    const pdfBytes = new Uint8Array(inputBuffer.slice(0));
    loadingTask = getDocument({
      data: pdfBytes,
      worker: pdfWorker,
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

    const pdf = await guard.wait(loadingTask.promise);
    guard.throwIfStopped();
    if (pdf.numPages > LOCAL_PDF_LIMITS_V1.maximumPages) throw new LocalPdfExtractionErrorV1('page_limit_exceeded');

    const sourceSegments: SourceSegmentV1[] = [];
    const pageLineTexts: string[][] = [];
    let totalCharacters = 0;
    let totalInputCharacters = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      guard.throwIfStopped();
      onProgress?.({ stage: 'extracting', page: pageNumber, totalPages: pdf.numPages });

      const page = await guard.wait(pdf.getPage(pageNumber));
      try {
        guard.throwIfStopped();
        const viewport = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(viewport.width)
          || !Number.isFinite(viewport.height)
          || viewport.width <= 0
          || viewport.height <= 0
          || viewport.width > 100_000
          || viewport.height > 100_000
        ) throw new LocalPdfExtractionErrorV1('unsupported_pdf');

        const rawItems: unknown[] = [];
        let pageInputCharacters = 0;
        const reader = page.streamTextContent({ includeMarkedContent: false, disableNormalization: false }).getReader();
        let readerCancelled: Promise<void> | undefined;
        const cancelReader = () => {
          readerCancelled ??= reader.cancel().then(() => undefined, () => undefined);
          return readerCancelled;
        };
        activeReaderCancel = cancelReader;
        let streamCompleted = false;
        try {
          while (true) {
            const chunk = await guard.wait(reader.read());
            guard.throwIfStopped();
            if (chunk.done) {
              streamCompleted = true;
              break;
            }
            if (!chunk.value || !Array.isArray(chunk.value.items)) {
              throw new LocalPdfExtractionErrorV1('invalid_extractor_output');
            }
            if (rawItems.length + chunk.value.items.length > LOCAL_PDF_LIMITS_V1.maximumTextItemsPerPage) {
              throw new LocalPdfExtractionErrorV1('extraction_limit_exceeded');
            }
            for (const item of chunk.value.items) {
              if (item && typeof item === 'object' && 'str' in item && typeof item.str === 'string') {
                pageInputCharacters += item.str.length;
                totalInputCharacters += item.str.length;
                if (
                  pageInputCharacters > LOCAL_PDF_LIMITS_V1.maximumCharactersPerPage
                  || totalInputCharacters > LOCAL_PDF_LIMITS_V1.maximumCharacters
                ) throw new LocalPdfExtractionErrorV1('extraction_limit_exceeded');
              }
              rawItems.push(item);
            }
          }
        } finally {
          activeReaderCancel = undefined;
          if (!streamCompleted) await settleWithinV1(cancelReader(), 250);
        }

        guard.throwIfStopped();
        const lines = groupPdfTextItemsV1(rawItems, viewport.transform);
        pageLineTexts.push(lines.map((line) => line.text));
        const pageCharacters = lines.reduce((total, line) => total + line.text.length, 0);
        const alphaNumericCount = lines.reduce((total, line) => total + (line.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0);
        if (alphaNumericCount < 10) throw new LocalPdfExtractionErrorV1('ocr_required');
        if (pageCharacters > LOCAL_PDF_LIMITS_V1.maximumCharactersPerPage) throw new LocalPdfExtractionErrorV1('extraction_limit_exceeded');
        totalCharacters += pageCharacters;
        if (totalCharacters > LOCAL_PDF_LIMITS_V1.maximumCharacters) throw new LocalPdfExtractionErrorV1('extraction_limit_exceeded');

        if (sourceSegments.length + lines.length > LOCAL_PDF_LIMITS_V1.maximumSegments) {
          throw new LocalPdfExtractionErrorV1('extraction_limit_exceeded');
        }
        for (const line of lines) {
          const x = clamp(line.x / viewport.width, 0, 1);
          const y = clamp(line.y / viewport.height, 0, 1);
          const width = clamp(line.width / viewport.width, Number.EPSILON, Math.max(Number.EPSILON, 1 - x));
          const height = clamp(line.height / viewport.height, Number.EPSILON, Math.max(Number.EPSILON, 1 - y));
          const index = sourceSegments.length;
          sourceSegments.push({
            id: `segment.${fingerprint.slice(0, 12)}.p${pageNumber}.b${index}`,
            sourceId,
            sourceRevisionId,
            index,
            text: line.text,
            anchor: {
              kind: 'page_region',
              page: pageNumber,
              region: { unit: 'normalized', x, y, width, height },
            },
            extraction: {
              method: 'native_text',
              engine: 'pdfjs-dist',
              version: pdfJsVersion,
              extractedAt: new Date().toISOString(),
            },
          });
        }
      } finally {
        try { page.cleanup(); } catch { /* document teardown remains authoritative */ }
      }
    }

    guard.throwIfStopped();
    if (totalCharacters < 40) throw new LocalPdfExtractionErrorV1('ocr_required');
    if (pageLineTexts.length > 1) {
      const linePageCounts = new Map<string, number>();
      pageLineTexts.forEach((lines) => {
        const pageKeys = new Set(lines.map(repeatedLineKey).filter(Boolean));
        pageKeys.forEach((key) => linePageCounts.set(key, (linePageCounts.get(key) ?? 0) + 1));
      });
      for (const lines of pageLineTexts) {
        const nonBoilerplateCharacters = lines
          .filter((line) => linePageCounts.get(repeatedLineKey(line)) !== pageLineTexts.length)
          .reduce((total, line) => total + (line.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0);
        if (nonBoilerplateCharacters < 10) throw new LocalPdfExtractionErrorV1('ocr_required');
      }
    }

    const extractedAt = new Date().toISOString();
    const canonicalCandidate: CanonicalSourceContextV1 = {
      sources: [{
        id: sourceId,
        displayName: safeFileName(file.name),
        kind: 'file',
        mediaType: 'application/pdf',
        byteSize: file.size,
        pageCount: pdf.numPages,
        origin: { kind: 'upload' },
      }],
      sourceRevisions: [{
        id: sourceRevisionId,
        sourceId,
        fingerprint: { algorithm: 'sha-256', value: fingerprint },
        createdAt: admittedAt,
        status: 'active',
      }],
      sourceSegments,
    };
    const parsedCanonical = parseCanonicalSourceContextV1(canonicalCandidate);
    if (!parsedCanonical.success) throw new LocalPdfExtractionErrorV1('invalid_extractor_output');

    const observedEvents = [
      {
        id: `event.${fingerprint.slice(0, 12)}.source`,
        sequence: 0,
        occurredAt: admittedAt,
        type: 'source_admitted',
        status: 'completed',
        actor: { location: 'browser', name: 'PaperWork local PDF admission' },
        relatedId: sourceId,
      },
      {
        id: `event.${fingerprint.slice(0, 12)}.extraction`,
        sequence: 1,
        occurredAt: extractedAt,
        type: 'extraction_completed',
        status: 'completed',
        actor: { location: 'browser', name: 'PaperWork local PDF extractor' },
        relatedId: sourceRevisionId,
      },
    ] as const satisfies readonly [ProcessingEventV1, ProcessingEventV1];

    guard.throwIfStopped();
    return {
      canonicalSources: parsedCanonical.data,
      sourceId,
      sourceRevisionId,
      fingerprint,
      parserVersion: pdfJsVersion,
      admittedAt,
      extractedAt,
      observedEvents,
    };
  } catch (error) {
    throw new LocalPdfExtractionErrorV1(extractionErrorCode(error, signal));
  } finally {
    unregisterForcedStop();
    guard.dispose();
    if (!forcedStop) {
      const destroy = beginLoadingTaskDestroy();
      if (destroy) await settleWithinV1(destroy, LOCAL_PDF_CLEANUP_GRACE_MS_V1);
    }
    if (workerPort && workerErrorHandler) {
      workerPort.removeEventListener('error', workerErrorHandler);
      workerPort.removeEventListener('messageerror', workerErrorHandler);
    }
    try { pdfWorker?.destroy(); } catch { /* already destroyed with the loading task */ }
    try { workerPort?.terminate(); } catch { /* already terminated */ }
  }
}
