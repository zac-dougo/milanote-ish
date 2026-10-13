import type { Board } from "./model.ts";

// Walk iteratively so deeply nested boards do not depend on the call stack.
export function boardPath(boards: Board[], id: string | null): Board[] {
  const byId = new Map(boards.map((board) => [board.id, board]));
  const path: Board[] = [];
  const seen = new Set<string>();
  while (id) {
    if (seen.has(id)) return [];
    seen.add(id);
    const board = byId.get(id);
    if (!board || board.trashed) return [];
    path.push(board);
    id = board.parentId;
  }
  return path.reverse();
}

export function isBoardLive(boards: Board[], id: string): boolean {
  return boardPath(boards, id).length > 0;
}

export const HOME_CAMERA = "home";
