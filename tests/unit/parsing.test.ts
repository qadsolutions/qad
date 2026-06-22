import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DocumentParseError } from "@/lib/parsing/errors";
import { parsePdf } from "@/lib/parsing/pdf";
import { parseText } from "@/lib/parsing/text";

describe("DocumentParseError", () => {
  it("carries a code and is a real Error", () => {
    const err = new DocumentParseError("corrupt_file", "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("corrupt_file");
    expect(err.message).toBe("boom");
    expect(err.name).toBe("DocumentParseError");
  });
});

describe("parseText", () => {
  it("decodes a UTF-8 buffer to a string", () => {
    expect(parseText(Buffer.from("hello md/txt", "utf-8"))).toBe("hello md/txt");
  });

  it("returns an empty string for an empty buffer (caller decides what empty means)", () => {
    expect(parseText(Buffer.from("", "utf-8"))).toBe("");
  });
});

describe("parsePdf", () => {
  it("extracts text from a real PDF", async () => {
    const buffer = readFileSync("tests/fixtures/sample.pdf");
    const text = await parsePdf(buffer);
    expect(text).toContain("Hello World");
  });

  it("throws DocumentParseError(corrupt_file) for a non-PDF buffer", async () => {
    const buffer = Buffer.from("not a real pdf file at all");
    await expect(parsePdf(buffer)).rejects.toMatchObject({
      code: "corrupt_file",
    });
  });
});
