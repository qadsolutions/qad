import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

import { DocumentParseError } from "@/lib/parsing/errors";

/**
 * Extract text from a PDF buffer. Text-extraction only (we never render a page),
 * so no standard-font data file is needed — `verbosity: ERRORS` silences
 * pdfjs-dist's otherwise-noisy font/indexing warnings, which are harmless for
 * this use case (confirmed: identical extracted text with or without them).
 */
export async function parsePdf(buffer: Buffer): Promise<string> {
  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      verbosity: VerbosityLevel.ERRORS,
    }).promise;
  } catch (err) {
    throw new DocumentParseError("corrupt_file", `Failed to open PDF: ${(err as Error).message}`);
  }

  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return pageTexts.join("\n");
  } catch (err) {
    throw new DocumentParseError(
      "corrupt_file",
      `Failed to read PDF page: ${(err as Error).message}`,
    );
  }
}
