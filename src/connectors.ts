import type { Board, Card, Connector } from "./model.ts";
import { isBoardLive } from "./boards.ts";

export const LINE_COLORS = [
  { name: "Ink", value: "#243b35" },
  { name: "Terracotta", value: "#a04732" },
  { name: "Blue", value: "#295c7b" },
  { name: "Green", value: "#466333" },
];
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };

export function borderPoint(rect: Rect, toward: Point): Point {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = toward.x - center.x,
    dy = toward.y - center.y;
  if (!dx && !dy) return { x: rect.x + rect.width, y: center.y };
  const scale =
    1 /
    Math.max(
      Math.abs(dx) / Math.max(rect.width / 2, 0.5),
      Math.abs(dy) / Math.max(rect.height / 2, 0.5),
    );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function connectorPoints(from: Rect, to: Rect): [Point, Point] {
  return [
    borderPoint(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 }),
    borderPoint(to, {
      x: from.x + from.width / 2,
      y: from.y + from.height / 2,
    }),
  ];
}

export function endpointsAvailable(
  line: Connector,
  boards: Board[],
  cards: Card[],
): boolean {
  if (line.fromId === line.toId || !isBoardLive(boards, line.boardId))
    return false;
  const available = (id: string) =>
    cards.some(
      (c) => c.id === id && c.boardId === line.boardId && !c.trashed,
    ) ||
    boards.some(
      (b) => b.id === id && b.parentId === line.boardId && !b.trashed,
    );
  return available(line.fromId) && available(line.toId);
}

// Endpoint/subtree deletion atomically hides its lines through the endpoint's saved
// trash state. The retained references allow restoration without reviving manually deleted lines.
export function connectorLive(
  line: Connector,
  boards: Board[],
  cards: Card[],
): boolean {
  return !line.trashed && endpointsAvailable(line, boards, cards);
}
