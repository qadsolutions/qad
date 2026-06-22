import { describe, expect, it, vi } from "vitest";

// Isolated from parsing.test.ts: this mocks pdfjs-dist's getDocument to simulate a
// PDF that opens successfully but fails while reading an individual page (A1) —
// not reproducible with a real fixture without hand-crafting a malformed PDF byte stream.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: vi.fn((pageNumber: number) => {
        if (pageNumber === 2) {
          throw new Error("bad XRef entry");
        }
        return Promise.resolve({
          getTextContent: () => Promise.resolve({ items: [{ str: "page one text" }] }),
        });
      }),
    }),
  })),
  VerbosityLevel: { ERRORS: 0 },
}));

const { parsePdf } = await import("@/lib/parsing/pdf");

describe("parsePdf — corrupt page after a successful open", () => {
  it("throws DocumentParseError(corrupt_file) when a page fails to load", async () => {
    await expect(parsePdf(Buffer.from("irrelevant — getDocument is mocked"))).rejects.toMatchObject(
      { code: "corrupt_file" },
    );
  });
});
