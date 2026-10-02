// What a score event adds to the Points chart, measured from each item's lowest point so far rather than from 0.
// Every word and verb form starts at 0, and missing one you never knew is not a step back: a miss costs only what the
// item had climbed above its lowest, and an item at its lowest loses nothing. The climb is the plain sum of the item's
// answers (+2, -3 and so on), without the fading its score has, so a day's points are what that day's answers did
// against each item's own record, and an item's progress is how far that sum stands above its worst.
export type ScoreEvent = { id: string; weight: number };

// The points each event moves the chart by, in the order given; `events` must be in time order.
export function pointsFromLowest(events: readonly ScoreEvent[]): number[] {
  const items = new Map<string, { total: number; lowest: number }>();
  return events.map((event) => {
    const item = items.get(event.id) ?? { total: 0, lowest: 0 };
    const moved = event.weight >= 0 ? event.weight : Math.min(0, Math.max(event.weight, item.lowest - item.total));
    const total = item.total + event.weight;
    items.set(event.id, { total, lowest: Math.min(item.lowest, total) });
    return moved;
  });
}
