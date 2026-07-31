import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@adversary/ui/components/accordion";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@adversary/ui/components/card";
import { Checkbox } from "@adversary/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@adversary/ui/components/field";
import { Input } from "@adversary/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@adversary/ui/components/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@adversary/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@adversary/ui/components/select";
import { Switch } from "@adversary/ui/components/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@adversary/ui/components/tabs";
import { Textarea } from "@adversary/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@adversary/ui/components/toggle-group";
import { ScrollArea } from "@adversary/ui/components/scroll-area";
import { cn } from "@adversary/ui/lib/utils";
import { toast } from "sonner";
import {
  CircleAlertIcon,
  DownloadIcon,
  FolderOpenIcon,
  MapIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RadioIcon,
  SaveIcon,
  ShuffleIcon,
  SparklesIcon,
  Trash2Icon,
  WaypointsIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { BrandMark } from "@/components/brand-mark";
import Loader from "@/components/loader";

import { DateTimePicker } from "@/components/date-time-picker";
import { DemoRegionSelect } from "@/components/demo-region-select";
import { EventMessageExportDialog } from "@/components/event-message-export-dialog";
import { GenerateRandomRouteForm } from "@/components/generate-random-route-form";
import { GenerateRouteForm } from "@/components/generate-route-form";
import { GroupedTimeline } from "@/components/grouped-timeline";
import { IdbConflictDialog } from "@/components/idb-conflict-dialog";
import { useSimulation } from "@/components/simulation-provider";
import { useTheme } from "@/components/theme-provider";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";
import {
  useDeleteScenarioMutation,
  useGenerateJobQuery,
  useGenerateScenarioMutation,
  usePutDraftMutation,
  useScenariosQuery,
} from "@/hooks/use-scenarios";
import type { ScenarioSummary } from "@/lib/api/types";
import { getScenarioApi } from "@/lib/api/scenarios";
import {
  migrateIdbDraftsToServer,
  type ConflictChoice,
  type IdbConflict,
} from "@/lib/idb-server-migrate";
import { DEMO_REGIONS, regionCenter } from "@/lib/demo-regions";
import {
  defaultTargetProfile,
  MAX_DEMO_TARGETS,
  MIN_DEMO_TARGETS,
  parseDemoTargetCount,
  pickRandomDemoOrigin,
  type DemoOrigin,
} from "@/lib/demo-scenario";
import {
  createDraftForTargetChange,
  createEventDraft,
  createFollowOnDraft,
  eventFromDraft,
} from "@/lib/event-draft";
import { addPriorityTerm, matchPriorityTerms, removePriorityTerm } from "@/lib/priority-terms";
import { applyFastForwardTimes } from "@/lib/scenario-timing";
import { effectiveEventAtMs, getEventsDueByTime, sortEvents } from "@/lib/simulation-engine";
import { buildTrackingMapEventPoints } from "@/lib/tracking-map-event-points";
import {
  coerceEditableScenario,
  downloadScenario,
} from "@/lib/simulation-storage";
import {
  fieldHasIssue,
  formatValidationIssueLabel,
  getIssuesForTarget,
  getScenarioValidationIssues,
  getValidationIssueFocusId,
  groupValidationIssues,
  type ValidationIssue,
} from "@/lib/scenario-validation-ui";
import { validateScenario } from "@/lib/simulation-schema";
import {
  findTargetColorLabel,
  nextTargetColor,
  normalizeHex,
  randomUnusedTargetColor,
  resolveTargetColorTheme,
  targetColorOptionList,
} from "@/lib/target-colors";
import { PREVIEW_SPEEDS, describePreviewEvent, useBuilderPreview } from "@/lib/use-builder-preview";
import { VEHICLE_CATEGORIES } from "@/types/target";
import type {
  Affiliation,
  SimulationEvent,
  SimulationScenario,
  TargetDefinition,
  TargetProfile,
  TargetStatus,
  VehicleCategory,
} from "@/types/target";

function focusElementById(id: string, delayMs = 120) {
  window.setTimeout(() => {
    const element = document.getElementById(id);
    if (element instanceof HTMLElement) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, delayMs);
}

const MapLocationPicker = lazy(() =>
  import("@/components/map-location-picker").then((module) => ({
    default: module.MapLocationPicker,
  })),
);
const TrackingMap = lazy(() =>
  import("@/components/tracking-map").then((module) => ({ default: module.TrackingMap })),
);
const PreviewEventGraph = lazy(() =>
  import("@/components/preview-event-graph").then((module) => ({
    default: module.PreviewEventGraph,
  })),
);

function DemoMapPickerFallback() {
  return (
    <div className="grid h-44 place-items-center rounded-lg border bg-muted text-sm text-muted-foreground">
      Loading map…
    </div>
  );
}

function matchingDemoLocationName(origin: DemoOrigin) {
  return (
    DEMO_REGIONS.find((region) => {
      const center = regionCenter(region);
      return (
        center.latitude === origin.latitude && center.longitude === origin.longitude
      );
    })?.name ?? null
  );
}

function blankScenario(): SimulationScenario {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: "Untitled operation",
    description: "",
    createdAt: now,
    updatedAt: now,
    priorityTerms: [],
    targets: [],
    events: [],
  };
}

/** Operation profile fast-forward choices: 1× = off, 2×–10× compress schedule. */
const FAST_FORWARD_MULTIPLIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function OptionSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(String(next))}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option.replace("-", " ")}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function TargetProfileFields({
  profile,
  onChange,
  idPrefix,
  invalidFields = [],
}: {
  profile: TargetProfile;
  onChange: (profile: TargetProfile) => void;
  idPrefix: string;
  invalidFields?: string[];
}) {
  const hasFieldError = (field: string) => invalidFields.includes(field);

  return (
    <FieldGroup className="grid gap-3 sm:grid-cols-2">
      <Field data-invalid={hasFieldError("profile.vehicleCategory") || undefined}>
        <FieldLabel>Vehicle category</FieldLabel>
        <OptionSelect
          label="Vehicle category"
          value={profile.vehicleCategory}
          onChange={(value) => onChange({ ...profile, vehicleCategory: value as VehicleCategory })}
          options={["aircraft", "boat", "car", "truck", "other"]}
        />
      </Field>
      <Field data-invalid={hasFieldError("profile.vehicleSubtype") || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-subtype`}>Subtype</FieldLabel>
        <Input
          id={`${idPrefix}-subtype`}
          value={profile.vehicleSubtype ?? ""}
          onChange={(event) => onChange({ ...profile, vehicleSubtype: event.target.value })}
          aria-invalid={hasFieldError("profile.vehicleSubtype")}
        />
      </Field>
      <Field data-invalid={hasFieldError("profile.affiliation") || undefined}>
        <FieldLabel>Affiliation</FieldLabel>
        <OptionSelect
          label="Affiliation"
          value={profile.affiliation}
          onChange={(value) => onChange({ ...profile, affiliation: value as Affiliation })}
          options={["unknown", "friendly", "neutral", "hostile"]}
        />
      </Field>
      <Field data-invalid={hasFieldError("profile.status") || undefined}>
        <FieldLabel>Status</FieldLabel>
        <OptionSelect
          label="Status"
          value={profile.status}
          onChange={(value) => onChange({ ...profile, status: value as TargetStatus })}
          options={["unknown", "active", "stationary", "lost", "inactive"]}
        />
      </Field>
      <Field data-invalid={hasFieldError("profile.identifier") || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-identifier`}>Identifier</FieldLabel>
        <Input
          id={`${idPrefix}-identifier`}
          value={profile.identifier ?? ""}
          onChange={(event) => onChange({ ...profile, identifier: event.target.value })}
          aria-invalid={hasFieldError("profile.identifier")}
        />
      </Field>
      <Field className="sm:col-span-2" data-invalid={hasFieldError("profile.description") || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-description`}>Description</FieldLabel>
        <Textarea
          id={`${idPrefix}-description`}
          value={profile.description ?? ""}
          onChange={(event) => onChange({ ...profile, description: event.target.value })}
          aria-invalid={hasFieldError("profile.description")}
        />
      </Field>
    </FieldGroup>
  );
}

export function ScenarioBuilder() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { scenarioId?: string };
  const scenarioId = search.scenarioId;
  const { runtime, start, isStarting } = useSimulation();
  const { resolvedTheme } = useTheme();
  const colorTheme = resolveTargetColorTheme(resolvedTheme);
  const scenariosQuery = useScenariosQuery();
  const putDraft = usePutDraftMutation();
  const deleteScenarioMutation = useDeleteScenarioMutation();
  const [loading, setLoading] = useState(true);
  const [migrationDone, setMigrationDone] = useState(false);
  const [idbConflict, setIdbConflict] = useState<IdbConflict | null>(null);
  const conflictResolverRef = useRef<((choice: ConflictChoice) => void) | null>(null);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<SimulationScenario>(() => blankScenario());
  const [draft, setDraft] = useState(() => createEventDraft());
  const [priorityInput, setPriorityInput] = useState("");
  const [eventMode, setEventMode] = useState<"manual" | "automatic" | "random">("manual");
  const [timelineMode, setTimelineMode] = useState<"view" | "edit">("view");
  const [previewViewMode, setPreviewViewMode] = useState<"map" | "graph">("map");
  const [cameraMode, setCameraMode] = useState<"overview" | "pan">("overview");
  const [highlightTargetId, setHighlightTargetId] = useState<string | null>(null);
  const [highlightEventId, setHighlightEventId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [previewGraphTargetId, setPreviewGraphTargetId] = useState<string | null>(null);
  const [openTimelineIds, setOpenTimelineIds] = useState<Record<string, boolean>>({});
  const [showReviewEventPoints, setShowReviewEventPoints] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [storedScenariosOpen, setStoredScenariosOpen] = useState(false);
  const [demoDialogOpen, setDemoDialogOpen] = useState(false);
  const [demoVehicleRandom, setDemoVehicleRandom] = useState(true);
  const [demoVehicleCategories, setDemoVehicleCategories] = useState<VehicleCategory[]>([]);
  const [demoTargetCountInput, setDemoTargetCountInput] = useState("10");
  const [demoStartAt, setDemoStartAt] = useState(() => new Date().toISOString());
  const [demoEndAt, setDemoEndAt] = useState("");
  const [demoOrigin, setDemoOrigin] = useState<DemoOrigin | null>(null);
  /** Empty selection means `"anywhere"`. */
  const [demoRegionIds, setDemoRegionIds] = useState<string[]>([]);
  const [demoProgress, setDemoProgress] = useState<{ ready: number; total: number } | null>(
    null,
  );
  const [demoJobId, setDemoJobId] = useState<string | null>(null);
  const completedDemoJobRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const generateDemo = useGenerateScenarioMutation();
  const demoJobQuery = useGenerateJobQuery(demoJobId);

  const records: ScenarioSummary[] = scenariosQuery.data ?? [];
  const draftAutosave = useDraftAutosave(scenario, {
    enabled: migrationDone && Boolean(activeRecordId) && !loading,
  });

  const demoTargetCount = parseDemoTargetCount(demoTargetCountInput);
  const demoTargetCountInvalid =
    demoTargetCountInput.trim().length > 0 && demoTargetCount === null;
  const demoEndAtInvalid =
    demoEndAt.trim().length > 0 &&
    (!Number.isFinite(Date.parse(demoEndAt)) || Date.parse(demoEndAt) <= Date.parse(demoStartAt));
  const demoLocationLabel = demoOrigin ? matchingDemoLocationName(demoOrigin) : null;
  const demoRegionAnywhere = demoRegionIds.length === 0;
  const demoPinOverridesRegions = demoOrigin !== null;
  const isDemoPending =
    generateDemo.isPending ||
    demoJobQuery.data?.status === "queued" ||
    demoJobQuery.data?.status === "running";

  useEffect(() => {
    if (demoVehicleCategories.length === 0 && !demoVehicleRandom) {
      setDemoVehicleRandom(true);
    }
  }, [demoVehicleCategories.length, demoVehicleRandom]);

  useEffect(() => {
    const job = demoJobQuery.data;
    if (!job) return;
    if (job.status === "failed") {
      if (completedDemoJobRef.current === job.id) return;
      completedDemoJobRef.current = job.id;
      toast.error(job.error ?? "Demo generation failed.");
      setDemoJobId(null);
      setDemoProgress(null);
      return;
    }
    if (job.status !== "succeeded" || !job.scenarioId) return;
    if (completedDemoJobRef.current === job.id) return;
    completedDemoJobRef.current = job.id;

    const typeLabel =
      demoVehicleRandom
        ? "mixed"
        : demoVehicleCategories.length === 1
          ? demoVehicleCategories[0]
          : demoVehicleCategories.join("/");
    setDemoProgress({ ready: demoTargetCount ?? 0, total: demoTargetCount ?? 0 });
    toast.success(
      `Loaded ${typeLabel} demo with ${job.degradedTrackCount ?? 0} synthetic fallback track${
        job.degradedTrackCount === 1 ? "" : "s"
      }.`,
    );
    setDemoDialogOpen(false);
    setDemoJobId(null);
    setDemoProgress(null);
    void switchScenario(job.scenarioId);
  }, [
    demoJobQuery.data,
    demoTargetCount,
    demoVehicleCategories,
    demoVehicleRandom,
    switchScenario,
  ]);

  const validationIssues = useMemo(
    () => getScenarioValidationIssues(scenario),
    [scenario],
  );
  const validationSuccess = validationIssues.length === 0;
  const groupedIssues = useMemo(
    () => groupValidationIssues(validationIssues),
    [validationIssues],
  );
  const preview = useBuilderPreview(scenario);
  const storedScenarioOptions = useMemo(
    () => records.filter((record) => record.id !== activeRecordId),
    [records, activeRecordId],
  );
  const allStoredSelected =
    storedScenarioOptions.length > 0 &&
    storedScenarioOptions.every((record) => selectedScenarioIds.includes(record.id));
  const someStoredSelected = selectedScenarioIds.some((id) =>
    storedScenarioOptions.some((record) => record.id === id),
  );

  useEffect(() => {
    const available = new Set(storedScenarioOptions.map((record) => record.id));
    setSelectedScenarioIds((current) => current.filter((id) => available.has(id)));
    if (storedScenarioOptions.length === 0) setStoredScenariosOpen(false);
  }, [storedScenarioOptions]);

  const selectedDraftTarget = scenario.targets.find((target) => target.id === draft.targetId);
  const selectedTarget =
    scenario.targets.find((target) => target.id === selectedTargetId) ?? null;
  const previewGraphTarget =
    scenario.targets.find((target) => target.id === previewGraphTargetId) ??
    scenario.targets[0] ??
    null;
  const priorityMatches = draft.includeMessage
    ? matchPriorityTerms(draft.message, scenario.priorityTerms)
    : [];

  const eventsByTarget = useMemo(() => {
    const grouped = new Map<string, SimulationEvent[]>();
    for (const target of scenario.targets) grouped.set(target.id, []);
    // Preserve authoring/array order so edit-mode rows stay stable while times change.
    for (const event of scenario.events) {
      grouped.get(event.targetId)?.push(event);
    }
    return grouped;
  }, [scenario.events, scenario.targets]);

  const reviewEventPoints = useMemo(
    () =>
      buildTrackingMapEventPoints(
        getEventsDueByTime(scenario, preview.previewTimeMs),
        scenario.targets,
      ),
    [preview.previewTimeMs, scenario],
  );

  const graphCurrentEventId = useMemo(() => {
    if (!previewGraphTarget) return null;
    const delaySeconds = scenario.delaySeconds ?? 0;
    const targetEvents = eventsByTarget.get(previewGraphTarget.id) ?? [];
    const due = targetEvents.filter(
      (event) => effectiveEventAtMs(event, delaySeconds) <= preview.previewTimeMs,
    );
    return sortEvents(due).at(-1)?.id ?? null;
  }, [
    eventsByTarget,
    preview.previewTimeMs,
    previewGraphTarget,
    scenario.delaySeconds,
  ]);

  const draftTargetPositionPoints = useMemo(() => {
    if (!draft.targetId) return [];
    return sortEvents(eventsByTarget.get(draft.targetId) ?? []).flatMap((event) => {
      if (!event.position) return [];
      return [
        {
          id: event.id,
          latitude: event.position.latitude,
          longitude: event.position.longitude,
          at: event.at,
        },
      ];
    });
  }, [draft.targetId, eventsByTarget]);

  useEffect(() => {
    if (selectedTargetId && scenario.targets.some((target) => target.id === selectedTargetId)) {
      return;
    }
    setSelectedTargetId(scenario.targets[0]?.id ?? null);
  }, [scenario.targets, selectedTargetId]);

  useEffect(() => {
    if (
      previewGraphTargetId &&
      scenario.targets.some((target) => target.id === previewGraphTargetId)
    ) {
      return;
    }
    setPreviewGraphTargetId(scenario.targets[0]?.id ?? null);
  }, [previewGraphTargetId, scenario.targets]);

  useEffect(() => {
    let cancelled = false;

    async function runMigrationThenHydrate() {
      setLoading(true);
      try {
        await migrateIdbDraftsToServer({
          onConflict(conflict) {
            return new Promise<ConflictChoice>((resolve) => {
              conflictResolverRef.current = resolve;
              setIdbConflict(conflict);
            });
          },
        });
        if (cancelled) return;
        setMigrationDone(true);
        await scenariosQuery.refetch();
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not migrate local drafts to the server.",
          );
          setMigrationDone(true);
        }
      }
    }

    void runMigrationThenHydrate();
    return () => {
      cancelled = true;
    };
    // One-shot migrate on builder mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, []);

  useEffect(() => {
    if (!migrationDone || hydratedRef.current) return;
    if (scenariosQuery.isFetching && !scenariosQuery.data) return;

    let cancelled = false;

    async function hydrateFromServer() {
      setLoading(true);
      try {
        const stored = scenariosQuery.data ?? [];
        const selected =
          (scenarioId ? stored.find((record) => record.id === scenarioId) : undefined) ??
          stored[0];

        if (selected) {
          const detail = await getScenarioApi(selected.id);
          if (cancelled) return;
          setActiveRecordId(detail.id);
          const nextScenario = coerceEditableScenario(detail.payload, detail.id);
          setScenario(nextScenario);
          setSelectedTargetId(nextScenario.targets[0]?.id ?? null);
          const firstTargetId = nextScenario.targets[0]?.id;
          setDraft(
            firstTargetId
              ? createDraftForTargetChange(
                  firstTargetId,
                  nextScenario.events,
                  createEventDraft().at,
                )
              : createEventDraft(),
          );
        } else {
          const blank = blankScenario();
          const created = await putDraft.mutateAsync({ id: blank.id, payload: blank });
          if (cancelled) return;
          setActiveRecordId(created.id);
          setScenario(coerceEditableScenario(created.payload, created.id));
          setSelectedTargetId(null);
          setDraft(createEventDraft());
          void navigate({ to: "/builder", search: { scenarioId: created.id } });
        }
        hydratedRef.current = true;
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Could not load scenarios from the API.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void hydrateFromServer();
    return () => {
      cancelled = true;
    };
  }, [migrationDone, navigate, putDraft, scenarioId, scenariosQuery.data, scenariosQuery.isFetching]);

  function applyValidation(nextScenario: SimulationScenario) {
    return getScenarioValidationIssues(nextScenario);
  }

  function updateScenario(patch: Partial<SimulationScenario>) {
    setScenario((current) => {
      const merged: SimulationScenario = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      if ("events" in patch || "fastForwardMultiplier" in patch) {
        return applyFastForwardTimes(merged);
      }
      return merged;
    });
  }

  function updateTarget(targetId: string, patch: Partial<TargetDefinition>) {
    updateScenario({
      targets: scenario.targets.map((target) =>
        target.id === targetId ? { ...target, ...patch } : target,
      ),
    });
  }

  function addTarget() {
    const targetId = crypto.randomUUID();
    const index = scenario.targets.length;
    updateScenario({
      targets: [
        ...scenario.targets,
        {
          id: targetId,
          callsign: `CONTACT ${String(index + 1).padStart(2, "0")}`,
          revealOnFirstEvent: true,
          appearOnFirstEvent: false,
          color: nextTargetColor(
            scenario.targets.map((target) => target.color),
            colorTheme,
          ),
          profile: defaultTargetProfile(),
        },
      ],
    });
    setSelectedTargetId(targetId);
    setDraft((current) =>
      current.targetId
        ? current
        : createDraftForTargetChange(targetId, scenario.events, current.at),
    );
  }

  function removeTarget(targetId: string) {
    const remaining = scenario.targets.filter((target) => target.id !== targetId);
    const remainingEvents = scenario.events.filter((event) => event.targetId !== targetId);
    updateScenario({
      targets: remaining,
      events: remainingEvents,
    });
    setSelectedTargetId((current) => {
      if (current !== targetId) return current;
      return remaining[0]?.id ?? null;
    });
    setDraft((current) => {
      if (current.targetId !== targetId) return current;
      const nextTargetId = remaining[0]?.id ?? "";
      if (!nextTargetId) return createEventDraft();
      return createDraftForTargetChange(nextTargetId, remainingEvents, current.at);
    });
  }

  function addPriorityTermFromInput() {
    const trimmed = priorityInput.trim();
    if (!trimmed) return;
    updateScenario({ priorityTerms: addPriorityTerm(scenario.priorityTerms, trimmed) });
    setPriorityInput("");
  }

  function addEvent() {
    const nextEvent = eventFromDraft(draft);
    if (!nextEvent) {
      toast.error("Choose a target, time, and at least one payload section.");
      return;
    }
    updateScenario({
      events: [...scenario.events, nextEvent],
    });
    // Same target: keep switch state + map pin; clear message; step time +5m.
    setDraft(createFollowOnDraft(draft));
  }

  function selectEventTarget(targetId: string) {
    // Different target: switches back to defaults; map uses that target's last position.
    setDraft((current) => createDraftForTargetChange(targetId, scenario.events, current.at));
  }

  function save() {
    void (async () => {
      const issues = applyValidation(scenario);
      try {
        const record = await putDraft.mutateAsync({ id: scenario.id, payload: scenario });
        setActiveRecordId(record.id);
        draftAutosave.saveNow(scenario);
        if (issues.length === 0) {
          toast.success("Scenario saved to server.");
          return;
        }
        toast.error(
          `Saved draft with ${issues.length} validation ${issues.length === 1 ? "error" : "errors"}.`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Save failed.");
      }
    })();
  }

  async function switchScenario(nextRecordId: string) {
    if (nextRecordId === activeRecordId) return;

    if (activeRecordId) {
      try {
        await putDraft.mutateAsync({ id: scenario.id, payload: scenario });
      } catch {
        // keep going; user explicitly switched
      }
    }

    if (nextRecordId === "__new__") {
      const blank = blankScenario();
      const created = await putDraft.mutateAsync({ id: blank.id, payload: blank });
      setActiveRecordId(created.id);
      setScenario(coerceEditableScenario(created.payload, created.id));
      setSelectedTargetId(null);
      setDraft(createEventDraft());
      void navigate({ to: "/builder", search: { scenarioId: created.id } });
      return;
    }

    const detail = await getScenarioApi(nextRecordId);
    const nextScenario = coerceEditableScenario(detail.payload, detail.id);
    setActiveRecordId(detail.id);
    setScenario(nextScenario);
    setSelectedTargetId(nextScenario.targets[0]?.id ?? null);
    {
      const firstTargetId = nextScenario.targets[0]?.id;
      setDraft(
        firstTargetId
          ? createDraftForTargetChange(
              firstTargetId,
              nextScenario.events,
              createEventDraft().at,
            )
          : createEventDraft(),
      );
    }
    void navigate({ to: "/builder", search: { scenarioId: detail.id } });
  }

  async function removeStoredScenarios(recordIds: string[]) {
    const deletableIds = [...new Set(recordIds)].filter((id) => id !== activeRecordId);
    if (deletableIds.length === 0) return;

    const labels = deletableIds.map((id) => {
      const record = records.find((entry) => entry.id === id);
      return record?.name?.trim() || "Untitled scenario";
    });
    const confirmLabel =
      labels.length === 1
        ? `Delete “${labels[0]}” from the server? This cannot be undone.`
        : `Delete ${labels.length} scenarios from the server? This cannot be undone.`;
    if (!window.confirm(confirmLabel)) return;

    await Promise.all(deletableIds.map((id) => deleteScenarioMutation.mutateAsync(id)));
    setSelectedScenarioIds((current) => current.filter((id) => !deletableIds.includes(id)));
    await scenariosQuery.refetch();
    toast.success(
      deletableIds.length === 1
        ? `Deleted ${labels[0]}.`
        : `Deleted ${deletableIds.length} scenarios.`,
    );
  }

  function toggleScenarioSelection(recordId: string, selected: boolean) {
    setSelectedScenarioIds((current) => {
      if (selected) return current.includes(recordId) ? current : [...current, recordId];
      return current.filter((id) => id !== recordId);
    });
  }

  function toggleSelectAllStoredScenarios(selected: boolean) {
    setSelectedScenarioIds(selected ? storedScenarioOptions.map((record) => record.id) : []);
  }

  function selectDemoVehicleRandom() {
    setDemoVehicleRandom(true);
    setDemoVehicleCategories([]);
  }

  function toggleDemoVehicleCategory(category: VehicleCategory, checked: boolean) {
    setDemoVehicleRandom(false);
    setDemoVehicleCategories((current) => {
      if (checked) {
        return current.includes(category) ? current : [...current, category];
      }
      return current.filter((entry) => entry !== category);
    });
  }

  function cancelDemoGeneration() {
    setDemoJobId(null);
    setDemoProgress(null);
    setDemoDialogOpen(false);
    toast.message("Stopped waiting for demo generation.");
  }

  function handleDemoDialogOpenChange(open: boolean) {
    if (!open && isDemoPending) {
      cancelDemoGeneration();
      return;
    }
    setDemoDialogOpen(open);
  }

  function loadRandomDemo() {
    if (demoTargetCount === null) {
      toast.error(`Enter a target size between ${MIN_DEMO_TARGETS} and ${MAX_DEMO_TARGETS}.`);
      return;
    }
    if (!demoVehicleRandom && demoVehicleCategories.length === 0) {
      toast.error("Select Random or at least one vehicle type.");
      return;
    }
    if (demoEndAtInvalid) {
      toast.error("End time must be after start time.");
      return;
    }

    const targetCount = demoTargetCount;
    completedDemoJobRef.current = null;
    setDemoProgress({ ready: 0, total: targetCount });
    generateDemo.mutate(
      {
        vehicleSelection: demoVehicleRandom ? undefined : demoVehicleCategories,
        targetCount,
        startAt: demoStartAt,
        endAt: demoEndAt.trim() || undefined,
        origin: demoOrigin ?? undefined,
        regionIds: demoOrigin ? undefined : demoRegionIds,
        anywhere: !demoOrigin && demoRegionAnywhere,
      },
      {
        onSuccess: (accepted) => setDemoJobId(accepted.jobId),
        onError: (error) => {
          setDemoProgress(null);
          toast.error(error instanceof Error ? error.message : "Unable to start demo generation.");
        },
      },
    );
  }

  function randomizeDemoOrigin() {
    setDemoOrigin(pickRandomDemoOrigin());
  }

  function beginSimulation() {
    const issues = applyValidation(scenario);
    if (issues.length > 0) {
      toast.error("Resolve scenario validation issues before starting.");
      return;
    }
    if (runtime?.status === "running") {
      toast.error("Stop the active simulation before starting another.");
      return;
    }
    void (async () => {
      try {
        await start(scenario);
        await navigate({ to: "/operations" });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not start run.");
      }
    })();
  }

  function isTimelineExpanded(targetId: string) {
    if (targetId in openTimelineIds) return openTimelineIds[targetId]!;
    return true;
  }

  function setAllTimelineExpanded(expanded: boolean) {
    setOpenTimelineIds(
      Object.fromEntries(scenario.targets.map((target) => [target.id, expanded])),
    );
  }

  function navigateToIssue(issue: ValidationIssue) {
    const focusId = getValidationIssueFocusId(issue, scenario);

    if (issue.path === "name" || issue.field === "name") {
      document.getElementById("scenario-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingFocusId("scenario-name");
      return;
    }

    if (issue.path === "targets") {
      document.getElementById("targets-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (issue.path === "events") {
      document.getElementById("events-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const targetMatch = /^targets\.(\d+)/.exec(issue.path);
    if (targetMatch) {
      const index = Number(targetMatch[1]);
      const target = scenario.targets[index];
      if (target) {
        setSelectedTargetId(target.id);
        setHighlightTargetId(target.id);
        document
          .getElementById("targets-section")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (focusId) setPendingFocusId(focusId);
        return;
      }
    }

    const eventMatch = /^events\.(\d+)/.exec(issue.path);
    if (eventMatch) {
      const index = Number(eventMatch[1]);
      const event = scenario.events[index];
      if (event) {
        setTimelineMode("edit");
        setOpenTimelineIds((current) => ({ ...current, [event.targetId]: true }));
        setHighlightEventId(event.id);
        document
          .getElementById(`event-row-${event.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (focusId) setPendingFocusId(focusId);
      }
    }
  }

  useEffect(() => {
    if (!pendingFocusId) return;
    const delayMs = pendingFocusId.startsWith("edit-") ? 420 : 180;
    const timer = window.setTimeout(() => {
      focusElementById(pendingFocusId, 0);
      setPendingFocusId(null);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [pendingFocusId, timelineMode]);

  useEffect(() => {
    if (!highlightTargetId) return;
    const timer = window.setTimeout(() => setHighlightTargetId(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [highlightTargetId]);

  useEffect(() => {
    if (!highlightEventId) return;
    const timer = window.setTimeout(() => setHighlightEventId(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [highlightEventId]);

  const selectedTargetIssues = selectedTarget
    ? getIssuesForTarget(validationIssues, selectedTarget.id, scenario)
    : [];
  const selectedInvalidProfileFields = selectedTargetIssues
    .map((issue) => issue.field ?? "")
    .filter((field) => field.startsWith("profile."));

  function updateEvent(next: SimulationEvent) {
    updateScenario({
      events: scenario.events.map((event) => (event.id === next.id ? next : event)),
    });
  }

  function removeEvent(eventId: string) {
    updateScenario({
      events: scenario.events.filter((event) => event.id !== eventId),
    });
  }

  if (loading) {
    return (
      <main className="grid min-h-full place-items-center p-6">
        <Loader />
        <IdbConflictDialog
          conflict={idbConflict}
          onResolve={(choice) => {
            conflictResolverRef.current?.(choice);
            conflictResolverRef.current = null;
            setIdbConflict(null);
          }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-3 sm:p-5 lg:p-7">
      <IdbConflictDialog
        conflict={idbConflict}
        onResolve={(choice) => {
          conflictResolverRef.current?.(choice);
          conflictResolverRef.current = null;
          setIdbConflict(null);
        }}
      />
      <section className="flex flex-col justify-between gap-4 border-b border-border/70 pb-5 md:flex-row md:items-end">
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-primary">
            <BrandMark className="size-4" />
            Scenario authoring
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simulation builder</h1>
          <p className="text-sm text-muted-foreground">
            Define contacts, schedule unified events, preview routes locally, then hand off to live
            operations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={demoDialogOpen} onOpenChange={handleDemoDialogOpenChange}>
            <DialogTrigger render={<Button variant="outline" />}>
              <SparklesIcon data-icon="inline-start" />
              Load random demo
            </DialogTrigger>
            <DialogContent className="flex max-h-[90vh] max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Load random demo</DialogTitle>
                <DialogDescription>
                  Configure vehicle mix, regions, and schedule. Placement precedence: map pin,
                  then selected regions, then anywhere.
                </DialogDescription>
              </DialogHeader>
              <div className="-mx-4 min-h-0 flex-1 overflow-y-auto border-y px-4 py-4">
                <div className="flex flex-col gap-5">
                  <Field>
                    <FieldLabel>Vehicle type</FieldLabel>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={demoVehicleRandom}
                          disabled={isDemoPending}
                          onCheckedChange={(checked) => {
                            if (checked) selectDemoVehicleRandom();
                          }}
                        />
                        Random
                      </label>
                      {VEHICLE_CATEGORIES.map((category) => (
                        <label key={category} className="flex items-center gap-2 text-sm capitalize">
                          <Checkbox
                            checked={demoVehicleCategories.includes(category)}
                            disabled={isDemoPending}
                            onCheckedChange={(checked) => {
                              toggleDemoVehicleCategory(category, checked === true);
                            }}
                          />
                          {category}
                        </label>
                      ))}
                    </div>
                  </Field>

                  <Field data-invalid={demoTargetCountInvalid || undefined}>
                    <FieldLabel htmlFor="demo-target-count">Target size</FieldLabel>
                    <Input
                      id="demo-target-count"
                      type="number"
                      inputMode="numeric"
                      min={MIN_DEMO_TARGETS}
                      max={MAX_DEMO_TARGETS}
                      step={1}
                      value={demoTargetCountInput}
                      disabled={isDemoPending}
                      onChange={(event) => setDemoTargetCountInput(event.target.value)}
                      aria-invalid={demoTargetCountInvalid || undefined}
                      aria-describedby={
                        demoTargetCountInvalid ? "demo-target-count-error" : "demo-target-count-hint"
                      }
                    />
                    {demoTargetCountInvalid ? (
                      <FieldError id="demo-target-count-error">
                        Enter an integer greater than 1 and at most {MAX_DEMO_TARGETS}.
                      </FieldError>
                    ) : (
                      <FieldDescription id="demo-target-count-hint">
                        {MIN_DEMO_TARGETS}–{MAX_DEMO_TARGETS} contacts
                      </FieldDescription>
                    )}
                  </Field>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="demo-start-at">Start time</FieldLabel>
                      <DateTimePicker
                        id="demo-start-at"
                        value={demoStartAt}
                        onChange={setDemoStartAt}
                      />
                    </Field>
                    <Field data-invalid={demoEndAtInvalid || undefined}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FieldLabel htmlFor="demo-end-at">End time (optional)</FieldLabel>
                        {demoEndAt.trim() ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isDemoPending}
                            onClick={() => setDemoEndAt("")}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                      <DateTimePicker
                        id="demo-end-at"
                        value={demoEndAt}
                        onChange={setDemoEndAt}
                        aria-invalid={demoEndAtInvalid || undefined}
                      />
                      {demoEndAtInvalid ? (
                        <FieldError>End time must be after start time.</FieldError>
                      ) : (
                        <FieldDescription>
                          Leave empty for per-contact random durations from start.
                        </FieldDescription>
                      )}
                    </Field>
                  </div>

                  <DemoRegionSelect
                    regionIds={demoRegionIds}
                    onRegionIdsChange={setDemoRegionIds}
                    vehicleCategories={demoVehicleRandom ? [] : demoVehicleCategories}
                    disabled={isDemoPending || demoPinOverridesRegions}
                    pinOverrides={demoPinOverridesRegions}
                    idPrefix="demo-region"
                  />

                  <Field>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FieldLabel>Starting location pin (optional)</FieldLabel>
                      <div className="flex flex-wrap gap-1">
                        {demoOrigin ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isDemoPending}
                              onClick={randomizeDemoOrigin}
                            >
                              <ShuffleIcon data-icon="inline-start" />
                              Randomize
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isDemoPending}
                              onClick={() => setDemoOrigin(null)}
                            >
                              Clear
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isDemoPending}
                            onClick={randomizeDemoOrigin}
                          >
                            <MapIcon data-icon="inline-start" />
                            Choose location
                          </Button>
                        )}
                      </div>
                    </div>
                    {demoOrigin ? (
                      <>
                        <FieldDescription>
                          {demoLocationLabel
                            ? `Pin overrides regions. Preset: ${demoLocationLabel}. Contacts scatter nearby.`
                            : "Pin overrides regions. Custom point — contacts scatter nearby."}
                        </FieldDescription>
                        <Suspense fallback={<DemoMapPickerFallback />}>
                          <MapLocationPicker
                            idPrefix="demo-origin"
                            value={{
                              latitude: demoOrigin.latitude,
                              longitude: demoOrigin.longitude,
                              altitude: 0,
                            }}
                            onChange={(point) =>
                              setDemoOrigin({
                                latitude: point.latitude,
                                longitude: point.longitude,
                              })
                            }
                            showSpeedField={false}
                            mapClassName="h-44 sm:h-52"
                            mapAriaLabel="Demo starting location. Click or tap to place the region center."
                          />
                        </Suspense>
                      </>
                    ) : (
                      <FieldDescription>
                        Leave unset to use region selection or Anywhere sampling.
                      </FieldDescription>
                    )}
                  </Field>
                </div>
              </div>
              <DialogFooter className="flex-col gap-3 sm:flex-col sm:space-x-0">
                {demoProgress ? (
                  <p
                    className="w-full text-sm text-muted-foreground"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    Routing {demoProgress.ready} of {demoProgress.total} contacts…
                    {isDemoPending ? " Generation in progress." : null}
                  </p>
                ) : null}
                <div className="flex w-full flex-wrap items-center justify-end gap-2">
                  {isDemoPending ? (
                    <Button type="button" variant="outline" onClick={cancelDemoGeneration}>
                      Cancel generation
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setDemoDialogOpen(false)}>
                      Cancel
                    </Button>
                  )}
                  <Button
                    disabled={
                      isDemoPending || demoTargetCount === null || demoEndAtInvalid
                    }
                    aria-busy={isDemoPending || undefined}
                    onClick={() => loadRandomDemo()}
                  >
                    <SparklesIcon data-icon="inline-start" />
                    {isDemoPending ? "Generating…" : "Load demo"}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {runtime?.status === "running" ? (
            <Button variant="secondary" render={<Link to="/operations" />}>
              <RadioIcon data-icon="inline-start" />
              View live simulation
            </Button>
          ) : null}
        </div>
      </section>

      <div className="flex items-start gap-2">
        <Accordion
          className="min-w-0 flex-1 rounded-lg border bg-card px-3 text-card-foreground"
          value={storedScenariosOpen ? ["stored-scenarios"] : []}
          onValueChange={(next) => {
            const open = next.includes("stored-scenarios");
            if (open && storedScenarioOptions.length === 0) {
              setStoredScenariosOpen(false);
              return;
            }
            setStoredScenariosOpen(open);
          }}
        >
          <AccordionItem value="stored-scenarios" className="border-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>
                  Stored scenarios
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    ({storedScenarioOptions.length})
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  Load or delete previously saved scenarios
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-2">
              {storedScenarioOptions.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  No other saved scenarios yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <Field orientation="horizontal" className="w-auto gap-2">
                      <Checkbox
                        id="select-all-stored-scenarios"
                        checked={allStoredSelected}
                        indeterminate={!allStoredSelected && someStoredSelected}
                        onCheckedChange={(checked) =>
                          toggleSelectAllStoredScenarios(checked === true)
                        }
                      />
                      <FieldLabel htmlFor="select-all-stored-scenarios" className="text-xs">
                        Select all
                      </FieldLabel>
                    </Field>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="ml-auto"
                      disabled={selectedScenarioIds.length === 0}
                      onClick={() => void removeStoredScenarios(selectedScenarioIds)}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Delete
                      {selectedScenarioIds.length > 0 ? ` (${selectedScenarioIds.length})` : ""}
                    </Button>
                  </div>
                  <ScrollArea className="h-36">
                    <ul className="flex flex-col gap-1 pr-2">
                      {storedScenarioOptions.map((record) => {
                        const ready = record.status === "ready";
                        const displayName = record.name.trim() || "Untitled scenario";
                        const updatedLabel = new Date(record.updatedAt).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric" },
                        );
                        const selected = selectedScenarioIds.includes(record.id);
                        return (
                          <li
                            key={record.id}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-1.5",
                              selected ? "bg-muted" : "hover:bg-muted/60",
                            )}
                          >
                            <Checkbox
                              checked={selected}
                              aria-label={`Select ${displayName}`}
                              onCheckedChange={(checked) =>
                                toggleScenarioSelection(record.id, checked === true)
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{displayName}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {ready ? "Ready" : "Draft"} · {updatedLabel}
                              </div>
                            </div>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Load ${displayName}`}
                              onClick={() => void switchScenario(record.id)}
                            >
                              <FolderOpenIcon />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <Button
          variant="outline"
          size="sm"
          className="mt-1.5 shrink-0"
          onClick={() => void switchScenario("__new__")}
        >
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
      </div>

      <Card id="scenario-profile">
        <CardHeader>
          <CardTitle>Operation profile</CardTitle>
          <CardDescription>
            Autosaved to the API
            {draftAutosave.isSaving
              ? " · saving…"
              : draftAutosave.isError
                ? " · save failed"
                : ""}
            .
          </CardDescription>
          <CardAction>
            <Badge variant={validationSuccess ? "secondary" : "outline"}>
              {validationSuccess ? "Ready" : `Draft · ${validationIssues.length}`}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={fieldHasIssue(validationIssues, "name") || undefined}>
              <FieldLabel htmlFor="scenario-name">Scenario name</FieldLabel>
              <Input
                id="scenario-name"
                value={scenario.name}
                onChange={(event) => updateScenario({ name: event.target.value })}
                aria-invalid={fieldHasIssue(validationIssues, "name")}
              />
              {fieldHasIssue(validationIssues, "name") ? (
                <FieldError>
                  {validationIssues.find((issue) => issue.path === "name")?.message ??
                    "Scenario name is invalid."}
                </FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="scenario-description">Brief</FieldLabel>
              <Textarea
                id="scenario-description"
                value={scenario.description}
                onChange={(event) => updateScenario({ description: event.target.value })}
                placeholder="Purpose, location, and operator notes"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={fieldHasIssue(validationIssues, "delaySeconds") || undefined}>
                <FieldLabel htmlFor="scenario-delay-seconds">Delay (seconds)</FieldLabel>
                <Input
                  id="scenario-delay-seconds"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={scenario.delaySeconds ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === "") {
                      updateScenario({ delaySeconds: undefined });
                      return;
                    }
                    const next = Number(raw);
                    if (!Number.isFinite(next) || next < 0) return;
                    updateScenario({ delaySeconds: next === 0 ? undefined : next });
                  }}
                  aria-invalid={fieldHasIssue(validationIssues, "delaySeconds")}
                  aria-describedby="scenario-delay-seconds-hint"
                />
                {fieldHasIssue(validationIssues, "delaySeconds") ? (
                  <FieldError>
                    {validationIssues.find((issue) => issue.path === "delaySeconds")?.message ??
                      "Delay cannot be negative."}
                  </FieldError>
                ) : (
                  <FieldDescription id="scenario-delay-seconds-hint">
                    Offsets when events fire. Authored timeline times stay unchanged. Empty or 0 =
                    none.
                  </FieldDescription>
                )}
              </Field>
              <Field
                data-invalid={
                  fieldHasIssue(validationIssues, "fastForwardMultiplier") || undefined
                }
              >
                <FieldLabel htmlFor="scenario-fast-forward">Fast-forward</FieldLabel>
                <Select
                  value={String(
                    Math.min(
                      10,
                      Math.max(
                        1,
                        Math.round(
                          scenario.fastForwardMultiplier &&
                            scenario.fastForwardMultiplier > 1
                            ? scenario.fastForwardMultiplier
                            : 1,
                        ),
                      ),
                    ),
                  )}
                  onValueChange={(next) => {
                    if (!next) return;
                    const multiplier = Number(next);
                    if (!Number.isFinite(multiplier) || multiplier <= 1) {
                      updateScenario({ fastForwardMultiplier: undefined });
                      return;
                    }
                    updateScenario({ fastForwardMultiplier: multiplier });
                  }}
                >
                  <SelectTrigger
                    id="scenario-fast-forward"
                    className="w-full"
                    aria-invalid={fieldHasIssue(validationIssues, "fastForwardMultiplier")}
                    aria-describedby="scenario-fast-forward-hint"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {FAST_FORWARD_MULTIPLIERS.map((multiplier) => (
                        <SelectItem key={multiplier} value={String(multiplier)}>
                          {multiplier}×
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldHasIssue(validationIssues, "fastForwardMultiplier") ? (
                  <FieldError>
                    {validationIssues.find((issue) => issue.path === "fastForwardMultiplier")
                      ?.message ?? "Fast-forward must be greater than 1 and at most 10."}
                  </FieldError>
                ) : (
                  <FieldDescription id="scenario-fast-forward-hint">
                    Multiplies sim speed from the first event: 1 hour of authored time at 10×
                    fires in 6 minutes. Authored times stay unchanged. 1× = off.
                  </FieldDescription>
                )}
              </Field>
            </div>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="priority-term-input">Priority terms</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="priority-term-input"
                value={priorityInput}
                onChange={(event) => setPriorityInput(event.target.value)}
                placeholder='e.g. "critical" or "proximity threshold"'
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addPriorityTermFromInput();
                  }
                }}
              />
              <Button variant="outline" onClick={addPriorityTermFromInput}>
                Add
              </Button>
            </div>
            <FieldDescription>
              Whole-word and exact-phrase matches are case-insensitive across all message
              events.
            </FieldDescription>
            <div className="mt-2 flex flex-wrap gap-2">
              {scenario.priorityTerms.map((term) => (
                <Badge key={term} variant="secondary" className="gap-1">
                  {term}
                  <button
                    type="button"
                    className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove priority term ${term}`}
                    onClick={() =>
                      updateScenario({
                        priorityTerms: removePriorityTerm(scenario.priorityTerms, term),
                      })
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </Field>
        </CardContent>
      </Card>

      <section className="overflow-hidden rounded-lg border bg-card shadow-sm" aria-labelledby="compose-banner-title">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-foreground px-3.5 py-2.5 text-background">
          <h2 id="compose-banner-title" className="text-xs font-semibold uppercase tracking-[0.08em]">
            Compose
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {!validationSuccess ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-destructive/50 bg-destructive/20 text-red-100 hover:bg-destructive/30 hover:text-red-50"
                      aria-label={`${validationIssues.length} validation errors`}
                    />
                  }
                >
                  <CircleAlertIcon data-icon="inline-start" />
                  {validationIssues.length}{" "}
                  {validationIssues.length === 1 ? "error" : "errors"}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  {(["scenario", "targets", "events"] as const).map((section) => {
                    const issues = groupedIssues[section];
                    if (issues.length === 0) return null;
                    return (
                      <DropdownMenuGroup key={section}>
                        <DropdownMenuLabel className="capitalize">{section}</DropdownMenuLabel>
                        {issues.map((issue) => (
                          <DropdownMenuItem
                            key={`${issue.path}-${issue.message}`}
                            className="items-start"
                            onClick={() => navigateToIssue(issue)}
                          >
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate font-medium">
                                {formatValidationIssueLabel(issue, scenario)}
                              </span>
                              <span className="text-xs text-muted-foreground whitespace-normal">
                                {issue.message}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <span className="text-xs text-background/60">targets + event</span>
          </div>
        </div>
        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)]">
          <div id="targets-section" className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm">Targets</strong>
              <Button variant="outline" size="sm" onClick={addTarget}>
                <PlusIcon data-icon="inline-start" />
                Add target
              </Button>
            </div>

            <div
              className={cn(
                "flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm",
                selectedTarget &&
                  highlightTargetId === selectedTarget.id &&
                  "ring-2 ring-destructive",
                selectedTarget &&
                  selectedTargetIssues.length > 0 &&
                  "border-destructive/40",
              )}
            >
              <div className="border-b border-border pb-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {selectedTarget ? "Edit target" : "Target form"}
                </p>
                {selectedTarget ? (
                  <p className="mt-0.5 truncate text-sm font-medium">{selectedTarget.callsign}</p>
                ) : null}
              </div>
              {selectedTarget ? (
              <FieldGroup className="flex flex-col gap-3">
                <Field
                  data-invalid={
                    selectedTargetIssues.some((issue) => issue.field === "callsign") ||
                    undefined
                  }
                >
                  <FieldLabel htmlFor={`${selectedTarget.id}-callsign`}>Callsign</FieldLabel>
                  <Input
                    id={`${selectedTarget.id}-callsign`}
                    value={selectedTarget.callsign}
                    onChange={(event) =>
                      updateTarget(selectedTarget.id, {
                        callsign: event.target.value.toLocaleUpperCase(),
                      })
                    }
                    aria-invalid={selectedTargetIssues.some(
                      (issue) => issue.field === "callsign",
                    )}
                  />
                  {selectedTargetIssues
                    .filter((issue) => issue.field === "callsign")
                    .map((issue) => (
                      <FieldError key={issue.message}>{issue.message}</FieldError>
                    ))}
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`${selectedTarget.id}-reveal`}
                    checked={selectedTarget.revealOnFirstEvent}
                    onCheckedChange={(checked) =>
                      updateTarget(selectedTarget.id, {
                        revealOnFirstEvent: checked === true,
                        ...(checked === true ? { appearOnFirstEvent: false } : {}),
                      })
                    }
                  />
                  <FieldLabel htmlFor={`${selectedTarget.id}-reveal`}>
                    Reveal on first event
                  </FieldLabel>
                </Field>
                <Field
                  orientation="horizontal"
                  data-invalid={
                    selectedTargetIssues.some((issue) => issue.field === "appearOnFirstEvent") ||
                    undefined
                  }
                >
                  <Checkbox
                    id={`${selectedTarget.id}-appear`}
                    checked={selectedTarget.appearOnFirstEvent}
                    onCheckedChange={(checked) =>
                      updateTarget(selectedTarget.id, {
                        appearOnFirstEvent: checked === true,
                        ...(checked === true ? { revealOnFirstEvent: false } : {}),
                      })
                    }
                    aria-invalid={
                      selectedTargetIssues.some((issue) => issue.field === "appearOnFirstEvent") ||
                      undefined
                    }
                  />
                  <FieldLabel htmlFor={`${selectedTarget.id}-appear`}>
                    Appear on first event
                  </FieldLabel>
                  {selectedTargetIssues
                    .filter((issue) => issue.field === "appearOnFirstEvent")
                    .map((issue) => (
                      <FieldError key={issue.message}>{issue.message}</FieldError>
                    ))}
                </Field>
                <Field
                  data-invalid={
                    selectedTargetIssues.some((issue) => issue.field === "color") || undefined
                  }
                >
                  <FieldLabel id={`${selectedTarget.id}-color-label`}>Color</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={normalizeHex(selectedTarget.color) ?? selectedTarget.color}
                      onValueChange={(value) => {
                        if (!value) return;
                        updateTarget(selectedTarget.id, { color: String(value) });
                      }}
                    >
                      <SelectTrigger
                        className="min-w-[12rem] flex-1"
                        aria-labelledby={`${selectedTarget.id}-color-label`}
                        aria-invalid={
                          selectedTargetIssues.some((issue) => issue.field === "color") || undefined
                        }
                      >
                        <SelectValue placeholder="Choose color">
                          <span className="flex items-center gap-2">
                            <span
                              className="size-3.5 shrink-0 rounded-full border border-border"
                              style={{ backgroundColor: selectedTarget.color }}
                              aria-hidden="true"
                            />
                            {findTargetColorLabel(colorTheme, selectedTarget.color)}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectGroup>
                          {targetColorOptionList(colorTheme, selectedTarget.color).map((option) => {
                            const takenBy = scenario.targets.find(
                              (target) =>
                                target.id !== selectedTarget.id &&
                                normalizeHex(target.color) === option.value,
                            );
                            return (
                              <SelectItem
                                key={option.id}
                                value={option.value}
                                disabled={Boolean(takenBy)}
                              >
                                <span className="flex items-center gap-2">
                                  <span
                                    className="size-3.5 shrink-0 rounded-full border border-border"
                                    style={{ backgroundColor: option.value }}
                                    aria-hidden="true"
                                  />
                                  <span>{option.label}</span>
                                  {takenBy ? (
                                    <span className="text-muted-foreground">
                                      · {takenBy.callsign}
                                    </span>
                                  ) : null}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label="Pick a random unused color"
                      onClick={() => {
                        const otherColors = scenario.targets
                          .filter((target) => target.id !== selectedTarget.id)
                          .map((target) => target.color);
                        const next = randomUnusedTargetColor(otherColors, colorTheme, {
                          preferDifferentFrom: selectedTarget.color,
                        });
                        if (!next) {
                          toast.error("Every palette color is already assigned to a target.");
                          return;
                        }
                        updateTarget(selectedTarget.id, { color: next });
                      }}
                    >
                      <ShuffleIcon data-icon="inline-start" />
                      Random
                    </Button>
                  </div>
                  <FieldDescription>
                    {colorTheme === "light" ? "Light" : "Dark"}-mode palette (AA). Random skips
                    colors already used by other targets.
                  </FieldDescription>
                </Field>
                <Field
                  data-invalid={
                    selectedTargetIssues.some((issue) => issue.field === "maxCruiseKnots") ||
                    undefined
                  }
                >
                  <FieldLabel htmlFor={`${selectedTarget.id}-max-cruise`}>
                    Max cruise (kt)
                  </FieldLabel>
                  <Input
                    id={`${selectedTarget.id}-max-cruise`}
                    type="number"
                    min={0}
                    step={1}
                    placeholder="Profile default"
                    value={selectedTarget.maxCruiseKnots ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      if (raw === "") {
                        updateScenario({
                          targets: scenario.targets.map((target) => {
                            if (target.id !== selectedTarget.id) return target;
                            const { maxCruiseKnots: _cleared, ...rest } = target;
                            return rest;
                          }),
                        });
                        return;
                      }
                      const next = Number(raw);
                      if (!Number.isFinite(next) || next < 0) return;
                      updateTarget(selectedTarget.id, { maxCruiseKnots: next });
                    }}
                    aria-invalid={
                      selectedTargetIssues.some((issue) => issue.field === "maxCruiseKnots") ||
                      undefined
                    }
                  />
                  <FieldDescription>
                    Optional cruise override for route generation. Empty clears.
                  </FieldDescription>
                  {selectedTargetIssues
                    .filter((issue) => issue.field === "maxCruiseKnots")
                    .map((issue) => (
                      <FieldError key={issue.message}>{issue.message}</FieldError>
                    ))}
                </Field>
                <TargetProfileFields
                  idPrefix={selectedTarget.id}
                  profile={selectedTarget.profile}
                  onChange={(profile) => updateTarget(selectedTarget.id, { profile })}
                  invalidFields={selectedInvalidProfileFields}
                />
                {selectedTargetIssues
                  .filter((issue) => issue.field === "color" || issue.field === "id")
                  .map((issue) => (
                    <FieldError key={issue.message}>{issue.message}</FieldError>
                  ))}
              </FieldGroup>
              ) : (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No targets defined. Add a target to begin.
                </p>
              )}
            </div>

            <div className="flex min-h-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Target list
                </p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {scenario.targets.length}
                </span>
              </div>
              {scenario.targets.length > 0 ? (
                <ScrollArea className="h-[min(14rem,28vh)] pr-2">
                  <ul className="flex flex-col gap-1" role="listbox" aria-label="Targets">
                    {scenario.targets.map((target) => {
                      const targetIssues = getIssuesForTarget(
                        validationIssues,
                        target.id,
                        scenario,
                      );
                      const selected = target.id === selectedTargetId;
                      return (
                        <li key={target.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            id={`target-card-${target.id}`}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent bg-card px-2 py-1.5 text-left text-sm outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring",
                              selected && "border-border bg-background shadow-sm",
                              highlightTargetId === target.id && "ring-2 ring-destructive",
                              targetIssues.length > 0 && "border-destructive/40",
                            )}
                            onClick={() => setSelectedTargetId(target.id)}
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: target.color }}
                              aria-hidden="true"
                            />
                            <span className="truncate font-medium">{target.callsign}</span>
                          </button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove ${target.callsign}`}
                            onClick={() => removeTarget(target.id)}
                          >
                            <Trash2Icon />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              ) : (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  Saved targets appear here.
                </p>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border pb-2">
              <strong className="text-sm">Event</strong>
              {eventMode === "manual" ? (
                <Button
                  size="sm"
                  onClick={addEvent}
                  disabled={scenario.targets.length === 0}
                >
                  <PlusIcon data-icon="inline-start" />
                  Add to timeline
                </Button>
              ) : null}
            </div>

            <Field data-disabled={scenario.targets.length === 0 ? true : undefined}>
              <FieldLabel>Target</FieldLabel>
              <Select
                value={draft.targetId}
                onValueChange={(value) => {
                  if (!value || value === draft.targetId) return;
                  selectEventTarget(String(value));
                }}
                disabled={scenario.targets.length === 0}
              >
                <SelectTrigger className="w-full" aria-label="Event target">
                  <SelectValue placeholder="Choose target">
                    {selectedDraftTarget?.callsign ?? "Choose target"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {scenario.targets.map((target) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.callsign}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Tabs
              value={eventMode}
              onValueChange={(value) => {
                if (value === "manual" || value === "automatic" || value === "random") {
                  setEventMode(value);
                }
              }}
              className="gap-3"
            >
              <TabsList className="w-full">
                <TabsTrigger value="manual" className="flex-1">
                  Manual
                </TabsTrigger>
                <TabsTrigger value="automatic" className="flex-1">
                  Automatic
                </TabsTrigger>
                <TabsTrigger value="random" className="flex-1">
                  Random
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="manual"
                keepMounted
                className="flex flex-col gap-3 outline-none"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <Field orientation="horizontal" className="w-auto gap-2">
                    <Switch
                      id="include-position"
                      checked={draft.includePosition}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({ ...current, includePosition: checked }))
                      }
                    />
                    <FieldLabel htmlFor="include-position">Position</FieldLabel>
                  </Field>
                  <Field orientation="horizontal" className="w-auto gap-2">
                    <Switch
                      id="include-message"
                      checked={draft.includeMessage}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({ ...current, includeMessage: checked }))
                      }
                    />
                    <FieldLabel htmlFor="include-message">Message</FieldLabel>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="event-at">Event date and time</FieldLabel>
                  <DateTimePicker
                    id="event-at"
                    value={draft.at}
                    onChange={(at) => setDraft((current) => ({ ...current, at }))}
                  />
                </Field>
                <div
                  className={cn(
                    "flex flex-col gap-3 rounded-lg border p-3",
                    !draft.includePosition && "opacity-50",
                  )}
                  aria-disabled={!draft.includePosition || undefined}
                >
                  <Suspense
                    fallback={
                      <div className="grid h-[min(40vh,22rem)] place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
                        Loading map picker…
                      </div>
                    }
                  >
                    <MapLocationPicker
                      idPrefix="event-position"
                      value={draft.position}
                      onChange={(position) => setDraft((current) => ({ ...current, position }))}
                      existingPoints={draftTargetPositionPoints}
                      previewAt={draft.at}
                      trailColor={selectedDraftTarget?.color}
                      mapClassName="h-[min(40vh,22rem)]"
                      disabled={!draft.includePosition}
                    />
                  </Suspense>
                </div>
                <div
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3",
                    !draft.includeMessage && "opacity-50",
                  )}
                  aria-disabled={!draft.includeMessage || undefined}
                >
                  <FieldLabel htmlFor="event-message">Message</FieldLabel>
                  <Textarea
                    id="event-message"
                    value={draft.message}
                    disabled={!draft.includeMessage}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, message: event.target.value }))
                    }
                    placeholder="Operator note or intelligence message"
                  />
                  {draft.includeMessage && priorityMatches.length > 0 ? (
                    <p className="text-sm text-destructive" role="status">
                      Priority match: {priorityMatches.join(", ")}
                    </p>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="automatic" keepMounted className="outline-none">
                {selectedDraftTarget ? (
                  <GenerateRouteForm
                    key={selectedDraftTarget.id}
                    scenarioId={scenario.id}
                    target={selectedDraftTarget}
                    onGenerate={(events, summary) => {
                      updateScenario({ events: [...scenario.events, ...events] });
                      toast.success(summary);
                    }}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Choose a target to generate a route automatically.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="random" keepMounted className="outline-none">
                {selectedDraftTarget ? (
                  <GenerateRandomRouteForm
                    key={`random-${selectedDraftTarget.id}`}
                    target={selectedDraftTarget}
                    onGeneratedScenario={(generatedScenarioId, summary) => {
                      toast.success(summary);
                      void switchScenario(generatedScenarioId);
                    }}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Choose a target to generate a random region-based route.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-card shadow-sm" aria-labelledby="review-banner-title">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-foreground px-3.5 py-2.5 text-background">
          <h2 id="review-banner-title" className="text-xs font-semibold uppercase tracking-[0.08em]">
            Review
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-background/60">timeline + map / graph preview</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background"
              onClick={save}
            >
              <SaveIcon data-icon="inline-start" />
              Save
            </Button>
            <Button
              size="sm"
              className="h-7 bg-background text-foreground hover:bg-background/90"
              onClick={beginSimulation}
              disabled={!validationSuccess || isStarting}
            >
              <PlayIcon data-icon="inline-start" />
              {isStarting ? "Starting…" : "Start simulation"}
            </Button>
          </div>
        </div>
        <div className="grid items-start gap-3 p-3 xl:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)]">
          <div id="events-section" className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border pb-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-sm">Grouped timeline</strong>
                <span className="text-xs text-muted-foreground">
                  {scenario.events.length} scheduled ingest events
                </span>
              </div>
              <ToggleGroup
                value={[timelineMode]}
                onValueChange={(values) => {
                  const next = values[0];
                  if (next === "view" || next === "edit") setTimelineMode(next);
                }}
                variant="outline"
                size="sm"
                spacing={0}
                aria-label="Timeline mode"
              >
                <ToggleGroupItem value="view" aria-label="View timeline">
                  View
                </ToggleGroupItem>
                <ToggleGroupItem value="edit" aria-label="Edit timeline">
                  Edit
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {scenario.targets.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Add targets to build a grouped timeline.
              </p>
            ) : (
              <GroupedTimeline
                scenario={scenario}
                eventsByTarget={eventsByTarget}
                mode={timelineMode}
                isExpanded={isTimelineExpanded}
                onOpenChange={(targetId, open) => {
                  setOpenTimelineIds((current) => ({ ...current, [targetId]: open }));
                }}
                onExpandAll={() => setAllTimelineExpanded(true)}
                onCollapseAll={() => setAllTimelineExpanded(false)}
                previewGraphTargetId={previewGraphTargetId}
                onSelectGraphTarget={setPreviewGraphTargetId}
                validationIssues={validationIssues}
                highlightEventId={highlightEventId}
                onUpdateEvent={updateEvent}
                onDeleteEvent={removeEvent}
              />
            )}
            <div className="flex flex-wrap gap-1.5 border-t border-dashed border-border pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!validationSuccess}
                onClick={() => {
                  const issues = applyValidation(scenario);
                  if (issues.length > 0) {
                    toast.error("Resolve validation issues before exporting.");
                    return;
                  }
                  downloadScenario(scenario);
                }}
              >
                <DownloadIcon data-icon="inline-start" />
                Export
              </Button>
              <EventMessageExportDialog scenario={scenario} disabled={!validationSuccess} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border pb-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-sm">Build preview</strong>
                <span className="text-xs text-muted-foreground">
                  {previewViewMode === "graph" && previewGraphTarget
                    ? `Event graph · ${previewGraphTarget.callsign}`
                    : "Accelerated local playback only"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {previewViewMode === "map" ? (
                  <Field orientation="horizontal" className="mr-1 w-auto gap-2">
                    <Switch
                      id="show-review-event-points"
                      checked={showReviewEventPoints}
                      onCheckedChange={setShowReviewEventPoints}
                    />
                    <FieldLabel htmlFor="show-review-event-points" className="text-xs font-normal">
                      Event dots
                    </FieldLabel>
                  </Field>
                ) : null}
                <ToggleGroup
                  value={[previewViewMode]}
                  onValueChange={(values) => {
                    const next = values[0];
                    if (next === "map" || next === "graph") setPreviewViewMode(next);
                  }}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-label="Preview view mode"
                >
                  <ToggleGroupItem value="map" aria-label="Map preview">
                    <MapIcon data-icon="inline-start" />
                    Map
                  </ToggleGroupItem>
                  <ToggleGroupItem value="graph" aria-label="Graph preview">
                    <WaypointsIcon data-icon="inline-start" />
                    Graph
                  </ToggleGroupItem>
                </ToggleGroup>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => (preview.playing ? preview.pause() : preview.play())}
                >
                  {preview.playing ? (
                    <>
                      <PauseIcon data-icon="inline-start" />
                      Pause
                    </>
                  ) : (
                    <>
                      <PlayIcon data-icon="inline-start" />
                      Play
                    </>
                  )}
                </Button>
                <Button size="sm" variant="outline" className="h-7" onClick={preview.reset}>
                  Reset
                </Button>
                <ToggleGroup
                  value={[String(preview.speed)]}
                  onValueChange={(values) => {
                    const next = Number(values[0]);
                    if (PREVIEW_SPEEDS.includes(next as (typeof PREVIEW_SPEEDS)[number])) {
                      preview.setSpeed(next as (typeof PREVIEW_SPEEDS)[number]);
                    }
                  }}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-label="Preview playback speed"
                >
                  {PREVIEW_SPEEDS.map((value) => (
                    <ToggleGroupItem key={value} value={String(value)} aria-label={`${value}x speed`}>
                      {value}×
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
            {preview.previewRange ? (
              <Field>
                <FieldLabel htmlFor="preview-time-slider">Preview timeline</FieldLabel>
                <input
                  id="preview-time-slider"
                  type="range"
                  className="h-2 w-full cursor-pointer accent-primary"
                  min={preview.previewRange.startMs}
                  max={preview.previewRange.endMs}
                  step={Math.max(
                    1,
                    Math.floor(
                      (preview.previewRange.endMs - preview.previewRange.startMs) / 500,
                    ),
                  )}
                  value={Math.min(
                    Math.max(preview.previewTimeMs, preview.previewRange.startMs),
                    preview.previewRange.endMs,
                  )}
                  onChange={(event) => preview.seek(Number(event.target.value))}
                  aria-valuetext={new Date(preview.previewTimeMs).toLocaleString()}
                />
                <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground">
                  <span>{new Date(preview.previewRange.startMs).toLocaleString()}</span>
                  <span>{new Date(preview.previewTimeMs).toLocaleString()}</span>
                  <span>{new Date(preview.previewRange.endMs).toLocaleString()}</span>
                </div>
              </Field>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add events to enable preview scrubbing.
              </p>
            )}
            {preview.currentEvent ? (
              <p className={cn("rounded-md border px-2.5 py-1.5 text-sm", "border-primary/40")}>
                Current: {describePreviewEvent(preview.currentEvent)}
              </p>
            ) : null}
            <div className="h-[min(58vh,34rem)] min-h-80">
              {previewViewMode === "graph" ? (
                previewGraphTarget ? (
                  <Suspense
                    fallback={
                      <div className="grid h-full place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
                        Initializing event graph…
                      </div>
                    }
                  >
                    <PreviewEventGraph
                      target={previewGraphTarget}
                      events={eventsByTarget.get(previewGraphTarget.id) ?? []}
                      currentEventId={graphCurrentEventId}
                      priorityTerms={scenario.priorityTerms}
                      fitKey={`${preview.previewRevision}:${previewGraphTarget.id}`}
                      onEventSelect={(eventId, at) => {
                        setHighlightEventId(eventId);
                        preview.seek(Date.parse(at));
                      }}
                    />
                  </Suspense>
                ) : (
                  <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-muted/40 px-4 text-center text-sm text-muted-foreground">
                    Add a target to view its event graph.
                  </div>
                )
              ) : (
                <Suspense
                  fallback={
                    <div className="grid h-full place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
                      Initializing preview map…
                    </div>
                  }
                >
                  <TrackingMap
                    targets={preview.mapTargets}
                    eventPoints={showReviewEventPoints ? reviewEventPoints : []}
                    highlightedEventId={
                      showReviewEventPoints ? (highlightEventId ?? undefined) : undefined
                    }
                    onEventPointClick={
                      showReviewEventPoints
                        ? (eventId) => {
                            const event = scenario.events.find((item) => item.id === eventId);
                            if (!event) return;
                            setOpenTimelineIds((current) => ({
                              ...current,
                              [event.targetId]: true,
                            }));
                            setHighlightEventId(eventId);
                          }
                        : undefined
                    }
                    mode="2d"
                    cameraMode={cameraMode}
                    continuousMotion
                    onCameraModeChange={(mode) => {
                      if (mode === "overview" || mode === "pan") setCameraMode(mode);
                    }}
                    availableCameraModes={["overview", "pan"]}
                    fitTargetsKey={preview.previewRevision}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
