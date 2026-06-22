import { describe, expect, it } from "vitest";
import { DocumentParseError } from "@/lib/parsing/errors";
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
