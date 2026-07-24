import { Button } from "@adversary/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@adversary/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@adversary/ui/components/field";
import { Input } from "@adversary/ui/components/input";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/date-time-picker";
import {
  generateRouteEvents,
  MAX_GENERATED_EVENTS,
  mergeGeneratedEvents,
} from "@/lib/event-generator";
import { isWithinBounds } from "@/lib/offline-regions/manifest";
import { useMapData } from "@/components/map-data-provider";
import type { PositionPayload, SimulationEvent, TargetDefinition } from "@/types/target";

const MapLocationPicker = lazy(() =>
  import("@/components/map-location-picker").then((module) => ({
    default: module.MapLocationPicker,
  })),
);

interface GenerateRouteDialogProps {
  target: TargetDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (events: SimulationEvent[], summary: string) => void;
}

interface FieldErrors {
  count?: string;
  startAt?: string;
  endAt?: string;
  startPoint?: string;
}

function validateRouteForm(options: {
  count: string;
  startAt: string;
  endAt: string;
  startPoint: PositionPayload;
  regionBounds?: [number, number, number, number];
}): FieldErrors {
  const errors: FieldErrors = {};
  const parsedCount = Number(options.count);
  if (!Number.isFinite(parsedCount) || parsedCount < 1) {
    errors.count = "Enter a valid event count of at least 1.";
  } else if (parsedCount > MAX_GENERATED_EVENTS) {
    errors.count = `Event count is capped at ${MAX_GENERATED_EVENTS}.`;
  }

  const startMs = Date.parse(options.startAt);
  const endMs = Date.parse(options.endAt);
  if (!Number.isFinite(startMs)) errors.startAt = "Enter a valid start time.";
  if (!Number.isFinite(endMs)) errors.endAt = "Enter a valid end time.";
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
    errors.endAt = "End time must be after start time.";
  }

  const { latitude, longitude } = options.startPoint;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    errors.startPoint = "Enter a valid latitude and longitude.";
  } else if (
    options.regionBounds &&
    !isWithinBounds(latitude, longitude, options.regionBounds)
  ) {
    errors.startPoint = "Start point is outside the active offline region bounds.";
  }

  return errors;
}

export function GenerateRouteDialog({
  target,
  open,
  onOpenChange,
  onGenerate,
}: GenerateRouteDialogProps) {
  const { activeRegion } = useMapData();
  const now = Date.now();
  const [count, setCount] = useState("60");
  const [startAt, setStartAt] = useState(new Date(now).toISOString());
  const [endAt, setEndAt] = useState(new Date(now + 60 * 60_000).toISOString());
  const [startPoint, setStartPoint] = useState<PositionPayload>({
    latitude: 51.5074,
    longitude: -0.1278,
    altitude: target.profile.vehicleCategory === "aircraft" ? 8_000 : 0,
  });
  const [pendingSummary, setPendingSummary] = useState<string | null>(null);
  const [pendingEvents, setPendingEvents] = useState<SimulationEvent[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  function clearPending() {
    setPendingSummary(null);
    setPendingEvents([]);
  }

  useEffect(() => {
    clearPending();
  }, [count, startAt, endAt, startPoint.latitude, startPoint.longitude, startPoint.altitude]);

  useEffect(() => {
    if (!attempted) return;
    setErrors(
      validateRouteForm({
        count,
        startAt,
        endAt,
        startPoint,
        regionBounds: activeRegion?.bounds,
      }),
    );
  }, [attempted, count, startAt, endAt, startPoint, activeRegion?.bounds]);

  function handleGeneratePreview() {
    setAttempted(true);
    const nextErrors = validateRouteForm({
      count,
      startAt,
      endAt,
      startPoint,
      regionBounds: activeRegion?.bounds,
    });
    setErrors(nextErrors);
    const firstError = Object.values(nextErrors).find(Boolean);
    if (firstError) {
      toast.error(firstError);
      return;
    }

    try {
      const generated = generateRouteEvents({
        targetId: target.id,
        count: Number(count),
        startAt,
        endAt,
        startPoint,
        vehicleCategory: target.profile.vehicleCategory,
      });

      const summary = `Generate ${generated.length} position events for ${target.callsign} between ${new Date(startAt).toLocaleString()} and ${new Date(endAt).toLocaleString()}?`;
      setPendingSummary(summary);
      setPendingEvents(generated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate route.";
      toast.error(message);
      if (/end/i.test(message) && /start/i.test(message)) {
        setErrors((current) => ({ ...current, endAt: message }));
      }
    }
  }

  function confirmInsert() {
    if (pendingEvents.length === 0) return;
    onGenerate(pendingEvents, pendingSummary ?? "");
    clearPending();
    setAttempted(false);
    setErrors({});
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,52rem)] max-w-2xl flex-col gap-4 overflow-hidden p-0">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 scrollbar-thin scroll-fade-b overscroll-contain scrollbar-gutter-stable">
          <DialogHeader>
            <DialogTitle>Generate route for {target.callsign}</DialogTitle>
            <DialogDescription>
              Create category-plausible movement using geodesic distance and bounded heading drift.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field data-invalid={Boolean(errors.count) || undefined}>
              <FieldLabel htmlFor="route-count">Event count</FieldLabel>
              <Input
                id="route-count"
                type="number"
                min={1}
                max={MAX_GENERATED_EVENTS}
                value={count}
                aria-invalid={Boolean(errors.count) || undefined}
                onChange={(event) => setCount(event.target.value)}
              />
              <FieldDescription>
                Events are evenly spaced for smoother travel updates. Maximum {MAX_GENERATED_EVENTS}.
              </FieldDescription>
              <FieldError>{errors.count}</FieldError>
            </Field>
            <Field data-disabled>
              <FieldLabel>Vehicle category</FieldLabel>
              <Input value={target.profile.vehicleCategory} disabled />
            </Field>
            <Field className="md:col-span-2" data-invalid={Boolean(errors.startAt) || undefined}>
              <FieldLabel htmlFor="route-start-at">Start time</FieldLabel>
              <DateTimePicker
                id="route-start-at"
                value={startAt}
                onChange={setStartAt}
                aria-invalid={Boolean(errors.startAt) || undefined}
              />
              <FieldError>{errors.startAt}</FieldError>
            </Field>
            <Field className="md:col-span-2" data-invalid={Boolean(errors.endAt) || undefined}>
              <FieldLabel htmlFor="route-end-at">End time</FieldLabel>
              <DateTimePicker
                id="route-end-at"
                value={endAt}
                onChange={setEndAt}
                aria-invalid={Boolean(errors.endAt) || undefined}
              />
              <FieldError>{errors.endAt}</FieldError>
            </Field>
          </FieldGroup>

          <Field data-invalid={Boolean(errors.startPoint) || undefined}>
            <FieldLabel>Start point</FieldLabel>
            <Suspense
              fallback={
                <div className="grid h-56 place-items-center rounded-lg border bg-muted text-sm text-muted-foreground">
                  Loading map picker…
                </div>
              }
            >
              <MapLocationPicker
                idPrefix={`route-${target.id}`}
                value={startPoint}
                onChange={setStartPoint}
              />
            </Suspense>
            <FieldError>{errors.startPoint}</FieldError>
          </Field>

          {pendingSummary ? (
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm" role="status">
              {pendingSummary}
            </p>
          ) : null}
        </div>
        <DialogFooter className="border-t bg-background p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {pendingEvents.length > 0 ? (
            <Button onClick={confirmInsert}>Insert {pendingEvents.length} events</Button>
          ) : (
            <Button onClick={handleGeneratePreview}>Preview generation</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { mergeGeneratedEvents };
