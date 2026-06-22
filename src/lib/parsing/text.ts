/** TXT/MD passthrough — both are already plain text, just decode as UTF-8. */
export function parseText(buffer: Buffer): string {
  return buffer.toString("utf-8");
}
