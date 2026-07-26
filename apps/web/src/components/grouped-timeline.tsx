import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
import { cn } from "@adversary/ui/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDownIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import {
  EditTimelineEvent,
  ViewTimelineEvent,
} from "@/components/grouped-timeline-event";
import { derivePositionSnapshot } from "@/lib/position-telemetry";
import { sortEvents } from "@/lib/simulation-engine";
import {
  getIssuesForEvent,
  type ValidationIssue,
} from "@/lib/scenario-validation-ui";
import type {
  PositionPayload,
  SimulationEvent,
  SimulationScenario,
  TargetDefinition,
  VehicleCategory,
} from "@/types/target";

const TIMELINE_VIEWPORT =
  "h-[min(36rem,58vh)] max-h-[min(36rem,58vh)] min-h-0 overflow-auto pr-2 scrollbar-thin";
const OVERSCAN = 8;
/** Matches original `gap-1.5` between group cards. */
const GROUP_GAP_PX = 6;
/** Matches original list gaps: view `gap-0.5`, edit `gap-1.5`. */
const EVENT_GAP_VIEW_PX = 2;
const EVENT_GAP_EDIT_PX = 6;
const HEADER_ESTIMATE_PX = 37;
const META_ESTIMATE_PX = 28;
const VIEW_EVENT_ESTIMATE_PX = 72;
const EDIT_EVENT_ESTIMATE_PX = 300;

function describeEvent(
  event: SimulationEvent,
  previousPosition?: PositionPayload,
  vehicleCategory?: VehicleCategory,
) {
  const parts: string[] = [];
  if (event.position) {
    const derived = derivePositionSnapshot(
      event.position,
      event.at,
      previousPosition
        ? {
            ...previousPosition,
            altitude: previousPosition.altitude ?? 0,
            speed: previousPosition.speed ?? 0,
            heading: 0,
            course: 0,
            at: event.at,
          }
        : undefined,
      vehicleCategory,
    );
    parts.push(
      `${event.position.latitude.toFixed(4)}, ${event.position.longitude.toFixed(4)} · ${derived.speed} kt · ${derived.heading}°`,
    );
  }
  if (event.message) parts.push(event.message);
  return parts.join(" · ");
}

type HeaderItem = {
  type: "header";
  key: string;
  target: TargetDefinition;
  eventCount: number;
  expanded: boolean;
  graphSelected: boolean;
};

type FlatItem =
  | HeaderItem
  | {
      type: "meta";
      key: string;
      firstAt?: string;
      lastAt?: string;
      graphSelected: boolean;
      isGroupEnd: boolean;
    }
  | {
      type: "event";
      key: string;
      target: TargetDefinition;
      event: SimulationEvent;
      summary: string;
      issues: ValidationIssue[];
      graphSelected: boolean;
      isGroupEnd: boolean;
    }
  | {
      type: "gap";
      key: string;
      size: number;
    };

function TargetHeaderBar({
  item,
  onSelectGraphTarget,
  onOpenChange,
}: {
  item: HeaderItem;
  onSelectGraphTarget: (targetId: string) => void;
  onOpenChange: (targetId: string, open: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "border bg-card",
        item.expanded ? "rounded-t-md border-b" : "rounded-md",
        item.graphSelected && "border-primary/50 ring-1 ring-primary/30",
      )}
    >
      <button
        type="button"
        aria-expanded={item.expanded}
        className="flex min-w-0 w-full items-center gap-1.5 px-2 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          onSelectGraphTarget(item.target.id);
          onOpenChange(item.target.id, !item.expanded);
        }}
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: item.target.color }}
          aria-hidden="true"
        />
        <span className="truncate font-medium">{item.target.callsign}</span>
        <Badge variant="outline" className="text-[10px]">
          {item.eventCount}
        </Badge>
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
            item.expanded && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}

export function GroupedTimeline({
  scenario,
  eventsByTarget,
  mode,
  isExpanded,
  onOpenChange,
  onExpandAll,
  onCollapseAll,
  previewGraphTargetId,
  onSelectGraphTarget,
  validationIssues,
  highlightEventId,
  onUpdateEvent,
  onDeleteEvent,
}: {
  scenario: SimulationScenario;
  eventsByTarget: Map<string, SimulationEvent[]>;
  mode: "view" | "edit";
  isExpanded: (targetId: string) => boolean;
  onOpenChange: (targetId: string, open: boolean) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  previewGraphTargetId?: string | null;
  onSelectGraphTarget: (targetId: string) => void;
  validationIssues: ValidationIssue[];
  highlightEventId?: string | null;
  onUpdateEvent: (next: SimulationEvent) => void;
  onDeleteEvent: (eventId: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const eventGapPx = mode === "edit" ? EVENT_GAP_EDIT_PX : EVENT_GAP_VIEW_PX;

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];

    scenario.targets.forEach((target, targetIndex) => {
      const placementEvents = eventsByTarget.get(target.id) ?? [];
      const events = mode === "edit" ? placementEvents : sortEvents(placementEvents);
      const timedEvents = sortEvents(placementEvents);
      const expanded = isExpanded(target.id);
      const graphSelected = previewGraphTargetId === target.id;
      const isLastTarget = targetIndex === scenario.targets.length - 1;

      items.push({
        type: "header",
        key: `header-${target.id}`,
        target,
        eventCount: events.length,
        expanded,
        graphSelected,
      });

      if (expanded) {
        const firstAt = timedEvents[0]?.at;
        const lastAt = timedEvents.at(-1)?.at;
        const hasEvents = events.length > 0;

        items.push({
          type: "meta",
          key: `meta-${target.id}`,
          firstAt,
          lastAt,
          graphSelected,
          isGroupEnd: !hasEvents,
        });

        let previousPosition: PositionPayload | undefined;
        events.forEach((event, eventIndex) => {
          const summary = describeEvent(
            event,
            previousPosition,
            target.profile.vehicleCategory,
          );
          if (event.position) previousPosition = event.position;
          const isLastEvent = eventIndex === events.length - 1;

          items.push({
            type: "event",
            key: `event-${event.id}`,
            target,
            event,
            summary,
            issues: getIssuesForEvent(validationIssues, event.id, scenario),
            graphSelected,
            isGroupEnd: isLastEvent,
          });

          if (!isLastEvent) {
            items.push({
              type: "gap",
              key: `event-gap-${event.id}`,
              size: eventGapPx,
            });
          }
        });
      }

      if (!isLastTarget) {
        items.push({
          type: "gap",
          key: `group-gap-${target.id}`,
          size: GROUP_GAP_PX,
        });
      }
    });

    return items;
  }, [
    eventGapPx,
    eventsByTarget,
    isExpanded,
    mode,
    previewGraphTargetId,
    scenario,
    validationIssues,
  ]);

  const headerIndexes = useMemo(
    () =>
      flatItems.flatMap((item, index) => (item.type === "header" ? [index] : [])),
    [flatItems],
  );

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => flatItems[index]?.key ?? index,
    estimateSize: (index) => {
      const item = flatItems[index];
      if (!item) return VIEW_EVENT_ESTIMATE_PX;
      if (item.type === "gap") return item.size;
      if (item.type === "header") return HEADER_ESTIMATE_PX;
      if (item.type === "meta") return META_ESTIMATE_PX;
      return mode === "edit" ? EDIT_EVENT_ESTIMATE_PX : VIEW_EVENT_ESTIMATE_PX;
    },
    overscan: OVERSCAN,
    measureElement: (element) => {
      const sizeAttr = element.getAttribute("data-gap-size");
      if (sizeAttr != null) return Number(sizeAttr);
      return element.getBoundingClientRect().height;
    },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [flatItems, mode, virtualizer]);

  useEffect(() => {
    if (!highlightEventId) return;
    const index = flatItems.findIndex(
      (item) => item.type === "event" && item.event.id === highlightEventId,
    );
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [flatItems, highlightEventId, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom =
    virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0);
  const scrollOffset = virtualizer.scrollOffset ?? 0;

  const pinnedHeader = useMemo(() => {
    const totalSize = virtualizer.getTotalSize();
    let match: { index: number; item: HeaderItem } | null = null;

    for (let i = 0; i < headerIndexes.length; i++) {
      const index = headerIndexes[i]!;
      const item = flatItems[index];
      if (item?.type !== "header") continue;

      const start = virtualizer.measurementsCache[index]?.start;
      if (start == null || start > scrollOffset) break;

      const nextIndex = headerIndexes[i + 1];
      const end =
        nextIndex == null
          ? totalSize
          : (virtualizer.measurementsCache[nextIndex]?.start ?? totalSize);

      // Pin while scrolled through this expanded group's body.
      if (item.expanded && scrollOffset > start && scrollOffset < end) {
        match = { index, item };
      }
    }

    return match;
  }, [flatItems, headerIndexes, scrollOffset, virtualizer]);

  const pinnedHeaderItem = pinnedHeader?.item ?? null;
  const pinnedHeaderIndex = pinnedHeader?.index ?? null;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={onExpandAll}>
          <ChevronsUpDownIcon data-icon="inline-start" />
          Expand all
        </Button>
        <Button variant="outline" size="sm" onClick={onCollapseAll}>
          <ChevronsDownUpIcon data-icon="inline-start" />
          Collapse all
        </Button>
      </div>

      <div ref={parentRef} className={TIMELINE_VIEWPORT}>
        {pinnedHeaderItem ? (
          <div className="sticky top-0 z-30 h-0 overflow-visible">
            <TargetHeaderBar
              item={pinnedHeaderItem}
              onSelectGraphTarget={onSelectGraphTarget}
              onOpenChange={onOpenChange}
            />
          </div>
        ) : null}

        <div style={{ paddingTop, paddingBottom }}>
          {virtualItems.map((virtualRow) => {
            const item = flatItems[virtualRow.index];
            if (!item) return null;

            if (item.type === "gap") {
              return (
                <div
                  key={item.key}
                  data-index={virtualRow.index}
                  data-gap-size={item.size}
                  ref={virtualizer.measureElement}
                  aria-hidden="true"
                  style={{ height: item.size }}
                />
              );
            }

            const selectedBorder = item.graphSelected && "border-primary/50";
            const hideUnderPin =
              item.type === "header" && pinnedHeaderIndex === virtualRow.index;

            return (
              <div
                key={item.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={cn(hideUnderPin && "invisible")}
                aria-hidden={hideUnderPin || undefined}
              >
                {item.type === "header" ? (
                  <TargetHeaderBar
                    item={item}
                    onSelectGraphTarget={onSelectGraphTarget}
                    onOpenChange={onOpenChange}
                  />
                ) : null}

                {item.type === "meta" ? (
                  <div
                    className={cn(
                      "border-x bg-card px-2 py-1 text-[11px] text-muted-foreground",
                      selectedBorder,
                      item.isGroupEnd && "rounded-b-md border-b pb-1.5",
                    )}
                  >
                    {item.firstAt && item.lastAt
                      ? `${new Date(item.firstAt).toLocaleString()} – ${new Date(item.lastAt).toLocaleString()}`
                      : "No events scheduled"}
                  </div>
                ) : null}

                {item.type === "event" ? (
                  <div
                    className={cn(
                      "border-x bg-card px-1.5",
                      selectedBorder,
                      item.isGroupEnd && "rounded-b-md border-b pb-1.5",
                    )}
                  >
                    {mode === "edit" ? (
                      <EditTimelineEvent
                        event={item.event}
                        callsign={item.target.callsign}
                        priorityTerms={scenario.priorityTerms}
                        issues={item.issues}
                        highlighted={highlightEventId === item.event.id}
                        onChange={onUpdateEvent}
                        onDelete={() => onDeleteEvent(item.event.id)}
                      />
                    ) : (
                      <ViewTimelineEvent
                        event={item.event}
                        callsign={item.target.callsign}
                        summary={item.summary}
                        issues={item.issues}
                        highlighted={highlightEventId === item.event.id}
                        onDelete={() => onDeleteEvent(item.event.id)}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
