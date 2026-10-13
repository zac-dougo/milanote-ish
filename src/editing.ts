import type { Board, Card, Connector } from "./model";
import { id } from "./model.ts";

export type Content = {
  boards: Board[];
  cards: Card[];
  connectors: Connector[];
};
export type Patch = Content & {
  removed: { boards: string[]; cards: string[]; connectors: string[] };
};
export const emptyPatch = (): Patch => ({
  boards: [],
  cards: [],
  connectors: [],
  removed: { boards: [], cards: [], connectors: [] },
});
export const tables = ["boards", "cards", "connectors"] as const;
export function applyPatch(content: Content, patch: Patch): Content {
  const result = { ...content };
  for (const table of tables) {
    if (!patch[table].length && !patch.removed[table].length) continue;
    const updates = new Map(patch[table].map((item) => [item.id, item]));
    const removed = new Set(patch.removed[table]);
    (result[table] as (Board | Card | Connector)[]) = content[table]
      .filter((item) => !removed.has(item.id))
      .map((item) => {
        const next = updates.get(item.id);
        updates.delete(item.id);
        return next ?? item;
      })
      .concat([...updates.values()]);
  }
  return result;
}
export function inversePatch(content: Content, patch: Patch): Patch {
  const inverse = emptyPatch();
  for (const table of tables) {
    const ids = new Set([
      ...patch[table].map((item) => item.id),
      ...patch.removed[table],
    ]);
    const old = new Map(content[table].map((item) => [item.id, item]));
    for (const id of ids) {
      const item = old.get(id);
      if (item) (inverse[table] as (Board | Card | Connector)[]).push(item);
      else inverse.removed[table].push(id);
    }
  }
  return inverse;
}
export function mergePatches(first: Patch, second: Patch): Patch {
  const merged = emptyPatch();
  for (const table of tables) {
    const values = new Map(first[table].map((item) => [item.id, item]));
    const removed = new Set(first.removed[table]);
    for (const item of second[table]) {
      values.set(item.id, item);
      removed.delete(item.id);
    }
    for (const id of second.removed[table]) {
      values.delete(id);
      removed.add(id);
    }
    (merged[table] as (Board | Card | Connector)[]) = [...values.values()];
    merged.removed[table] = [...removed];
  }
  return merged;
}

type Entry = {
  before: Patch;
  after: Patch;
  canvas: string | null;
  key?: string;
  time: number;
};
export class EditHistory {
  past: Entry[] = [];
  future: Entry[] = [];
  record(
    content: Content,
    patch: Patch,
    canvas: string | null,
    key?: string,
    time = Date.now(),
  ) {
    const before = inversePatch(content, patch);
    const last = this.past.at(-1);
    if (
      key &&
      last?.key === key &&
      time - last.time < 700 &&
      !this.future.length
    ) {
      // Preserve the earliest value of each entity in a continuous typing burst.
      last.after = mergePatches(last.after, patch);
      last.time = time;
    } else this.past.push({ before, after: patch, canvas, key, time });
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  breakBurst() {
    const last = this.past.at(-1);
    if (last) last.key = undefined;
  }
  undo() {
    const entry = this.past.pop();
    if (entry) this.future.push(entry);
    return entry && { patch: entry.before, canvas: entry.canvas };
  }
  redo() {
    const entry = this.future.pop();
    if (entry) this.past.push(entry);
    return entry && { patch: entry.after, canvas: entry.canvas };
  }
}

export class PendingEdits {
  private patch = emptyPatch();
  private revision = 0;
  add(patch: Patch) {
    this.patch = mergePatches(this.patch, patch);
    this.revision++;
  }
  snapshot() {
    return { patch: this.patch, revision: this.revision };
  }
  acknowledge(revision: number) {
    if (revision === this.revision) this.patch = emptyPatch();
  }
}

export function translateItems(
  content: Content,
  ids: string[],
  dx: number,
  dy: number,
): Patch {
  const chosen = new Set(ids);
  const patch = emptyPatch();
  patch.cards = content.cards
    .filter((item) => chosen.has(item.id))
    .map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }));
  patch.boards = content.boards
    .filter((item) => chosen.has(item.id))
    .map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }));
  return patch;
}
export function duplicateItems(
  content: Content,
  ids: string[],
): { patch: Patch; selected: string[] } {
  const chosen = new Set(ids);
  const boardIds = new Set(
    content.boards
      .filter((board) => chosen.has(board.id))
      .map((board) => board.id),
  );
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const board of content.boards)
      if (
        board.parentId &&
        boardIds.has(board.parentId) &&
        !boardIds.has(board.id)
      ) {
        boardIds.add(board.id);
        expanded = true;
      }
  }
  const cards = content.cards.filter(
    (card) => chosen.has(card.id) || boardIds.has(card.boardId),
  );
  const mapping = new Map(
    [...boardIds, ...cards.map((card) => card.id)].map((old) => [old, id()]),
  );
  const patch = emptyPatch();
  patch.boards = content.boards
    .filter((board) => boardIds.has(board.id))
    .map((board) => ({
      ...board,
      id: mapping.get(board.id)!,
      parentId:
        (board.parentId && mapping.get(board.parentId)) || board.parentId,
      title: chosen.has(board.id)
        ? `${board.title || "Untitled board"} copy`
        : board.title,
      x: board.x + (chosen.has(board.id) ? 32 : 0),
      y: board.y + (chosen.has(board.id) ? 32 : 0),
    }));
  patch.cards = cards.map((card) => ({
    ...card,
    id: mapping.get(card.id)!,
    boardId: mapping.get(card.boardId) || card.boardId,
    x: card.x + (chosen.has(card.id) ? 32 : 0),
    y: card.y + (chosen.has(card.id) ? 32 : 0),
    blocks: card.blocks.map((block) =>
      block.kind === "checklist"
        ? {
            ...block,
            id: id(),
            items: block.items.map((item) => ({ ...item, id: id() })),
          }
        : { ...block, id: id() },
    ),
  }));
  patch.connectors = content.connectors
    .filter((line) => mapping.has(line.fromId) && mapping.has(line.toId))
    .map((line) => ({
      ...line,
      id: id(),
      boardId: mapping.get(line.boardId) || line.boardId,
      fromId: mapping.get(line.fromId)!,
      toId: mapping.get(line.toId)!,
    }));
  return {
    patch,
    selected: ids.map((old) => mapping.get(old)!).filter(Boolean),
  };
}
export function moveItems(
  content: Content,
  ids: string[],
  destination: string | null,
): Patch {
  const chosen = new Set(ids);
  const patch = translateItems(content, ids, 0, 0);
  if (!destination && patch.cards.length)
    throw new Error("Cards need a destination board.");
  if (destination) {
    let next: string | null = destination;
    const visited = new Set<string>();
    while (next) {
      if (chosen.has(next) || visited.has(next))
        throw new Error("A board cannot move inside itself or a descendant.");
      visited.add(next);
      next =
        content.boards.find((board) => board.id === next)?.parentId ?? null;
    }
  }
  const minX = Math.min(
    ...patch.cards.map((item) => item.x),
    ...patch.boards.map((item) => item.x),
  );
  const minY = Math.min(
    ...patch.cards.map((item) => item.y),
    ...patch.boards.map((item) => item.y),
  );
  patch.cards = patch.cards.map((card) => ({
    ...card,
    boardId: destination!,
    x: card.x - minX + 64,
    y: card.y - minY + 64,
  }));
  patch.boards = patch.boards.map((board) => ({
    ...board,
    parentId: destination,
    x: board.x - minX + 64,
    y: board.y - minY + 64,
  }));
  patch.connectors = content.connectors
    .filter((line) => chosen.has(line.fromId) || chosen.has(line.toId))
    .map((line) =>
      chosen.has(line.fromId) && chosen.has(line.toId) && destination
        ? { ...line, boardId: destination }
        : { ...line, trashed: true },
    );
  return patch;
}
