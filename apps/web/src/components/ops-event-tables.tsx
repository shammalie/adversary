import { Badge } from "@adversary/ui/components/badge";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@adversary/ui/components/table";
import { cn } from "@adversary/ui/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MapPinIcon, MessageSquareIcon } from "lucide-react";
import { useMemo, useRef, type ReactNode } from "react";

import { isPriorityMessage, matchPriorityTerms } from "@/lib/priority-terms";
import { effectiveEventAtMs } from "@/lib/simulation-engine";
import type { RuntimeTargetState, SimulationEvent } from "@/types/target";

const TABLE_MAX_HEIGHT = "max-h-[24rem]";
const ROW_ESTIMATE_PX = 41;
const ROW_OVERSCAN = 12;

function eventSummary(event: SimulationEvent) {
  const parts: string[] = [];
  if (event.position) {
    parts.push(
      `Position ${event.position.latitude.toFixed(4)}, ${event.position.longitude.toFixed(4)}`,
    );
  }
  if (event.message) parts.push(event.message);
  return parts.join(" · ");
}

function eventPayloadBadges(event: SimulationEvent) {
  return (
    <div className="flex flex-wrap gap-1">
      {event.position ? (
        <Badge variant="outline">
          <MapPinIcon data-icon="inline-start" />
          Position
        </Badge>
      ) : null}
      {event.message ? (
        <Badge variant="outline">
          <MessageSquareIcon data-icon="inline-start" />
          Message
        </Badge>
      ) : null}
    </div>
  );
}

function VirtualizedTableShell({
  columnCount,
  empty,
  header,
  rowCount,
  renderRow,
}: {
  columnCount: number;
  empty: ReactNode;
  header: ReactNode;
  rowCount: number;
  renderRow: (index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: ROW_OVERSCAN,
  });

  if (rowCount === 0) {
    return (
      <div className={cn(TABLE_MAX_HEIGHT, "overflow-auto px-0 scrollbar-thin")}>
        <table className="w-full caption-bottom text-sm">
          {header}
          <TableBody>{empty}</TableBody>
        </table>
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  return (
    <div ref={parentRef} className={cn(TABLE_MAX_HEIGHT, "overflow-auto px-0 scrollbar-thin")}>
      <table className="w-full caption-bottom text-sm">
        {header}
        <TableBody>
          {paddingTop > 0 ? (
            <tr aria-hidden="true">
              <td
                colSpan={columnCount}
                style={{ height: paddingTop, padding: 0, border: 0 }}
              />
            </tr>
          ) : null}
          {items.map((item) => renderRow(item.index))}
          {paddingBottom > 0 ? (
            <tr aria-hidden="true">
              <td
                colSpan={columnCount}
                style={{ height: paddingBottom, padding: 0, border: 0 }}
              />
            </tr>
          ) : null}
        </TableBody>
      </table>
    </div>
  );
}

export function EventIngestTable({
  events,
  priorityTerms,
  targetStates,
  delaySeconds = 0,
}: {
  events: SimulationEvent[];
  priorityTerms: string[];
  targetStates: Record<string, RuntimeTargetState>;
  delaySeconds?: number;
}) {
  const rows = useMemo(() => events.toReversed(), [events]);

  return (
    <VirtualizedTableShell
      columnCount={4}
      rowCount={rows.length}
      header={
        <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b">
          <TableRow>
            <TableHead>Ingest time</TableHead>
            <TableHead>Callsign</TableHead>
            <TableHead>Payload</TableHead>
            <TableHead>Summary</TableHead>
          </TableRow>
        </TableHeader>
      }
      empty={
        <TableRow>
          <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
            Listening for scheduled events…
          </TableCell>
        </TableRow>
      }
      renderRow={(index) => {
        const event = rows[index]!;
        const target = targetStates[event.targetId];
        const critical = Boolean(
          event.message && isPriorityMessage(event.message, priorityTerms),
        );
        return (
          <TableRow key={event.id} className={cn(critical && "bg-destructive/10")}>
            <TableCell className="whitespace-nowrap font-mono text-xs">
              {new Date(effectiveEventAtMs(event.at, delaySeconds)).toLocaleTimeString()}
            </TableCell>
            <TableCell className="font-medium">{target?.callsign}</TableCell>
            <TableCell>{eventPayloadBadges(event)}</TableCell>
            <TableCell className="max-w-md truncate text-muted-foreground">
              {eventSummary(event)}
            </TableCell>
          </TableRow>
        );
      }}
    />
  );
}

export function IntelligenceMessagesTable({
  events,
  priorityTerms,
  targetStates,
  delaySeconds = 0,
}: {
  events: SimulationEvent[];
  priorityTerms: string[];
  targetStates: Record<string, RuntimeTargetState>;
  delaySeconds?: number;
}) {
  const rows = useMemo(() => events.toReversed(), [events]);

  return (
    <VirtualizedTableShell
      columnCount={4}
      rowCount={rows.length}
      header={
        <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b">
          <TableRow>
            <TableHead>Event time</TableHead>
            <TableHead>Callsign</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
      }
      empty={
        <TableRow>
          <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
            No intelligence messages ingested.
          </TableCell>
        </TableRow>
      }
      renderRow={(index) => {
        const event = rows[index]!;
        const matches = event.message ? matchPriorityTerms(event.message, priorityTerms) : [];
        return (
          <TableRow
            key={event.id}
            className={cn(matches.length > 0 && "bg-destructive/10 font-medium")}
          >
            <TableCell className="whitespace-nowrap font-mono text-xs">
              {new Date(effectiveEventAtMs(event.at, delaySeconds)).toLocaleTimeString()}
            </TableCell>
            <TableCell>{targetStates[event.targetId]?.callsign}</TableCell>
            <TableCell>
              {matches.length > 0 ? (
                <Badge variant="destructive">Priority</Badge>
              ) : (
                <Badge variant="outline">Routine</Badge>
              )}
            </TableCell>
            <TableCell>{event.message}</TableCell>
          </TableRow>
        );
      }}
    />
  );
}
