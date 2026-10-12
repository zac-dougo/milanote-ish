import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { block, COLORS, id, INITIAL_CAMERA, makeCard } from "./model";
import type { Block, Board, Camera, Card } from "./model";
import * as storage from "./storage";
import { SaveQueue } from "./save-queue";
import { boardPath, HOME_CAMERA, isBoardLive } from "./boards";
import { BoardTile, TILE_HEIGHT, TILE_WIDTH } from "./BoardTile";

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
  name: "note" | "image" | "board" | "home" | "plus" | "hand";
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
  zoom,
  onChange,
  onSelect,
  onImage,
  onPreview,
  onFlush,
  onDelete,
  onOrder,
}: {
  card: Card;
  selected: boolean;
  zoom: number;
  onChange: (card: Card) => void;
  onSelect: (id: string) => void;
  onImage: (cardId: string) => void;
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
  const updateBlock = (blockId: string, text: string) =>
    onChange({
      ...card,
      blocks: card.blocks.map((b) =>
        b.id === blockId && b.kind !== "image" ? { ...b, text } : b,
      ),
    });
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
      ref={node}
      tabIndex={-1}
      className={`card surface-${card.color}${selected ? " selected" : ""}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        zIndex: selected ? 2147483647 : (card.order ?? 0),
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(card.id);
        if (
          !(e.target as HTMLElement).closest(
            'textarea, input, button, [role="button"], [role="slider"]',
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
          <div className={`block block-${b.kind}`} key={b.id}>
            {b.kind === "image" ? (
              <AssetImage
                name={b.thumbnail}
                alt={b.name}
                onOpen={() => onPreview(b)}
              />
            ) : (
              <textarea
                aria-label={b.kind === "heading" ? "Card heading" : "Card text"}
                placeholder={
                  b.kind === "heading" ? "Add a heading…" : "Write something…"
                }
                value={b.text}
                rows={1}
                spellCheck
                onBlur={onFlush}
                ref={(el) => {
                  if (el) {
                    el.style.height = "0px";
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                onChange={(e) => {
                  updateBlock(b.id, e.target.value);
                  e.target.style.height = "0px";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
              />
            )}
            {selected && (
              <div className="block-actions">
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
      {selected && (
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
          <button onClick={() => onImage(card.id)}>+ Image</button>
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
  const cardsRef = useRef<Card[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
  const [preview, setPreview] = useState<Extract<
    Block,
    { kind: "image" }
  > | null>(null);
  const [hand, setHand] = useState(false);
  const space = useRef(false);
  const pan = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  const { schedule, flush, status, error } = useSaves(importing);
  const currentBoard = boards.find((b) => b.id === boardId);
  const path = boardPath(boards, boardId);
  const childBoards = boards.filter(
    (b) => b.parentId === boardId && !b.trashed,
  );
  const visibleCards = cards.filter((c) => c.boardId === boardId && !c.trashed);
  const itemCount = (id: string) =>
    cards.filter((c) => c.boardId === id && !c.trashed).length +
    boards.filter((b) => b.parentId === id && !b.trashed).length;
  const changeBoard = useCallback(
    (board: Board) => {
      setBoards((previous) =>
        previous.map((b) => (b.id === board.id ? board : b)),
      );
      schedule(`board:${board.id}`, () => storage.saveBoard(board));
    },
    [schedule],
  );
  cameraRef.current = camera;

  useEffect(() => {
    void storage
      .loadLibrary()
      .then((lib) => {
        setBoards(lib.boards);
        cardsRef.current = lib.cards;
        setCards(lib.cards);
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
              ...boards
                .filter((b) => b.parentId === card.boardId)
                .map((b) => b.order),
            ) + 1,
        };
      const next = previous.some((c) => c.id === card.id)
        ? previous.map((c) => (c.id === card.id ? card : c))
        : [...previous, card];
      cardsRef.current = next;
      setCards(next);
      schedule(`card:${card.id}`, () => storage.saveCard(card));
    },
    [schedule, boards],
  );
  const reorderItem = useCallback(
    (id: string, front: boolean) => {
      const orders = [
        ...cardsRef.current
          .filter((c) => c.boardId === boardId && !c.trashed)
          .map((c) => c.order ?? 0),
        ...boards
          .filter((b) => b.parentId === boardId && !b.trashed)
          .map((b) => b.order),
      ];
      const order = front
        ? Math.max(0, ...orders) + 1
        : Math.min(0, ...orders) - 1;
      const card = cardsRef.current.find((c) => c.id === id);
      const board = boards.find((b) => b.id === id);
      if (card) changeCard({ ...card, order });
      else if (board) changeBoard({ ...board, order });
      setSelected(null);
    },
    [boardId, boards, changeCard, changeBoard],
  );
  const deleteCard = useCallback(
    (cardId: string) => {
      const card = cardsRef.current.find((c) => c.id === cardId);
      if (!card) return;
      changeCard({ ...card, trashed: true });
      setSelected(null);
    },
    [changeCard],
  );
  const finishSave = useCallback(() => {
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
        setNotice(
          "Wait for the image import to finish before changing boards.",
        );
        return;
      }
      if (next && !isBoardLive(boards, next)) return;
      try {
        await flush();
        schedule("session", () => storage.saveSession(next ?? HOME_CAMERA));
        setSelected(null);
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
        await storage.saveBoard(next);
        setBoards((previous) => previous.map((b) => (b.id === id ? next : b)));
        setSelected(null);
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
    [boards, importing, flush, boardId, schedule],
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
      await storage.saveBoard(next);
      setBoards((previous) =>
        previous.map((b) => (b.id === board.id ? next : b)),
      );
    } catch (e) {
      setNotice(`Could not restore board: ${String(e)}`);
    }
  };
  const createBoard = async () => {
    const point = canvasPoint();
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
      await storage.saveBoard(board);
      setBoards((previous) => [...previous, board]);
      schedule("session", () => storage.saveSession(board.id));
      setSelected(null);
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
  const addNote = () => {
    if (!boardId) return;
    const point = canvasPoint();
    const card = makeCard(boardId, point.x - 160, point.y - 90);
    changeCard(card);
    setSelected(card.id);
  };

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
        const target = cardsRef.current.find((card) => card.id === targetId);
        if (target)
          changeCard({ ...target, blocks: [...target.blocks, imageBlock] });
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
    ) => {
      setImporting(true);
      const errors: string[] = [];
      const origin = point ?? canvasPoint();
      try {
        for (const [index, path] of paths.entries()) {
          try {
            applyImported(await storage.importImage(path), targetId, {
              x: origin.x + (index % 4) * 360,
              y: origin.y + Math.floor(index / 4) * 360,
            });
          } catch (e) {
            errors.push(String(e));
          }
        }
        if (errors.length) setNotice(errors.join("\n"));
      } finally {
        setImporting(false);
      }
    },
    [applyImported, canvasPoint],
  );
  const chooseImage = useCallback(
    async (targetId?: string) => {
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
          await importPaths(Array.isArray(paths) ? paths : [paths], targetId);
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
          void importPaths(event.payload.paths, undefined, point);
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
    const paste = async (event: ClipboardEvent) => {
      if (
        !boardId ||
        showTrash ||
        preview ||
        importing ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement
      )
        return;
      const image = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (image) {
        event.preventDefault();
        setImporting(true);
        try {
          applyImported(
            await storage.importClipboard(
              Array.from(new Uint8Array(await image.arrayBuffer())),
            ),
          );
        } catch (e) {
          setNotice(String(e));
        } finally {
          setImporting(false);
        }
      } else {
        const text = event.clipboardData?.getData("text/plain");
        if (text) {
          event.preventDefault();
          const p = canvasPoint();
          const card = makeCard(boardId, p.x - 160, p.y - 90, [
            block("text", text),
          ]);
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
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      }
      if (e.key === "Escape") {
        setSelected(null);
        setPreview(null);
        setShowTrash(false);
      }
      if (showTrash || preview) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        if (boards.some((b) => b.id === selected)) void deleteBoard(selected);
        else deleteCard(selected);
      }
      if (e.metaKey && ["+", "=", "-", "0"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "0") updateCamera(INITIAL_CAMERA);
        else zoomAt(cameraRef.current.zoom * (e.key === "-" ? 0.8 : 1.25));
      }
    };
    const up = () => {
      space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", up);
    };
  }, [
    updateCamera,
    zoomAt,
    selected,
    deleteCard,
    showTrash,
    preview,
    boards,
    boardId,
    importing,
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
        <div className="save-status">
          <span className={`status-dot ${error ? "error" : ""}`} />
          {storage.desktop ? status : "Temporary preview"}
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
        <button disabled={!boardId || importing} onClick={addNote}>
          <Icon name="note" />
          <span>Text</span>
        </button>
        <button
          disabled={!boardId || importing}
          onClick={() => void chooseImage()}
        >
          <Icon name="image" />
          <span>Image</span>
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
        <button disabled={importing} onClick={() => void createBoard()}>
          <Icon name="plus" />
          <span>Board</span>
        </button>
        <button onClick={() => setShowTrash(true)} aria-label="Open Trash">
          <span className="trash-symbol">⌫</span>
          <span>
            Trash{" "}
            {cards.filter((c) => c.trashed).length +
              boards.filter((b) => b.trashed).length || ""}
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
              ? "Copying image…"
              : `${childBoards.length} boards${boardId ? ` · ${visibleCards.length} cards` : ""}`}
          </span>
        </div>
        <div
          ref={canvas}
          className={`canvas ${hand ? "hand-mode" : ""}`}
          tabIndex={0}
          aria-label={boardId ? "Board canvas" : "Home canvas"}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return;
            setSelected(null);
            if (space.current || hand || e.button === 1) {
              e.preventDefault();
              pan.current = { x: e.clientX, y: e.clientY, camera };
              e.currentTarget.setPointerCapture(e.pointerId);
            }
          }}
          onPointerMove={(e) => {
            if (pan.current)
              updateCamera({
                ...pan.current.camera,
                x: pan.current.camera.x + e.clientX - pan.current.x,
                y: pan.current.camera.y + e.clientY - pan.current.y,
              });
          }}
          onPointerUp={() => {
            pan.current = null;
            finishSave();
          }}
          onPointerCancel={() => {
            pan.current = null;
          }}
        >
          <div
            className="canvas-world"
            style={{
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            {childBoards.map((board) => (
              <BoardTile
                key={board.id}
                board={board}
                count={itemCount(board.id)}
                selected={selected === board.id}
                zoom={camera.zoom}
                onSelect={setSelected}
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
                  selected={selected === card.id}
                  zoom={camera.zoom}
                  onSelect={setSelected}
                  onChange={changeCard}
                  onImage={chooseImage}
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
              <button onClick={boardId ? addNote : () => void createBoard()}>
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
                </div>
              ))}
            {cards.filter((c) => c.trashed).length +
              boards.filter((b) => b.trashed).length ===
              0 && <p>Your trash is empty.</p>}
            {cards
              .filter((c) => c.trashed)
              .map((card) => (
                <div className="trash-item" key={card.id}>
                  <div>
                    <strong>
                      {card.blocks
                        .filter(
                          (
                            b,
                          ): b is Extract<
                            Block,
                            { kind: "heading" | "text" }
                          > => b.kind !== "image",
                        )
                        .map((b) => b.text)
                        .find(Boolean)
                        ?.slice(0, 60) ||
                        (card.blocks.some((b) => b.kind === "image")
                          ? "Image card"
                          : "Untitled card")}
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
                </div>
              ))}
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
          <AssetImage name={preview.asset} alt={preview.name} />
        </div>
      )}
    </div>
  );
}
