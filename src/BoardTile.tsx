import { memo, useRef } from "react";
import type { PointerEvent } from "react";
import { COLORS } from "./model";
import type { Board } from "./model";

export const TILE_WIDTH = 240;
export const TILE_HEIGHT = 180;

export const BoardTile = memo(function BoardTile({
  board,
  count,
  selected,
  zoom,
  onChange,
  onSelect,
  onOpen,
  onDelete,
  onFlush,
  onOrder,
}: {
  board: Board;
  count: number;
  selected: boolean;
  zoom: number;
  onChange: (board: Board) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onFlush: () => void;
  onOrder: (id: string, front: boolean) => void;
}) {
  const node = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; last: Board } | null>(null);
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !node.current) return;
    d.last = {
      ...board,
      x: board.x + (e.clientX - d.x) / zoom,
      y: board.y + (e.clientY - d.y) / zoom,
    };
    node.current.style.left = `${d.last.x}px`;
    node.current.style.top = `${d.last.y}px`;
  };
  const finish = () => {
    if (!drag.current) return;
    onChange(drag.current.last);
    drag.current = null;
    onFlush();
  };
  return (
    <article
      id={`board-${board.id}`}
      data-canvas-item={board.id}
      ref={node}
      className={`canvas-board surface-${board.color}${selected ? " selected" : ""}`}
      style={{
        left: board.x,
        top: board.y,
        width: TILE_WIDTH,
        zIndex: selected ? 2147483646 : board.order,
      }}
      tabIndex={0}
      aria-label={`Board tile: ${board.title || "Untitled board"}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(board.id);
        if (!(e.target as HTMLElement).closest("input,button,[role=button]"))
          node.current?.focus();
      }}
      onFocusCapture={() => onSelect(board.id)}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("input, button"))
          onOpen(board.id);
      }}
      onKeyDown={(e) => {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLButtonElement
        )
          return;
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(board.id);
        }
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
            ...board,
            x: board.x + offset[0] * (e.shiftKey ? 10 : 1),
            y: board.y + offset[1] * (e.shiftKey ? 10 : 1),
          });
        }
      }}
    >
      <div
        className="card-grip"
        role="button"
        tabIndex={0}
        aria-label={`Move board: ${board.title || "Untitled board"}`}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.focus();
          onSelect(board.id);
          drag.current = { x: e.clientX, y: e.clientY, last: board };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <span className="grip-dots">⠿</span>
        <span>BOARD</span>
      </div>
      <div className="board-tile-content">
        <span className="board-initial">
          {(board.title.trim() || "B").slice(0, 1).toUpperCase()}
        </span>
        <input
          aria-label="Board tile title"
          value={board.title}
          placeholder="Untitled board"
          onChange={(e) => onChange({ ...board, title: e.target.value })}
          onBlur={onFlush}
        />
        <div className="board-tile-bottom">
          <span>{count} items</span>
          <button
            aria-label={`Open board: ${board.title || "Untitled board"}`}
            onClick={() => onOpen(board.id)}
          >
            Open ↗
          </button>
        </div>
      </div>
      {selected && (
        <div className="card-tools">
          <button onClick={() => onOrder(board.id, true)}>
            Bring to front
          </button>
          <button onClick={() => onOrder(board.id, false)}>Send to back</button>
          <button onClick={() => onDelete(board.id)}>Delete board</button>
          <div className="swatches">
            {COLORS.map((color) => (
              <button
                key={color}
                className={`swatch surface-${color}`}
                aria-label={`${color} board colour`}
                aria-pressed={color === board.color}
                onClick={() => onChange({ ...board, color })}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
});
