import { useRef, useState } from "react";
import type { Block } from "./model";
import { RichText } from "./RichText";
import { id, webUrl } from "./model";
import * as storage from "./storage";

export function ContentBlock({
  value,
  onChange,
  onFlush,
}: {
  value: Exclude<Block, { kind: "image" }>;
  onChange: (value: Block) => void;
  onFlush: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const act = async (job: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const textArea = (
    text: string,
    label: string,
    change: (text: string) => void,
  ) => (
    <textarea
      aria-label={label}
      placeholder={label}
      value={text}
      rows={1}
      spellCheck
      onBlur={onFlush}
      ref={(el) => {
        if (el) {
          el.style.height = "0px";
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      onChange={(e) => {
        change(e.target.value);
        e.target.style.height = "0px";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
    />
  );
  if (value.kind === "text")
    return (
      <RichText
        text={value.text}
        document={value.document}
        onFlush={onFlush}
        onChange={(text, document) => onChange({ ...value, text, document })}
      />
    );
  if (value.kind === "heading")
    return textArea(value.text, "Card heading", (text) =>
      onChange({ ...value, text }),
    );
  if (value.kind === "quote")
    return (
      <>
        <div className="quote-text">
          {textArea(value.text, "Quote", (text) =>
            onChange({ ...value, text }),
          )}
        </div>
        <input
          className="quote-attribution"
          aria-label="Quote attribution"
          placeholder="Attribution, optional"
          value={value.attribution}
          onBlur={onFlush}
          onChange={(e) => onChange({ ...value, attribution: e.target.value })}
        />
      </>
    );
  if (value.kind === "link") {
    const url = webUrl(value.url);
    return (
      <div className="link-content">
        <input
          aria-label="Link title"
          placeholder="Link title, optional"
          value={value.title}
          onBlur={onFlush}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
        <input
          aria-label="Link URL"
          placeholder="https://…"
          value={value.url}
          onBlur={onFlush}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
        />
        <div className="attachment-actions">
          <span>
            {url?.hostname ||
              (value.url ? "Enter an HTTP or HTTPS address" : "No address yet")}
          </span>
          <button
            disabled={!url || busy}
            onClick={() => url && void act(() => storage.openLink(url.href))}
          >
            Open link ↗
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }
  if (value.kind === "file")
    return (
      <div className="file-content">
        <strong>{value.name}</strong>
        <small>
          {value.mediaType} ·{" "}
          {new Intl.NumberFormat(undefined, {
            style: "unit",
            unit: "byte",
            notation: "compact",
          }).format(value.size)}
        </small>
        <div className="attachment-actions">
          <button
            disabled={busy || !storage.desktop}
            onClick={() => void act(() => storage.openFile(value.asset))}
          >
            Open file ↗
          </button>
          <button
            disabled={busy || !storage.desktop}
            onClick={() => void act(() => storage.openFile(value.asset, true))}
          >
            Show in Finder
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  if (value.kind !== "checklist") return null;
  const items = value.items;
  const update = (next: typeof items) => onChange({ ...value, items: next });
  const add = (after: number) => {
    const item = { id: id(), text: "", done: false };
    update([...items.slice(0, after + 1), item, ...items.slice(after + 1)]);
    requestAnimationFrame(() => inputs.current.get(item.id)?.focus());
  };
  return (
    <div className="checklist-content">
      {items.map((item, index) => (
        <div className="checklist-row" key={item.id}>
          <input
            type="checkbox"
            aria-label={`Complete ${item.text || "item"}`}
            checked={item.done}
            onChange={(e) =>
              update(
                items.map((v) =>
                  v.id === item.id ? { ...v, done: e.target.checked } : v,
                ),
              )
            }
          />
          <input
            className={item.done ? "completed" : ""}
            aria-label="Checklist item"
            placeholder="To do…"
            value={item.text}
            ref={(el) => {
              if (el) inputs.current.set(item.id, el);
              else inputs.current.delete(item.id);
            }}
            onBlur={onFlush}
            onChange={(e) =>
              update(
                items.map((v) =>
                  v.id === item.id ? { ...v, text: e.target.value } : v,
                ),
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(index);
              }
            }}
          />
          <div className="checklist-actions">
            <button
              aria-label="Move checklist item up"
              disabled={index === 0}
              onClick={() => {
                const next = [...items];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                update(next);
              }}
            >
              ↑
            </button>
            <button
              aria-label="Move checklist item down"
              disabled={index === items.length - 1}
              onClick={() => {
                const next = [...items];
                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                update(next);
              }}
            >
              ↓
            </button>
            <button
              aria-label="Remove checklist item"
              onClick={() => update(items.filter((v) => v.id !== item.id))}
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button
        className="add-checklist-item"
        onClick={() => add(items.length - 1)}
      >
        + Item
      </button>
    </div>
  );
}
