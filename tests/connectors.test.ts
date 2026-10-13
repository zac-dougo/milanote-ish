import { test } from "node:test";
import assert from "node:assert/strict";
import { borderPoint, connectorPoints, connectorLive } from "../src/connectors.ts";
import type { Board, Card, Connector } from "../src/model.ts";

test("straight lines meet item borders and follow movement and resizing", () => {
  const from = { x: 0, y: 0, width: 100, height: 100 };
  const to = { x: 300, y: 0, width: 100, height: 100 };
  assert.deepEqual(connectorPoints(from, to), [{ x: 100, y: 50 }, { x: 300, y: 50 }]);
  assert.deepEqual(connectorPoints({ ...from, width: 200 }, to), [{ x: 200, y: 50 }, { x: 300, y: 50 }]);
  assert.deepEqual(connectorPoints(from, { ...to, x: 0, y: 300 }), [{ x: 50, y: 100 }, { x: 50, y: 300 }]);
  assert.deepEqual(borderPoint(from, { x: 200, y: 200 }), { x: 100, y: 100 });
});

test("overlapping centres produce finite border anchors", () => {
  const rect = { x: -100, y: -50, width: 200, height: 100 };
  for (const p of connectorPoints(rect, rect)) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.equal(p.x, 100);
  }
});

test("line visibility follows endpoint/subtree restoration and respects manual deletion", () => {
  const owner: Board = { id: "owner", parentId: null, title: "Main", x: 0, y: 0, color: "paper", order: 0, trashed: false };
  const tile: Board = { ...owner, id: "tile", parentId: "owner" };
  const card: Card = { id: "card", boardId: "owner", x: 0, y: 0, width: 320, color: "paper", blocks: [], trashed: false };
  const line: Connector = { id: "line", boardId: "owner", fromId: "card", toId: "tile", arrow: "target", color: "#243b35", trashed: false };
  assert.equal(connectorLive(line, [owner, tile], [card]), true);
  card.trashed = true;
  assert.equal(connectorLive(line, [owner, tile], [card]), false);
  card.trashed = false;
  tile.trashed = true;
  assert.equal(connectorLive(line, [owner, tile], [card]), false);
  tile.trashed = false;
  owner.trashed = true;
  assert.equal(connectorLive(line, [owner, tile], [card]), false);
  owner.trashed = false;
  assert.equal(connectorLive(line, [owner, tile], [card]), true);
  line.trashed = true;
  assert.equal(connectorLive(line, [owner, tile], [card]), false);
  line.trashed = false;
  card.boardId = "other";
  assert.equal(connectorLive(line, [owner, tile], [card]), false);
});
