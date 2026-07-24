import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clampPreviewTimeMs,
  computePreviewRevision,
  getPreviewRangeMs,
  getPreviewStartMs,
} from "@/lib/preview-revision";
import {
  buildInterpolatedPreviewTargetStates,
  getEventsDueByTime,
  sortEvents,
} from "@/lib/simulation-engine";
import type { SimulationEvent, SimulationScenario } from "@/types/target";

export const PREVIEW_SPEEDS = [1, 2, 5, 10, 100] as const;
export type PreviewSpeed = (typeof PREVIEW_SPEEDS)[number];

export function useBuilderPreview(scenario: SimulationScenario) {
  const previewRevision = useMemo(() => computePreviewRevision(scenario), [scenario]);
  const previewRange = useMemo(() => getPreviewRangeMs(scenario), [scenario]);
  const [previewTimeMs, setPreviewTimeMs] = useState(
    () => previewRange?.startMs ?? Date.now(),
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PreviewSpeed>(1);
  const lastTickRef = useRef<number | null>(null);
  const previewRangeRef = useRef(previewRange);
  previewRangeRef.current = previewRange;

  useEffect(() => {
    if (previewRange) {
      setPreviewTimeMs(previewRange.startMs);
    }
    setPlaying(false);
  }, [previewRevision, previewRange]);

  useEffect(() => {
    if (!playing) {
      lastTickRef.current = null;
      return;
    }
    let frame = 0;
    const tick = (now: number) => {
      if (lastTickRef.current !== null) {
        const delta = now - lastTickRef.current;
        setPreviewTimeMs((current) => {
          const range = previewRangeRef.current;
          const next = current + delta * speed;
          if (!range) return next;
          if (next >= range.endMs) {
            setPlaying(false);
            return range.endMs;
          }
          return clampPreviewTimeMs(next, range);
        });
      }
      lastTickRef.current = now;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      lastTickRef.current = null;
    };
  }, [playing, speed]);

  const dueEvents = useMemo(
    () => getEventsDueByTime(scenario, previewTimeMs),
    [previewTimeMs, scenario],
  );
  const targetStates = useMemo(
    () => buildInterpolatedPreviewTargetStates(scenario, previewTimeMs),
    [previewTimeMs, scenario],
  );
  const currentEvent = dueEvents.at(-1);
  const mapTargets = useMemo(() => Object.values(targetStates), [targetStates]);
  const firstEventMs = useMemo(() => {
    const first = sortEvents(scenario.events)[0];
    return first ? Date.parse(first.at) : null;
  }, [scenario.events]);

  const reset = useCallback(() => {
    if (previewRange) {
      setPreviewTimeMs(previewRange.startMs);
    }
    setPlaying(false);
  }, [previewRange]);

  const seek = useCallback(
    (timeMs: number) => {
      if (!previewRange) return;
      setPlaying(false);
      setPreviewTimeMs(clampPreviewTimeMs(timeMs, previewRange));
    },
    [previewRange],
  );

  const pause = useCallback(() => setPlaying(false), []);
  const play = useCallback(() => {
    if (!previewRange) return;
    setPlaying(true);
  }, [previewRange]);

  return {
    previewRevision,
    previewRange,
    previewTimeMs,
    playing,
    speed,
    setSpeed,
    play,
    pause,
    reset,
    seek,
    dueEvents,
    currentEvent,
    mapTargets,
    startMs: previewRange?.startMs ?? null,
    endMs: previewRange?.endMs ?? null,
    firstEventMs,
  };
}

export function describePreviewEvent(event: SimulationEvent) {
  const parts: string[] = [];
  if (event.position) {
    parts.push(`${event.position.latitude.toFixed(4)}, ${event.position.longitude.toFixed(4)}`);
  }
  if (event.message) parts.push(event.message);
  return parts.join(" · ");
}

export { computePreviewRevision, getPreviewRangeMs, getPreviewStartMs };
