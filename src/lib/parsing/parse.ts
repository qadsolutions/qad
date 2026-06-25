import type { FileType } from "@/lib/documents/validation";
import { parseDocx } from "@/lib/parsing/docx";
import { DocumentParseError } from "@/lib/parsing/errors";
import { parsePdf } from "@/lib/parsing/pdf";
import { parseText } from "@/lib/parsing/text";

export interface ParseResult {
  text: string;
}

/**
 * Parse an uploaded document's raw bytes into plain text (issue #24).
 *
 * `fileType` is the same canonical type #23's upload validation already
 * resolved and persisted on the `documents` row — the future worker (#26)
 * passes it straight through, no second classification needed.
 *
 * Empty/whitespace-only extracted text (e.g. a scanned-image-only PDF with no
 * text layer) is treated as a failure, not a successful empty result — there
 * is nothing for #25 to chunk, and the AC requires this to surface as a
 * document `error`, the same as a corrupt file.
 */
export async function parse(buffer: Buffer, fileType: FileType): Promise<ParseResult> {
  const text = await extractText(buffer, fileType);
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new DocumentParseError("empty_text", "Document contains no extractable text");
  }
  return { text: trimmed };
}

async function extractText(buffer: Buffer, fileType: FileType): Promise<string> {
  switch (fileType) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "txt":
    case "md":
      return parseText(buffer);
    default: {
      const _exhaustive: never = fileType;
      throw new Error(`unhandled file type: ${String(_exhaustive)}`);
    }
  }
}
