import { Badge } from "@adversary/ui/components/badge";
import { cn } from "@adversary/ui/lib/utils";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { EventGraphKind, EventGraphNode } from "@/lib/build-event-graph";
import {
  useEventGraphDetailLevel,
  useFlowZoom,
  useZoomCompensatedWidth,
} from "@/lib/flow-zoom";

const KIND_LABEL: Record<EventGraphKind, string> = {
  position: "POS",
  message: "MSG",
  both: "POS+MSG",
  empty: "EVT",
};

const KIND_COLOR: Record<EventGraphKind, string> = {
  position: "var(--event-kind-position)",
  message: "var(--event-kind-message)",
  both: "var(--event-kind-both)",
  empty: "var(--muted-foreground)",
};

const KIND_BADGE: Record<EventGraphKind, string> = {
  position:
    "border-[color:var(--event-kind-position)] text-[color:var(--event-kind-position)]",
  message:
    "border-[color:var(--event-kind-message)] text-[color:var(--event-kind-message)]",
  both: "border-[color:var(--event-kind-both)] text-[color:var(--event-kind-both)]",
  empty: "border-muted-foreground text-muted-foreground",
};

export function EventGraphNodeView({
  data,
  selected,
}: NodeProps<EventGraphNode>) {
  const vertical = data.layout === "vertical";
  const zoom = useFlowZoom();
  const detail = useEventGraphDetailLevel();
  const borderWidth = useZoomCompensatedWidth(1.5);
  const ringWidth = useZoomCompensatedWidth(2, 8);
  const kindColor = KIND_COLOR[data.kind];
  // Dashed borders fall apart under heavy downscale — solid below ~0.6 keeps the frame continuous.
  const borderStyle =
    data.playback === "current" || zoom < 0.6 ? "solid" : "dashed";
  const showSummary = detail !== "type";
  const showFull = detail === "full";

  return (
    <div
      className={cn(
        "box-border flex h-full w-full flex-col overflow-hidden rounded-md bg-card text-card-foreground transition-opacity",
        data.playback === "past" && "opacity-50",
        data.playback === "future" && "opacity-85",
        data.priority && "critical-rail",
        selected && "ring-2 ring-ring",
      )}
      style={{
        borderColor: kindColor,
        borderStyle,
        borderWidth,
        boxShadow:
          data.playback === "current"
            ? `0 0 0 ${ringWidth}px color-mix(in oklab, ${kindColor} 40%, transparent)`
            : undefined,
      }}
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className="size-2! border-border! bg-muted!"
      />
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          detail === "type"
            ? "items-center justify-center gap-1 p-2"
            : "gap-1 p-2.5",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1.5",
            detail === "type" ? "justify-center" : "justify-between",
          )}
        >
          <Badge
            variant="outline"
            className={cn(
              KIND_BADGE[data.kind],
              detail === "type" ? "text-xs" : "text-[10px]",
            )}
          >
            {KIND_LABEL[data.kind]}
          </Badge>
          {showSummary && data.playback === "current" ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              Now
            </span>
          ) : null}
        </div>
        {showSummary ? (
          <time
            className="font-mono text-[11px] text-muted-foreground"
            dateTime={data.at}
          >
            {new Date(data.at).toLocaleString()}
          </time>
        ) : null}
        {showFull && data.positionSummary ? (
          <p className="truncate font-mono text-[11px] text-foreground">
            {data.positionSummary}
          </p>
        ) : null}
        {showFull && data.messageSummary ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {data.messageSummary}
          </p>
        ) : null}
      </div>
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className="size-2! border-border! bg-muted!"
      />
    </div>
  );
}
