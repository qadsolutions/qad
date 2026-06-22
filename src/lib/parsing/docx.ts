import mammoth from "mammoth";

import { DocumentParseError } from "@/lib/parsing/errors";

/** Extract text from a DOCX buffer. mammoth handles the OOXML zip/XML internally. */
export async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (err) {
    throw new DocumentParseError("corrupt_file", `Failed to open DOCX: ${(err as Error).message}`);
  }
}
