// Top-down map of the fair (x → east, z → south). The camera looks north (-z).
export const LAYOUT = {
  spawn: { x: 0, z: 16, heading: 0 },
  letters: { x: 0, z: 5 },
  arch: { x: 0, z: -8 },
  carousel: { x: 0, z: -30 },
  ferris: { x: 0, z: -68 },
  coasterStation: { x: -26, z: 0 },
  rocket: { x: 42, z: -52 },
  crates: { x: 34, z: -12 },
  striker: { x: -20, z: -40 },
  booth: { x: 20, z: 12 },
  boundary: 92,
};

export type ZoneId = 'entrance' | 'coaster' | 'rocket' | 'crates' | 'striker' | 'ferris' | 'booth';

/** Where the car is placed when teleporting to a zone, and the zone trigger. */
export const ZONES: Record<ZoneId, { x: number; z: number; radius: number; title: string; action: string; heading: number }> = {
  entrance: { x: 0, z: 14, radius: 0, title: 'Entrance', action: '', heading: 0 },
  coaster: { x: -19, z: 2, radius: 3.6, title: 'Projects Coaster', action: 'Ride the coaster', heading: Math.PI / 2 },
  rocket: { x: 42, z: -40, radius: 3.6, title: 'Career Rocket', action: 'Launch my timeline', heading: 0 },
  crates: { x: 34, z: -2, radius: 3.6, title: 'Skill Smash', action: 'Restack the crates', heading: 0 },
  striker: { x: -20, z: -33, radius: 3.4, title: 'High Striker', action: 'Swing the hammer', heading: 0 },
  ferris: { x: 0, z: -55, radius: 3.6, title: 'Ferris Wheel', action: 'About me', heading: 0 },
  booth: { x: 20, z: 18, radius: 3.4, title: 'Ticket Booth', action: 'Contact me', heading: 0 },
};

export const PATHS: { points: [number, number][]; width: number }[] = [
  // main boulevard
  { points: [[0, 26], [0, -58]], width: 7 },
  // west loop to coaster + striker
  { points: [[0, 2], [-12, 2], [-19, 2]], width: 5 },
  { points: [[0, -30], [-12, -33], [-20, -33]], width: 4.5 },
  // east to crates and rocket
  { points: [[0, -6], [18, -4], [34, -2]], width: 5 },
  { points: [[34, -2], [40, -20], [42, -40]], width: 5 },
  { points: [[0, -30], [22, -38], [42, -40]], width: 4.5 },
  // booth spur
  { points: [[0, 18], [12, 18], [20, 18]], width: 4.5 },
];

export const PLAZAS: [number, number, number][] = [
  [0, 10, 13],
  [0, -30, 11],
  [0, -56, 9],
  [42, -40, 7],
  [34, -6, 9],
  [-20, -36, 6],
  [20, 16, 5],
  [-20, 2, 5],
];
