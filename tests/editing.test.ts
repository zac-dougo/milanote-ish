import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch, EditHistory, emptyPatch, PendingEdits, translateItems, duplicateItems, moveItems } from "../src/editing.ts";
import type { Content } from "../src/editing.ts";
import { makeCard } from "../src/model.ts";

function fixture(): Content {
  return { boards: [{ id: "main", title: "Main", parentId: null, x: 0, y: 0, color: "paper", order: 0, trashed: false }, { id: "child", title: "Child", parentId: "main", x: 40, y: 50, color: "blue", order: 1, trashed: false }, { id: "destination", title: "Destination", parentId: null, x: 200, y: 100, color: "green", order: 2, trashed: false }], cards: [{ ...makeCard("main", 10, 20), id: "a" }, { ...makeCard("main", 90, 70), id: "b" }, { ...makeCard("child", 1, 2), id: "nested" }], connectors: [{ id: "ab", boardId: "main", fromId: "a", toId: "b", color: "#243b35", arrow: "target", trashed: false }, { id: "bc", boardId: "main", fromId: "b", toId: "child", color: "#243b35", arrow: "none", trashed: false }] };
}

test("group edits and newly created items undo and redo as one action", () => {
  const original = fixture(); const history = new EditHistory();
  const patch = translateItems(original, ["a", "b", "child"], 23, -17);
  history.record(original, patch, "main");
  const changed = applyPatch(original, patch);
  assert.equal(changed.cards[0].x, 33);
  const undo = history.undo()!; assert.deepEqual(applyPatch(changed, undo.patch), original);
  assert.deepEqual(history.redo()!.patch, patch);
  const addition = emptyPatch(); addition.cards = [makeCard("main", 1, 2)];
  history.record(changed, addition, "main");
  assert.deepEqual(applyPatch(applyPatch(changed, addition), history.undo()!.patch), changed);
});

test("typing bursts retain their first value, history is bounded, and new edits clear redo", () => {
  const history = new EditHistory(); let content = fixture(); const initial = content.cards[0];
  for (let i = 1; i <= 3; i++) { const patch = emptyPatch(); patch.cards = [{ ...content.cards[0], width: 320 + i }]; history.record(content, patch, "main", "typing:a", i * 100); content = applyPatch(content, patch); }
  assert.equal(history.past.length, 1);
  assert.deepEqual(history.undo()!.patch.cards[0], initial);
  const patch = emptyPatch(); patch.cards = [initial]; history.record(content, patch, "main"); assert.equal(history.future.length, 0);
  for (let i = 0; i < 130; i++) history.record(content, patch, "main");
  assert.equal(history.past.length, 100);
});

test("pending edits preserve changes arriving during a write and order removals", () => {
  const pending = new PendingEdits(); const patch = emptyPatch(); patch.cards = [fixture().cards[0]];
  pending.add(patch); const first = pending.snapshot();
  const deletion = emptyPatch(); deletion.removed.cards = [patch.cards[0].id]; pending.add(deletion);
  pending.acknowledge(first.revision); const next = pending.snapshot();
  assert.deepEqual(next.patch.cards, []); assert.deepEqual(next.patch.removed.cards, ["a"]);
  pending.acknowledge(next.revision); assert.deepEqual(pending.snapshot().patch, emptyPatch());
});

test("deep duplication gives descendants/blocks new IDs and keeps only internal connectors", () => {
  const content = fixture(); const { patch, selected } = duplicateItems(content, ["a", "child"]);
  assert.equal(patch.boards.length, 1); assert.equal(patch.cards.length, 2); assert.equal(patch.connectors.length, 0);
  const child = patch.boards[0]; assert.notEqual(child.id, "child");
  assert.equal(patch.cards.find(card => card.boardId === child.id)?.x, 1);
  assert.notEqual(patch.cards[0].blocks[0].id, content.cards[0].blocks[0].id);
  assert.equal(selected.length, 2);
  const group = duplicateItems(content, ["a", "b"]); assert.equal(group.patch.connectors.length, 1); assert.equal(group.patch.connectors[0].fromId, group.selected[0]);
});

test("moves retain relative placement, transfer internal lines, trash boundary lines and reject cycles", () => {
  const content = fixture(); const patch = moveItems(content, ["a", "b"], "destination");
  assert.equal(patch.cards[1].x - patch.cards[0].x, 80);
  assert.equal(patch.connectors.find(line => line.id === "ab")?.boardId, "destination");
  assert.equal(patch.connectors.find(line => line.id === "bc")?.trashed, true);
  assert.throws(() => moveItems(content, ["main"], "child"), /descendant/);
  assert.throws(() => moveItems(content, ["a"], null), /destination/);
});
