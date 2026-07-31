import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
import { Checkbox } from "@adversary/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@adversary/ui/components/field";
import { Input } from "@adversary/ui/components/input";
import { Textarea } from "@adversary/ui/components/textarea";
import { cn } from "@adversary/ui/lib/utils";
import { MapPinIcon, MessageSquareIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { DateTimePicker } from "@/components/date-time-picker";
import { matchPriorityTerms } from "@/lib/priority-terms";
import type { ValidationIssue } from "@/lib/scenario-validation-ui";
import type { PositionPayload, SimulationEvent } from "@/types/target";

const DEFAULT_POSITION: PositionPayload = {
  latitude: 51.5074,
  longitude: -0.1278,
  altitude: 0,
};

function issuesForField(issues: ValidationIssue[], field: string) {
  return issues.filter(
    (issue) => issue.field === field || issue.field?.startsWith(`${field}.`),
  );
}

interface TimelineEventShellProps {
  eventId: string;
  highlighted: boolean;
  hasIssues: boolean;
  compact?: boolean;
  children: ReactNode;
  actions: ReactNode;
}

function TimelineEventShell({
  eventId,
  highlighted,
  hasIssues,
  compact = false,
  children,
  actions,
}: TimelineEventShellProps) {
  return (
    <div
      id={`event-row-${eventId}`}
      className={cn(
        "flex items-start justify-between gap-2 rounded-md hover:bg-muted/40",
        compact ? "px-1.5 py-1.5" : "px-2 py-2",
        highlighted && "ring-2 ring-destructive",
        hasIssues && "border border-destructive/40",
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 gap-1">{actions}</div>
    </div>
  );
}

function DeleteEventButton({
  event,
  callsign,
  onDelete,
}: {
  event: SimulationEvent;
  callsign: string;
  onDelete: () => void;
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={`Remove event at ${new Date(event.at).toLocaleString()} for ${callsign}`}
      onClick={onDelete}
    >
      <Trash2Icon />
    </Button>
  );
}

interface ViewTimelineEventProps {
  event: SimulationEvent;
  callsign: string;
  summary: string;
  issues: ValidationIssue[];
  highlighted: boolean;
  onDelete: () => void;
}

export function ViewTimelineEvent({
  event,
  callsign,
  summary,
  issues,
  highlighted,
  onDelete,
}: ViewTimelineEventProps) {
  return (
    <TimelineEventShell
      eventId={event.id}
      highlighted={highlighted}
      hasIssues={issues.length > 0}
      actions={<DeleteEventButton event={event} callsign={callsign} onDelete={onDelete} />}
    >
      <div className="font-mono text-xs text-muted-foreground">
        {new Date(event.at).toLocaleString()}
      </div>
      {event.firesAt ? (
        <div className="font-mono text-xs text-muted-foreground">
          Fires at {new Date(event.firesAt).toLocaleString()}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
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
      <p className="mt-1 truncate text-sm text-muted-foreground">{summary}</p>
      {issues.map((issue) => (
        <FieldError key={issue.message}>{issue.message}</FieldError>
      ))}
    </TimelineEventShell>
  );
}

interface EditTimelineEventProps {
  event: SimulationEvent;
  callsign: string;
  priorityTerms: string[];
  issues: ValidationIssue[];
  highlighted: boolean;
  onChange: (next: SimulationEvent) => void;
  onDelete: () => void;
}

export function EditTimelineEvent({
  event,
  callsign,
  priorityTerms,
  issues,
  highlighted,
  onChange,
  onDelete,
}: EditTimelineEventProps) {
  const includePosition = Boolean(event.position);
  const includeMessage = event.message !== undefined;
  const atIssues = issuesForField(issues, "at");
  const messageIssues = issuesForField(issues, "message");
  const latitudeIssues = issuesForField(issues, "position.latitude");
  const longitudeIssues = issuesForField(issues, "position.longitude");
  const altitudeIssues = issuesForField(issues, "position.altitude");
  const speedIssues = issuesForField(issues, "position.speed");
  const payloadIssues = messageIssues.filter(
    (issue) => issue.message === "Add a position, a message, or both to this event.",
  );
  const messageTextIssues = messageIssues.filter(
    (issue) => issue.message !== "Add a position, a message, or both to this event.",
  );
  const priorityMatches =
    includeMessage && event.message ? matchPriorityTerms(event.message, priorityTerms) : [];

  function updatePosition(field: keyof PositionPayload, raw: string) {
    if (!event.position) return;
    if (raw.trim() === "") {
      if (field === "altitude" || field === "speed") {
        const next = { ...event.position };
        delete next[field];
        onChange({ ...event, position: next });
      }
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange({
      ...event,
      position: { ...event.position, [field]: parsed },
    });
  }

  return (
    <TimelineEventShell
      eventId={event.id}
      highlighted={highlighted}
      hasIssues={issues.length > 0}
      compact
      actions={<DeleteEventButton event={event} callsign={callsign} onDelete={onDelete} />}
    >
      <FieldGroup className="flex flex-col gap-2">
        <Field data-invalid={atIssues.length > 0 || undefined}>
          <FieldLabel htmlFor={`edit-${event.id}-at`}>Event date and time</FieldLabel>
          <DateTimePicker
            id={`edit-${event.id}-at`}
            value={event.at}
            aria-invalid={atIssues.length > 0}
            onChange={(at) => onChange({ ...event, at })}
          />
          {atIssues.map((issue) => (
            <FieldError key={issue.message}>{issue.message}</FieldError>
          ))}
          {event.firesAt ? (
            <FieldDescription>
              Fires at {new Date(event.firesAt).toLocaleString()}
            </FieldDescription>
          ) : null}
        </Field>

        <div className="flex flex-col gap-2 rounded-md border px-2 py-1.5">
          <Field orientation="horizontal">
            <Checkbox
              id={`edit-${event.id}-include-position`}
              checked={includePosition}
              onCheckedChange={(checked) => {
                if (checked === true) {
                  onChange({ ...event, position: { ...DEFAULT_POSITION } });
                  return;
                }
                const { position: _removed, ...rest } = event;
                onChange(rest);
              }}
            />
            <FieldLabel htmlFor={`edit-${event.id}-include-position`}>Position</FieldLabel>
          </Field>
          {event.position ? (
            <FieldGroup className="grid grid-cols-2 gap-x-2 gap-y-1.5 lg:grid-cols-4">
              <Field data-invalid={latitudeIssues.length > 0 || undefined}>
                <FieldLabel htmlFor={`edit-${event.id}-latitude`}>Latitude</FieldLabel>
                <Input
                  id={`edit-${event.id}-latitude`}
                  type="number"
                  step="0.000001"
                  value={event.position.latitude}
                  aria-invalid={latitudeIssues.length > 0}
                  onChange={(changeEvent) =>
                    updatePosition("latitude", changeEvent.target.value)
                  }
                />
                {latitudeIssues.map((issue) => (
                  <FieldError key={issue.message}>{issue.message}</FieldError>
                ))}
              </Field>
              <Field data-invalid={longitudeIssues.length > 0 || undefined}>
                <FieldLabel htmlFor={`edit-${event.id}-longitude`}>Longitude</FieldLabel>
                <Input
                  id={`edit-${event.id}-longitude`}
                  type="number"
                  step="0.000001"
                  value={event.position.longitude}
                  aria-invalid={longitudeIssues.length > 0}
                  onChange={(changeEvent) =>
                    updatePosition("longitude", changeEvent.target.value)
                  }
                />
                {longitudeIssues.map((issue) => (
                  <FieldError key={issue.message}>{issue.message}</FieldError>
                ))}
              </Field>
              <Field data-invalid={altitudeIssues.length > 0 || undefined}>
                <FieldLabel htmlFor={`edit-${event.id}-altitude`}>Altitude (ft)</FieldLabel>
                <Input
                  id={`edit-${event.id}-altitude`}
                  type="number"
                  step="100"
                  value={event.position.altitude ?? ""}
                  aria-invalid={altitudeIssues.length > 0}
                  onChange={(changeEvent) =>
                    updatePosition("altitude", changeEvent.target.value)
                  }
                />
                {altitudeIssues.map((issue) => (
                  <FieldError key={issue.message}>{issue.message}</FieldError>
                ))}
              </Field>
              <Field data-invalid={speedIssues.length > 0 || undefined}>
                <FieldLabel htmlFor={`edit-${event.id}-speed`}>Speed (kt)</FieldLabel>
                <Input
                  id={`edit-${event.id}-speed`}
                  type="number"
                  step="1"
                  min={0}
                  value={event.position.speed ?? ""}
                  aria-invalid={speedIssues.length > 0}
                  onChange={(changeEvent) => updatePosition("speed", changeEvent.target.value)}
                />
                {speedIssues.map((issue) => (
                  <FieldError key={issue.message}>{issue.message}</FieldError>
                ))}
              </Field>
            </FieldGroup>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 rounded-md border px-2 py-1.5">
          <Field orientation="horizontal">
            <Checkbox
              id={`edit-${event.id}-include-message`}
              checked={includeMessage}
              onCheckedChange={(checked) => {
                if (checked === true) {
                  onChange({ ...event, message: "" });
                  return;
                }
                const { message: _removed, ...rest } = event;
                onChange(rest);
              }}
            />
            <FieldLabel htmlFor={`edit-${event.id}-include-message`}>Message</FieldLabel>
          </Field>
          {includeMessage ? (
            <Field data-invalid={messageTextIssues.length > 0 || undefined}>
              <FieldLabel htmlFor={`edit-${event.id}-message`} className="sr-only">
                Message text
              </FieldLabel>
              <Textarea
                id={`edit-${event.id}-message`}
                value={event.message ?? ""}
                rows={2}
                className="min-h-16"
                aria-invalid={messageTextIssues.length > 0}
                onChange={(changeEvent) =>
                  onChange({ ...event, message: changeEvent.target.value })
                }
                placeholder="Operator note or intelligence message"
              />
              {messageTextIssues.map((issue) => (
                <FieldError key={issue.message}>{issue.message}</FieldError>
              ))}
              {priorityMatches.length > 0 ? (
                <p className="text-sm text-destructive" role="status">
                  Priority match: {priorityMatches.join(", ")}
                </p>
              ) : null}
            </Field>
          ) : null}
        </div>

        {payloadIssues.map((issue) => (
          <FieldError key={issue.message}>{issue.message}</FieldError>
        ))}
        {issues
          .filter(
            (issue) =>
              issue.field &&
              issue.field !== "at" &&
              issue.field !== "message" &&
              !issue.field.startsWith("position."),
          )
          .map((issue) => (
            <FieldError key={issue.message}>{issue.message}</FieldError>
          ))}
      </FieldGroup>
    </TimelineEventShell>
  );
}
