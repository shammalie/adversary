/**
 * Numerical Recipes LCG — deterministic `Math.random`-compatible [0, 1) stream.
 * Shared by tests and any caller that needs reproducible demo generation.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/**
 * Deterministic id factory derived from a numeric seed.
 * Used when `seed` is set without an explicit `idFactory` so the same seed
 * reproduces scenario / target / event ids (acceptance criterion #8).
 */
export function createSeededIdFactory(seed: number): () => string {
  let n = 0;
  const prefix = `s${(seed >>> 0).toString(36)}`;
  return () => `${prefix}-${(n++).toString(36)}`;
}

/** Resolve id factory: explicit override > seed-derived > crypto.randomUUID. */
export function resolveIdFactory(options: {
  seed?: number;
  idFactory?: () => string;
}): () => string {
  if (options.idFactory) return options.idFactory;
  if (options.seed !== undefined) return createSeededIdFactory(options.seed);
  return () => crypto.randomUUID();
}
