export interface TrackingMapEventPoint {
  id: string;
  targetId: string;
  latitude: number;
  longitude: number;
  color: string;
}

/** Build Review-map circles from authored scenario events that have a position.
 * Callers should pass only events that are due for the current preview scrub time
 * (e.g. via `getEventsDueByTime`). Compose maps must not use this helper.
 */
export function buildTrackingMapEventPoints(
  events: Array<{
    id: string;
    targetId: string;
    position?: { latitude: number; longitude: number };
  }>,
  targets: Array<{ id: string; color: string }>,
): TrackingMapEventPoint[] {
  const colorByTarget = new Map(targets.map((target) => [target.id, target.color]));
  const points: TrackingMapEventPoint[] = [];
  for (const event of events) {
    const position = event.position;
    if (!position) continue;
    if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) continue;
    const color = colorByTarget.get(event.targetId);
    if (!color) continue;
    points.push({
      id: event.id,
      targetId: event.targetId,
      latitude: position.latitude,
      longitude: position.longitude,
      color,
    });
  }
  return points;
}
