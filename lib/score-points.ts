// What a score event adds to the Points chart, measured from each item's lowest score so far rather than from 0.
// Every word and verb form starts at 0, and missing one you never knew is not a step back: a miss costs only the
// points the item had climbed above its lowest, and an item at its lowest loses nothing. An item's progress is
// then how far it stands above its worst. Both the score and that lowest point fade towards 0 with the score's
// half-life, so a lift that fading alone gave is not counted as gained, nor taken back as lost.
const DAY_MS = 86_400_000;

export type ScoreEvent = { id: string; weight: number; at: number };

// The points each event moves the chart by, in the order given; `events` must be in time order.
export function pointsFromLowest(events: readonly ScoreEvent[], halfLifeDays: number): number[] {
  const items = new Map<string, { score: number; lowest: number; at: number }>();
  return events.map((event) => {
    const item = items.get(event.id) ?? { score: 0, lowest: 0, at: event.at };
    const fade = 0.5 ** (Math.max(0, event.at - item.at) / DAY_MS / halfLifeDays);
    const score = item.score * fade, lowest = item.lowest * fade;
    const moved = event.weight >= 0 ? event.weight : Math.min(0, Math.max(event.weight, lowest - score));
    items.set(event.id, { score: score + event.weight, lowest: Math.min(lowest, score + event.weight), at: event.at });
    return moved;
  });
}
