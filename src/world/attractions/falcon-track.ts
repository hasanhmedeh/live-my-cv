// "Sky Falcon" — a tribute to Falcons Flight at Six Flags Qiddiya City (Intamin Exa coaster,
// opened 31 Dec 2025), laid out from the published ride sequence and statistics:
//   4,250 m long · 250 km/h · 158 m drop at 90° · 163 m arch hill · ~195 m elevation change
//   0 inversions · LSM lift hill + two LSM launches · 6 trains × 4 cars, 14 riders
// Sequence: station → right turn → 39 km/h LSM lift → 55 m twisted drop → airtime hills, a
// wave turn and an extreme overbanked turn → 160 km/h LSM launch up the cliff → slow clifftop
// section with an overbanked turn → brakes at the edge → 90° drop into a tunnel → LSM launch
// downhill to 250 km/h → 163 m arch with heavy trims → speed turns around the park boundary,
// over the main entrance → final brake run → right turn into the station.
// Our version: 4,247 m, 251 km/h, 157.9 m drop at 90°, arch crest ~163 m, 0 inversions.
// The exact plan is not public, so turn radii, hill shapes and the route are fitted to the park.
import * as THREE from 'three';
import { PHYS, type Element, type Phys, type Zone } from './track.ts';

export const FALCON_START = new THREE.Vector3(70, 2.5, 22);
export const FALCON_HEADING = new THREE.Quaternion(); // facing north (-z), toward the mountain
export const FALCON_CONNECTOR: Zone = 'brake';

export const FALCON_ELEMENTS: Element[] = [
  { t: 'straight', len: 20, zone: 'station' },
  // dispatch: a right turn onto the LSM lift, which pushes the train up at 39 km/h
  { t: 'straight', len: 4, zone: 'lift' },
  { t: 'turn', angle: -90, radius: 18, bank: 15, zone: 'lift' },
  { t: 'straight', len: 6, zone: 'lift' },
  { t: 'pitch', angle: 40, radius: 30, zone: 'lift' },
  { t: 'straight', len: 66, zone: 'lift' },
  { t: 'pitch', angle: -40, radius: 22, zone: 'lift' },
  // 55 m twisted drop, unwinding left to face the escarpment
  { t: 'pitch', angle: -50, radius: 20 },
  { t: 'turn', angle: 100, radius: 26, bank: 50 },
  { t: 'pitch', angle: 50, radius: 36 },
  // airtime hills
  { t: 'pitch', angle: 35, radius: 50 },
  { t: 'straight', len: 8 },
  { t: 'pitch', angle: -70, radius: 45 },
  { t: 'straight', len: 8 },
  { t: 'pitch', angle: 35, radius: 50 },
  { t: 'pitch', angle: 25, radius: 50 },
  { t: 'pitch', angle: -50, radius: 40 },
  { t: 'pitch', angle: 25, radius: 50 },
  // wave turn (banked outward), then the extreme overbanked turn on a rise
  { t: 'turn', angle: -60, radius: 80, bank: -10 },
  { t: 'pitch', angle: 20, radius: 50 },
  { t: 'turn', angle: 50, radius: 55, bank: 100 },
  { t: 'pitch', angle: -40, radius: 50 },
  { t: 'straight', len: 47 },
  { t: 'pitch', angle: 20, radius: 50 },
  // LSM launch to 160 km/h at the foot of the Tuwaiq cliffs; it keeps pushing on the way
  // up, then the train climbs the rest of the cliff face on momentum
  { t: 'straight', len: 50, zone: 'launch' },
  { t: 'pitch', angle: 40, radius: 90, zone: 'launch' },
  { t: 'straight', len: 122, zone: 'launch' },
  { t: 'straight', len: 114 },
  { t: 'pitch', angle: -40, radius: 70 },
  // the slow clifftop section (LSMs hold ~39 km/h): turns, a hill and an overbanked turn
  { t: 'straight', len: 20, zone: 'lift' },
  { t: 'turn', angle: 90, radius: 30, bank: 40, zone: 'lift' },
  { t: 'straight', len: 30, zone: 'lift' },
  { t: 'pitch', angle: 8, radius: 60, zone: 'lift' },
  { t: 'pitch', angle: -16, radius: 60, zone: 'lift' },
  { t: 'pitch', angle: 8, radius: 60, zone: 'lift' },
  { t: 'straight', len: 10, zone: 'lift' },
  { t: 'turn', angle: 90, radius: 26, bank: 100, zone: 'lift' },
  { t: 'straight', len: 15, zone: 'lift' },
  // brakes at the very edge: the train creeps over the lip…
  { t: 'straight', len: 25, zone: 'brake' },
  // …and falls 158 m at 90°, pulling out inside a tunnel at the foot of the cliff
  { t: 'pitch', angle: -90, radius: 20 },
  { t: 'straight', len: 58 },
  { t: 'pitch', angle: 90, radius: 80, zone: 'tunnel' },
  { t: 'straight', len: 40, zone: 'tunnel' },
  // out of the tunnel, the third LSM fires downhill: 250 km/h
  { t: 'pitch', angle: -8, radius: 100, zone: 'boost' },
  { t: 'straight', len: 110, zone: 'boost' },
  { t: 'pitch', angle: 4.34, radius: 100 },
  { t: 'turn', angle: -90, radius: 140, bank: 74 },
  { t: 'pitch', angle: 3.66, radius: 100 },
  { t: 'straight', len: 20 },
  // the 163 m arch, with heavy trim brakes on the way up
  { t: 'pitch', angle: 70, radius: 140 },
  { t: 'straight', len: 24, zone: 'trim' },
  { t: 'pitch', angle: -140, radius: 70 },
  { t: 'straight', len: 24 },
  { t: 'pitch', angle: 70, radius: 140 },
  { t: 'straight', len: 60, zone: 'trim' },
  // speed turns around the park boundary, a hill over the main (south) entrance
  { t: 'turn', angle: 135, radius: 130, bank: 45 },
  { t: 'straight', len: 504 },
  { t: 'turn', angle: 45, radius: 130, bank: 40 },
  { t: 'straight', len: 76 },
  { t: 'pitch', angle: 18, radius: 120 },
  { t: 'pitch', angle: -36, radius: 100 },
  { t: 'pitch', angle: 18, radius: 120 },
  { t: 'straight', len: 140 },
  { t: 'turn', angle: 90, radius: 80, bank: 58 },
  { t: 'straight', len: 25 },
  { t: 'turn', angle: 90, radius: 60, bank: 62 },
  // final brake run, then a right turn into the station
  { t: 'straight', len: 55 },
  { t: 'straight', len: 60, zone: 'brake' },
  { t: 'turn', angle: -90, radius: 20, bank: 10, zone: 'brake' },
];

export const FALCON_PHYS: Phys = {
  ...PHYS,
  maxPowered: 72,
  motor: 5,
  turbo: 10,
  liftSpeed: 10.8, // 39 km/h: the LSM lift out of the station, and the slow LSM crawl along the clifftop
  launchTarget: 44.4, // 160 km/h launch up the Tuwaiq cliff face
  launchAccel: 14,
  boostTarget: 69.4, // 250 km/h: the LSM launch out of the tunnel, downhill
  boostAccel: 14,
  trimSpeed: 36, // heavy trims on the way up the 163 m arch
  trimDecel: 12,
  trimMax: 5, // brakes at the cliff edge (the train creeps over) and the final brake run
  drag: 0.00018, // ~10 t train, CdA ≈ 3 m²: about 0.9 m/s² of drag at 250 km/h
};
