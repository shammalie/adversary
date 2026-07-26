import { isPriorityMessage } from "@/lib/priority-terms";
import { derivePositionSnapshot, interpolatePositionSnapshot } from "@/lib/position-telemetry";
import type {
  RuntimeTargetState,
  SimulationEvent,
  SimulationRuntime,
  SimulationScenario,
  TargetDefinition,
} from "@/types/target";

export function sortEvents(events: SimulationEvent[]) {
  return events.toSorted((a, b) => {
    const timeDifference = Date.parse(a.at) - Date.parse(b.at);
    return timeDifference === 0 ? a.id.localeCompare(b.id) : timeDifference;
  });
}

function maskedProfile(target: TargetDefinition): Partial<RuntimeTargetState["profile"]> {
  if (!target.revealOnFirstEvent) return { ...target.profile };
  return {};
}

function createInitialTargetStates(scenario: SimulationScenario) {
  return Object.fromEntries(
    scenario.targets.map((target) => [
      target.id,
      {
        targetId: target.id,
        callsign: target.callsign,
        color: target.color,
        profile: maskedProfile(target),
        revealed: !target.revealOnFirstEvent,
        appeared: !target.appearOnFirstEvent,
        trail: [],
      } satisfies RuntimeTargetState,
    ]),
  );
}

export function createRuntime(scenario: SimulationScenario, now = new Date()): SimulationRuntime {
  return {
    schemaVersion: 2,
    scenario,
    status: "running",
    startedAt: now.toISOString(),
    processedEventIds: [],
    ingestedEvents: [],
    targetStates: createInitialTargetStates(scenario),
    criticalAlertIds: [],
    lastReconciledAt: now.toISOString(),
  };
}

function revealTarget(
  current: RuntimeTargetState,
  definition: TargetDefinition | undefined,
): RuntimeTargetState {
  if (!definition || current.revealed) return current;
  return {
    ...current,
    revealed: true,
    profile: { ...definition.profile },
  };
}

function appearTarget(current: RuntimeTargetState): RuntimeTargetState {
  if (current.appeared) return current;
  return {
    ...current,
    appeared: true,
  };
}

function applyEvent(runtime: SimulationRuntime, event: SimulationEvent) {
  let target = runtime.targetStates[event.targetId];
  if (!target) return runtime;

  const definition = runtime.scenario.targets.find((candidate) => candidate.id === event.targetId);
  target = appearTarget(target);
  target = revealTarget(target, definition);
  const nextTarget: RuntimeTargetState = { ...target, lastEventAt: event.at };

  if (event.position) {
    const previous = target.position ?? target.trail.at(-1);
    const vehicleCategory =
      nextTarget.profile.vehicleCategory ?? definition?.profile.vehicleCategory;
    const position = derivePositionSnapshot(
      event.position,
      event.at,
      previous,
      vehicleCategory,
    );
    nextTarget.position = position;
    nextTarget.trail = [...target.trail, position];
  }

  const isCritical = event.message
    ? isPriorityMessage(event.message, runtime.scenario.priorityTerms)
    : false;

  return {
    ...runtime,
    targetStates: { ...runtime.targetStates, [event.targetId]: nextTarget },
    processedEventIds: [...runtime.processedEventIds, event.id],
    ingestedEvents: [...runtime.ingestedEvents, event],
    criticalAlertIds: isCritical
      ? [...runtime.criticalAlertIds, event.id]
      : runtime.criticalAlertIds,
  };
}

export function reconcileRuntime(runtime: SimulationRuntime, now = new Date()): SimulationRuntime {
  if (runtime.status !== "running") return runtime;

  const nowTime = now.getTime();
  const processed = new Set(runtime.processedEventIds);
  const dueEvents = sortEvents(runtime.scenario.events).filter(
    (event) => !processed.has(event.id) && Date.parse(event.at) <= nowTime,
  );

  let nextRuntime = dueEvents.reduce(applyEvent, runtime);
  const isComplete = nextRuntime.processedEventIds.length === runtime.scenario.events.length;
  nextRuntime = {
    ...nextRuntime,
    status: isComplete ? "completed" : "running",
    completedAt: isComplete ? now.toISOString() : undefined,
    lastReconciledAt: now.toISOString(),
  };
  return nextRuntime;
}

export function stopRuntime(runtime: SimulationRuntime, now = new Date()): SimulationRuntime {
  return {
    ...runtime,
    status: "stopped",
    stoppedAt: now.toISOString(),
    lastReconciledAt: now.toISOString(),
  };
}

export function getNextEvent(runtime: SimulationRuntime) {
  const processed = new Set(runtime.processedEventIds);
  return sortEvents(runtime.scenario.events).find((event) => !processed.has(event.id));
}

export function buildPreviewTargetStates(
  scenario: SimulationScenario,
  processedEventIds: string[],
) {
  let runtime = createRuntime(scenario);
  const processed = new Set(processedEventIds);
  const dueEvents = sortEvents(scenario.events).filter((event) => processed.has(event.id));
  runtime = dueEvents.reduce(applyEvent, runtime);
  return runtime.targetStates;
}

export function getEventsDueByTime(scenario: SimulationScenario, previewTimeMs: number) {
  return sortEvents(scenario.events).filter((event) => Date.parse(event.at) <= previewTimeMs);
}

function positionEventsForTarget(scenario: SimulationScenario, targetId: string) {
  return sortEvents(scenario.events).filter((event) => event.targetId === targetId && event.position);
}

export function buildInterpolatedPreviewTargetStates(
  scenario: SimulationScenario,
  previewTimeMs: number,
) {
  const dueEvents = getEventsDueByTime(scenario, previewTimeMs);
  const baseStates = buildPreviewTargetStates(
    scenario,
    dueEvents.map((event) => event.id),
  );
  const nextStates = { ...baseStates };

  for (const target of scenario.targets) {
    const state = baseStates[target.id];
    if (!state) continue;

    const positionEvents = positionEventsForTarget(scenario, target.id);
    if (positionEvents.length === 0) continue;

    let lastAppliedIndex = -1;
    for (let index = 0; index < positionEvents.length; index += 1) {
      if (Date.parse(positionEvents[index]!.at) <= previewTimeMs) {
        lastAppliedIndex = index;
      }
    }
    if (lastAppliedIndex < 0) continue;

    const nextPositionEvent = positionEvents[lastAppliedIndex + 1];
    if (!nextPositionEvent?.position) continue;

    const vehicleCategory = target.profile.vehicleCategory;
    const fromSnapshot =
      state.trail.at(-1) ??
      derivePositionSnapshot(
        positionEvents[lastAppliedIndex]!.position!,
        positionEvents[lastAppliedIndex]!.at,
        undefined,
        vehicleCategory,
      );
    const fromMs = Date.parse(fromSnapshot.at);
    const toMs = Date.parse(nextPositionEvent.at);
    if (previewTimeMs >= toMs) continue;

    const interpolated = interpolatePositionSnapshot(
      fromSnapshot,
      nextPositionEvent.position,
      fromMs,
      toMs,
      previewTimeMs,
      vehicleCategory,
    );

    const lastTrailPoint = state.trail.at(-1);
    const trailMoved =
      !lastTrailPoint ||
      lastTrailPoint.latitude !== interpolated.latitude ||
      lastTrailPoint.longitude !== interpolated.longitude;

    nextStates[target.id] = {
      ...state,
      position: interpolated,
      trail: trailMoved ? [...state.trail, interpolated] : state.trail,
    };
  }

  return nextStates;
}

export { applyEvent };
