// Both coaster tracks are built once, up front, so the environment (trees, fence) and the
// mountain can shape themselves around them.
import { buildTrack, CONNECTOR_ZONE, DS, LAYOUT_ELEMENTS, STATION_HEADING, STATION_START, type TrackData } from './attractions/track';
import { FALCON_CONNECTOR, FALCON_ELEMENTS, FALCON_HEADING, FALCON_START } from './attractions/falcon-track';

export const STACK_TRACK: TrackData = buildTrack(STATION_START, STATION_HEADING, LAYOUT_ELEMENTS, CONNECTOR_ZONE);
export const FALCON_TRACK: TrackData = buildTrack(FALCON_START, FALCON_HEADING, FALCON_ELEMENTS, FALCON_CONNECTOR);

/** Spatial hash of every track sample, for quick "is there track near here?" queries. */
const CELL = 8;
type Which = 'stack' | 'falcon';
const grids: Record<Which, Map<string, { x: number; z: number; rail: number }[]>> = { stack: new Map(), falcon: new Map() };
for (const [which, d] of [['stack', STACK_TRACK], ['falcon', FALCON_TRACK]] as const)
  for (let i = 0; i < d.pos.length; i += 2) {
    const p = d.pos[i];
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    let list = grids[which].get(key);
    if (!list) grids[which].set(key, (list = []));
    list.push({ x: p.x, z: p.z, rail: p.y - d.up[i].y });
  }

/** True if track with its rails below `maxRail` passes within `r` metres (horizontally). */
export function nearTrack(x: number, z: number, r: number, maxRail = Infinity, which: Which | 'any' = 'any') {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  const span = Math.ceil(r / CELL);
  for (const w of which === 'any' ? (['stack', 'falcon'] as const) : [which])
    for (let i = cx - span; i <= cx + span; i++)
      for (let j = cz - span; j <= cz + span; j++) {
        const list = grids[w].get(`${i},${j}`);
        if (!list) continue;
        for (const p of list) if (p.rail < maxRail && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true;
      }
  return false;
}

export const TRACK_DS = DS;
