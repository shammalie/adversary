import { Button } from "@adversary/ui/components/button";
import { ButtonGroup, ButtonGroupSeparator } from "@adversary/ui/components/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@adversary/ui/components/tooltip";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import {
  FocusIcon,
  Maximize2Icon,
  MinusIcon,
  PlusIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactElement } from "react";
import "@xyflow/react/dist/style.css";

import { EventGraphNodeView } from "@/components/event-graph-node";
import { TimedEventEdgeView } from "@/components/event-graph-edge";
import {
  buildEventGraph,
  EVENT_GRAPH_NODE_HEIGHT,
  EVENT_GRAPH_NODE_WIDTH,
  type EventGraphLayout,
  type EventGraphNode,
  type TimedEventEdge,
} from "@/lib/build-event-graph";
import type { SimulationEvent, TargetDefinition } from "@/types/target";

const nodeTypes = { event: EventGraphNodeView };
const edgeTypes = { timed: TimedEventEdgeView };

export interface PreviewEventGraphProps {
  target: TargetDefinition;
  events: SimulationEvent[];
  currentEventId?: string | null;
  priorityTerms: string[];
  fitKey: string;
  onEventSelect?: (eventId: string, at: string) => void;
}

function ControlTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

function GraphViewportControls({
  layout,
  onLayoutChange,
  followActive,
  onFollowActiveChange,
}: {
  layout: EventGraphLayout;
  onLayoutChange: (layout: EventGraphLayout) => void;
  followActive: boolean;
  onFollowActiveChange: (follow: boolean) => void;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <Panel position="top-right" className="m-3!">
      <TooltipProvider delay={300}>
        <ButtonGroup
          orientation="vertical"
          className="pointer-events-auto bg-card/75 shadow-sm backdrop-blur-md"
          aria-label="Graph viewport controls"
        >
          <ControlTooltip label="Horizontal layout">
            <Button
              type="button"
              size="icon"
              variant={layout === "horizontal" ? "default" : "outline"}
              aria-label="Horizontal layout"
              aria-pressed={layout === "horizontal"}
              onClick={() => onLayoutChange("horizontal")}
            >
              <SquareSplitHorizontalIcon />
            </Button>
          </ControlTooltip>
          <ControlTooltip label="Vertical layout">
            <Button
              type="button"
              size="icon"
              variant={layout === "vertical" ? "default" : "outline"}
              aria-label="Vertical layout"
              aria-pressed={layout === "vertical"}
              onClick={() => onLayoutChange("vertical")}
            >
              <SquareSplitVerticalIcon />
            </Button>
          </ControlTooltip>
          <ButtonGroupSeparator orientation="horizontal" />
          <ControlTooltip label="Focus active node">
            <Button
              type="button"
              size="icon"
              variant={followActive ? "default" : "outline"}
              aria-label="Focus active node"
              aria-pressed={followActive}
              onClick={() => onFollowActiveChange(!followActive)}
            >
              <FocusIcon />
            </Button>
          </ControlTooltip>
          <ButtonGroupSeparator orientation="horizontal" />
          <ControlTooltip label="Zoom in">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom in"
              onClick={() => void zoomIn({ duration: 160 })}
            >
              <PlusIcon />
            </Button>
          </ControlTooltip>
          <ControlTooltip label="Zoom out">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Zoom out"
              onClick={() => void zoomOut({ duration: 160 })}
            >
              <MinusIcon />
            </Button>
          </ControlTooltip>
          <ControlTooltip label="Fit graph">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Fit graph"
              onClick={() => {
                onFollowActiveChange(false);
                void fitView({ padding: 0.2, duration: 200 });
              }}
            >
              <Maximize2Icon />
            </Button>
          </ControlTooltip>
        </ButtonGroup>
      </TooltipProvider>
    </Panel>
  );
}

function PreviewEventGraphCanvas({
  target,
  events,
  currentEventId,
  priorityTerms,
  fitKey,
  onEventSelect,
}: PreviewEventGraphProps) {
  const [layout, setLayout] = useState<EventGraphLayout>("horizontal");
  const [followActive, setFollowActive] = useState(true);
  const followZoomRef = useRef<number | null>(null);
  const programmaticViewportRef = useRef(false);
  const { fitView, getNode, getZoom, setCenter } = useReactFlow();
  const graph = useMemo(
    () =>
      buildEventGraph({
        target,
        events,
        currentEventId,
        priorityTerms,
        layout,
      }),
    [currentEventId, events, layout, priorityTerms, target],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<EventGraphNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TimedEventEdge>(graph.edges);

  const centerOnActiveNode = useEffectEvent((eventId: string, duration = 0) => {
    const node = getNode(eventId);
    if (!node) return;
    const zoom = followZoomRef.current ?? getZoom();
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    followZoomRef.current = zoom;
    const width = node.measured?.width ?? EVENT_GRAPH_NODE_WIDTH;
    const height = node.measured?.height ?? EVENT_GRAPH_NODE_HEIGHT;
    programmaticViewportRef.current = true;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom,
      duration,
    }).finally(() => {
      programmaticViewportRef.current = false;
    });
  });

  const fitOrFollow = useEffectEvent(() => {
    if (followActive && currentEventId) {
      centerOnActiveNode(currentEventId, 200);
      return;
    }
    followZoomRef.current = null;
    void fitView({ padding: 0.2, duration: 200 });
  });

  useEffect(() => {
    // Merge into existing RF nodes so measured dims / selection survive playhead updates.
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      const sameStructure =
        current.length === graph.nodes.length &&
        graph.nodes.every((node, index) => current[index]?.id === node.id);

      if (!sameStructure) return graph.nodes;

      return graph.nodes.map((next) => {
        const prev = currentById.get(next.id);
        if (!prev) return next;
        return {
          ...prev,
          position: next.position,
          sourcePosition: next.sourcePosition,
          targetPosition: next.targetPosition,
          style: next.style,
          data: next.data,
          draggable: next.draggable,
          selectable: next.selectable,
        };
      });
    });
    setEdges(graph.edges);
  }, [graph.edges, graph.nodes, setEdges, setNodes]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      fitOrFollow();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitKey, layout, target.id]);

  useEffect(() => {
    if (!followActive || !currentEventId) return;
    const frame = window.requestAnimationFrame(() => {
      // Instant pan while scrubbing/playing — keep the locked zoom level.
      centerOnActiveNode(currentEventId, 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentEventId, followActive]);

  const defaultEdgeOptions = useMemo(
    () => ({
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: target.color,
      },
    }),
    [target.color],
  );

  const onNodeClick: NodeMouseHandler<EventGraphNode> = (_event, node) => {
    onEventSelect?.(node.data.eventId, node.data.at);
  };

  function handleFollowActiveChange(follow: boolean) {
    setFollowActive(follow);
    if (!follow) {
      followZoomRef.current = null;
      return;
    }
    const zoom = getZoom();
    if (Number.isFinite(zoom) && zoom > 0) {
      followZoomRef.current = zoom;
    }
    if (currentEventId) {
      window.requestAnimationFrame(() => {
        centerOnActiveNode(currentEventId, 200);
      });
    }
  }

  function handleMoveEnd(_event: unknown, viewport: { zoom: number }) {
    if (programmaticViewportRef.current) return;
    if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return;
    // User pan/zoom: adopt the new zoom for subsequent focus pans.
    followZoomRef.current = followActive ? viewport.zoom : null;
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-muted/40 px-4 text-center text-sm text-muted-foreground">
        No events scheduled for {target.callsign}.
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodeClick={onNodeClick}
      onMoveEnd={handleMoveEnd}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      panOnScroll
      zoomOnScroll
      minZoom={0.35}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      className="preview-event-graph rounded-lg border border-border"
    >
      <Background
        id="ops-grid"
        variant={BackgroundVariant.Lines}
        gap={32}
        size={1}
        color="color-mix(in oklab, var(--primary) 12%, transparent)"
      />
      <GraphViewportControls
        layout={layout}
        onLayoutChange={setLayout}
        followActive={followActive}
        onFollowActiveChange={handleFollowActiveChange}
      />
    </ReactFlow>
  );
}

export function PreviewEventGraph(props: PreviewEventGraphProps) {
  return (
    <div className="relative h-full min-h-80 w-full">
      <ReactFlowProvider>
        <PreviewEventGraphCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
