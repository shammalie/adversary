import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
} from "@xyflow/react";

import type { TimedEventEdge } from "@/lib/build-event-graph";
import {
  useEventGraphDetailLevel,
  useFlowZoom,
  useZoomCompensatedWidth,
} from "@/lib/flow-zoom";

export function TimedEventEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
}: EdgeProps<TimedEventEdge>) {
  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
  const zoom = useFlowZoom();
  const detail = useEventGraphDetailLevel();
  const strokeWidth = useZoomCompensatedWidth(data?.active ? 2.5 : 1.75);
  const dash = `${Math.max(4, 6 / zoom)} ${Math.max(3, 4 / zoom)}`;

  const stroke = data?.active
    ? "var(--primary)"
    : data?.past
      ? `color-mix(in oklab, ${data.targetColor} 35%, transparent)`
      : `color-mix(in oklab, ${data?.targetColor ?? "var(--primary)"} 70%, transparent)`;

  const labelTransform =
    data?.layout === "vertical"
      ? `translate(calc(-100% - 8px), -50%) translate(${labelX}px, ${labelY}px)`
      : `translate(-50%, calc(-100% - 8px)) translate(${labelX}px, ${labelY}px)`;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: dash,
        }}
      />
      {data?.deltaLabel && detail !== "type" ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded border border-border/80 bg-card/95 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm"
            style={{ transform: labelTransform }}
          >
            {data.deltaLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
