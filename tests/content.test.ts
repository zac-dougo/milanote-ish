import { test } from "node:test";
import assert from "node:assert/strict";
import { blockLabel, contentBlock, webUrl } from "../src/model.ts";
import { documentText, plainDocument } from "../src/rich-text.ts";

test("mixed-content presets produce independent identifiers and retain labels", () => {
  const a = contentBlock("checklist"), b = contentBlock("checklist");
  assert.notEqual(a.id, b.id);
  if (a.kind !== "checklist" || b.kind !== "checklist") throw new Error("Wrong preset");
  assert.notEqual(a.items[0].id, b.items[0].id);
  a.items[0].text = "Opening shot";
  assert.equal(blockLabel(a), "Opening shot");
  assert.equal(blockLabel({ id: "file", kind: "file", asset: "asset.pdf", name: "script.pdf", size: 12, mediaType: "application/pdf" }), "script.pdf");
});

test("only explicit HTTP/HTTPS URLs without embedded credentials can launch", () => {
  for (const value of ["javascript:alert(1)", "file:///tmp/data", "https://user:secret@example.com", "example.com", "invalid"]) assert.equal(webUrl(value), null);
  assert.equal(webUrl(" https://example.com/path ")?.hostname, "example.com");
});

test("semantic rich text retains readable paragraphs and lists", () => {
  assert.equal(documentText(plainDocument("One\n\nThree")), "One\n\nThree");
  assert.equal(documentText([{ kind: "bullet", spans: [{ text: "A", bold: true }, { text: " list", href: "https://example.com" }] }]), "A list");
});
