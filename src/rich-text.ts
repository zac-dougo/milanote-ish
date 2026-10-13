import { webUrl } from "./model.ts";

export type TextSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  href?: string;
};
export type TextLine = {
  kind: "paragraph" | "bullet" | "number";
  spans: TextSpan[];
};
export type TextDocument = TextLine[];
export const plainDocument = (text: string): TextDocument =>
  text.split("\n").map((text) => ({ kind: "paragraph", spans: [{ text }] }));
export const documentText = (doc: TextDocument) =>
  doc.map((line) => line.spans.map((span) => span.text).join("")).join("\n");

// Construct only supported elements and attributes. Saved/clipboard HTML is never injected.
export function writeDocument(root: HTMLElement, doc: TextDocument) {
  root.replaceChildren();
  let list: HTMLElement | undefined;
  for (const line of doc) {
    const tag =
      line.kind === "bullet" ? "ul" : line.kind === "number" ? "ol" : null;
    if (!tag || list?.tagName.toLowerCase() !== tag) list = undefined;
    if (tag && !list) {
      list = document.createElement(tag);
      root.append(list);
    }
    const row = document.createElement(tag ? "li" : "p");
    (list ?? root).append(row);
    for (const span of line.spans) {
      let node: Node = document.createTextNode(span.text);
      const tags = [
        span.bold && "strong",
        span.italic && "em",
        span.underline && "u",
        span.strike && "s",
      ];
      for (const tag of tags)
        if (tag) {
          const wrapper = document.createElement(tag);
          wrapper.append(node);
          node = wrapper;
        }
      const url = span.href && webUrl(span.href);
      if (url) {
        const link = document.createElement("a");
        link.href = url.href;
        link.append(node);
        node = link;
      }
      row.append(node);
    }
    if (!row.textContent) row.append(document.createElement("br"));
  }
}

export function readDocument(root: HTMLElement): TextDocument {
  const lines: TextDocument = [];
  let current: TextLine = { kind: "paragraph", spans: [] };
  const finish = (force = false) => {
    if (force || current.spans.length) lines.push(current);
    current = { kind: "paragraph", spans: [] };
  };
  const walk = (node: Node, marks: Omit<TextSpan, "text"> = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text) current.spans.push({ ...marks, text });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "noscript"].includes(tag))
      return;
    if (tag === "br") {
      if (node.parentElement?.childNodes.length !== 1) finish(true);
      return;
    }
    const block = ["p", "div", "li", "h1", "h2", "h3", "blockquote"].includes(
      tag,
    );
    if (block) {
      finish();
      current.kind =
        tag === "li"
          ? node.parentElement?.tagName === "OL"
            ? "number"
            : "bullet"
          : "paragraph";
    }
    const before = lines.length;
    const next = { ...marks };
    if (
      ["b", "strong"].includes(tag) ||
      Number(node.style.fontWeight) >= 600 ||
      node.style.fontWeight === "bold"
    )
      next.bold = true;
    if (["i", "em"].includes(tag) || node.style.fontStyle === "italic")
      next.italic = true;
    if (tag === "u" || node.style.textDecoration.includes("underline"))
      next.underline = true;
    if (
      ["s", "strike", "del"].includes(tag) ||
      node.style.textDecoration.includes("line-through")
    )
      next.strike = true;
    if (tag === "a") {
      const url = webUrl(node.getAttribute("href") || "");
      if (url) next.href = url.href;
    }
    node.childNodes.forEach((child) => walk(child, next));
    if (block) finish(current.spans.length > 0 || lines.length === before);
  };
  root.childNodes.forEach((node) => walk(node));
  finish();
  return lines.length ? lines : plainDocument("");
}
