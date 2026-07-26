import { validateScenario } from "@/lib/simulation-schema";
import type { SimulationScenario } from "@/types/target";
import type { ZodIssue } from "zod";

export type ValidationIssue = {
  path: string;
  message: string;
  section: "scenario" | "targets" | "events";
  index?: number;
  field?: string;
};

const SECTION_LABELS: Record<ValidationIssue["section"], string> = {
  scenario: "Scenario",
  targets: "Target",
  events: "Event",
};

function issueToValidationIssue(issue: ZodIssue): ValidationIssue {
  const pathParts = issue.path.map(String);
  const root = pathParts[0];
  const section: ValidationIssue["section"] =
    root === "targets" ? "targets" : root === "events" ? "events" : "scenario";
  const index =
    (section === "targets" || section === "events") && typeof issue.path[1] === "number"
      ? issue.path[1]
      : undefined;
  const field =
    pathParts.length > 2 ? pathParts.slice(2).join(".") : pathParts.at(-1) ?? "scenario";

  return {
    path: pathParts.join("."),
    message: issue.message,
    section,
    index,
    field,
  };
}

export function getScenarioValidationIssues(scenario: unknown): ValidationIssue[] {
  const result = validateScenario(scenario);
  if (result.success) return [];
  return result.error.issues.map(issueToValidationIssue);
}

export function getIssuesForTarget(
  issues: ValidationIssue[],
  targetId: string,
  scenario: SimulationScenario,
): ValidationIssue[] {
  const index = scenario.targets.findIndex((target) => target.id === targetId);
  if (index < 0) return [];
  return issues.filter((issue) => issue.section === "targets" && issue.index === index);
}

export function getIssuesForEvent(
  issues: ValidationIssue[],
  eventId: string,
  scenario: SimulationScenario,
): ValidationIssue[] {
  const index = scenario.events.findIndex((event) => event.id === eventId);
  if (index < 0) return [];
  return issues.filter((issue) => issue.section === "events" && issue.index === index);
}

export function groupValidationIssues(issues: ValidationIssue[]) {
  return {
    scenario: issues.filter((issue) => issue.section === "scenario"),
    targets: issues.filter((issue) => issue.section === "targets"),
    events: issues.filter((issue) => issue.section === "events"),
  };
}

export function fieldHasIssue(issues: ValidationIssue[], fieldPath: string) {
  return issues.some(
    (issue) => issue.path === fieldPath || issue.path.endsWith(`.${fieldPath}`),
  );
}

/** Short label for validation dropdown entries. */
export function formatValidationIssueLabel(
  issue: ValidationIssue,
  scenario: SimulationScenario,
): string {
  if (issue.section === "targets" && typeof issue.index === "number") {
    const target = scenario.targets[issue.index];
    const subject = target?.callsign?.trim() || `Target ${issue.index + 1}`;
    const field = issue.field && issue.field !== "id" ? ` · ${issue.field}` : "";
    return `${subject}${field}`;
  }

  if (issue.section === "events" && typeof issue.index === "number") {
    const event = scenario.events[issue.index];
    const target = event
      ? scenario.targets.find((entry) => entry.id === event.targetId)
      : undefined;
    const subject = target?.callsign?.trim() || `Event ${issue.index + 1}`;
    const field = issue.field ? ` · ${issue.field}` : "";
    return `${subject}${field}`;
  }

  if (issue.section === "scenario") {
    const field = issue.field && issue.field !== "scenario" ? issue.field : issue.path;
    return field === "name" ? "Scenario name" : `Scenario · ${field}`;
  }

  return `${SECTION_LABELS[issue.section]} · ${issue.path}`;
}

/** DOM id for the control most associated with a validation issue, when known. */
export function getValidationIssueFocusId(
  issue: ValidationIssue,
  scenario: SimulationScenario,
): string | null {
  if (issue.path === "name" || issue.field === "name") return "scenario-name";
  if (issue.path === "targets") return "targets-section";
  if (issue.path === "events") return "events-section";

  if (issue.section === "targets" && typeof issue.index === "number") {
    const target = scenario.targets[issue.index];
    if (!target) return "targets-section";
    if (issue.field === "callsign") return `${target.id}-callsign`;
    if (issue.field === "appearOnFirstEvent") return `${target.id}-appear`;
    if (issue.field === "revealOnFirstEvent") return `${target.id}-reveal`;
    if (issue.field === "profile.vehicleSubtype") return `${target.id}-subtype`;
    if (issue.field === "profile.identifier") return `${target.id}-identifier`;
    if (issue.field === "profile.description") return `${target.id}-description`;
    return `target-card-${target.id}`;
  }

  if (issue.section === "events" && typeof issue.index === "number") {
    const event = scenario.events[issue.index];
    if (!event) return "events-section";
    if (issue.field?.startsWith("position.")) {
      const positionField = issue.field.slice("position.".length);
      return `edit-${event.id}-${positionField}`;
    }
    if (issue.field === "message") return `edit-${event.id}-message`;
    if (issue.field === "at") return `edit-${event.id}-at`;
    return `event-row-${event.id}`;
  }

  return null;
}
