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
};
export type Board = { id: string; title: string; color: string };
export type Camera = { x: number; y: number; zoom: number };
export type Library = {
  boards: Board[];
  cards: Card[];
  cameras: Record<string, Camera>;
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
