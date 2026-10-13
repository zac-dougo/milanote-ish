import type { TextDocument } from "./rich-text";
export type Block =
  | {
      id: string;
      kind: "heading" | "text";
      text: string;
      document?: TextDocument;
    }
  | { id: string; kind: "quote"; text: string; attribution: string }
  | { id: string; kind: "link"; url: string; title: string }
  | {
      id: string;
      kind: "checklist";
      items: { id: string; text: string; done: boolean }[];
    }
  | {
      id: string;
      kind: "file";
      asset: string;
      name: string;
      size: number;
      mediaType: string;
    }
  | {
      id: string;
      kind: "image";
      alt?: string;
      asset: string;
      thumbnail: string;
      name: string;
    };

export type Card = {
  id: string;
  boardId: string;
  x: number;
  y: number;
  width: number;
  color: string;
  blocks: Block[];
  trashed?: boolean;
  order?: number;
};
export type Board = {
  id: string;
  title: string;
  color: string;
  parentId: string | null;
  x: number;
  y: number;
  trashed: boolean;
  order: number;
};
export type Camera = { x: number; y: number; zoom: number };
export type Connector = {
  id: string;
  boardId: string;
  fromId: string;
  toId: string;
  arrow: "none" | "target";
  color: string;
  trashed: boolean;
};
export type Library = {
  boards: Board[];
  cards: Card[];
  connectors: Connector[];
  cameras: Record<string, Camera>;
  lastCanvas: string | null;
};
export const COLORS = ["paper", "yellow", "blue", "pink", "green"] as const;
export const INITIAL_CAMERA: Camera = { x: 64, y: 64, zoom: 1 };
export const id = () => crypto.randomUUID();
export const block = (kind: "heading" | "text", text = ""): Block => ({
  id: id(),
  kind,
  text,
});

export function makeCard(
  boardId: string,
  x: number,
  y: number,
  blocks?: Block[],
): Card {
  return {
    id: id(),
    boardId,
    x,
    y,
    width: 320,
    color: "paper",
    blocks: blocks ?? [block("text")],
  };
}

export type Preset = "text" | "quote" | "link" | "checklist";
export function contentBlock(kind: Preset): Block {
  if (kind === "quote") return { id: id(), kind, text: "", attribution: "" };
  if (kind === "link") return { id: id(), kind, url: "", title: "" };
  if (kind === "checklist")
    return { id: id(), kind, items: [{ id: id(), text: "", done: false }] };
  return block("text");
}
export function blockLabel(b: Block): string {
  switch (b.kind) {
    case "image":
    case "file":
      return b.name;
    case "link":
      return b.title || b.url;
    case "checklist":
      return b.items.map((item) => item.text).find(Boolean) || "Checklist";
    default:
      return b.text;
  }
}
export function webUrl(value: string): URL | null {
  try {
    const trimmed = value.trim();
    if (/\s|[\u0000-\u001f]/.test(trimmed)) return null;
    const url = new URL(trimmed);
    return ["http:", "https:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
