import { test } from "node:test";
import assert from "node:assert/strict";
import { boardPath, isBoardLive } from "../src/boards.ts";
import type { Board } from "../src/model.ts";

function board(id: string, parentId: string | null = null): Board {
  return { id, parentId, title: id, color: "paper", x: 0, y: 0, trashed: false, order: 0 };
}

test("breadcrumbs follow IDs through renames and deep nesting", () => {
  const boards = [board("root")];
  for (let i = 1; i <= 1000; i++) boards.push(board(String(i), boards.at(-1)!.id));
  boards[0].title = "Renamed";
  const path = boardPath(boards, "1000");
  assert.equal(path.length, 1001);
  assert.equal(path[0].title, "Renamed");
  assert.equal(path.at(-1)!.id, "1000");
});

test("trash hides descendants, restoration reveals them, bad paths stop safely", () => {
  const boards = [board("root"), board("child", "root"), board("nested", "child")];
  boards[0].trashed = true;
  assert.equal(isBoardLive(boards, "nested"), false);
  boards[0].trashed = false;
  assert.equal(isBoardLive(boards, "nested"), true);
  boards[1].trashed = true;
  assert.equal(isBoardLive(boards, "nested"), false);
  boards[1].trashed = false;
  boards[0].parentId = "nested";
  assert.deepEqual(boardPath(boards, "nested"), []);
  boards[0].parentId = "missing";
  assert.deepEqual(boardPath(boards, "nested"), []);
});
