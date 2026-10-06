// "Sky Falcon" — a tribute to the record-breaking cliff coaster at Six Flags Qiddiya (Riyadh).
// Launch out of the park, LSM climb up the escarpment, a crawl along the plateau, a near-
// vertical drop off the cliff face, a 250 km/h boost and a high-speed flight over the park.
import * as THREE from 'three';
import { PHYS, type Element, type Phys, type Zone } from './track.ts';

export const FALCON_START = new THREE.Vector3(70, 2.5, 22);
export const FALCON_HEADING = new THREE.Quaternion(); // facing north (-z), toward the mountain
export const FALCON_CONNECTOR: Zone = 'brake';

export const FALCON_ELEMENTS: Element[] = [
  { t: 'straight', len: 20, zone: 'station' },
  { t: 'straight', len: 6 },
  // launch 1: out of the park toward the escarpment
  { t: 'straight', len: 83.62, zone: 'launch' },
  // LSM climb up the mountain
  { t: 'pitch', angle: 35, radius: 70, zone: 'lift' },
  { t: 'straight', len: 280, zone: 'lift' },
  { t: 'pitch', angle: -35, radius: 70, zone: 'lift' },
  { t: 'straight', len: 12.23 },
  // swing around on the plateau to face the cliff edge and the park far below
  { t: 'turn', angle: -180, radius: 32, bank: 45 },
  { t: 'straight', len: 25, zone: 'brake' },
  // over the edge — and, like the real Falcon's Flight, an LSM launch fires on the way
  // down the near-vertical drop, slingshotting the train to 250 km/h
  { t: 'pitch', angle: -85, radius: 25 }, // tip over the lip first (launching here would lift riders out of their seats)
  { t: 'straight', len: 44.1, zone: 'boost' },
  // long, gentle pull-out: gravity finishes the job, 250 km/h at the bottom (~4.9 G)
  { t: 'pitch', angle: 85, radius: 125 },
  { t: 'straight', len: 16.6 },
  // speed hill into the park
  { t: 'pitch', angle: 18, radius: 160 },
  { t: 'straight', len: 10 },
  { t: 'pitch', angle: -18, radius: 160 },
  // huge banked turn, then straight across the middle of the park, high above it all
  { t: 'turn', angle: -90, radius: 110, bank: 78 },
  { t: 'straight', len: 40 },
  // dive over the west side
  { t: 'pitch', angle: -16, radius: 200 },
  { t: 'straight', len: 20 },
  { t: 'pitch', angle: 16, radius: 200 },
  // sweeping turnaround around the south-west
  { t: 'turn', angle: 180, radius: 75, bank: 80 },
  { t: 'straight', len: 2.2 },
  // HYPER STRIP: 550 m of linear motors out into the desert — 0 → 500 km/h, then flat-out
  { t: 'straight', len: 550, zone: 'hyper' },
  // magnetic brakes bleed it back down to ~80 km/h (about 3.4 G of deceleration)
  { t: 'straight', len: 300, zone: 'trim' },
  // tight banked turnaround back toward the park
  { t: 'turn', angle: 180, radius: 25, bank: 72 },
  // return run: airtime camelbacks over the desert
  { t: 'straight', len: 60 },
  { t: 'pitch', angle: 14, radius: 80 },
  { t: 'pitch', angle: -28, radius: 60 },
  { t: 'pitch', angle: 14, radius: 80 },
  { t: 'straight', len: 120 },
  { t: 'pitch', angle: 14, radius: 80 },
  { t: 'pitch', angle: -28, radius: 60 },
  { t: 'pitch', angle: 14, radius: 80 },
  { t: 'straight', len: 120 },
  { t: 'pitch', angle: 10, radius: 80 },
  { t: 'pitch', angle: -20, radius: 60 },
  { t: 'pitch', angle: 10, radius: 80 },
  // final dip back to ground level
  { t: 'pitch', angle: -8, radius: 100 },
  { t: 'straight', len: 10 },
  { t: 'pitch', angle: 8, radius: 100 },
  { t: 'straight', len: 86.3 },
  // home: swing north into the brakes
  { t: 'turn', angle: -90, radius: 20, bank: 45 },
  { t: 'straight', len: 28.2, zone: 'brake' },
];

export const FALCON_PHYS: Phys = {
  ...PHYS,
  maxPowered: 72,
  motor: 5,
  turbo: 10,
  launchTarget: 46, // ~165 km/h launch out of the station area
  launchAccel: 14,
  boostTarget: 58, // LSM cut-off on the vertical drop; the pull-out's last ~114 m of fall brings it to 250 km/h
  boostAccel: 32,
  liftSpeed: 20,
  hyperTarget: 138.9, // 500 km/h
  hyperAccel: 30,
  trimSpeed: 28,
  trimDecel: 33,
  trimMax: 8,
  drag: 0.0006, // heavy train, low drag
};
