// Top-down map of the fair (x → east, z → south). The camera looks north (-z).
export const LAYOUT = {
  spawn: { x: 0, z: 16, heading: 0 },
  letters: { x: 0, z: 5 },
  arch: { x: 0, z: -8 },
  carousel: { x: 0, z: -30 },
  ferris: { x: 0, z: -200 }, // the giant wheel stands outside the park, at the end of the boulevard
  coasterStation: { x: -26, z: 0 },
  rocket: { x: 42, z: -52 },
  crates: { x: 34, z: -12 },
  striker: { x: -20, z: -40 },
  booth: { x: 20, z: 12 },
  ideas: { x: -11.5, z: 9 }, // the Idea Box, on the entrance plaza's west side, its slot facing east
  drone: { x: 12, z: -49 }, // the rental kiosk, beside the boulevard's north plaza
  dronePad: { x: 12, z: -57.5 },
  flip: { x: -52, z: -70 }, // the Sky Flip's tower, in the park's north-west corner
  ship: { x: 22, z: 66 }, // the Nebula 360 pendulum ship, on the lawn south of the entrance
  speedway: { x: -55, z: 53 }, // the kart garage; the circuit itself lies outside the south-west fence
  boundary: 92,
};

/** The Sky Flip's arm swings in a vertical plane turned this far about y, so it faces the entrance. */
export const FLIP_YAW = Math.PI / 6;

/** (x, z) in the Sky Flip's own frame: lx along its swing, lz out towards the park. */
export function flipLocal(x: number, z: number): [number, number] {
  const dx = x - LAYOUT.flip.x;
  const dz = z - LAYOUT.flip.z;
  const c = Math.cos(FLIP_YAW);
  const s = Math.sin(FLIP_YAW);
  return [dx * c - dz * s, dx * s + dz * c];
}

export type ZoneId = 'entrance' | 'coaster' | 'falcon' | 'rocket' | 'crates' | 'striker' | 'ferris' | 'booth' | 'ideas' | 'drone' | 'flip' | 'ship' | 'speedway';

/** Where the visitor is placed when teleporting to a zone, and the zone trigger. */
export const ZONES: Record<ZoneId, { x: number; z: number; radius: number; title: string; action: string; heading: number }> = {
  entrance: { x: 0, z: 14, radius: 0, title: 'Entrance', action: '', heading: 0 },
  coaster: { x: -19, z: 2, radius: 3.6, title: 'Thunder Loop', action: 'Drive the coaster', heading: Math.PI / 2 },
  // west of the station: the track itself is a solid wall you can't cross
  falcon: { x: 63, z: 12, radius: 3.6, title: 'Sky Falcon', action: 'Ride the 250 km/h cliff coaster', heading: -Math.PI / 2 },
  rocket: { x: 42, z: -40, radius: 3.6, title: 'Rocket Ride', action: 'Launch into orbit', heading: 0 },
  crates: { x: 34, z: -2, radius: 3.6, title: 'Crate Smash', action: 'Play a round', heading: 0 },
  striker: { x: -20, z: -33, radius: 3.4, title: 'High Striker', action: 'Swing the hammer', heading: 0 },
  // at the wheel's boarding terminal, at the far end of the road out of the park
  ferris: { x: 0, z: -181, radius: 3.6, title: 'Giant Wheel', action: 'Ride the 250 m wheel', heading: 0 },
  booth: { x: 20, z: 18, radius: 3.4, title: 'Ticket Booth', action: 'Step up to the counter', heading: 0 },
  // in front of the Idea Box, facing west at its slot
  ideas: { x: -8, z: 9, radius: 2.6, title: 'Idea Box', action: 'Share an idea', heading: Math.PI / 2 },
  // at the kiosk counter, facing east
  drone: { x: 7, z: -49, radius: 3.2, title: 'Drone Flights', action: 'Rent a drone', heading: -Math.PI / 2 },
  // outside the Sky Flip's gate, facing the tower
  flip: { x: -37, z: -56.1, radius: 3.4, title: 'Sky Flip', action: 'Swing 125 m up and flip', heading: FLIP_YAW },
  // at the ship's queue, facing south over the fence at the boat
  ship: { x: 22, z: 52, radius: 3.4, title: 'Nebula 360', action: 'Loop the pendulum ship', heading: Math.PI },
  // at the kart garage's counter, facing south-west towards the circuit
  speedway: { x: -48, z: 46, radius: 3.4, title: 'Turbo Speedway', action: 'Race the karts', heading: (3 * Math.PI) / 4 },
};

export const PATHS: { points: [number, number][]; width: number }[] = [
  // main boulevard, running on out of the park's north gate to the giant wheel
  { points: [[0, 26], [0, -178]], width: 7 },
  // west loop to coaster + striker
  { points: [[0, 2], [-12, 2], [-19, 2]], width: 5 },
  { points: [[0, -30], [-12, -33], [-20, -33]], width: 4.5 },
  // east to crates and rocket
  { points: [[0, -6], [18, -4], [34, -2]], width: 5 },
  { points: [[34, -2], [40, -20], [42, -40]], width: 5 },
  { points: [[0, -30], [22, -38], [42, -40]], width: 4.5 },
  // east gate to the Sky Falcon
  { points: [[20, 18], [48, 17], [63, 12]], width: 4.5 },
  // booth spur
  { points: [[0, 18], [12, 18], [20, 18]], width: 4.5 },
  // north plaza west to the Sky Flip
  { points: [[0, -62], [-20, -63.5], [-28.9, -58], [-37, -56.1]], width: 4.5 },
  // entrance plaza south to the Nebula 360
  { points: [[4, 21], [14, 34], [22, 48]], width: 4.5 },
  // entrance plaza south-west to the kart garage
  { points: [[-4, 21], [-20, 26], [-36, 36], [-48, 46]], width: 4.5 },
];

export const PLAZAS: [number, number, number][] = [
  [0, 10, 13],
  [0, -30, 11],
  [0, -56, 9],
  [42, -40, 7],
  [34, -6, 9],
  [-20, -36, 6],
  [20, 16, 5],
  [63, 12, 5],
  [-20, 2, 5],
  [0, -178, 10], // in front of the giant wheel's terminal
  [10, -53, 7.5], // the drone kiosk and its landing pad
  [-37, -56.1, 3.4], // the Sky Flip's gate
  [22, 52, 5], // the Nebula 360's queue
  [-50, 48, 5], // the kart garage
];

/** The road out to the giant wheel: the one stretch of ground outside the fence you can walk on. */
export const WHEEL_ROAD = { half: 4.2, end: -178, plaza: { x: 0, z: -178, r: 9.5 } };

/**
 * The lawn the road runs through, beyond the edge of the park's own ground: x within ±half,
 * z from z0 (behind the wheel's terminal) to z1 (just inside the park ground's edge). It fades
 * out into the open country over the last `fade` metres of each side.
 */
export const WHEEL_LAWN = { half: 50, z0: -206, z1: -126, fade: 12 };

/** True if (x, z) is on (or within `margin` of) a footpath or plaza. */
export function onPath(x: number, z: number, margin = 0) {
  for (const { points, width } of PATHS)
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < width / 2 + margin) return true;
    }
  return PLAZAS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + margin);
}

/**
 * Where the visitor may walk: inside the fence, or along the road to the giant wheel. Returns the
 * nearest walkable point to (x, z), or null when (x, z) is already walkable.
 */
export function clampToGrounds(x: number, z: number): [number, number] | null {
  const R = LAYOUT.boundary;
  const r = Math.hypot(x, z);
  if (r <= R) return null;
  const { half, end, plaza } = WHEEL_ROAD;
  if (Math.abs(x) <= half && z < 0 && z >= end) return null;
  const pr = Math.hypot(x - plaza.x, z - plaza.z);
  if (pr <= plaza.r) return null;
  const candidates: [number, number][] = [
    [(x * R) / r, (z * R) / r],
    [Math.max(-half, Math.min(half, x)), Math.max(end, Math.min(-R + half, z))],
    [plaza.x + ((x - plaza.x) * plaza.r) / pr, plaza.z + ((z - plaza.z) * plaza.r) / pr],
  ];
  let best = candidates[0];
  let bd = Infinity;
  for (const c of candidates) {
    const d = (c[0] - x) ** 2 + (c[1] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}
