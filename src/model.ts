export type Block =
  | { id: string; kind: "heading" | "text"; text: string }
  | {
      id: string;
      kind: "image";
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
