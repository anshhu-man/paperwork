import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { groupPdfTextItemsV1 } from './pdf-lines';

test('the public synthetic PDF remains readable by the capped line path', async () => {
  const fixtureUrl = new URL('../../../public/samples/Northstar_Offer_Letter.pdf', import.meta.url);
  const loadingTask = getDocument({
    data: new Uint8Array(readFileSync(fixtureUrl)),
    stopAtErrors: true,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: 0,
  });

  try {
    const pdf = await loadingTask.promise;
    assert.equal(pdf.numPages, 2);
    const pageLines: string[][] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const reader = page.streamTextContent({ includeMarkedContent: false, disableNormalization: false }).getReader();
        const items: unknown[] = [];
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          items.push(...chunk.value.items);
        }
        pageLines.push(groupPdfTextItemsV1(items, viewport.transform).map((line) => line.text));
      } finally {
        page.cleanup();
      }
    }

    assert.ok(pageLines[0].includes('Offer of Employment'));
    assert.ok(pageLines[0].includes('We are pleased to offer you the position of Product Analyst.'));
    assert.ok(pageLines[0].includes('Please sign and return this letter by 5 September 2026.'));
    assert.ok(pageLines[1].includes('Annex A states that the probation period is six months.'));
  } finally {
    await loadingTask.destroy();
  }
});
