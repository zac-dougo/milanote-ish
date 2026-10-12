import { useLayoutEffect, useRef, useState } from "react";
import type { TextDocument } from "./rich-text";
import {
  plainDocument,
  readDocument,
  writeDocument,
  documentText,
} from "./rich-text";
import { webUrl } from "./model";
import * as storage from "./storage";

export function RichText({
  text,
  document: saved,
  onChange,
  onFlush,
}: {
  text: string;
  document?: TextDocument;
  onChange: (text: string, document: TextDocument) => void;
  onFlush: () => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const last = useRef("");
  const selection = useRef<Range | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  const value = saved ?? plainDocument(text);
  const key = JSON.stringify(value);
  useLayoutEffect(() => {
    if (node.current && key !== last.current) {
      writeDocument(node.current, value);
      last.current = key;
    }
  }, [key]);
  const commit = () => {
    if (!node.current) return;
    const doc = readDocument(node.current);
    last.current = JSON.stringify(doc);
    onChange(documentText(doc), doc);
  };
  const remember = () => {
    const range = window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0)
      : undefined;
    if (range && node.current?.contains(range.commonAncestorContainer))
      selection.current = range.cloneRange();
  };
  const restore = () => {
    node.current?.focus();
    if (
      selection.current &&
      node.current?.contains(selection.current.commonAncestorContainer)
    ) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(selection.current);
    }
  };
  const command = (name: string, argument?: string) => {
    restore();
    document.execCommand(name, false, argument);
    commit();
    remember();
  };
  return (
    <div className="rich-text-wrap">
      <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
        {(
          [
            ["bold", "Bold", "B"],
            ["italic", "Italic", "I"],
            ["underline", "Underline", "U"],
            ["strikeThrough", "Strikethrough", "S"],
            ["insertUnorderedList", "Bullet list", "• List"],
            ["insertOrderedList", "Numbered list", "1. List"],
          ] as const
        ).map(([name, label, display]) => (
          <button
            key={name}
            aria-label={label}
            onPointerDown={(e) => {
              e.preventDefault();
              remember();
            }}
            onClick={() => command(name)}
          >
            {display}
          </button>
        ))}
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            remember();
          }}
          onClick={() => setLink("")}
        >
          Link
        </button>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            remember();
          }}
          onClick={() => command("unlink")}
        >
          Unlink
        </button>
      </div>
      {link !== null && (
        <div className="rich-link-entry">
          <input
            autoFocus
            aria-label="Text hyperlink URL"
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button
            disabled={!webUrl(link)}
            onClick={() => {
              const url = webUrl(link);
              if (url) command("createLink", url.href);
              setLink(null);
            }}
          >
            Apply
          </button>
          <button
            onClick={() => {
              setLink(null);
              restore();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      <div
        ref={node}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Card text"
        className="rich-text"
        onInput={commit}
        onBlur={() => {
          remember();
          onFlush();
        }}
        onKeyUp={remember}
        onPointerUp={remember}
        onPaste={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const html = e.clipboardData.getData("text/html");
          const parsed = html
            ? new DOMParser().parseFromString(html, "text/html")
            : null;
          const doc = parsed
            ? readDocument(parsed.body)
            : plainDocument(e.clipboardData.getData("text/plain"));
          const safe = window.document.createElement("div");
          writeDocument(safe, doc);
          // insertHTML receives only HTML built by writeDocument from the supported subset.
          document.execCommand("insertHTML", false, safe.innerHTML);
          commit();
        }}
        onClick={(e) => {
          const anchor = (e.target as HTMLElement).closest("a");
          if (anchor) {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey) {
              const url = webUrl(anchor.href);
              if (url)
                void storage
                  .openLink(url.href)
                  .catch((error) => setError(String(error)));
            }
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
