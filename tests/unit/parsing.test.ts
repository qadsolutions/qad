import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DocumentParseError } from "@/lib/parsing/errors";
import { parseDocx } from "@/lib/parsing/docx";
import { parse } from "@/lib/parsing/parse";
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

describe("parseDocx", () => {
  it("extracts text from a real DOCX", async () => {
    const buffer = readFileSync("tests/fixtures/sample.docx");
    const text = await parseDocx(buffer);
    expect(text).toContain("Hello World");
  });

  it("throws DocumentParseError(corrupt_file) for a non-DOCX buffer", async () => {
    const buffer = Buffer.from("not a real docx file at all");
    await expect(parseDocx(buffer)).rejects.toMatchObject({
      code: "corrupt_file",
    });
  });
});

describe("parse (dispatcher)", () => {
  it("routes pdf to parsePdf and trims trailing whitespace", async () => {
    const buffer = readFileSync("tests/fixtures/sample.pdf");
    const result = await parse(buffer, "pdf");
    expect(result.text).toBe("Hello World");
  });

  it("routes docx to parseDocx and trims mammoth's trailing newlines", async () => {
    const buffer = readFileSync("tests/fixtures/sample.docx");
    const result = await parse(buffer, "docx");
    expect(result.text).toBe("Hello World");
  });

  it("routes txt/md to parseText", async () => {
    const buffer = Buffer.from("plain text content", "utf-8");
    expect((await parse(buffer, "txt")).text).toBe("plain text content");
    expect((await parse(buffer, "md")).text).toBe("plain text content");
  });

  it("throws DocumentParseError(empty_text) when extracted text is empty or whitespace-only", async () => {
    await expect(parse(Buffer.from("   \n  ", "utf-8"), "txt")).rejects.toMatchObject({
      code: "empty_text",
    });
    await expect(parse(Buffer.from("", "utf-8"), "txt")).rejects.toMatchObject({
      code: "empty_text",
    });
  });
});
