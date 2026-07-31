import { Button } from "@adversary/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@adversary/ui/components/field";
import { Input } from "@adversary/ui/components/input";
import { cn } from "@adversary/ui/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/date-time-picker";
import { DemoRegionSelect } from "@/components/demo-region-select";
import { useGenerateJobQuery, useGenerateScenarioMutation } from "@/hooks/use-scenarios";
import { MAX_GENERATED_EVENTS } from "@/lib/event-generator";
import type { TargetDefinition } from "@/types/target";

export interface GenerateRandomRouteFormProps {
  target: TargetDefinition;
  onGeneratedScenario: (scenarioId: string, summary: string) => void;
  disabled?: boolean;
}

interface FieldErrors {
  count?: string;
  startAt?: string;
  endAt?: string;
}

function validateRandomForm(options: {
  count: string;
  startAt: string;
  endAt: string;
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
  if (endAtTrimmed) {
    const endMs = Date.parse(endAtTrimmed);
    if (!Number.isFinite(endMs)) errors.endAt = "Enter a valid end time.";
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      errors.endAt = "End time must be after start time.";
    }
  }

  return errors;
}

/**
 * Compose Random tab: region-based authentic geo route for one target,
 * with demo-style start / optional end and an event-count field.
 */
export function GenerateRandomRouteForm({
  target,
  onGeneratedScenario,
  disabled = false,
}: GenerateRandomRouteFormProps) {
  const now = Date.now();
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [count, setCount] = useState("60");
  const [startAt, setStartAt] = useState(new Date(now).toISOString());
  const [endAt, setEndAt] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const generate = useGenerateScenarioMutation();
  const jobQuery = useGenerateJobQuery(jobId);

  useEffect(() => {
  }, [count, startAt, endAt, regionIds, target.id]);

  useEffect(() => {
    if (!attempted) return;
    setErrors(validateRandomForm({ count, startAt, endAt }));
  }, [attempted, count, startAt, endAt]);

  useEffect(() => {
    const job = jobQuery.data;
    if (job?.status !== "succeeded" || !job.scenarioId) return;
    const summary = `Generated scenario with ${job.degradedTrackCount ?? 0} synthetic fallback track${
      job.degradedTrackCount === 1 ? "" : "s"
    }.`;
    onGeneratedScenario(job.scenarioId, summary);
    setJobId(null);
  }, [jobQuery.data, onGeneratedScenario]);

  function handleGeneratePreview() {
    setAttempted(true);
    const nextErrors = validateRandomForm({ count, startAt, endAt });
    setErrors(nextErrors);
    const firstError = Object.values(nextErrors).find(Boolean);
    if (firstError) {
      toast.error(firstError);
      return;
    }

    generate.mutate(
      {
        vehicleSelection: [target.profile.vehicleCategory],
        targetCount: 1,
        startAt,
        endAt: endAt.trim() || undefined,
        regionIds,
        anywhere: regionIds.length === 0,
      },
      {
        onSuccess: (accepted) => setJobId(accepted.jobId),
        onError: (error) => {
          const message = error instanceof Error ? error.message : "Unable to start generation.";
          toast.error(message);
          setErrors((current) => ({ ...current, count: message }));
        },
      },
    );
  }

  const isPending =
    generate.isPending ||
    jobQuery.data?.status === "queued" ||
    jobQuery.data?.status === "running";
  const statusMessage =
    jobQuery.data?.status === "failed"
      ? jobQuery.data.error ?? "Generation failed."
      : jobQuery.data?.progress ?? (generate.isPending ? "Starting generation…" : null);
  const formDisabled = disabled || isPending;

  return (
    <div className={cn("flex flex-col gap-4", disabled && "pointer-events-none opacity-50")}>
      <FieldGroup>
        <DemoRegionSelect
          regionIds={regionIds}
          onRegionIdsChange={setRegionIds}
          vehicleCategories={[target.profile.vehicleCategory]}
          disabled={formDisabled}
          idPrefix={`random-event-region-${target.id}`}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.startAt) || undefined}>
            <FieldLabel htmlFor={`random-start-at-${target.id}`}>Start time</FieldLabel>
            <DateTimePicker
              id={`random-start-at-${target.id}`}
              value={startAt}
              onChange={setStartAt}
              aria-invalid={Boolean(errors.startAt) || undefined}
            />
            <FieldError>{errors.startAt}</FieldError>
          </Field>
          <Field data-invalid={Boolean(errors.endAt) || undefined}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel htmlFor={`random-end-at-${target.id}`}>
                End time (optional)
              </FieldLabel>
              {endAt.trim() ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={formDisabled}
                  onClick={() => setEndAt("")}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            <DateTimePicker
              id={`random-end-at-${target.id}`}
              value={endAt}
              onChange={setEndAt}
              aria-invalid={Boolean(errors.endAt) || undefined}
            />
            <FieldDescription>
              Leave empty for a one-hour window from start.
            </FieldDescription>
            <FieldError>{errors.endAt}</FieldError>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.count) || undefined}>
            <FieldLabel htmlFor={`random-count-${target.id}`}>Event count</FieldLabel>
            <Input
              id={`random-count-${target.id}`}
              type="number"
              min={1}
              max={MAX_GENERATED_EVENTS}
              value={count}
              disabled={formDisabled}
              aria-invalid={Boolean(errors.count) || undefined}
              onChange={(event) => setCount(event.target.value)}
            />
            <FieldDescription>Maximum {MAX_GENERATED_EVENTS}.</FieldDescription>
            <FieldError>{errors.count}</FieldError>
          </Field>
          <Field data-disabled>
            <FieldLabel htmlFor={`random-category-${target.id}`}>Vehicle category</FieldLabel>
            <Input
              id={`random-category-${target.id}`}
              value={target.profile.vehicleCategory}
              disabled
            />
          </Field>
        </div>

        {statusMessage ? (
          <p
            className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            {statusMessage}
          </p>
        ) : null}

      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          className="w-full sm:w-auto"
          disabled={formDisabled}
          aria-busy={isPending || undefined}
          onClick={handleGeneratePreview}
        >
          {isPending ? "Generating…" : "Generate scenario"}
        </Button>
      </div>
    </div>
  );
}
