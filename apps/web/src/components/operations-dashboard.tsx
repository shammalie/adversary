import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
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
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@adversary/ui/components/command";
import { ScrollArea } from "@adversary/ui/components/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@adversary/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@adversary/ui/components/toggle-group";
import { cn } from "@adversary/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CircleDotIcon,
  Clock3Icon,
  CommandIcon,
  FocusIcon,
  Globe2Icon,
  MapIcon,
  MapPinIcon,
  MessageSquareIcon,
  RadioTowerIcon,
  RotateCcwIcon,
  SquareTerminalIcon,
  UsersIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { useSimulation } from "@/components/simulation-provider";
import type { CameraMode } from "@/components/tracking-map";
import { isPriorityMessage, matchPriorityTerms } from "@/lib/priority-terms";
import { getVehicleCategoryIcon } from "@/lib/vehicle-icon";
import type { MapMode, RuntimeTargetState, SimulationEvent } from "@/types/target";

const TrackingMap = lazy(() =>
  import("@/components/tracking-map").then((module) => ({ default: module.TrackingMap })),
);

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

function TargetRoster({
  targets,
  selectedId,
  trackedIds,
  onSelect,
  onToggleTrack,
}: {
  targets: RuntimeTargetState[];
  selectedId?: string;
  trackedIds: string[];
  onSelect: (id: string) => void;
  onToggleTrack: (id: string, tracked: boolean) => void;
}) {
  const trackedSet = new Set(trackedIds);

  return (
    <ScrollArea className="h-[20rem]">
      <div className="flex flex-col gap-1 p-1">
        {targets.map((target) => {
          const Icon = getVehicleCategoryIcon(target.profile.vehicleCategory);
          const isTracked = trackedSet.has(target.targetId);
          return (
            <div
              key={target.targetId}
              className={cn(
                "flex min-h-12 w-full items-center gap-2 rounded-lg px-2 py-2 transition-colors",
                selectedId === target.targetId && "bg-accent text-accent-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(target.targetId)}
                aria-pressed={selectedId === target.targetId}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-md border bg-background"
                  style={{ color: target.color }}
                >
                  <Icon aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{target.callsign}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {target.revealed
                      ? (target.profile.vehicleSubtype ??
                        target.profile.vehicleCategory ??
                        "Unclassified contact")
                      : "Masked contact"}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[0.68rem] uppercase tracking-wider text-muted-foreground">
                  <CircleDotIcon className="size-3" aria-hidden="true" />
                  {target.revealed ? (target.profile.status ?? "unknown") : "unknown"}
                </span>
              </button>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pr-1 text-xs text-muted-foreground">
                <Checkbox
                  checked={isTracked}
                  onCheckedChange={(checked) => {
                    onToggleTrack(target.targetId, checked === true);
                  }}
                  aria-label={`Track ${target.callsign}`}
                />
                Track
              </label>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function TrackedTargetCard({ target }: { target: RuntimeTargetState }) {
  const Icon = getVehicleCategoryIcon(target.profile.vehicleCategory);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md border" style={{ color: target.color }}>
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          {target.callsign}
        </CardTitle>
        <CardDescription>
          {target.revealed
            ? (target.profile.vehicleSubtype ?? target.profile.vehicleCategory ?? "Contact")
            : "Masked contact"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
          {[
            [
              "Category",
              target.revealed ? (target.profile.vehicleCategory ?? "Unknown") : "Masked",
            ],
            [
              "Subtype",
              target.revealed ? (target.profile.vehicleSubtype ?? "Unresolved") : "Masked",
            ],
            [
              "Affiliation",
              target.revealed ? (target.profile.affiliation ?? "Unknown") : "Masked",
            ],
            ["Status", target.revealed ? (target.profile.status ?? "Unknown") : "Masked"],
            ["Speed", target.position ? `${target.position.speed} kt` : "—"],
            ["Heading", target.position ? `${target.position.heading}°` : "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 capitalize">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function OperationsDashboard() {
  const navigate = useNavigate();
  const { runtime, stop, reset, reconcile } = useSimulation();
  const [now, setNow] = useState(() => new Date());
  const [mapMode, setMapMode] = useState<MapMode>("2d");
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [trackedTargetIds, setTrackedTargetIds] = useState<string[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();

  const targets = useMemo(() => (runtime ? Object.values(runtime.targetStates) : []), [runtime]);
  const selectedTarget =
    targets.find((target) => target.targetId === selectedTargetId) ?? targets[0];
  const trackedTargets = useMemo(
    () =>
      trackedTargetIds
        .map((id) => targets.find((target) => target.targetId === id))
        .filter((target): target is RuntimeTargetState => Boolean(target)),
    [targets, trackedTargetIds],
  );
  const priorityTerms = runtime?.scenario.priorityTerms ?? [];
  const messageEvents = runtime?.ingestedEvents.filter((event) => event.message) ?? [];
  const latestCritical = runtime?.ingestedEvents
    .toReversed()
    .find((event) => event.message && isPriorityMessage(event.message, priorityTerms));

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedTargetId && targets[0]) setSelectedTargetId(targets[0].targetId);
  }, [selectedTargetId, targets]);

  useEffect(() => {
    if (cameraMode === "track" && trackedTargetIds.length === 0) {
      setCameraMode("overview");
    }
  }, [cameraMode, trackedTargetIds.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.shiftKey && event.key.toLocaleLowerCase() === "m") {
        setMapMode((current) => (current === "2d" ? "globe" : "2d"));
      }
      if (event.shiftKey && event.key.toLocaleLowerCase() === "s") stop();
      if (event.shiftKey && event.key.toLocaleLowerCase() === "r") {
        reset();
        void navigate({ to: "/builder" });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, reset, stop]);

  function handleCameraModeChange(mode: CameraMode) {
    if (mode === "track" && trackedTargetIds.length === 0) return;
    setCameraMode(mode);
  }

  function handleToggleTrack(id: string, tracked: boolean) {
    setTrackedTargetIds((current) => {
      if (tracked) {
        if (current.includes(id)) return current;
        return [...current, id];
      }
      return current.filter((targetId) => targetId !== id);
    });
    if (tracked) setSelectedTargetId(id);
  }

  if (!runtime) {
    return (
      <main className="grid min-h-full place-items-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>No active simulation</CardTitle>
            <CardDescription>
              Use Settings → Import simulation to upload a scenario, or open the simulation builder
              to author one. Start it from the builder before returning here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Button render={<Link to="/import" />}>Import simulation</Button>
            <Button variant="outline" render={<Link to="/builder" />}>
              Open simulation builder
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-col gap-3 p-2 sm:p-3 lg:p-4">
      <section className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-[1.3fr_repeat(2,1fr)_auto]">
        <div className="flex min-h-16 items-center gap-3 bg-card/75 px-4 py-3 backdrop-blur-md">
          <span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
            <RadioTowerIcon aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{runtime.scenario.name}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  runtime.status === "running"
                    ? "bg-emerald-400 operational-pulse"
                    : "bg-muted-foreground",
                )}
              />
              {runtime.status.toLocaleUpperCase()}
            </div>
          </div>
        </div>
        <div className="flex min-h-16 items-center gap-3 bg-card/75 px-4 py-3 backdrop-blur-md">
          <Clock3Icon className="text-muted-foreground" aria-hidden="true" />
          <div>
            <div className="font-mono text-sm tabular-nums">{now.toLocaleTimeString()}</div>
            <div className="text-xs text-muted-foreground">{now.toLocaleDateString()}</div>
          </div>
        </div>
        <div className="flex min-h-16 items-center gap-3 bg-card/75 px-4 py-3 backdrop-blur-md">
          <UsersIcon className="text-muted-foreground" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium">{targets.length} tracked</div>
            <div className="text-xs text-muted-foreground">Active roster</div>
          </div>
        </div>
        <div className="flex min-h-16 items-center justify-between gap-2 bg-card/75 px-3 py-2 backdrop-blur-md sm:col-span-2 lg:col-span-1">
          <ToggleGroup
            value={[mapMode]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "2d" || next === "globe") setMapMode(next);
            }}
            variant="outline"
            spacing={0}
            aria-label="Map representation"
          >
            <ToggleGroupItem value="2d" aria-label="2D map">
              <MapIcon />
              2D
            </ToggleGroupItem>
            <ToggleGroupItem value="globe" aria-label="3D globe">
              <Globe2Icon />
              3D
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Open simulation commands"
            onClick={() => setCommandOpen(true)}
          >
            <CommandIcon />
          </Button>
        </div>
      </section>

      {latestCritical?.message ? (
        <section
          className="critical-rail flex flex-col justify-between gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <AlertTriangleIcon className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">PRIORITY</Badge>
                <span className="text-xs font-medium uppercase tracking-widest">
                  Critical intelligence
                </span>
              </div>
              <p className="mt-1 text-sm font-medium">{latestCritical.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Matched: {matchPriorityTerms(latestCritical.message, priorityTerms).join(", ")}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedTargetId(latestCritical.targetId)}
          >
            <FocusIcon data-icon="inline-start" />
            Focus target
          </Button>
        </section>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[18rem_minmax(0,1fr)_minmax(18rem,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Target roster</CardTitle>
            <CardDescription>Contacts derived from received events</CardDescription>
          </CardHeader>
          <CardContent className="px-1">
            <TargetRoster
              targets={targets}
              selectedId={selectedTarget?.targetId}
              trackedIds={trackedTargetIds}
              onSelect={setSelectedTargetId}
              onToggleTrack={handleToggleTrack}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {mapMode === "globe" ? "Global representation" : "Operational map"}
            </CardTitle>
            <CardDescription>
              {targets.filter((target) => target.position).length} positioned contacts
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{mapMode === "globe" ? "GLOBE" : "MERCATOR"}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="min-h-[22rem] h-[min(58vh,42rem)]">
            <Suspense
              fallback={
                <div className="grid h-full min-h-[22rem] place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
                  Initializing geospatial display…
                </div>
              }
            >
              <TrackingMap
                targets={targets}
                trackedTargetIds={trackedTargetIds}
                cameraMode={cameraMode}
                onCameraModeChange={handleCameraModeChange}
                availableCameraModes={["track", "overview", "pan"]}
                selectedTargetId={selectedTarget?.targetId}
                onSelectTarget={setSelectedTargetId}
                mode={mapMode}
              />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tracked detail</CardTitle>
            <CardDescription>
              {trackedTargets.length > 0
                ? `${trackedTargets.length} contact${trackedTargets.length === 1 ? "" : "s"} on camera`
                : "Select Track on roster contacts"}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2">
            <ScrollArea className="h-[min(58vh,42rem)]">
              {trackedTargets.length > 0 ? (
                <div className="flex flex-col gap-2 p-1">
                  {trackedTargets.map((target) => (
                    <TrackedTargetCard key={target.targetId} target={target} />
                  ))}
                </div>
              ) : (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                  No tracked targets. Check Track on a roster contact to follow it on the map.
                </p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 2xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Event ingest</CardTitle>
            <CardDescription>Complete ordered stream from the active scenario</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[24rem] overflow-auto px-0 scrollbar-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingest time</TableHead>
                  <TableHead>Callsign</TableHead>
                  <TableHead>Payload</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runtime.ingestedEvents.toReversed().map((event) => {
                  const target = runtime.targetStates[event.targetId];
                  const critical = event.message && isPriorityMessage(event.message, priorityTerms);
                  return (
                    <TableRow key={event.id} className={cn(critical && "bg-destructive/10")}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {new Date(event.at).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="font-medium">{target?.callsign}</TableCell>
                      <TableCell>{eventPayloadBadges(event)}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">
                        {eventSummary(event)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {runtime.ingestedEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      Listening for scheduled events…
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Intelligence messages</CardTitle>
            <CardDescription>Derived priority from scenario terms</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[24rem] overflow-auto px-0 scrollbar-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event time</TableHead>
                  <TableHead>Callsign</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messageEvents.toReversed().map((event) => {
                  const matches = event.message
                    ? matchPriorityTerms(event.message, priorityTerms)
                    : [];
                  return (
                    <TableRow
                      key={event.id}
                      className={cn(matches.length > 0 && "bg-destructive/10 font-medium")}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {new Date(event.at).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>{runtime.targetStates[event.targetId]?.callsign}</TableCell>
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
                })}
                {messageEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      No intelligence messages ingested.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="sr-only" aria-live="polite">
        {runtime.status === "completed"
          ? "Simulation complete."
          : `${runtime.ingestedEvents.length} events ingested.`}
      </div>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search simulation commands…" />
        <CommandList>
          <CommandEmpty>No command found.</CommandEmpty>
          <CommandGroup heading="View">
            <CommandItem
              onSelect={() => {
                setMapMode((current) => (current === "2d" ? "globe" : "2d"));
                setCommandOpen(false);
              }}
            >
              <Globe2Icon />
              Toggle 2D / 3D map
              <CommandShortcut>⇧M</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                reconcile();
                setCommandOpen(false);
              }}
            >
              <SquareTerminalIcon />
              Reconcile event clock
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Simulation">
            <CommandItem
              disabled={runtime.status !== "running"}
              onSelect={() => {
                stop();
                setCommandOpen(false);
              }}
            >
              <RadioTowerIcon />
              Stop simulation
              <CommandShortcut>⇧S</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                reset();
                setCommandOpen(false);
                void navigate({ to: "/builder" });
              }}
            >
              <RotateCcwIcon />
              Reset and return to builder
              <CommandShortcut>⇧R</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </main>
  );
}
