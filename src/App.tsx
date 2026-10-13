import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  block,
  blockLabel,
  contentBlock,
  webUrl,
  COLORS,
  id,
  INITIAL_CAMERA,
  makeCard,
} from "./model";
import type { Block, Board, Camera, Card, Connector, Preset } from "./model";
import * as storage from "./storage";
import { SaveQueue } from "./save-queue";
import { boardPath, HOME_CAMERA, isBoardLive } from "./boards";
import { BoardTile, TILE_HEIGHT, TILE_WIDTH } from "./BoardTile";
import { ConnectorLayer } from "./ConnectorLayer";
import { connectorLive, endpointsAvailable, LINE_COLORS } from "./connectors";

import {
  applyPatch,
  EditHistory,
  emptyPatch,
  PendingEdits,
  translateItems,
  duplicateItems,
  moveItems,
  mergePatches,
} from "./editing";
import type { Content, Patch } from "./editing";
import { documentText, readDocument } from "./rich-text";
import { ContentBlock } from "./ContentBlock";

type Job = () => Promise<void>;
function useSaves(importing: boolean) {
  const busy = useRef(importing);
  busy.current = importing;
  const queue = useRef(new SaveQueue());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState("Saved");
  const [error, setError] = useState("");
  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    try {
      await queue.current.flush();
      setError("");
      setStatus("Saved");
    } catch (e) {
      setError(String(e));
      setStatus("Not saved");
      throw e;
    }
  }, []);
  const schedule = useCallback(
    (key: string, job: Job) => {
      queue.current.enqueue(key, job);
      setStatus("Saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, 350);
    },
    [flush],
  );
  useEffect(() => {
    const blur = () => {
      void flush().catch(() => {});
    };
    window.addEventListener("blur", blur);
    if (!storage.desktop) return () => window.removeEventListener("blur", blur);
    let cancelled = false;
    let off: (() => void) | undefined;
    let offQuit: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (busy.current) return;
        try {
          await flush();
          await invoke("finish_quit");
        } catch {
          /* Keep unsaved work open. */
        }
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else off = unlisten;
      });
    void listen("app:quit-requested", () => {
      if (busy.current) return;
      void flush()
        .then(() => invoke("finish_quit"))
        .catch(() => {});
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else offQuit = unlisten;
    });
    return () => {
      cancelled = true;
      off?.();
      offQuit?.();
      window.removeEventListener("blur", blur);
    };
  }, [flush]);
  return { status, error, schedule, flush };
}

function Icon({
  name,
}: {
  name: "note" | "image" | "board" | "home" | "plus" | "hand" | "connector";
}) {
  const paths = {
    note: (
      <>
        <path d="M5 3h14v18H5z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 18 6-6 4 4 4-6 4 5" />
      </>
    ),
    board: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </>
    ),
    home: (
      <>
        <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
      </>
    ),
    connector: <path d="M3 20 21 4M14 4h7v7" />,
    plus: <path d="M12 4v16M4 12h16" />,
    hand: (
      <>
        <path d="M8 12V5a2 2 0 0 1 4 0v7M12 11V7a2 2 0 0 1 4 0v6M16 11V9a2 2 0 0 1 4 0v7c0 4-2 6-6 6h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l1 1" />
      </>
    ),
  };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const AssetImage = memo(function AssetImage({
  name,
  alt,
  onOpen,
}: {
  name: string;
  alt: string;
  onOpen?: () => void;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void storage.imageSrc(name).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [name]);
  if (failed)
    return (
      <div className="missing-image">
        Image unavailable
        <br />
        {alt}
        <br />
        Restore a backup containing this image to recover it.
      </div>
    );
  return (
    <img
      src={src || undefined}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      onDoubleClick={onOpen}
    />
  );
});

const CardView = memo(function CardView({
  card,
  selected,
  active,
  zoom,
  onChange,
  onSelect,
  onImage,
  onFile,
  onPasteImage,
  onPreview,
  onFlush,
  onDelete,
  onOrder,
}: {
  card: Card;
  selected: boolean;
  active: boolean;
  zoom: number;
  onChange: (card: Card) => void;
  onSelect: (id: string) => void;
  onImage: (cardId: string) => void;
  onFile: (cardId: string) => void;
  onPasteImage: (cardId: string) => void;
  onPreview: (image: Extract<Block, { kind: "image" }>) => void;
  onFlush: () => void;
  onDelete: (id: string) => void;
  onOrder: (id: string, front: boolean) => void;
}) {
  const node = useRef<HTMLElement>(null);
  const drag = useRef<{
    kind: "move" | "resize";
    x: number;
    y: number;
    last: Card;
  } | null>(null);
  const begin = (e: ReactPointerEvent, kind: "move" | "resize") => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus();
    onSelect(card.id);
    drag.current = { kind, x: e.clientX, y: e.clientY, last: card };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !node.current) return;
    const dx = (e.clientX - d.x) / zoom,
      dy = (e.clientY - d.y) / zoom;
    d.last =
      d.kind === "move"
        ? { ...card, x: card.x + dx, y: card.y + dy }
        : { ...card, width: Math.max(180, Math.min(1200, card.width + dx)) };
    // Only this DOM node changes during a gesture. Content commits once on release.
    node.current.style.left = `${d.last.x}px`;
    node.current.style.top = `${d.last.y}px`;
    node.current.style.width = `${d.last.width}px`;
  };
  const finish = () => {
    if (drag.current) {
      onChange(drag.current.last);
      drag.current = null;
      onFlush();
    }
  };
  const reorder = (index: number, delta: number) => {
    const blocks = [...card.blocks];
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    onChange({ ...card, blocks });
  };
  return (
    <article
      id={`card-${card.id}`}
      data-canvas-item={card.id}
      ref={node}
      tabIndex={-1}
      className={`card surface-${card.color}${selected ? " selected" : ""}${active ? " editing" : ""}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        zIndex: selected ? 2147483646 : (card.order ?? 0),
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(card.id);
        if (
          !(e.target as HTMLElement).closest(
            'textarea, input, button, [contenteditable="true"], [role="button"], [role="slider"]',
          )
        )
          node.current?.focus();
      }}
      onFocusCapture={() => onSelect(card.id)}
      aria-label="Canvas card"
    >
      <div
        className="card-grip"
        title="Drag card"
        aria-label="Move card"
        role="button"
        tabIndex={0}
        onPointerDown={(e) => begin(e, "move")}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={(e) => {
          const offsets: Record<string, number[]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          const offset = offsets[e.key];
          if (offset) {
            e.preventDefault();
            onChange({
              ...card,
              x: card.x + offset[0] * (e.shiftKey ? 10 : 1),
              y: card.y + offset[1] * (e.shiftKey ? 10 : 1),
            });
          }
        }}
      >
        <span className="grip-dots">⠿</span>
        <span>
          {card.blocks.some((b) => b.kind === "image") ? "REFERENCE" : "NOTE"}
        </span>
      </div>
      <div className="blocks">
        {card.blocks.map((b, index) => (
          <div
            className={`block block-${b.kind}`}
            key={b.id}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-milanote-block"))
                e.preventDefault();
            }}
            onDrop={(e) => {
              const source = e.dataTransfer.getData(
                "application/x-milanote-block",
              );
              const from = card.blocks.findIndex(
                (block) => block.id === source,
              );
              if (from < 0) return;
              e.preventDefault();
              e.stopPropagation();
              const blocks = [...card.blocks];
              const [moving] = blocks.splice(from, 1);
              blocks.splice(index, 0, moving);
              onChange({ ...card, blocks });
              onFlush();
            }}
          >
            {b.kind === "image" ? (
              <>
                <AssetImage
                  name={b.thumbnail}
                  alt={b.alt || b.name}
                  onOpen={() => onPreview(b)}
                />
                {active && (
                  <input
                    className="image-alt"
                    aria-label="Image alt text"
                    placeholder="Image description, optional"
                    value={b.alt ?? ""}
                    onBlur={onFlush}
                    onChange={(e) =>
                      onChange({
                        ...card,
                        blocks: card.blocks.map((block) =>
                          block.id === b.id
                            ? { ...b, alt: e.target.value }
                            : block,
                        ),
                      })
                    }
                  />
                )}
              </>
            ) : (
              <ContentBlock
                value={b}
                selected={active}
                onFlush={onFlush}
                onChange={(value) =>
                  onChange({
                    ...card,
                    blocks: card.blocks.map((item) =>
                      item.id === value.id ? value : item,
                    ),
                  })
                }
              />
            )}
            {active && (
              <div className="block-actions">
                <button
                  draggable
                  aria-label="Drag block to reorder"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-milanote-block",
                      b.id,
                    );
                    e.stopPropagation();
                  }}
                >
                  ⠿
                </button>
                <button
                  aria-label="Move block up"
                  disabled={index === 0}
                  onClick={() => reorder(index, -1)}
                >
                  ↑
                </button>
                <button
                  aria-label="Move block down"
                  disabled={index === card.blocks.length - 1}
                  onClick={() => reorder(index, 1)}
                >
                  ↓
                </button>
                <button
                  aria-label="Remove block"
                  onClick={() => {
                    const blocks = card.blocks.filter((v) => v.id !== b.id);
                    onChange({
                      ...card,
                      blocks: blocks.length ? blocks : [block("text")],
                    });
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {active && (
        <div className="card-tools">
          <button onClick={() => onOrder(card.id, true)}>Bring to front</button>
          <button onClick={() => onOrder(card.id, false)}>Send to back</button>
          <button className="delete-card" onClick={() => onDelete(card.id)}>
            Delete card
          </button>
          <button
            onClick={() =>
              onChange({ ...card, blocks: [...card.blocks, block("heading")] })
            }
          >
            + Heading
          </button>
          <button
            onClick={() =>
              onChange({ ...card, blocks: [...card.blocks, block("text")] })
            }
          >
            + Text
          </button>
          {(["quote", "link", "checklist"] as const).map((kind) => (
            <button
              key={kind}
              onClick={() =>
                onChange({
                  ...card,
                  blocks: [...card.blocks, contentBlock(kind)],
                })
              }
            >
              +{" "}
              {kind === "quote"
                ? "Quote"
                : kind === "link"
                  ? "Link"
                  : "Checklist"}
            </button>
          ))}
          <button onClick={() => onImage(card.id)}>+ Image</button>
          <button onClick={() => onPasteImage(card.id)}>Paste image</button>
          <button onClick={() => onFile(card.id)}>+ File</button>
          <div className="swatches">
            {COLORS.map((color) => (
              <button
                className={`swatch surface-${color}`}
                aria-label={`${color} card colour`}
                aria-pressed={color === card.color}
                key={color}
                onClick={() => onChange({ ...card, color })}
              />
            ))}
          </div>
        </div>
      )}
      <div
        className="resize-grip"
        role="slider"
        aria-label="Card width"
        aria-valuemin={180}
        aria-valuemax={1200}
        aria-valuenow={Math.round(card.width)}
        tabIndex={0}
        onPointerDown={(e) => begin(e, "resize")}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            onChange({
              ...card,
              width: Math.max(
                180,
                Math.min(
                  1200,
                  card.width + (e.key === "ArrowRight" ? 10 : -10),
                ),
              ),
            });
          }
        }}
      />
    </article>
  );
});

export default function App() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectFrom, setConnectFrom] = useState("");
  const [connectTo, setConnectTo] = useState("");
  const cardsRef = useRef<Card[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [selected, setPrimary] = useState<string | null>(null);
  const [selection, setSelectionState] = useState<string[]>([]);
  const selectionRef = useRef<string[]>([]);
  const setSelection = (ids: string[]) => {
    selectionRef.current = ids;
    setSelectionState(ids);
    setPrimary(ids.at(-1) ?? null);
  };
  const setSelected = (value: string | null) =>
    setSelection(value ? [value] : []);
  const history = useRef(new EditHistory());
  const pending = useRef(new PendingEdits());
  const importGroup = useRef<{
    before: Content;
    patch: Patch;
    canvas: string | null;
  } | null>(null);
  const content = useRef<Content>({ boards: [], cards: [], connectors: [] });
  const [historyTick, setHistoryTick] = useState(0);
  const historyBusy = useRef(false);
  const [moveDestination, setMoveDestination] = useState("");
  const [backupPreview, setBackupPreview] = useState<{
    path: string;
    info: storage.BackupInfo;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const [permanentDelete, setPermanentDelete] = useState<Patch | null>(null);
  const clipboard = useRef<{
    token: string;
    content: Content;
    ids: string[];
    canvas: string | null;
  } | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);

  const [showTrash, setShowTrash] = useState(false);
  const [restoreDestinations, setRestoreDestinations] = useState<
    Record<string, string>
  >({});
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const cameraRef = useRef(camera);
  const cameras = useRef<Record<string, Camera>>({});
  const canvas = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const [preview, setPreview] = useState<Extract<
    Block,
    { kind: "image" }
  > | null>(null);
  const [hand, setHand] = useState(false);
  const space = useRef(false);
  const suppressCanvasClick = useRef(false);
  const groupDrag = useRef<{
    x: number;
    y: number;
    zoom: number;
    ids: string[];
    dx: number;
    dy: number;
    mode: "move" | "resize";
    checkpointAt: number;
  } | null>(null);
  const marquee = useRef<{ x: number; y: number; base: string[] } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const pan = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  const { schedule, flush, status, error } = useSaves(importing || gesturing);
  const applyEdit = useCallback(
    (incoming: Patch, record = true, key?: string) => {
      const previous = content.current;
      const patch = { ...incoming, removed: { ...incoming.removed } };
      patch.cards = patch.cards.filter(
        (next) =>
          JSON.stringify(previous.cards.find((old) => old.id === next.id)) !==
          JSON.stringify(next),
      );
      patch.boards = patch.boards.filter(
        (next) =>
          JSON.stringify(previous.boards.find((old) => old.id === next.id)) !==
          JSON.stringify(next),
      );
      patch.connectors = patch.connectors.filter(
        (next) =>
          JSON.stringify(
            previous.connectors.find((old) => old.id === next.id),
          ) !== JSON.stringify(next),
      );
      if (
        !patch.cards.length &&
        !patch.boards.length &&
        !patch.connectors.length &&
        !Object.values(patch.removed).some((ids) => ids.length)
      )
        return;
      if (record && importGroup.current)
        importGroup.current.patch = mergePatches(
          importGroup.current.patch,
          patch,
        );
      else if (record) history.current.record(previous, patch, boardId, key);
      const next = applyPatch(previous, patch);
      content.current = next;
      cardsRef.current = next.cards;
      setCards(next.cards);
      setBoards(next.boards);
      setConnectors(next.connectors);
      if (!importGroup.current) {
        pending.current.add(patch);
        schedule("edits", async () => {
          const snapshot = pending.current.snapshot();
          await storage.savePatch(snapshot.patch);
          pending.current.acknowledge(snapshot.revision);
        });
      }
      setHistoryTick((tick) => tick + 1);
    },
    [boardId, schedule],
  );
  const beginImport = () => {
    importGroup.current = {
      before: content.current,
      patch: emptyPatch(),
      canvas: boardId,
    };
  };
  const finishImport = () => {
    const group = importGroup.current;
    importGroup.current = null;
    if (
      !group ||
      (!group.patch.cards.length &&
        !group.patch.boards.length &&
        !group.patch.connectors.length)
    )
      return;
    history.current.record(group.before, group.patch, group.canvas);
    pending.current.add(group.patch);
    schedule("edits", async () => {
      const snapshot = pending.current.snapshot();
      await storage.savePatch(snapshot.patch);
      pending.current.acknowledge(snapshot.revision);
    });
    setHistoryTick((tick) => tick + 1);
    void flush().catch(() => {});
  };
  const gesturePatch = (drag: NonNullable<typeof groupDrag.current>): Patch => {
    if (drag.mode === "move")
      return translateItems(content.current, drag.ids, drag.dx, drag.dy);
    const card = content.current.cards.find((card) => card.id === drag.ids[0]);
    const patch = emptyPatch();
    if (card)
      patch.cards = [
        { ...card, width: Math.max(180, Math.min(1200, card.width + drag.dx)) },
      ];
    return patch;
  };
  const cancelGesture = () => {
    const drag = groupDrag.current;
    if (drag) {
      const base = translateItems(content.current, drag.ids, 0, 0);
      for (const item of [...base.cards, ...base.boards]) {
        const node =
          document.getElementById(`card-${item.id}`) ??
          document.getElementById(`board-${item.id}`);
        if (node) {
          node.style.left = `${item.x}px`;
          node.style.top = `${item.y}px`;
          if ("width" in item) node.style.width = `${item.width}px`;
        }
      }
      schedule("gesture", () => storage.saveGeometry(base));
    }
    groupDrag.current = null;
    setGesturing(false);
    marquee.current = null;
    pan.current = null;
    setSelectionBox(null);
  };
  const prepareImagePaste = useCallback((id: string) => {
    setPasteTarget(id);
    canvas.current?.focus();
  }, []);
  const typingKey = (kind: string, itemId: string) => {
    const active = document.activeElement;
    return active instanceof HTMLElement &&
      (active.isContentEditable ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLInputElement && active.type !== "checkbox"))
      ? `${kind}:${itemId}`
      : undefined;
  };
  const currentBoard = boards.find((b) => b.id === boardId);
  const path = boardPath(boards, boardId);
  const childBoards = boards.filter(
    (b) => b.parentId === boardId && !b.trashed,
  );
  const visibleCards = cards.filter((c) => c.boardId === boardId && !c.trashed);
  const itemCount = (id: string) =>
    cards.filter((c) => c.boardId === id && !c.trashed).length +
    boards.filter((b) => b.parentId === id && !b.trashed).length;
  const itemLabel = (id: string) =>
    boards.find((b) => b.id === id)?.title ||
    cards
      .find((c) => c.id === id)
      ?.blocks.map(blockLabel)
      .find(Boolean)
      ?.slice(0, 45) ||
    "Untitled item";
  const items = [
    ...visibleCards.map((c) => c.id),
    ...childBoards.map((b) => b.id),
  ];
  const liveLines = connectors.filter(
    (line) => line.boardId === boardId && connectorLive(line, boards, cards),
  );
  const currentLine = liveLines.find((line) => line.id === selectedLine);
  const trashedLines = connectors.filter(
    (line) =>
      isBoardLive(boards, line.boardId) && !connectorLive(line, boards, cards),
  );
  const selectItem = useCallback((id: string | null, additive = false) => {
    if (!id) {
      setSelected(null);
      return;
    }
    const previous = selectionRef.current;
    if (additive)
      setSelection(
        previous.includes(id)
          ? previous.filter((value) => value !== id)
          : [...previous, id],
      );
    else if (!previous.includes(id)) setSelected(id);
    else setPrimary(id);
    setSelectedLine(null);
  }, []);
  const changeConnector = useCallback(
    (line: Connector) => {
      const patch = emptyPatch();
      patch.connectors = [line];
      applyEdit(patch);
    },
    [applyEdit],
  );
  const connectItems = (fromId: string, toId: string, lineId?: string) => {
    if (
      !boardId ||
      !items.includes(fromId) ||
      !items.includes(toId) ||
      fromId === toId
    ) {
      setNotice("Choose two different items on this board.");
      return;
    }
    const previous = lineId
      ? connectors.find((line) => line.id === lineId)
      : undefined;
    const line: Connector = previous
      ? { ...previous, fromId, toId }
      : {
          id: id(),
          boardId,
          fromId,
          toId,
          arrow: "target",
          color: LINE_COLORS[0].value,
          trashed: false,
        };
    changeConnector(line);
    setSelected(null);
    setSelectedLine(line.id);
    setConnecting(false);
    setConnectFrom("");
    setConnectTo("");
  };
  const pickConnectItem = (id: string) => {
    if (!connectFrom) {
      setConnectFrom(id);
      selectItem(id);
    } else connectItems(connectFrom, id);
  };
  const deleteConnector = () => {
    if (currentLine) changeConnector({ ...currentLine, trashed: true });
    setSelectedLine(null);
  };
  const changeBoard = useCallback(
    (board: Board) => {
      const patch = emptyPatch();
      patch.boards = [board];
      applyEdit(patch, true, typingKey("board", board.id));
    },
    [applyEdit],
  );
  cameraRef.current = camera;

  useEffect(() => {
    void storage
      .loadLibrary()
      .then((lib) => {
        content.current = {
          boards: lib.boards,
          cards: lib.cards,
          connectors: lib.connectors,
        };
        setBoards(lib.boards);
        cardsRef.current = lib.cards;
        setCards(lib.cards);
        setConnectors(lib.connectors);
        cameras.current = lib.cameras;
        const last =
          lib.lastCanvas &&
          lib.lastCanvas !== HOME_CAMERA &&
          isBoardLive(lib.boards, lib.lastCanvas)
            ? lib.lastCanvas
            : null;
        setBoardId(last);
        setCamera(lib.cameras[last ?? HOME_CAMERA] ?? INITIAL_CAMERA);
        setReady(true);
      })
      .catch((e) => setFatal(String(e)));
  }, []);

  const changeCard = useCallback(
    (card: Card) => {
      const previous = cardsRef.current;
      if (!previous.some((c) => c.id === card.id))
        card = {
          ...card,
          order:
            Math.max(
              0,
              ...previous
                .filter((c) => c.boardId === card.boardId)
                .map((c) => c.order ?? 0),
              ...content.current.boards
                .filter((b) => b.parentId === card.boardId)
                .map((b) => b.order),
            ) + 1,
        };
      const patch = emptyPatch();
      patch.cards = [card];
      const old = previous.find((item) => item.id === card.id);
      const shape = (item: Card) =>
        item.blocks.map((block) => ({
          id: block.id,
          kind: block.kind,
          ...(block.kind === "checklist"
            ? {
                items: block.items.map((item) => ({
                  id: item.id,
                  done: item.done,
                })),
              }
            : {}),
        }));
      const plain = (item: Card) =>
        JSON.stringify(
          item.blocks.map((block) =>
            block.kind === "checklist"
              ? block.items.map((item) => item.text)
              : block.kind === "link"
                ? [block.url, block.title]
                : block.kind === "quote"
                  ? [block.text, block.attribution]
                  : block.kind === "image"
                    ? block.alt
                    : block.kind === "file"
                      ? block.name
                      : block.text,
          ),
        );
      const key =
        old &&
        JSON.stringify(shape(old)) === JSON.stringify(shape(card)) &&
        plain(old) !== plain(card)
          ? typingKey("card", card.id)
          : undefined;
      applyEdit(patch, true, key);
    },
    [applyEdit],
  );
  const travelHistory = async (redo: boolean) => {
    if (importing || historyBusy.current || permanentDelete || backupPreview)
      return;
    historyBusy.current = true;
    setImporting(true);
    try {
      await flush();
      const entry = redo ? history.current.redo() : history.current.undo();
      if (!entry) return;
      applyEdit(entry.patch, false);
      let destination = entry.canvas;
      const liveCards = entry.patch.cards.filter((card) => !card.trashed);
      const liveBoards = entry.patch.boards.filter((board) => !board.trashed);
      if (
        !liveCards.some((card) => card.boardId === destination) &&
        !liveBoards.some(
          (board) => board.parentId === destination || board.id === destination,
        )
      ) {
        if (liveCards.length) destination = liveCards[0].boardId;
        else if (liveBoards.length) destination = liveBoards[0].parentId;
      }
      while (destination && !isBoardLive(content.current.boards, destination))
        destination =
          content.current.boards.find((board) => board.id === destination)
            ?.parentId ?? null;
      setBoardId(destination);
      setSelectedLine(null);
      setConnecting(false);
      setShowTrash(false);
      setPasteTarget(null);
      const affected = [
        ...entry.patch.cards.filter(
          (card) => !card.trashed && card.boardId === destination,
        ),
        ...entry.patch.boards.filter(
          (board) => !board.trashed && board.parentId === destination,
        ),
      ];
      setSelection(affected.map((item) => item.id));
      const view =
        destination === boardId
          ? cameraRef.current
          : affected.length
            ? { x: 80 - affected[0].x, y: 60 - affected[0].y, zoom: 1 }
            : (cameras.current[destination ?? HOME_CAMERA] ?? INITIAL_CAMERA);
      setCamera(view);
      cameraRef.current = view;
      cameras.current[destination ?? HOME_CAMERA] = view;
      schedule(`camera:${destination ?? HOME_CAMERA}`, () =>
        storage.saveCamera(destination ?? HOME_CAMERA, view),
      );
      schedule("session", () =>
        storage.saveSession(destination ?? HOME_CAMERA),
      );
      await flush();
    } catch (e) {
      setNotice(`Could not apply history: ${String(e)}`);
    } finally {
      historyBusy.current = false;
      setImporting(false);
    }
  };
  const deleteSelection = async () => {
    if (importing || !selectionRef.current.length) return;
    setImporting(true);
    try {
      await flush();
      const chosen = new Set(selectionRef.current);
      const patch = emptyPatch();
      patch.cards = content.current.cards
        .filter((item) => chosen.has(item.id))
        .map((item) => ({ ...item, trashed: true }));
      patch.boards = content.current.boards
        .filter((item) => chosen.has(item.id))
        .map((item) => ({ ...item, trashed: true }));
      applyEdit(patch);
      setSelected(null);
      await flush();
    } catch (e) {
      setNotice(`Could not delete selection: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };
  const duplicateSelection = () => {
    const result = duplicateItems(content.current, selectionRef.current);
    applyEdit(result.patch);
    setSelection(result.selected);
    finishSave();
  };
  const moveSelection = async () => {
    setImporting(true);
    try {
      await flush();
      const destination =
        moveDestination === HOME_CAMERA ? null : moveDestination;
      const patch = moveItems(
        content.current,
        selectionRef.current,
        destination,
      );
      applyEdit(patch);
      await flush();
      setShowMove(false);
      await navigate(destination);
      setSelection([...patch.cards, ...patch.boards].map((item) => item.id));
    } catch (e) {
      setNotice(String(e));
    } finally {
      setImporting(false);
    }
  };
  const exportLibrary = async () => {
    if (!storage.desktop) {
      setNotice("Backup is available in the desktop app.");
      return;
    }
    try {
      const path = await save({
        defaultPath: "Milanote-ish.milanote",
        filters: [{ name: "Milanote-ish backup", extensions: ["milanote"] }],
      });
      if (!path) return;
      setImporting(true);
      await flush();
      await storage.exportBackup(path);
      setNotice("Backup saved, including original assets and Trash.");
    } catch (e) {
      setNotice(`Could not save backup: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };
  const chooseBackup = async () => {
    if (!storage.desktop) {
      setNotice("Restore is available in the desktop app.");
      return;
    }
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Milanote-ish backup", extensions: ["milanote"] }],
      });
      if (!path || Array.isArray(path)) return;
      setImporting(true);
      await flush();
      const info = await storage.inspectBackup(path);
      setBackupPreview({ path, info });
    } catch (e) {
      setNotice(`Could not inspect backup: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };
  const restoreLibrary = async () => {
    if (!backupPreview) return;
    setImporting(true);
    let activated = false;
    try {
      await flush();
      await storage.restoreBackup(
        backupPreview.path,
        backupPreview.info.fingerprint,
      );
      activated = true;
      const lib = await storage.loadLibrary();
      content.current = {
        boards: lib.boards,
        cards: lib.cards,
        connectors: lib.connectors,
      };
      cardsRef.current = lib.cards;
      setCards(lib.cards);
      setBoards(lib.boards);
      setConnectors(lib.connectors);
      cameras.current = lib.cameras;
      history.current = new EditHistory();
      pending.current = new PendingEdits();
      clipboard.current = null;
      setHistoryTick((tick) => tick + 1);
      const destination =
        lib.lastCanvas && isBoardLive(lib.boards, lib.lastCanvas)
          ? lib.lastCanvas
          : null;
      setBoardId(destination);
      setCamera(lib.cameras[destination ?? HOME_CAMERA] ?? INITIAL_CAMERA);
      setSelected(null);
      setPasteTarget(null);
      setSelectedLine(null);
      setShowTrash(false);
      setBackupPreview(null);
      setNotice(
        "Backup restored. A recovery archive of the previous library was saved beside your library folder.",
      );
    } catch (e) {
      if (activated)
        setFatal(
          `The backup was restored, but the library could not be reloaded. Restart the app before editing. ${String(e)}`,
        );
      else setNotice(`Could not restore backup: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };
  const requestPermanentDelete = (
    cardIds: string[] = [],
    boardIds: string[] = [],
    connectorIds: string[] = [],
  ) => {
    const owned = new Set(boardIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const board of content.current.boards)
        if (
          board.parentId &&
          owned.has(board.parentId) &&
          !owned.has(board.id)
        ) {
          owned.add(board.id);
          expanded = true;
        }
    }
    const cards = new Set([
      ...cardIds,
      ...content.current.cards
        .filter((card) => owned.has(card.boardId))
        .map((card) => card.id),
    ]);
    const lines = new Set([
      ...connectorIds,
      ...content.current.connectors
        .filter(
          (line) =>
            owned.has(line.boardId) ||
            cards.has(line.fromId) ||
            cards.has(line.toId) ||
            owned.has(line.fromId) ||
            owned.has(line.toId),
        )
        .map((line) => line.id),
    ]);
    const patch = emptyPatch();
    patch.removed = {
      boards: [...owned],
      cards: [...cards],
      connectors: [...lines],
    };
    setPermanentDelete(patch);
  };
  const erasePermanently = async () => {
    if (!permanentDelete) return;
    try {
      setImporting(true);
      await flush();
      // Commit before changing UI/history. A failed deletion leaves both intact.
      const cleanupErrors = await storage.purgeItems(permanentDelete);
      const next = applyPatch(content.current, permanentDelete);
      content.current = next;
      cardsRef.current = next.cards;
      setCards(next.cards);
      setBoards(next.boards);
      setConnectors(next.connectors);
      history.current = new EditHistory();
      clipboard.current = null;
      setHistoryTick((tick) => tick + 1);
      setPermanentDelete(null);
      setSelected(null);
      if (cleanupErrors.length)
        setNotice(
          "Items were deleted, but some unused asset files could not be removed. " +
            cleanupErrors.join("\n"),
        );
    } catch (e) {
      setNotice(`Could not permanently delete: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };
  const reorderItem = useCallback(
    (id: string, front: boolean) => {
      const orders = [
        ...cardsRef.current
          .filter((c) => c.boardId === boardId && !c.trashed)
          .map((c) => c.order ?? 0),
        ...content.current.boards
          .filter((b) => b.parentId === boardId && !b.trashed)
          .map((b) => b.order),
      ];
      const chosen = new Set(
        selectionRef.current.includes(id) ? selectionRef.current : [id],
      );
      const all = [
        ...content.current.cards.filter((item) => chosen.has(item.id)),
        ...content.current.boards.filter((item) => chosen.has(item.id)),
      ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const base = front
        ? Math.max(0, ...orders) + 1
        : Math.min(0, ...orders) - all.length;
      const assigned = new Map(
        all.map((item, index) => [item.id, base + index]),
      );
      const patch = emptyPatch();
      patch.cards = content.current.cards
        .filter((item) => assigned.has(item.id))
        .map((item) => ({ ...item, order: assigned.get(item.id)! }));
      patch.boards = content.current.boards
        .filter((item) => assigned.has(item.id))
        .map((item) => ({ ...item, order: assigned.get(item.id)! }));
      applyEdit(patch);
      setSelected(null);
    },
    [boardId, applyEdit],
  );
  const deleteCard = useCallback(
    async (cardId: string) => {
      try {
        // Drain edits to incident lines first so deletion cannot strand a queued
        // style edit which still expects the endpoint to be live.
        await flush();
        const card = cardsRef.current.find((c) => c.id === cardId);
        if (!card) return;
        changeCard({ ...card, trashed: true });
        setSelected(null);
        setPasteTarget(null);
        setSelectedLine(null);
        await flush();
      } catch (e) {
        setNotice(`Could not delete card: ${String(e)}`);
      }
    },
    [changeCard, flush],
  );
  const finishSave = useCallback(() => {
    history.current.breakBurst();
    void flush().catch(() => {});
  }, [flush]);
  const updateCamera = useCallback(
    (next: Camera) => {
      setCamera(next);
      cameraRef.current = next;
      const key = boardId ?? HOME_CAMERA;
      cameras.current[key] = next;
      schedule(`camera:${key}`, () => storage.saveCamera(key, next));
    },
    [boardId, schedule],
  );
  const navigate = useCallback(
    async (next: string | null) => {
      if (importing) {
        setNotice("Wait for the import to finish before changing boards.");
        return;
      }
      if (next && !isBoardLive(boards, next)) return;
      try {
        await flush();
        schedule("session", () => storage.saveSession(next ?? HOME_CAMERA));
        setSelected(null);
        setPasteTarget(null);
        setSelectedLine(null);
        setConnecting(false);
        setPasteTarget(null);
        setContextMenu(null);
        setConnectFrom("");
        setConnectTo("");
        setBoardId(next);
        setCamera(cameras.current[next ?? HOME_CAMERA] ?? INITIAL_CAMERA);
      } catch {
        /* Do not hide work that failed to save. */
      }
    },
    [boards, importing, flush, schedule],
  );
  const deleteBoard = useCallback(
    async (id: string) => {
      const board = boards.find((b) => b.id === id);
      if (!board || importing) return;
      try {
        await flush();
        const next = { ...board, trashed: true };
        changeBoard(next);
        await flush();
        setSelected(null);
        setPasteTarget(null);
        setSelectedLine(null);
        setConnecting(false);
        if (boardId === id) {
          schedule("session", () =>
            storage.saveSession(board.parentId ?? HOME_CAMERA),
          );
          setBoardId(board.parentId);
          setCamera(
            cameras.current[board.parentId ?? HOME_CAMERA] ?? INITIAL_CAMERA,
          );
        }
      } catch (e) {
        setNotice(`Could not delete board: ${String(e)}`);
      }
    },
    [boards, importing, flush, boardId, schedule, changeBoard],
  );
  const restoreBoard = async (board: Board) => {
    const next = {
      ...board,
      trashed: false,
      parentId:
        board.parentId && isBoardLive(boards, board.parentId)
          ? board.parentId
          : null,
    };
    try {
      changeBoard(next);
      await flush();
    } catch (e) {
      setNotice(`Could not restore board: ${String(e)}`);
    }
  };
  const createBoard = async (
    at?: { x: number; y: number },
    openAfter = true,
  ) => {
    const point = at ?? canvasPoint();
    const board: Board = {
      id: id(),
      title: "Untitled board",
      color: COLORS[(boards.length + 1) % COLORS.length],
      order:
        Math.max(
          0,
          ...visibleCards.map((c) => c.order ?? 0),
          ...childBoards.map((b) => b.order),
        ) + 1,
      parentId: boardId,
      x: point.x - TILE_WIDTH / 2,
      y: point.y - TILE_HEIGHT / 2,
      trashed: false,
    };
    try {
      await flush();
      changeBoard(board);
      await flush();
      if (!openAfter) {
        setSelected(board.id);
        return;
      }
      schedule("session", () => storage.saveSession(board.id));
      setSelected(null);
      setPasteTarget(null);
      setSelectedLine(null);
      setConnecting(false);
      setConnectFrom("");
      setConnectTo("");
      setBoardId(board.id);
      setCamera(INITIAL_CAMERA);
    } catch (e) {
      setNotice(`Could not create board: ${String(e)}`);
    }
  };
  const canvasPoint = useCallback((clientX?: number, clientY?: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    const view = cameraRef.current;
    return {
      x:
        ((clientX ?? (rect ? rect.left + rect.width / 2 : 500)) -
          (rect?.left ?? 0) -
          view.x) /
        view.zoom,
      y:
        ((clientY ?? (rect ? rect.top + rect.height / 2 : 300)) -
          (rect?.top ?? 0) -
          view.y) /
        view.zoom,
    };
  }, []);
  const addNote = (kind: Preset = "text", at?: { x: number; y: number }) => {
    if (!boardId) return;
    const point = at ?? canvasPoint();
    const card = makeCard(boardId, point.x - 160, point.y - 90, [
      contentBlock(kind),
    ]);
    changeCard(card);
    setSelected(card.id);
  };

  const chooseFile = useCallback(
    async (targetId?: string, at?: { x: number; y: number }) => {
      if (importGroup.current) return;
      if (!storage.desktop || !boardId) {
        setNotice("File importing is available in the desktop app.");
        return;
      }
      try {
        const selectedPaths = await open({ multiple: true, directory: false });
        if (!selectedPaths) return;
        if (importGroup.current) return;
        beginImport();
        setImporting(true);
        const point = at ?? canvasPoint();
        const errors: string[] = [];
        for (const [index, path] of (Array.isArray(selectedPaths)
          ? selectedPaths
          : [selectedPaths]
        ).entries()) {
          try {
            const value: Block = {
              ...(await storage.importFile(path)),
              kind: "file",
              id: id(),
            };
            const target = targetId
              ? cardsRef.current.find((c) => c.id === targetId && !c.trashed)
              : undefined;
            if (target)
              changeCard({ ...target, blocks: [...target.blocks, value] });
            else if (!targetId) {
              const card = makeCard(
                boardId,
                point.x - 160 + (index % 4) * 360,
                point.y - 100 + Math.floor(index / 4) * 360,
                [value],
              );
              changeCard(card);
              setSelected(card.id);
            }
          } catch (e) {
            errors.push(`${path.split("/").pop()}: ${String(e)}`);
          }
        }
        if (errors.length) setNotice(errors.join("\n"));
      } catch (e) {
        setNotice(String(e));
      } finally {
        finishImport();
        setImporting(false);
      }
    },
    [boardId, canvasPoint, changeCard],
  );

  const applyImported = useCallback(
    (
      image: { asset: string; thumbnail: string; name: string },
      targetId?: string,
      point?: { x: number; y: number },
    ) => {
      if (!boardId) return;
      const imageBlock: Block = { ...image, kind: "image", id: id() };
      if (targetId) {
        // Read the latest content so edits made while the picker was open are retained.
        const target = cardsRef.current.find(
          (card) =>
            card.id === targetId && !card.trashed && card.boardId === boardId,
        );
        if (target)
          changeCard({ ...target, blocks: [...target.blocks, imageBlock] });
        else
          setNotice(
            "The destination card is no longer available on this board.",
          );
      } else {
        const at = point ?? canvasPoint();
        const card = makeCard(boardId, at.x - 160, at.y - 100, [
          imageBlock,
          block("text"),
        ]);
        changeCard(card);
        setSelected(card.id);
      }
    },
    [boardId, canvasPoint, changeCard, schedule],
  );

  const importPaths = useCallback(
    async (
      paths: string[],
      targetId?: string,
      point?: { x: number; y: number },
      attachments = false,
    ) => {
      if (importGroup.current) return;
      beginImport();
      setImporting(true);
      const errors: string[] = [];
      const origin = point ?? canvasPoint();
      try {
        for (const [index, path] of paths.entries()) {
          try {
            const at = {
              x: origin.x + (index % 4) * 360,
              y: origin.y + Math.floor(index / 4) * 360,
            };
            if (attachments && !/\.(png|jpe?g|webp|gif)$/i.test(path)) {
              const value: Block = {
                ...(await storage.importFile(path)),
                kind: "file",
                id: id(),
              };
              const card = makeCard(boardId!, at.x - 160, at.y - 100, [value]);
              changeCard(card);
              setSelected(card.id);
            } else applyImported(await storage.importImage(path), targetId, at);
          } catch (e) {
            errors.push(String(e));
          }
        }
        if (errors.length) setNotice(errors.join("\n"));
      } finally {
        finishImport();
        setImporting(false);
      }
    },
    [applyImported, canvasPoint, boardId, changeCard],
  );
  const chooseImage = useCallback(
    async (targetId?: string, at?: { x: number; y: number }) => {
      if (importGroup.current) return;
      if (!storage.desktop) {
        setNotice(
          "Image importing is available in the desktop app. Browser preview is temporary.",
        );
        return;
      }
      try {
        const paths = await open({
          multiple: true,
          directory: false,
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "webp", "gif"],
            },
          ],
        });
        if (paths)
          await importPaths(
            Array.isArray(paths) ? paths : [paths],
            targetId,
            at,
          );
      } catch (e) {
        setNotice(String(e));
      }
    },
    [importPaths],
  );
  useEffect(() => {
    if (!storage.desktop || !boardId) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          // Tauri reports physical window coordinates, including the native title bar.
          const scale = window.devicePixelRatio || 1;
          const point = canvasPoint(
            event.payload.position.x / scale,
            event.payload.position.y / scale,
          );
          void importPaths(event.payload.paths, undefined, point, true);
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [boardId, canvasPoint, importPaths]);

  useEffect(() => {
    const copy = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        (target instanceof HTMLElement &&
          target.closest('input, textarea, [contenteditable="true"]')) ||
        !selectionRef.current.length ||
        showTrash ||
        showMove ||
        preview
      )
        return;
      const token = id();
      clipboard.current = {
        token,
        content: content.current,
        ids: [...selectionRef.current],
        canvas: boardId,
      };
      event.preventDefault();
      event.clipboardData?.setData("application/x-milanote-ish", token);
      event.clipboardData?.setData(
        "text/plain",
        selectionRef.current.map(itemLabel).join("\n"),
      );
    };
    document.addEventListener("copy", copy);
    return () => document.removeEventListener("copy", copy);
  }, [boardId, showTrash, showMove, preview, selection]);
  useEffect(() => {
    const paste = async (event: ClipboardEvent) => {
      if (
        showTrash ||
        showMove ||
        backupPreview ||
        permanentDelete ||
        preview ||
        importing ||
        (event.target instanceof HTMLElement &&
          !!event.target.closest('[contenteditable="true"]')) ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement
      )
        return;
      const copied = clipboard.current;
      if (
        !pasteTarget &&
        copied &&
        event.clipboardData?.getData("application/x-milanote-ish") ===
          copied.token
      ) {
        event.preventDefault();
        const result = duplicateItems(copied.content, copied.ids);
        if (
          !boardId &&
          result.patch.cards.some(
            (card) =>
              !result.patch.boards.some((board) => board.id === card.boardId),
          )
        ) {
          setNotice("Open a board before pasting cards.");
          return;
        }
        const roots = new Set(result.selected);
        result.patch.boards = result.patch.boards.map((board) =>
          roots.has(board.id) ? { ...board, parentId: boardId } : board,
        );
        result.patch.cards = result.patch.cards.map((card) =>
          roots.has(card.id) ? { ...card, boardId: boardId! } : card,
        );
        result.patch.connectors = result.patch.connectors.map((line) =>
          line.boardId === copied.canvas
            ? { ...line, boardId: boardId! }
            : line,
        );
        applyEdit(result.patch);
        setSelection(result.selected);
        return;
      }
      if (!boardId) return;
      const image = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (image) {
        event.preventDefault();
        beginImport();
        setImporting(true);
        try {
          applyImported(
            await storage.importClipboard(
              Array.from(new Uint8Array(await image.arrayBuffer())),
            ),
            pasteTarget ?? undefined,
          );
          setPasteTarget(null);
        } catch (e) {
          setNotice(String(e));
        } finally {
          finishImport();
          setImporting(false);
        }
      } else if (pasteTarget) {
        event.preventDefault();
        setNotice(
          "The clipboard has no image. Copy an image, then try Paste image again.",
        );
        setPasteTarget(null);
      } else {
        const text = event.clipboardData?.getData("text/plain");
        if (text) {
          event.preventDefault();
          const p = canvasPoint();
          const html = event.clipboardData?.getData("text/html");
          const parsed = html
            ? new DOMParser().parseFromString(html, "text/html")
            : null;
          const document = parsed ? readDocument(parsed.body) : undefined;
          const content: Block = webUrl(text)
            ? { id: id(), kind: "link", url: text.trim(), title: "" }
            : {
                id: id(),
                kind: "text",
                text: document ? documentText(document) : text,
                ...(document ? { document } : {}),
              };
          const card = makeCard(boardId, p.x - 160, p.y - 90, [content]);
          changeCard(card);
          setSelected(card.id);
        }
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [
    boardId,
    applyImported,
    canvasPoint,
    changeCard,
    showTrash,
    preview,
    importing,
    showMove,
    backupPreview,
    permanentDelete,
    applyEdit,
    pasteTarget,
  ]);

  const zoomAt = useCallback(
    (zoom: number, px?: number, py?: number) => {
      const rect = canvas.current?.getBoundingClientRect();
      const view = cameraRef.current;
      const x = px ?? (rect?.width ?? 800) / 2,
        y = py ?? (rect?.height ?? 600) / 2;
      const next = Math.max(0.1, Math.min(4, zoom));
      updateCamera({
        x: x - ((x - view.x) * next) / view.zoom,
        y: y - ((y - view.y) * next) / view.zoom,
        zoom: next,
      });
    },
    [updateCamera],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomAt(
          cameraRef.current.zoom * Math.exp(-event.deltaY * 0.01),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      } else
        updateCamera({
          ...cameraRef.current,
          x: cameraRef.current.x - event.deltaX,
          y: cameraRef.current.y - event.deltaY,
        });
    };
    // Non-passive is necessary to route trackpad pinch to the canvas rather than page zoom.
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [boardId, ready, zoomAt, updateCamera]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        cancelGesture();
        e.preventDefault();
        e.stopPropagation();
        void travelHistory(e.shiftKey);
        return;
      }
      if (groupDrag.current && e.key !== "Escape") {
        e.preventDefault();
        return;
      }
      if (
        e.key === "Escape" &&
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, [contenteditable="true"]')
      ) {
        e.target.blur();
        return;
      }
      if (
        (e.target instanceof HTMLElement &&
          !!e.target.closest('[contenteditable="true"]')) ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      }
      if (e.key === "Escape") {
        cancelGesture();
        setContextMenu(null);
        setSelected(null);
        setPasteTarget(null);
        setSelectedLine(null);
        setConnecting(false);
        setConnectFrom("");
        setConnectTo("");
        setPreview(null);
        setShowTrash(false);
        setShowMove(false);
      }
      if (
        showTrash ||
        preview ||
        showMove ||
        backupPreview ||
        permanentDelete ||
        importing
      )
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLine) {
        e.preventDefault();
        deleteConnector();
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectionRef.current.length
      ) {
        e.preventDefault();
        void deleteSelection();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(items);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      }
      const offsets: Record<string, number[]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (
        offsets[e.key] &&
        selectionRef.current.length &&
        !(e.target instanceof HTMLButtonElement) &&
        !(
          e.target instanceof HTMLElement &&
          e.target.getAttribute("role") === "slider"
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
        const [dx, dy] = offsets[e.key];
        applyEdit(
          translateItems(
            content.current,
            selectionRef.current,
            dx * (e.shiftKey ? 10 : 1),
            dy * (e.shiftKey ? 10 : 1),
          ),
        );
        finishSave();
      }
      if (e.metaKey && ["+", "=", "-", "0"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "0") updateCamera(INITIAL_CAMERA);
        else zoomAt(cameraRef.current.zoom * (e.key === "-" ? 0.8 : 1.25));
      }
    };
    const beforeInput = (event: InputEvent) => {
      if (["historyUndo", "historyRedo"].includes(event.inputType)) {
        event.preventDefault();
        event.stopPropagation();
        void travelHistory(event.inputType === "historyRedo");
      }
    };
    document.addEventListener("beforeinput", beforeInput, true);
    const up = () => {
      space.current = false;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", up);
    return () => {
      document.removeEventListener("beforeinput", beforeInput, true);
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", up);
    };
  }, [
    updateCamera,
    zoomAt,
    selected,
    deleteCard,
    selectedLine,
    connectors,
    showTrash,
    preview,
    boards,
    boardId,
    importing,
    historyTick,
    selection,
    applyEdit,
    showMove,
    backupPreview,
    permanentDelete,
  ]);

  const fit = () => {
    const visible = cards.filter((c) => c.boardId === boardId && !c.trashed);
    const rect = canvas.current?.getBoundingClientRect();
    if ((!visible.length && !childBoards.length) || !rect) {
      updateCamera(INITIAL_CAMERA);
      return;
    }
    const minX = Math.min(
        ...visible.map((c) => c.x),
        ...childBoards.map((b) => b.x),
      ),
      minY = Math.min(
        ...visible.map((c) => c.y),
        ...childBoards.map((b) => b.y),
      );
    const maxX = Math.max(
        ...visible.map((c) => c.x + c.width),
        ...childBoards.map((b) => b.x + TILE_WIDTH),
      ),
      maxY = Math.max(
        ...childBoards.map(
          (b) =>
            b.y +
            (document.getElementById(`board-${b.id}`)?.offsetHeight ??
              TILE_HEIGHT),
        ),
        ...visible.map(
          (c) =>
            c.y +
            (document.getElementById(`card-${c.id}`)?.offsetHeight ?? 400),
        ),
      );
    const zoom = Math.max(
      0.1,
      Math.min(
        1,
        (rect.width - 100) / (maxX - minX),
        (rect.height - 100) / (maxY - minY),
      ),
    );
    updateCamera({
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
      zoom,
    });
  };
  if (fatal)
    return (
      <main className="startup-error">
        <h1>Could not open your library.</h1>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>Retry</button>
        <p>Your library has not been replaced.</p>
      </main>
    );
  if (!ready)
    return (
      <main className="startup-error">
        <p>Opening your local library…</p>
      </main>
    );

  return (
    <div className="app">
      <header className="header">
        <button
          className="brand"
          onClick={() => void navigate(null)}
          aria-label="Go to Home"
        >
          <span className="brand-mark">
            <Icon name="board" />
          </span>
          <span>
            milanote-ish
            <span className="brand-sub">PERSONAL WORKSPACE</span>
          </span>
        </button>
        <nav className="breadcrumb" aria-label="Board navigation">
          <span className="path-label">Board path</span>
          <button onClick={() => void navigate(null)}>Home</button>
          {path.map((board) => (
            <span className="breadcrumb-part" key={board.id}>
              <span>/</span>
              <button
                aria-current={board.id === boardId ? "page" : undefined}
                onClick={() => void navigate(board.id)}
              >
                {board.title || "Untitled board"}
              </button>
            </span>
          ))}
        </nav>
        <div className="history-controls">
          <button
            disabled={!history.current.past.length || importing}
            onClick={() => void travelHistory(false)}
            title="Undo, Cmd-Z"
          >
            Undo
          </button>
          <button
            disabled={!history.current.future.length || importing}
            onClick={() => void travelHistory(true)}
            title="Redo, Shift-Cmd-Z"
          >
            Redo
          </button>
        </div>
        <div className="save-status">
          <span className={`status-dot ${error ? "error" : ""}`} />
          {storage.desktop
            ? gesturing
              ? "Moving…"
              : status
            : "Temporary preview"}
        </div>
        <div className="zoom-controls">
          <button
            onClick={() => zoomAt(camera.zoom / 1.25)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => updateCamera(INITIAL_CAMERA)}
            title="Reset view"
          >
            {Math.round(camera.zoom * 100)}%
          </button>
          <button
            onClick={() => zoomAt(camera.zoom * 1.25)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button onClick={fit}>Fit</button>
        </div>
      </header>
      <aside className="rail">
        <button
          className={!boardId ? "active" : ""}
          onClick={() => void navigate(null)}
        >
          <Icon name="home" />
          <span>Home</span>
        </button>
        <div className="rail-rule" />
        <button
          draggable={!importing}
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-milanote-tool", "text")
          }
          disabled={!boardId || importing}
          onClick={() => addNote()}
        >
          <Icon name="note" />
          <span>Text</span>
        </button>
        <button
          disabled={!boardId || importing}
          onClick={() => void chooseImage()}
          draggable={!importing}
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-milanote-tool", "image")
          }
        >
          <Icon name="image" />
          <span>Image</span>
        </button>
        {(["quote", "link", "checklist"] as const).map((kind) => (
          <button
            key={kind}
            disabled={!boardId || importing}
            draggable={!importing}
            onDragStart={(e) =>
              e.dataTransfer.setData("application/x-milanote-tool", kind)
            }
            onClick={() => addNote(kind)}
          >
            <span className="tool-glyph">
              {kind === "quote" ? "“”" : kind === "link" ? "↗" : "☑"}
            </span>
            <span>
              {kind === "quote"
                ? "Quote"
                : kind === "link"
                  ? "Link"
                  : "Checklist"}
            </span>
          </button>
        ))}
        <button
          disabled={!boardId || importing}
          onClick={() => void chooseFile()}
          draggable={!importing}
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-milanote-tool", "file")
          }
        >
          <Icon name="note" />
          <span>File</span>
        </button>
        <button
          disabled={!boardId || importing}
          className={connecting ? "active" : ""}
          aria-pressed={connecting}
          onClick={() => {
            setConnecting((old) => !old);
            setConnectFrom(selected ?? "");
            setConnectTo("");
            setSelectedLine(null);
          }}
        >
          <Icon name="connector" />
          <span>Connector</span>
        </button>
        <button
          className={hand ? "active" : ""}
          aria-pressed={hand}
          onClick={() => setHand((v) => !v)}
        >
          <Icon name="hand" />
          <span>Pan</span>
        </button>
        <div className="rail-rule" />
        <button
          draggable={!importing}
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-milanote-tool", "board")
          }
          disabled={importing}
          onClick={() => void createBoard()}
        >
          <Icon name="plus" />
          <span>Board</span>
        </button>
        <button disabled={importing} onClick={() => void exportLibrary()}>
          <span className="tool-glyph">↓</span>
          <span>Backup</span>
        </button>
        <button disabled={importing} onClick={() => void chooseBackup()}>
          <span className="tool-glyph">↑</span>
          <span>Restore backup</span>
        </button>
        <button
          disabled={importing}
          onClick={() => setShowTrash(true)}
          aria-label="Open Trash"
        >
          <span className="trash-symbol">⌫</span>
          <span>
            Trash{" "}
            {cards.filter((c) => c.trashed).length +
              boards.filter((b) => b.trashed).length +
              trashedLines.length || ""}
          </span>
        </button>
        <span className="rail-bottom">
          ON THIS
          <br />
          MAC
        </span>
      </aside>
      <main className="workspace">
        {(notice || error) && (
          <div className="notice" role="alert">
            <span>{error || notice}</span>
            {error ? (
              <button onClick={() => void flush().catch(() => {})}>
                Retry save
              </button>
            ) : (
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            )}
          </div>
        )}
        <div className="board-bar">
          {!boardId ? (
            <h1>Your boards</h1>
          ) : (
            <input
              aria-label="Board title"
              value={currentBoard?.title ?? ""}
              placeholder="Untitled board"
              onChange={(e) => {
                if (currentBoard)
                  changeBoard({ ...currentBoard, title: e.target.value });
              }}
              onBlur={finishSave}
            />
          )}
          {currentBoard && (
            <button
              disabled={importing}
              onClick={() => void deleteBoard(currentBoard.id)}
            >
              Delete board
            </button>
          )}
          <span>
            {importing
              ? "Working…"
              : `${childBoards.length} boards${boardId ? ` · ${visibleCards.length} cards` : ""}`}
          </span>
        </div>
        {pasteTarget && (
          <div className="selection-tools">
            <span>
              Press Cmd-V to add an image to {itemLabel(pasteTarget)}.
            </span>
            <button onClick={() => setPasteTarget(null)}>
              Cancel image paste
            </button>
          </div>
        )}
        {boardId && !connecting && !currentLine && (
          <div className="connector-tools">
            <span>
              Select an item, then drag its round handle to another item to
              connect.
            </span>
          </div>
        )}
        {boardId && connecting && (
          <div className="connector-tools" aria-label="Create connector">
            <span>
              {connectFrom
                ? "Choose a target, or drag between items."
                : "Choose two items to connect."}
            </span>
            <label>
              From{" "}
              <select
                aria-label="New connector source"
                value={connectFrom}
                onChange={(e) => {
                  setConnectFrom(e.target.value);
                  selectItem(e.target.value || null);
                }}
              >
                <option value="">Choose source</option>
                {items.map((id) => (
                  <option key={id} value={id}>
                    {itemLabel(id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To{" "}
              <select
                aria-label="New connector target"
                value={connectTo}
                onChange={(e) => setConnectTo(e.target.value)}
              >
                <option value="">Choose target</option>
                {items
                  .filter((id) => id !== connectFrom)
                  .map((id) => (
                    <option key={id} value={id}>
                      {itemLabel(id)}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={!connectFrom || !connectTo}
              onClick={() => connectItems(connectFrom, connectTo)}
            >
              Connect
            </button>
            <button onClick={() => setConnecting(false)}>Cancel</button>
          </div>
        )}
        {currentLine && !connecting && (
          <div className="connector-tools" aria-label="Edit connector">
            <label>
              From{" "}
              <select
                aria-label="Connector source"
                value={currentLine.fromId}
                onChange={(e) =>
                  changeConnector({ ...currentLine, fromId: e.target.value })
                }
              >
                {items
                  .filter((id) => id !== currentLine.toId)
                  .map((id) => (
                    <option key={id} value={id}>
                      {itemLabel(id)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              To{" "}
              <select
                aria-label="Connector target"
                value={currentLine.toId}
                onChange={(e) =>
                  changeConnector({ ...currentLine, toId: e.target.value })
                }
              >
                {items
                  .filter((id) => id !== currentLine.fromId)
                  .map((id) => (
                    <option key={id} value={id}>
                      {itemLabel(id)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Arrow{" "}
              <select
                aria-label="Connector arrow"
                value={currentLine.arrow}
                onChange={(e) =>
                  changeConnector({
                    ...currentLine,
                    arrow: e.target.value as Connector["arrow"],
                  })
                }
              >
                <option value="target">Target arrow</option>
                <option value="none">No arrow</option>
              </select>
            </label>
            <div className="line-colors">
              {LINE_COLORS.map((color) => (
                <button
                  key={color.value}
                  style={{ background: color.value }}
                  aria-label={`${color.name} connector colour`}
                  aria-pressed={currentLine.color === color.value}
                  onClick={() =>
                    changeConnector({ ...currentLine, color: color.value })
                  }
                />
              ))}
            </div>
            <button onClick={deleteConnector}>Delete connector</button>
          </div>
        )}
        {
          <div className="selection-tools">
            <span>
              {selection.length
                ? `${selection.length} selected`
                : "Shift-click or drag to select"}
            </span>
            <button
              disabled={importing || !selection.length}
              onClick={duplicateSelection}
            >
              Duplicate
            </button>
            <button
              disabled={importing || !selection.length}
              onClick={() => {
                setMoveDestination("");
                setShowMove(true);
              }}
            >
              Move to…
            </button>
            <button
              disabled={importing || !selection.length}
              onClick={() => void deleteSelection()}
            >
              Delete selected
            </button>
            <button onClick={() => setSelected(null)}>Clear selection</button>
          </div>
        }
        <div
          ref={canvas}
          className={`canvas ${hand ? "hand-mode" : ""}`}
          tabIndex={0}
          aria-label={boardId ? "Board canvas" : "Home canvas"}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-milanote-tool"))
              e.preventDefault();
          }}
          onDrop={(e) => {
            const kind = e.dataTransfer.getData("application/x-milanote-tool");
            if (!kind || importing) return;
            e.preventDefault();
            const at = canvasPoint(e.clientX, e.clientY);
            if (kind === "board") void createBoard(at, false);
            else if (
              boardId &&
              ["text", "quote", "link", "checklist"].includes(kind)
            )
              addNote(kind as Preset, at);
            else if (boardId && kind === "image")
              void chooseImage(undefined, at);
            else if (boardId && kind === "file") void chooseFile(undefined, at);
          }}
          onContextMenu={(e) => {
            const item = (e.target as HTMLElement).closest<HTMLElement>(
              "article[data-canvas-item]",
            );
            if (item?.dataset.canvasItem) {
              e.preventDefault();
              selectItem(item.dataset.canvasItem);
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                id: item.dataset.canvasItem,
              });
            }
          }}
          onPointerDownCapture={(e) => {
            setContextMenu(null);
            if ((space.current || hand || e.button === 1) && !connecting) {
              e.preventDefault();
              e.stopPropagation();
              pan.current = { x: e.clientX, y: e.clientY, camera };
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }
            const target = e.target as HTMLElement;
            const selectedItem = target.closest<HTMLElement>(
              "article[data-canvas-item]",
            );
            if (
              !connecting &&
              selectedItem?.dataset.canvasItem &&
              e.button === 0
            ) {
              const itemId = selectedItem.dataset.canvasItem;
              if (target.closest('input, textarea, [contenteditable="true"]'))
                setSelected(itemId);
              if (
                e.shiftKey &&
                !target.closest('input, textarea, [contenteditable="true"]')
              ) {
                e.preventDefault();
                e.stopPropagation();
                suppressCanvasClick.current = true;
                selectItem(itemId, true);
                e.currentTarget.focus();
                return;
              }
              if (
                (target.closest("[data-move-handle]") ||
                  target.closest('[role="slider"]') ||
                  !target.closest(
                    'input, textarea, button, [contenteditable="true"], [role="button"], [role="slider"], a',
                  )) &&
                !space.current &&
                !hand
              ) {
                e.preventDefault();
                e.stopPropagation();
                selectItem(itemId);
                e.currentTarget.focus();
                setGesturing(true);
                groupDrag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  zoom: cameraRef.current.zoom,
                  ids: target.closest('[role="slider"]')
                    ? [itemId]
                    : [...selectionRef.current],
                  dx: 0,
                  dy: 0,
                  mode: target.closest('[role="slider"]') ? "resize" : "move",
                  checkpointAt: Date.now(),
                };
                e.currentTarget.setPointerCapture(e.pointerId);
                return;
              }
            }
            if (!connecting) return;
            const item = (e.target as Element).closest<HTMLElement>(
              "article[data-canvas-item]",
            );
            if (item?.dataset.canvasItem) {
              e.preventDefault();
              e.stopPropagation();
              suppressCanvasClick.current = true;
              pickConnectItem(item.dataset.canvasItem);
            }
          }}
          onClickCapture={(e) => {
            if (connecting || suppressCanvasClick.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressCanvasClick.current = false;
            }
          }}
          onDoubleClickCapture={(e) => {
            if (connecting || hand || space.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onPointerDown={(e) => {
            if (
              e.target !== e.currentTarget &&
              !(
                e.target instanceof HTMLElement &&
                e.target.classList.contains("canvas-world")
              )
            )
              return;
            setSelectedLine(null);
            e.currentTarget.focus();
            if (space.current || hand || e.button === 1) {
              e.preventDefault();
              pan.current = { x: e.clientX, y: e.clientY, camera };
              e.currentTarget.setPointerCapture(e.pointerId);
            } else if (e.button === 0) {
              const base = e.shiftKey ? [...selectionRef.current] : [];
              if (!e.shiftKey) setSelected(null);
              marquee.current = { x: e.clientX, y: e.clientY, base };
              e.currentTarget.setPointerCapture(e.pointerId);
            }
          }}
          onPointerMove={(e) => {
            if (groupDrag.current) {
              const drag = groupDrag.current;
              drag.dx = (e.clientX - drag.x) / drag.zoom;
              drag.dy = (e.clientY - drag.y) / drag.zoom;
              const patch = gesturePatch(drag);
              for (const item of [...patch.cards, ...patch.boards]) {
                const node =
                  document.getElementById(`card-${item.id}`) ??
                  document.getElementById(`board-${item.id}`);
                if (node) {
                  node.style.left = `${item.x}px`;
                  node.style.top = `${item.y}px`;
                  if ("width" in item) node.style.width = `${item.width}px`;
                }
              }
              if (Date.now() - drag.checkpointAt >= 500) {
                drag.checkpointAt = Date.now();
                schedule("gesture", () => storage.saveGeometry(patch));
              }
            } else if (marquee.current) {
              const start = marquee.current;
              const rect = e.currentTarget.getBoundingClientRect();
              const left = Math.min(start.x, e.clientX),
                top = Math.min(start.y, e.clientY),
                right = Math.max(start.x, e.clientX),
                bottom = Math.max(start.y, e.clientY);
              setSelectionBox({
                left: left - rect.left,
                top: top - rect.top,
                width: right - left,
                height: bottom - top,
              });
              const hits = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  "article[data-canvas-item]",
                ),
              )
                .filter((node) => {
                  const box = node.getBoundingClientRect();
                  return (
                    box.right >= left &&
                    box.left <= right &&
                    box.bottom >= top &&
                    box.top <= bottom
                  );
                })
                .map((node) => node.dataset.canvasItem!);
              setSelection([...new Set([...start.base, ...hits])]);
            } else if (pan.current)
              updateCamera({
                ...pan.current.camera,
                x: pan.current.camera.x + e.clientX - pan.current.x,
                y: pan.current.camera.y + e.clientY - pan.current.y,
              });
          }}
          onPointerUp={() => {
            if (groupDrag.current) {
              const drag = groupDrag.current;
              const patch = gesturePatch(drag);
              schedule("gesture", () => storage.saveGeometry(patch));
              applyEdit(patch);
              groupDrag.current = null;
              setGesturing(false);
            }
            marquee.current = null;
            setSelectionBox(null);
            pan.current = null;
            finishSave();
          }}
          onPointerCancel={cancelGesture}
        >
          {selectionBox && (
            <div className="selection-box" style={selectionBox} />
          )}
          <div
            className="canvas-world"
            style={{
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            {boardId && (
              <ConnectorLayer
                key={boardId}
                lines={liveLines}
                itemIds={items}
                selectedItem={selected}
                selectedLine={selectedLine}
                camera={camera}
                canvas={canvas.current}
                onSelect={(id) => {
                  setSelectedLine(id);
                  setSelected(null);
                }}
                onConnect={connectItems}
                label={itemLabel}
              />
            )}
            {childBoards.map((board) => (
              <BoardTile
                key={board.id}
                board={board}
                count={itemCount(board.id)}
                selected={selection.includes(board.id)}
                active={selection.length === 1 && selected === board.id}
                zoom={camera.zoom}
                onSelect={selectItem}
                onChange={changeBoard}
                onOrder={reorderItem}
                onOpen={navigate}
                onDelete={deleteBoard}
                onFlush={finishSave}
              />
            ))}
            {cards
              .filter((c) => c.boardId === boardId && !c.trashed)
              .map((card) => (
                <CardView
                  key={card.id}
                  card={card}
                  selected={selection.includes(card.id)}
                  active={selection.length === 1 && selected === card.id}
                  zoom={camera.zoom}
                  onSelect={selectItem}
                  onChange={changeCard}
                  onImage={chooseImage}
                  onFile={chooseFile}
                  onPasteImage={prepareImagePaste}
                  onPreview={setPreview}
                  onFlush={finishSave}
                  onDelete={deleteCard}
                  onOrder={reorderItem}
                />
              ))}
          </div>
          {!visibleCards.length && !childBoards.length && (
            <div className="empty-board">
              <span className="empty-mark">
                <Icon name="board" />
              </span>
              <h2>{boardId ? "Empty board." : "Your local library."}</h2>
              <p>
                {boardId
                  ? "Add a note, drop an image, or create a nested board."
                  : "Start a board for your images, notes and references."}
                <br />
                Arrange it however you like.
              </p>
              <button
                onClick={boardId ? () => addNote() : () => void createBoard()}
              >
                {boardId ? "Add your first note" : "Start a board"}{" "}
                <span>↗</span>
              </button>
            </div>
          )}
          <div className="canvas-hint">
            Scroll to pan · Pinch to zoom · Drag items by their top edge
          </div>
        </div>
      </main>
      {showTrash && (
        <div
          className="trash-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Trash"
        >
          <section className="trash-panel">
            <div className="trash-heading">
              <h2>Trash</h2>
              <button
                disabled={importing}
                onClick={() =>
                  requestPermanentDelete(
                    cards.filter((card) => card.trashed).map((card) => card.id),
                    boards
                      .filter((board) => board.trashed)
                      .map((board) => board.id),
                    trashedLines.map((line) => line.id),
                  )
                }
              >
                Empty Trash…
              </button>
              <button autoFocus onClick={() => setShowTrash(false)}>
                Close ×
              </button>
            </div>
            <p>
              Deleted boards keep their nested boards and cards. Restore them
              together.
            </p>
            {boards
              .filter((b) => b.trashed)
              .map((board) => (
                <div className="trash-item" key={board.id}>
                  <div>
                    <strong>{board.title || "Untitled board"}</strong>
                    <span>Board and its contents</span>
                  </div>
                  <button onClick={() => void restoreBoard(board)}>
                    Restore board
                  </button>
                  <button
                    onClick={() => requestPermanentDelete([], [board.id])}
                  >
                    Delete permanently…
                  </button>
                </div>
              ))}
            {cards.filter((c) => c.trashed).length +
              boards.filter((b) => b.trashed).length +
              trashedLines.length ===
              0 && <p>Your trash is empty.</p>}
            {trashedLines.map((line) => (
              <div className="trash-item" key={line.id}>
                <div>
                  <strong>
                    {itemLabel(line.fromId)} → {itemLabel(line.toId)}
                  </strong>
                  <span>
                    {endpointsAvailable(line, boards, cards)
                      ? "Connector"
                      : "Restore both endpoints on the same board first."}
                  </span>
                </div>
                <button
                  disabled={!endpointsAvailable(line, boards, cards)}
                  onClick={() => changeConnector({ ...line, trashed: false })}
                >
                  Restore connector
                </button>
                <button
                  onClick={() => requestPermanentDelete([], [], [line.id])}
                >
                  Delete permanently…
                </button>
              </div>
            ))}
            {cards
              .filter((c) => c.trashed)
              .map((card) => (
                <div className="trash-item" key={card.id}>
                  <div>
                    <strong>
                      {card.blocks
                        .map(blockLabel)
                        .find(Boolean)
                        ?.slice(0, 60) || "Untitled card"}
                    </strong>
                    <span>
                      {boards.find((b) => b.id === card.boardId)?.title ||
                        "Board"}
                    </span>
                  </div>
                  {!isBoardLive(boards, card.boardId) && (
                    <select
                      aria-label="Restore card to board"
                      value={restoreDestinations[card.id] ?? ""}
                      onChange={(e) =>
                        setRestoreDestinations((old) => ({
                          ...old,
                          [card.id]: e.target.value,
                        }))
                      }
                    >
                      <option value="">Choose a board</option>
                      {boards
                        .filter((b) => isBoardLive(boards, b.id))
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {boardPath(boards, b.id)
                              .map((p) => p.title || "Untitled board")
                              .join(" / ")}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    disabled={
                      !isBoardLive(boards, card.boardId) &&
                      !restoreDestinations[card.id]
                    }
                    onClick={() => {
                      changeCard({
                        ...card,
                        boardId: isBoardLive(boards, card.boardId)
                          ? card.boardId
                          : restoreDestinations[card.id],
                        trashed: false,
                      });
                    }}
                  >
                    Restore
                  </button>
                  <button onClick={() => requestPermanentDelete([card.id])}>
                    Delete permanently…
                  </button>
                </div>
              ))}
          </section>
        </div>
      )}
      {contextMenu && (
        <div
          className="item-context-menu"
          role="menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 180),
            top: Math.min(contextMenu.y, window.innerHeight - 120),
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              reorderItem(contextMenu.id, true);
              setContextMenu(null);
            }}
          >
            Bring to front
          </button>
          <button
            role="menuitem"
            onClick={() => {
              reorderItem(contextMenu.id, false);
              setContextMenu(null);
            }}
          >
            Send to back
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void deleteSelection();
              setContextMenu(null);
            }}
          >
            Delete selected
          </button>
        </div>
      )}
      {importing && (
        <div className="working-overlay" role="status">
          Working with your local library…
        </div>
      )}
      {backupPreview && (
        <div className="trash-backdrop">
          <section
            className="trash-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Restore backup"
          >
            <h2>Replace library from backup?</h2>
            <p>
              {backupPreview.info.boards} boards, {backupPreview.info.cards}{" "}
              cards, {backupPreview.info.connectors} connectors,{" "}
              {backupPreview.info.assets} originals. Includes Trash. Saved{" "}
              {new Date(backupPreview.info.completedAt * 1000).toLocaleString()}
              .
            </p>
            <p>
              This replaces your current library and resets undo history. A
              recovery backup of the current library is created first.
            </p>
            <div className="attachment-actions">
              <button
                disabled={importing}
                onClick={() => void restoreLibrary()}
              >
                Replace library
              </button>
              <button onClick={() => setBackupPreview(null)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {permanentDelete && (
        <div className="trash-backdrop">
          <section
            className="trash-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm permanent deletion"
          >
            <h2>Delete permanently?</h2>
            <p>
              This removes {permanentDelete.removed.boards.length} boards,{" "}
              {permanentDelete.removed.cards.length} cards, and{" "}
              {permanentDelete.removed.connectors.length} connectors, including
              descendants and connected lines. This cannot be undone. Undo
              history and copied items will be cleared.
            </p>
            <div className="attachment-actions">
              <button
                disabled={importing}
                onClick={() => void erasePermanently()}
              >
                Delete permanently
              </button>
              <button onClick={() => setPermanentDelete(null)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {showMove && (
        <div className="trash-backdrop">
          <section
            className="trash-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Move selected items"
          >
            <h2>Move {selection.length} items</h2>
            <p>
              Connections between selected items move with them. Connections to
              items left behind go to Trash. Undo returns the whole move.
            </p>
            <select
              aria-label="Destination board"
              value={moveDestination}
              onChange={(e) => setMoveDestination(e.target.value)}
            >
              <option value="">Choose destination</option>
              {!selection.some((id) =>
                cards.some((card) => card.id === id),
              ) && <option value={HOME_CAMERA}>Home</option>}
              {boards
                .filter(
                  (board) =>
                    isBoardLive(boards, board.id) && board.id !== boardId,
                )
                .map((board) => (
                  <option key={board.id} value={board.id}>
                    {boardPath(boards, board.id)
                      .map((item) => item.title || "Untitled board")
                      .join(" / ")}
                  </option>
                ))}
            </select>
            <div className="attachment-actions">
              <button
                disabled={!moveDestination || importing}
                onClick={() => void moveSelection()}
              >
                Move
              </button>
              <button onClick={() => setShowMove(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {preview && (
        <div
          className="image-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Original image"
          onClick={() => setPreview(null)}
        >
          <button
            autoFocus
            aria-label="Close image preview"
            onClick={() => setPreview(null)}
          >
            Close ×
          </button>
          <AssetImage name={preview.asset} alt={preview.alt || preview.name} />
        </div>
      )}
    </div>
  );
}
