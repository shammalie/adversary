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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@adversary/ui/components/collapsible";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@adversary/ui/components/field";
import { Input } from "@adversary/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@adversary/ui/components/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@adversary/ui/components/select";
import { Textarea } from "@adversary/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@adversary/ui/components/toggle-group";
import { ScrollArea } from "@adversary/ui/components/scroll-area";
import { cn } from "@adversary/ui/lib/utils";
import { toast } from "sonner";
import {
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  DownloadIcon,
  FolderOpenIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RadarIcon,
  RadioIcon,
  RouteIcon,
  SaveIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import Loader from "@/components/loader";

import { DateTimePicker } from "@/components/date-time-picker";
import {
  EditTimelineEvent,
  ViewTimelineEvent,
} from "@/components/grouped-timeline-event";
import { GenerateRouteDialog } from "@/components/generate-route-dialog";
import { useSimulation } from "@/components/simulation-provider";
import {
  createDemoScenario,
  defaultTargetProfile,
  type DemoVehicleSelection,
} from "@/lib/demo-scenario";
import { createEventDraft, eventFromDraft } from "@/lib/event-draft";
import { derivePositionSnapshot } from "@/lib/position-telemetry";
import { addPriorityTerm, matchPriorityTerms, removePriorityTerm } from "@/lib/priority-terms";
import { sortEvents } from "@/lib/simulation-engine";
import {
  coerceEditableScenario,
  deleteScenario,
  downloadScenario,
  listScenarios,
  saveScenarioDraft,
  upsertValidScenario,
  type StoredScenarioRecord,
} from "@/lib/simulation-storage";
import {
  fieldHasIssue,
  formatValidationIssueLabel,
  getIssuesForEvent,
  getIssuesForTarget,
  getScenarioValidationIssues,
  getValidationIssueFocusId,
  groupValidationIssues,
  type ValidationIssue,
} from "@/lib/scenario-validation-ui";
import { validateScenario } from "@/lib/simulation-schema";
import { PREVIEW_SPEEDS, describePreviewEvent, useBuilderPreview } from "@/lib/use-builder-preview";
import { VEHICLE_CATEGORIES } from "@/types/target";
import type {
  Affiliation,
  PositionPayload,
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

const TARGET_COLORS = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#fb7185"];

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
  const { runtime, start } = useSimulation();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<StoredScenarioRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<SimulationScenario>(() => blankScenario());
  const [draft, setDraft] = useState(() => createEventDraft());
  const [priorityInput, setPriorityInput] = useState("");
  const [routeTargetId, setRouteTargetId] = useState<string | null>(null);
  const [timelineMode, setTimelineMode] = useState<"view" | "edit">("view");
  const [cameraMode, setCameraMode] = useState<"overview" | "pan">("overview");
  const [highlightTargetId, setHighlightTargetId] = useState<string | null>(null);
  const [highlightEventId, setHighlightEventId] = useState<string | null>(null);
  const [openTargetIds, setOpenTargetIds] = useState<Record<string, boolean>>({});
  const [openTimelineIds, setOpenTimelineIds] = useState<Record<string, boolean>>({});
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [storedScenariosOpen, setStoredScenariosOpen] = useState(false);

  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
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
  const priorityMatches = draft.includeMessage
    ? matchPriorityTerms(draft.message, scenario.priorityTerms)
    : [];

  const eventsByTarget = useMemo(() => {
    const grouped = new Map<string, SimulationEvent[]>();
    for (const target of scenario.targets) grouped.set(target.id, []);
    for (const event of sortEvents(scenario.events)) {
      grouped.get(event.targetId)?.push(event);
    }
    return grouped;
  }, [scenario.events, scenario.targets]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialScenario() {
      setLoading(true);
      try {
        const stored = await listScenarios();
        if (cancelled) return;

        setRecords(stored);
        const selected =
          (scenarioId ? stored.find((record) => record.id === scenarioId) : undefined) ??
          stored[0];

        if (selected) {
          setActiveRecordId(selected.id);
          const nextScenario = coerceEditableScenario(selected.payload, selected.id);
          setScenario(nextScenario);
          setDraft(createEventDraft(nextScenario.targets[0]?.id));
          setValidationIssues(getScenarioValidationIssues(nextScenario));
        } else {
          const blank = blankScenario();
          const record = await saveScenarioDraft(blank);
          setActiveRecordId(record.id);
          setScenario(blank);
          setDraft(createEventDraft());
          setValidationIssues(getScenarioValidationIssues(blank));
          setRecords(await listScenarios());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialScenario();
    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  function applyValidation(nextScenario: SimulationScenario) {
    const issues = getScenarioValidationIssues(nextScenario);
    setValidationIssues(issues);
    return issues;
  }

  function updateScenario(patch: Partial<SimulationScenario>) {
    setScenario((current) => ({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
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
          color: TARGET_COLORS[index % TARGET_COLORS.length] ?? "#22d3ee",
          profile: defaultTargetProfile(),
        },
      ],
    });
    setDraft((current) => ({ ...current, targetId: current.targetId || targetId }));
  }

  function removeTarget(targetId: string) {
    updateScenario({
      targets: scenario.targets.filter((target) => target.id !== targetId),
      events: scenario.events.filter((event) => event.targetId !== targetId),
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
      events: sortEvents([...scenario.events, nextEvent]),
    });
    setDraft(createEventDraft(draft.targetId));
  }

  function save() {
    void (async () => {
      const issues = applyValidation(scenario);
      const record = await saveScenarioDraft(scenario);
      setActiveRecordId(record.id);
      setRecords(await listScenarios());
      if (issues.length === 0) {
        toast.success("Scenario saved locally.");
        return;
      }
      toast.error(
        `Saved draft with ${issues.length} validation ${issues.length === 1 ? "error" : "errors"}.`,
      );
    })();
  }

  async function switchScenario(nextRecordId: string) {
    if (nextRecordId === activeRecordId) return;

    if (activeRecordId) {
      await saveScenarioDraft(scenario);
    }

    if (nextRecordId === "__new__") {
      const blank = blankScenario();
      await saveScenarioDraft(blank);
      setActiveRecordId(blank.id);
      setScenario(blank);
      setDraft(createEventDraft());
      setValidationIssues(getScenarioValidationIssues(blank));
      setRecords(await listScenarios());
      void navigate({ to: "/builder", search: { scenarioId: blank.id } });
      return;
    }

    const nextRecord = records.find((record) => record.id === nextRecordId);
    if (!nextRecord) return;

    const nextScenario = coerceEditableScenario(nextRecord.payload, nextRecord.id);
    setActiveRecordId(nextRecord.id);
    setScenario(nextScenario);
    setDraft(createEventDraft(nextScenario.targets[0]?.id));
    setValidationIssues(getScenarioValidationIssues(nextScenario));
    void navigate({ to: "/builder", search: { scenarioId: nextRecord.id } });
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
        ? `Delete “${labels[0]}” from this browser? This cannot be undone.`
        : `Delete ${labels.length} saved scenarios from this browser? This cannot be undone.`;
    if (!window.confirm(confirmLabel)) return;

    await Promise.all(deletableIds.map((id) => deleteScenario(id)));
    setSelectedScenarioIds((current) => current.filter((id) => !deletableIds.includes(id)));
    setRecords(await listScenarios());
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

  function loadRandomDemo(vehicleSelection: DemoVehicleSelection) {
    const demo = createDemoScenario(Date.now(), Math.random, { vehicleSelection });
    setScenario(demo);
    setDraft(createEventDraft(demo.targets[0]?.id));
    setValidationIssues(getScenarioValidationIssues(demo));
    toast.success(
      `Loaded ${demo.targets.length} ${vehicleSelection === "random" ? "mixed" : vehicleSelection} target${demo.targets.length === 1 ? "" : "s"}.`,
    );
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
      await upsertValidScenario(scenario);
      start(scenario);
      await navigate({ to: "/operations" });
    })();
  }

  function isTargetExpanded(targetId: string) {
    if (targetId in openTargetIds) return openTargetIds[targetId]!;
    return scenario.targets.length <= 2;
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
        setOpenTargetIds((current) => ({ ...current, [target.id]: true }));
        setHighlightTargetId(target.id);
        document
          .getElementById(`target-card-${target.id}`)
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

  const routeTarget = scenario.targets.find((target) => target.id === routeTargetId);

  function updateEvent(next: SimulationEvent) {
    updateScenario({
      events: sortEvents(
        scenario.events.map((event) => (event.id === next.id ? next : event)),
      ),
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
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-3 sm:p-5 lg:p-7">
      <section className="flex flex-col justify-between gap-4 border-b border-border/70 pb-5 md:flex-row md:items-end">
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-primary">
            <RadarIcon className="size-4" aria-hidden="true" />
            Scenario authoring
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simulation builder</h1>
          <p className="text-sm text-muted-foreground">
            Define contacts, schedule unified events, preview routes locally, then hand off to live
            operations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!validationSuccess ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <SparklesIcon data-icon="inline-start" />
              Load random demo
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Vehicle type</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => loadRandomDemo("random")}
                >
                  Random
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {VEHICLE_CATEGORIES.map((category) => (
                  <DropdownMenuItem
                    key={category}
                    className="capitalize"
                    onClick={() => loadRandomDemo(category)}
                  >
                    {category}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {runtime?.status === "running" ? (
            <Button variant="secondary" render={<Link to="/operations" />}>
              <RadioIcon data-icon="inline-start" />
              View live simulation
            </Button>
          ) : null}
          <Button onClick={beginSimulation} disabled={!validationSuccess}>
            <PlayIcon data-icon="inline-start" />
            Start simulation
          </Button>
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
                        const ready = validateScenario(record.payload).success;
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-4">
          <Card id="scenario-profile">
            <CardHeader>
              <CardTitle>Operation profile</CardTitle>
              <CardDescription>Stored only in this browser unless exported.</CardDescription>
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

          <Card id="targets-section">
            <CardHeader>
              <CardTitle>Target definitions</CardTitle>
              <CardDescription>
                Full profiles are stored up front and optionally masked until the first event.
              </CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={addTarget}>
                  <PlusIcon data-icon="inline-start" />
                  Add target
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {scenario.targets.length === 0 ? (
                <p className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                  No targets defined.
                </p>
              ) : (
                <ScrollArea className="h-[min(28rem,50vh)] pr-3">
                  <div className="flex flex-col gap-3">
                    {scenario.targets.map((target) => {
                      const targetIssues = getIssuesForTarget(validationIssues, target.id, scenario);
                      const invalidProfileFields = targetIssues
                        .map((issue) => issue.field ?? "")
                        .filter((field) => field.startsWith("profile."));
                      return (
                        <Collapsible
                          key={target.id}
                          open={isTargetExpanded(target.id)}
                          onOpenChange={(open) =>
                            setOpenTargetIds((current) => ({ ...current, [target.id]: open }))
                          }
                        >
                          <div
                            id={`target-card-${target.id}`}
                            className={cn(
                              "rounded-lg border bg-muted/20",
                              highlightTargetId === target.id && "ring-2 ring-destructive",
                              targetIssues.length > 0 && "border-destructive/40",
                            )}
                          >
                            <div className="flex items-center gap-2 px-3 py-2">
                              <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: target.color }}
                                aria-hidden="true"
                              />
                              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span className="truncate text-sm font-medium">{target.callsign}</span>
                                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
                              </CollapsibleTrigger>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove ${target.callsign}`}
                                onClick={() => removeTarget(target.id)}
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                            <CollapsibleContent className="border-t px-3 py-3">
                              <FieldGroup className="flex flex-col gap-3">
                                <Field
                                  data-invalid={
                                    targetIssues.some((issue) => issue.field === "callsign") ||
                                    undefined
                                  }
                                >
                                  <FieldLabel htmlFor={`${target.id}-callsign`}>Callsign</FieldLabel>
                                  <Input
                                    id={`${target.id}-callsign`}
                                    value={target.callsign}
                                    onChange={(event) =>
                                      updateTarget(target.id, {
                                        callsign: event.target.value.toLocaleUpperCase(),
                                      })
                                    }
                                    aria-invalid={targetIssues.some(
                                      (issue) => issue.field === "callsign",
                                    )}
                                  />
                                  {targetIssues
                                    .filter((issue) => issue.field === "callsign")
                                    .map((issue) => (
                                      <FieldError key={issue.message}>{issue.message}</FieldError>
                                    ))}
                                </Field>
                                <Field orientation="horizontal">
                                  <Checkbox
                                    id={`${target.id}-reveal`}
                                    checked={target.revealOnFirstEvent}
                                    onCheckedChange={(checked) =>
                                      updateTarget(target.id, {
                                        revealOnFirstEvent: checked === true,
                                      })
                                    }
                                  />
                                  <FieldLabel htmlFor={`${target.id}-reveal`}>
                                    Reveal on first event
                                  </FieldLabel>
                                </Field>
                                <TargetProfileFields
                                  idPrefix={target.id}
                                  profile={target.profile}
                                  onChange={(profile) => updateTarget(target.id, { profile })}
                                  invalidFields={invalidProfileFields}
                                />
                                {targetIssues
                                  .filter((issue) => issue.field === "color" || issue.field === "id")
                                  .map((issue) => (
                                    <FieldError key={issue.message}>{issue.message}</FieldError>
                                  ))}
                              </FieldGroup>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Schedule event</CardTitle>
            <CardDescription>
              Events may include position data, a message, or both. Priority is derived from
              scenario terms.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field data-disabled={scenario.targets.length === 0 ? true : undefined}>
                <FieldLabel>Target</FieldLabel>
                <Select
                  value={draft.targetId}
                  onValueChange={(value) =>
                    value && setDraft((current) => ({ ...current, targetId: String(value) }))
                  }
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
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="event-at">Event date and time</FieldLabel>
                <DateTimePicker
                  id="event-at"
                  value={draft.at}
                  onChange={(at) => setDraft((current) => ({ ...current, at }))}
                />
              </Field>
            </FieldGroup>

            <div className="flex flex-col gap-4 rounded-lg border p-4">
              <Field orientation="horizontal">
                <Checkbox
                  id="include-position"
                  checked={draft.includePosition}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, includePosition: checked === true }))
                  }
                />
                <FieldLabel htmlFor="include-position">Position</FieldLabel>
              </Field>
              {draft.includePosition ? (
                <Suspense
                  fallback={
                    <div className="grid h-56 place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
                      Loading map picker…
                    </div>
                  }
                >
                  <MapLocationPicker
                    idPrefix="event-position"
                    value={draft.position}
                    onChange={(position) => setDraft((current) => ({ ...current, position }))}
                  />
                </Suspense>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <Field orientation="horizontal">
                <Checkbox
                  id="include-message"
                  checked={draft.includeMessage}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, includeMessage: checked === true }))
                  }
                />
                <FieldLabel htmlFor="include-message">Message</FieldLabel>
              </Field>
              {draft.includeMessage ? (
                <>
                  <Textarea
                    id="event-message"
                    value={draft.message}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, message: event.target.value }))
                    }
                    placeholder="Operator note or intelligence message"
                  />
                  {priorityMatches.length > 0 ? (
                    <p className="text-sm text-destructive" role="status">
                      Priority match: {priorityMatches.join(", ")}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>

            <Button onClick={addEvent} disabled={scenario.targets.length === 0}>
              <PlusIcon data-icon="inline-start" />
              Add to timeline
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card id="events-section">
          <CardHeader>
            <CardTitle>Grouped timeline</CardTitle>
            <CardDescription>{scenario.events.length} scheduled ingest events</CardDescription>
            <CardAction className="flex flex-wrap items-center gap-2">
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
              <Button variant="outline" size="sm" onClick={save}>
                <SaveIcon data-icon="inline-start" />
                Save
              </Button>
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
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {scenario.targets.length === 0 ? (
              <p className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                Add targets to build a grouped timeline.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllTimelineExpanded(true)}
                  >
                    <ChevronsUpDownIcon data-icon="inline-start" />
                    Expand all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAllTimelineExpanded(false)}
                  >
                    <ChevronsDownUpIcon data-icon="inline-start" />
                    Collapse all
                  </Button>
                </div>
                <ScrollArea className="h-[min(28rem,50vh)] pr-3">
                  <div className="flex flex-col gap-3">
                    {scenario.targets.map((target) => {
                      const events = eventsByTarget.get(target.id) ?? [];
                      const firstAt = events[0]?.at;
                      const lastAt = events.at(-1)?.at;
                      let previousPosition: PositionPayload | undefined;
                      return (
                        <Collapsible
                          key={target.id}
                          open={isTimelineExpanded(target.id)}
                          onOpenChange={(open) =>
                            setOpenTimelineIds((current) => ({ ...current, [target.id]: open }))
                          }
                        >
                          <div className="rounded-lg border">
                            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b bg-card/95 px-3 py-2 backdrop-blur-md">
                              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span
                                  className="size-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: target.color }}
                                  aria-hidden="true"
                                />
                                <span className="truncate font-medium">{target.callsign}</span>
                                <Badge variant="outline">{events.length} events</Badge>
                                <ChevronDownIcon className="size-4 text-muted-foreground" />
                              </CollapsibleTrigger>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRouteTargetId(target.id)}
                              >
                                <RouteIcon data-icon="inline-start" />
                                Generate route
                              </Button>
                            </div>
                            <CollapsibleContent>
                              <p className="px-3 py-2 text-xs text-muted-foreground">
                                {firstAt && lastAt
                                  ? `${new Date(firstAt).toLocaleString()} – ${new Date(lastAt).toLocaleString()}`
                                  : "No events scheduled"}
                              </p>
                              <ul
                                className={cn(
                                  "flex flex-col px-2 pb-2",
                                  timelineMode === "edit" ? "gap-2" : "gap-1",
                                )}
                              >
                                {events.map((event) => {
                                  const eventIssues = getIssuesForEvent(
                                    validationIssues,
                                    event.id,
                                    scenario,
                                  );
                                  const summary = describeEvent(
                                    event,
                                    previousPosition,
                                    target.profile.vehicleCategory,
                                  );
                                  if (event.position) previousPosition = event.position;
                                  if (timelineMode === "edit") {
                                    return (
                                      <EditTimelineEvent
                                        key={event.id}
                                        event={event}
                                        callsign={target.callsign}
                                        priorityTerms={scenario.priorityTerms}
                                        issues={eventIssues}
                                        highlighted={highlightEventId === event.id}
                                        onChange={updateEvent}
                                        onDelete={() => removeEvent(event.id)}
                                      />
                                    );
                                  }
                                  return (
                                    <ViewTimelineEvent
                                      key={event.id}
                                      event={event}
                                      callsign={target.callsign}
                                      summary={summary}
                                      issues={eventIssues}
                                      highlighted={highlightEventId === event.id}
                                      onDelete={() => removeEvent(event.id)}
                                    />
                                  );
                                })}
                              </ul>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Builder preview</CardTitle>
            <CardDescription>
              Accelerated local playback only. Live operations remain real-time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
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
              <Button size="sm" variant="outline" onClick={preview.reset}>
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
                <div className="flex items-center justify-between gap-3 font-mono text-xs text-muted-foreground">
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
              <p className={cn("rounded-lg border px-3 py-2 text-sm", "border-primary/40")}>
                Current: {describePreviewEvent(preview.currentEvent)}
              </p>
            ) : null}
            <div className="h-[min(42vh,24rem)]">
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
                    Initializing preview map…
                  </div>
                }
              >
                <TrackingMap
                  targets={preview.mapTargets}
                  highlightedEventId={preview.currentEvent?.id}
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
            </div>
          </CardContent>
        </Card>
      </div>

      {routeTarget ? (
        <GenerateRouteDialog
          target={routeTarget}
          open={Boolean(routeTargetId)}
          onOpenChange={(open) => {
            if (!open) setRouteTargetId(null);
          }}
          onGenerate={(events, summary) => {
            updateScenario({ events: sortEvents([...scenario.events, ...events]) });
            toast.success(summary);
            setRouteTargetId(null);
          }}
        />
      ) : null}
    </main>
  );
}
