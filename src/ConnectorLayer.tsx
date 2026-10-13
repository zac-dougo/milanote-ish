import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Camera, Connector } from "./model";
import { borderPoint, connectorPoints } from "./connectors";
import type { Point, Rect } from "./connectors";

type Drag = {
  fixedId: string;
  cursor: Point;
  lineId?: string;
  end?: "source" | "target";
};

export function ConnectorLayer({
  lines,
  itemIds,
  selectedItem,
  selectedLine,
  camera,
  canvas,
  onSelect,
  onConnect,
  label,
}: {
  lines: Connector[];
  itemIds: string[];
  selectedItem: string | null;
  selectedLine: string | null;
  camera: Camera;
  canvas: HTMLDivElement | null;
  onSelect: (id: string) => void;
  onConnect: (fromId: string, toId: string, lineId?: string) => void;
  label: (id: string) => string;
}) {
  const [bounds, setBounds] = useState<Record<string, Rect>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const itemKey = itemIds.join("|");

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dragRef.current = null;
        setDrag(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  useLayoutEffect(() => {
    const nodes = new Map<HTMLElement, string>();
    for (const id of itemIds) {
      const node =
        document.getElementById(`card-${id}`) ??
        document.getElementById(`board-${id}`);
      if (node) nodes.set(node, id);
    }
    let frame = 0;
    const dirty = new Set(nodes.keys());
    const measure = () => {
      frame = 0;
      const changed = [...dirty];
      dirty.clear();
      setBounds((old) => {
        const next: Record<string, Rect> = {};
        for (const id of itemIds) if (old[id]) next[id] = old[id];
        for (const node of changed) {
          const id = nodes.get(node)!;
          next[id] = {
            x: node.offsetLeft,
            y: node.offsetTop,
            width: node.offsetWidth,
            height: node.offsetHeight,
          };
        }
        return next;
      });
    };
    const queue = (node: HTMLElement) => {
      dirty.add(node);
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // Gestures move only the item's DOM node. Observe those changes here rather
    // than rerendering every card on each pointer event just to move its lines.
    const resize = new ResizeObserver((entries) =>
      entries.forEach((e) => queue(e.target as HTMLElement)),
    );
    const mutation = new MutationObserver((entries) =>
      entries.forEach((e) => queue(e.target as HTMLElement)),
    );
    for (const node of nodes.keys()) {
      resize.observe(node);
      mutation.observe(node, { attributes: true, attributeFilter: ["style"] });
    }
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [itemKey]);

  const point = (e: PointerEvent): Point => {
    const rect = canvas?.getBoundingClientRect();
    return {
      x: (e.clientX - (rect?.left ?? 0) - camera.x) / camera.zoom,
      y: (e.clientY - (rect?.top ?? 0) - camera.y) / camera.zoom,
    };
  };
  const begin = (
    e: PointerEvent<SVGCircleElement>,
    fixedId: string,
    lineId?: string,
    end?: "source" | "target",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const next = { fixedId, cursor: point(e), lineId, end };
    dragRef.current = next;
    setDrag(next);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const finish = (e: PointerEvent) => {
    const active = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!active) return;
    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-canvas-item]");
    const id = hit?.dataset.canvasItem;
    if (!id || !itemIds.includes(id) || id === active.fixedId) return;
    if (active.end === "source") onConnect(id, active.fixedId, active.lineId);
    else onConnect(active.fixedId, id, active.lineId);
  };
  const selected = lines.find((line) => line.id === selectedLine);
  const selectedPoints =
    selected && bounds[selected.fromId] && bounds[selected.toId]
      ? connectorPoints(bounds[selected.fromId], bounds[selected.toId])
      : null;
  const source = selectedItem ? bounds[selectedItem] : null;
  const previewStart =
    drag && bounds[drag.fixedId]
      ? borderPoint(bounds[drag.fixedId], drag.cursor)
      : null;
  const handleRadius = 6 / camera.zoom;

  return (
    <>
      <svg
        className="connector-lines"
        width="1"
        height="1"
        aria-label="Board connectors"
      >
        <defs>
          {lines.map((line) => (
            <marker
              key={line.id}
              id={`arrow-${line.id}`}
              viewBox="0 0 8 8"
              refX="8"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 Z" fill={line.color} />
            </marker>
          ))}
        </defs>
        {lines.map((line) => {
          if (!bounds[line.fromId] || !bounds[line.toId]) return null;
          const [a, b] = connectorPoints(
            bounds[line.fromId],
            bounds[line.toId],
          );
          return (
            <g key={line.id}>
              {selectedLine === line.id && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={line.color}
                  strokeWidth="6"
                  strokeOpacity="0.2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <line
                className="connector-stroke"
                data-connector-id={line.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={line.color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                markerEnd={
                  line.arrow === "target" ? `url(#arrow-${line.id})` : undefined
                }
              />
              <line
                className="connector-hit"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth="16"
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={0}
                aria-label={`Connector: ${label(line.fromId)} to ${label(line.toId)}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.focus();
                  onSelect(line.id);
                }}
                onClick={(e) => {
                  // Accessibility activation can send a click without pointer events.
                  e.stopPropagation();
                  e.currentTarget.focus();
                  onSelect(line.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(line.id);
                  }
                }}
              />
            </g>
          );
        })}
      </svg>
      <svg
        className="connector-handles"
        width="1"
        height="1"
        onPointerMove={(e) => {
          if (dragRef.current) {
            const next = { ...dragRef.current, cursor: point(e) };
            dragRef.current = next;
            setDrag(next);
          }
        }}
        onPointerUp={finish}
        onPointerCancel={() => {
          dragRef.current = null;
          setDrag(null);
        }}
      >
        {previewStart && drag && (
          <line
            x1={previewStart.x}
            y1={previewStart.y}
            x2={drag.cursor.x}
            y2={drag.cursor.y}
            stroke="#243b35"
            strokeWidth="2"
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {source && selectedItem && (
          <circle
            className="connector-handle"
            // Keep the handle clear of the selected card's outline and hit box,
            // including in WebKit. The resulting line still anchors to the border.
            cx={source.x + source.width + 12 / camera.zoom}
            cy={source.y + 13}
            r={handleRadius}
            role="button"
            tabIndex={-1}
            aria-label="Drag to connect this item"
            onPointerDown={(e) => begin(e, selectedItem)}
          >
            <title>Drag to another card or board to connect</title>
          </circle>
        )}
        {selectedPoints &&
          selected &&
          selectedPoints.map((p, index) => (
            <circle
              className="connector-handle"
              key={index}
              cx={p.x}
              cy={p.y}
              r={handleRadius}
              role="button"
              tabIndex={-1}
              aria-label={index === 0 ? "Reconnect source" : "Reconnect target"}
              onPointerDown={(e) =>
                begin(
                  e,
                  index === 0 ? selected.toId : selected.fromId,
                  selected.id,
                  index === 0 ? "source" : "target",
                )
              }
            >
              <title>Drag to reconnect this endpoint</title>
            </circle>
          ))}
      </svg>
    </>
  );
}
