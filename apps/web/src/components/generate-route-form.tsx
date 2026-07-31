import { Button } from "@adversary/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@adversary/ui/components/field";
import { Input } from "@adversary/ui/components/input";
import { Switch } from "@adversary/ui/components/switch";
import { cn } from "@adversary/ui/lib/utils";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/date-time-picker";
import { deriveEndAtFromDistance, MAX_GENERATED_EVENTS } from "@/lib/event-generator";
import { resolveGenerationCruiseKnots } from "@/lib/geo/vehicle-profiles";
import { useRouteTargetMutation } from "@/hooks/use-scenarios";
import { haversineDistanceNm } from "@/lib/position-telemetry";
import type { PositionPayload, SimulationEvent, TargetDefinition } from "@/types/target";

const MapLocationPicker = lazy(() =>
  import("@/components/map-location-picker").then((module) => ({
    default: module.MapLocationPicker,
  })),
);

export interface GenerateRouteFormProps {
  scenarioId: string;
  target: TargetDefinition;
  onGenerate: (events: SimulationEvent[], summary: string) => void;
  disabled?: boolean;
}

interface FieldErrors {
  count?: string;
  startAt?: string;
  endAt?: string;
  startPoint?: string;
  endPoint?: string;
}

function defaultEndPoint(start: PositionPayload): PositionPayload {
  return {
    latitude: start.latitude + 0.4,
    longitude: start.longitude + 0.4,
    altitude: start.altitude ?? 8_000,
  };
}

function isValidCoordinate(point: PositionPayload) {
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function validateRouteForm(options: {
  count: string;
  startAt: string;
  endAt: string;
  startPoint: PositionPayload;
  endPoint: PositionPayload | null;
  allowOptionalEndAt: boolean;
}): FieldErrors {
  const errors: FieldErrors = {};
  const parsedCount = Number(options.count);
  if (!Number.isFinite(parsedCount) || parsedCount < 1) {
    errors.count = "Enter a valid event count of at least 1.";
  } else if (parsedCount > MAX_GENERATED_EVENTS) {
    errors.count = `Event count is capped at ${MAX_GENERATED_EVENTS}.`;
  }

  const startMs = Date.parse(options.startAt);
  if (!Number.isFinite(startMs)) errors.startAt = "Enter a valid start time.";

  const endAtTrimmed = options.endAt.trim();
  if (!endAtTrimmed) {
    if (!options.allowOptionalEndAt) {
      errors.endAt = "Enter a valid end time.";
    }
  } else {
    const endMs = Date.parse(endAtTrimmed);
    if (!Number.isFinite(endMs)) errors.endAt = "Enter a valid end time.";
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      errors.endAt = "End time must be after start time.";
    }
  }

  if (!isValidCoordinate(options.startPoint)) {
    errors.startPoint = "Enter a valid latitude and longitude.";
  }

  if (options.endPoint) {
    if (!isValidCoordinate(options.endPoint)) {
      errors.endPoint = "Enter a valid end latitude and longitude.";
    } else if (haversineDistanceNm(options.startPoint, options.endPoint) < 0.001) {
      errors.endPoint = "End point must be distinct from the start point.";
    }
  }

  return errors;
}

function MapPickerFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid h-44 place-items-center rounded-lg border bg-muted text-sm text-muted-foreground sm:h-52",
        className,
      )}
    >
      Loading map picker…
    </div>
  );
}

/**
 * Automatic route generation form (stacked A/B for Compose).
 * Aircraft can enable an end location; other categories use random wander.
 */
export function GenerateRouteForm({
  scenarioId,
  target,
  onGenerate,
  disabled = false,
}: GenerateRouteFormProps) {
  const now = Date.now();
  const isAircraft = target.profile.vehicleCategory === "aircraft";
  const [count, setCount] = useState("60");
  const [startAt, setStartAt] = useState(new Date(now).toISOString());
  const [endAt, setEndAt] = useState(new Date(now + 60 * 60_000).toISOString());
  const [startPoint, setStartPoint] = useState<PositionPayload>({
    latitude: 51.5074,
    longitude: -0.1278,
    altitude: isAircraft ? 8_000 : 0,
  });
  const [endPoint, setEndPoint] = useState<PositionPayload>(() =>
    defaultEndPoint({
      latitude: 51.5074,
      longitude: -0.1278,
      altitude: isAircraft ? 8_000 : 0,
    }),
  );
  const [endPointEnabled, setEndPointEnabled] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const routeTarget = useRouteTargetMutation();

  const allowOptionalEndAt = isAircraft && endPointEnabled;
  const activeEndPoint = allowOptionalEndAt ? endPoint : null;
  const generationCruise = resolveGenerationCruiseKnots({
    vehicleCategory: target.profile.vehicleCategory,
    vehicleSubtype: target.profile.vehicleSubtype,
    maxCruiseKnots: target.maxCruiseKnots,
  });

  const computedEndPreview = useMemo(() => {
    if (!allowOptionalEndAt || endAt.trim()) return null;
    try {
      const derived = deriveEndAtFromDistance({
        startAt,
        startPoint,
        endPoint,
        vehicleCategory: target.profile.vehicleCategory,
        cruiseKnots: generationCruise,
      });
      const distanceNm = haversineDistanceNm(startPoint, endPoint);
      return { derived, distanceNm, cruise: generationCruise };
    } catch {
      return null;
    }
  }, [
    allowOptionalEndAt,
    endAt,
    endPoint,
    generationCruise,
    startAt,
    startPoint,
    target.profile.vehicleCategory,
  ]);

  useEffect(() => {
    if (!attempted) return;
    setErrors(
      validateRouteForm({
        count,
        startAt,
        endAt,
        startPoint,
        endPoint: activeEndPoint,
        allowOptionalEndAt,
      }),
    );
  }, [attempted, count, startAt, endAt, startPoint, activeEndPoint, allowOptionalEndAt]);

  function setEndLocationEnabled(checked: boolean) {
    setEndPointEnabled(checked);
    if (checked) {
      setEndAt("");
      return;
    }
    if (!endAt.trim()) {
      const startMs = Date.parse(startAt);
      setEndAt(
        new Date((Number.isFinite(startMs) ? startMs : Date.now()) + 60 * 60_000).toISOString(),
      );
    }
  }

  function handleGeneratePreview() {
    setAttempted(true);
    const nextErrors = validateRouteForm({
      count,
      startAt,
      endAt,
      startPoint,
      endPoint: activeEndPoint,
      allowOptionalEndAt,
    });
    setErrors(nextErrors);
    const firstError = Object.values(nextErrors).find(Boolean);
    if (firstError) {
      toast.error(firstError);
      return;
    }

    routeTarget.mutate(
      {
        scenarioId,
        targetId: target.id,
        input: {
          startAt,
          endAt: endAt.trim() || undefined,
          eventCount: Number(count),
        },
      },
      {
        onSuccess: (result) => {
          const summary = `Generated ${result.events.length} position events for ${target.callsign}${
            result.degraded ? " with synthetic fallback." : "."
          }`;
          onGenerate(result.events, summary);
          setAttempted(false);
          setErrors({});
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : "Unable to generate route.";
          toast.error(message);
          setErrors((current) => ({ ...current, endAt: message }));
        },
      },
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", disabled && "pointer-events-none opacity-50")}>
      <FieldGroup>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.count) || undefined}>
            <FieldLabel htmlFor="route-count">Event count</FieldLabel>
            <Input
              id="route-count"
              type="number"
              min={1}
              max={MAX_GENERATED_EVENTS}
              value={count}
              disabled={disabled}
              aria-invalid={Boolean(errors.count) || undefined}
              onChange={(event) => setCount(event.target.value)}
            />
            <FieldDescription>Maximum {MAX_GENERATED_EVENTS}.</FieldDescription>
            <FieldError>{errors.count}</FieldError>
          </Field>
          <Field data-disabled>
            <FieldLabel htmlFor="route-category">Vehicle category</FieldLabel>
            <Input id="route-category" value={target.profile.vehicleCategory} disabled />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.startAt) || undefined}>
            <FieldLabel htmlFor="route-start-at">Start time</FieldLabel>
            <DateTimePicker
              id="route-start-at"
              value={startAt}
              onChange={setStartAt}
              aria-invalid={Boolean(errors.startAt) || undefined}
            />
            <FieldError>{errors.startAt}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.endAt) || undefined}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel htmlFor="route-end-at">
                End time{allowOptionalEndAt ? " (optional)" : ""}
              </FieldLabel>
              {allowOptionalEndAt && endAt.trim() ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => setEndAt("")}
                >
                  Use computed
                </Button>
              ) : null}
            </div>
            <DateTimePicker
              id="route-end-at"
              value={endAt}
              onChange={setEndAt}
              aria-invalid={Boolean(errors.endAt) || undefined}
            />
            <FieldDescription>
              {allowOptionalEndAt
                ? "Leave empty to derive from distance at cruise midpoint."
                : "Required without an end location."}
            </FieldDescription>
            <FieldError>{errors.endAt}</FieldError>
          </Field>
        </div>

        {computedEndPreview ? (
          <p
            className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            role="status"
          >
            Computed end {new Date(computedEndPreview.derived).toLocaleString()} ·{" "}
            {computedEndPreview.distanceNm.toFixed(1)} nm @ {computedEndPreview.cruise.toFixed(0)}{" "}
            kt cruise
          </p>
        ) : null}

        {isAircraft ? (
          <Field orientation="horizontal">
            <Switch
              id="route-end-location"
              checked={endPointEnabled}
              disabled={disabled}
              onCheckedChange={setEndLocationEnabled}
            />
            <FieldContent>
              <FieldLabel htmlFor="route-end-location">End location</FieldLabel>
              <FieldDescription>
                Enable the end point so the route finishes at a chosen location.
              </FieldDescription>
            </FieldContent>
          </Field>
        ) : null}

        <Field data-invalid={Boolean(errors.startPoint) || undefined}>
          <FieldLabel>Start (A)</FieldLabel>
          <Suspense fallback={<MapPickerFallback />}>
            <MapLocationPicker
              idPrefix={`route-start-${target.id}`}
              value={startPoint}
              onChange={setStartPoint}
              showSpeedField={false}
              mapClassName="h-44 sm:h-52"
              disabled={disabled}
              mapAriaLabel="Start point map. Click or tap to place the route start."
              companionPoint={
                endPointEnabled
                  ? {
                      latitude: endPoint.latitude,
                      longitude: endPoint.longitude,
                      label: "End",
                    }
                  : null
              }
            />
          </Suspense>
          <FieldError>{errors.startPoint}</FieldError>
        </Field>

        {isAircraft ? (
          <Field
            data-invalid={Boolean(errors.endPoint) || undefined}
            data-disabled={!endPointEnabled || undefined}
            className={cn(!endPointEnabled && "opacity-55")}
          >
            <FieldLabel>End (B)</FieldLabel>
            <Suspense fallback={<MapPickerFallback />}>
              <MapLocationPicker
                idPrefix={`route-end-${target.id}`}
                value={endPoint}
                onChange={setEndPoint}
                showSpeedField={false}
                mapClassName="h-44 sm:h-52"
                disabled={disabled || !endPointEnabled}
                mapAriaLabel="End point map. Click or tap to place the route end."
                companionPoint={
                  endPointEnabled
                    ? {
                        latitude: startPoint.latitude,
                        longitude: startPoint.longitude,
                        label: "Start",
                      }
                    : null
                }
              />
            </Suspense>
            {!endPointEnabled ? (
              <FieldDescription>Turn on End location to edit this point.</FieldDescription>
            ) : null}
            <FieldError>{errors.endPoint}</FieldError>
          </Field>
        ) : null}

        {routeTarget.isPending ? (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">
            Planning route…
          </p>
        ) : null}
      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          className="w-full sm:w-auto"
          disabled={disabled || routeTarget.isPending}
          onClick={handleGeneratePreview}
        >
          {routeTarget.isPending ? "Generating…" : "Generate route"}
        </Button>
      </div>
    </div>
  );
}
