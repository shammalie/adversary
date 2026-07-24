export const SPEED_UNITS = ["kt", "mph", "km/h", "m/s", "ft/s", "mach"] as const;

export type SpeedUnit = (typeof SPEED_UNITS)[number];

/** Multiply by these to convert from the unit into knots. */
const TO_KNOTS: Record<SpeedUnit, number> = {
  kt: 1,
  mph: 0.868_976_241_9,
  "km/h": 0.539_956_803_5,
  "m/s": 1.943_844_492_4,
  "ft/s": 0.592_483_801_3,
  // Approximate ISA sea-level speed of sound.
  mach: 661.47,
};

const UNIT_ALIASES: Record<string, SpeedUnit> = {
  kt: "kt",
  kn: "kt",
  kts: "kt",
  knot: "kt",
  knots: "kt",
  mph: "mph",
  mih: "mph",
  "mi/h": "mph",
  "mi/hr": "mph",
  "km/h": "km/h",
  kmh: "km/h",
  kph: "km/h",
  "km/hr": "km/h",
  "m/s": "m/s",
  ms: "m/s",
  mps: "m/s",
  "ft/s": "ft/s",
  fts: "ft/s",
  fps: "ft/s",
  "ft/sec": "ft/s",
  mach: "mach",
};

export function isSpeedUnit(value: string): value is SpeedUnit {
  return (SPEED_UNITS as readonly string[]).includes(value);
}

export function toKnots(amount: number, unit: SpeedUnit): number {
  return amount * TO_KNOTS[unit];
}

export function fromKnots(knots: number, unit: SpeedUnit): number {
  return knots / TO_KNOTS[unit];
}

export function roundSpeed(value: number): number {
  return Number(value.toFixed(1));
}

export function formatSpeedInUnit(knots: number, unit: SpeedUnit): string {
  const decimals = unit === "mach" ? 3 : unit === "kt" ? 1 : 2;
  return String(Number(fromKnots(knots, unit).toFixed(decimals)));
}

/**
 * Parses freeform speed input such as `450`, `450 mph`, or `12.5m/s`.
 * When no unit token is present, `fallbackUnit` is used.
 */
export function parseSpeedInput(
  raw: string,
  fallbackUnit: SpeedUnit = "kt",
): { knots: number; unit: SpeedUnit; amount: number } | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const match = /^(-?\d+(?:\.\d+)?)\s*([a-z/%]+)?$/i.exec(trimmed);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const unitToken = match[2]?.replace(/\s+/g, "") ?? "";
  const unit = unitToken ? UNIT_ALIASES[unitToken] : fallbackUnit;
  if (!unit) return null;

  return {
    amount,
    unit,
    knots: roundSpeed(toKnots(amount, unit)),
  };
}

export function speedUnitLabel(unit: SpeedUnit): string {
  return unit;
}
