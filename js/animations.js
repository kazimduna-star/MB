// js/animations.js — анимации персонажа
// 1) Клипы Miku (idle / walk / run / jump / death) смешиваются по скорости, фаза шага общая.
// 2) Поверх клипов добавляются процедурные движения по костям: дыхание, голова, наклоны,
//    стойки оружия, атаки по типам оружия, блок, уклонение, урон, взаимодействие, приземление.
// Все повороты задаются в системе координат персонажа (pivot: +Z вперёд, +X влево, +Y вверх),
// поэтому не зависят от локальных осей костей риггинга. Исходный скелет не изменяется.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const K = (t, pose) => ({ t, pose });
const Z3 = [0, 0, 0];

// Знаки (в системе персонажа, градусы):
//  X: + = наклон вперёд (корпус/голова), руки и бёдра вперёд = минус, колено согнуть = плюс
//  Y: + = поворот влево
//  Z: левая рука наружу = +, правая рука наружу = −, наклон корпуса влево = −

// ---------------------------------------------------------------------------
// ТАБЛИЦА АТАК. Каждая атака: dur (сек), hitAt (доля времени удара), keys (позы по времени)
// ---------------------------------------------------------------------------
const STRIKES = {
  sword1h: {
    light: [
      { dur: 0.55, hitAt: 0.52, keys: [
        K(0, {}),
        K(0.30, { rArm: [-120, 0, -35], rForeArm: [-50, 0, 0], rHand: [20, 0, 0], spine: [0, -14, 0], spine1: [-5, -22, 0], spine2: [0, -8, 0], head: [0, 8, 0], lArm: [15, 0, 10] }),
        K(0.52, { rArm: [-55, 0, 25], rForeArm: [-20, 0, 0], rHand: [-25, 0, 0], spine: [0, 16, 0], spine1: [10, 26, 0], spine2: [0, 10, 0], hips: [0, 10, 0], lArm: [25, 0, 15], head: [5, -6, 0] }),
        K(0.78, { rArm: [-50, 0, 22], rForeArm: [-22, 0, 0], spine1: [6, 18, 0], hips: [0, 6, 0] }),
        K(1, {})
      ] },
      { dur: 0.5, hitAt: 0.5, keys: [
        K(0, {}),
        K(0.30, { rArm: [-80, 0, 20], rForeArm: [-60, 0, 0], rHand: [0, 0, 20], spine: [0, 12, 0], spine1: [0, 24, 0], hips: [0, 8, 0], lArm: [10, 0, 5] }),
        K(0.50, { rArm: [-85, 0, -55], rForeArm: [-15, 0, 0], rHand: [0, 0, -20], spine: [0, -16, 0], spine1: [0, -30, 0], hips: [0, -12, 0], lArm: [20, 0, 25] }),
        K(0.78, { rArm: [-80, 0, -50], rForeArm: [-20, 0, 0], spine1: [0, -20, 0] }),
        K(1, {})
      ] },
      { dur: 0.65, hitAt: 0.55, keys: [
        K(0, {}),
        K(0.34, { rArm: [-170, 0, -10], rForeArm: [-70, 0, 0], rHand: [25, 0, 0], spine1: [-12, 0, 0], spine2: [-6, 0, 0], lArm: [-20, 0, 15] }),
        K(0.55, { rArm: [-35, 0, 0], rForeArm: [-15, 0, 0], rHand: [-30, 0, 0], spine1: [22, 0, 0], spine2: [8, 0, 0], hips: [6, 0, 0], lArm: [20, 0, 10], head: [8, 0, 0], lUpLeg: [-12, 0, 0], lLeg: [12, 0, 0] }),
        K(0.82, { rArm: [-35, 0, 0], spine1: [14, 0, 0] }),
        K(1, {})
      ] }
    ],
    heavy: { dur: 1.0, hitAt: 0.65, keys: [
      K(0, {}),
      K(0.45, { rArm: [-175, 0, -30], rForeArm: [-80, 0, 0], rHand: [25, 0, 0], spine: [0, -14, 0], spine1: [-18, -35, 0], hips: [0, -10, 0], lArm: [10, 0, 25], lUpLeg: [10, 0, 0], rUpLeg: [-10, 0, 0] }),
      K(0.65, { rArm: [-30, 0, 20], rForeArm: [-15, 0, 0], rHand: [-30, 0, 0], spine: [0, 16, 0], spine1: [20, 40, 0], hips: [8, 18, 0], lArm: [25, 0, 20], lUpLeg: [-30, 0, 0], lLeg: [25, 0, 0], rUpLeg: [14, 0, 0], rLeg: [18, 0, 0] }),
      K(0.88, { rArm: [-30, 0, 18], spine1: [14, 30, 0], hips: [4, 12, 0], lUpLeg: [-20, 0, 0], lLeg: [18, 0, 0] }),
      K(1, {})
    ] }
  },

  sword2h: {
    light: [
      { dur: 0.9, hitAt: 0.6, keys: [
        K(0, {}),
        K(0.35, { rArm: [-95, 0, -50], rForeArm: [-45, 0, 0], lArm: [-100, 0, -25], lForeArm: [-55, 0, 0], spine: [0, -16, 0], spine1: [0, -35, 0], hips: [0, -12, 0] }),
        K(0.6, { rArm: [-85, 0, 45], rForeArm: [-25, 0, 0], lArm: [-90, 0, 25], lForeArm: [-40, 0, 0], spine: [0, 18, 0], spine1: [0, 40, 0], hips: [0, 20, 0], lUpLeg: [-14, 0, 0] }),
        K(0.85, { rArm: [-80, 0, 40], lArm: [-85, 0, 22], spine1: [0, 28, 0], hips: [0, 14, 0] }),
        K(1, {})
      ] },
      { dur: 1.0, hitAt: 0.62, keys: [
        K(0, {}),
        K(0.4, { rArm: [-165, 0, -15], rForeArm: [-60, 0, 0], lArm: [-165, 0, -5], lForeArm: [-60, 0, 0], spine1: [-15, 0, 0], spine2: [-8, 0, 0] }),
        K(0.62, { rArm: [-40, 0, 0], rForeArm: [-30, 0, 0], lArm: [-45, 0, 5], lForeArm: [-35, 0, 0], spine1: [25, 0, 0], spine2: [10, 0, 0], hips: [10, 0, 0], head: [8, 0, 0], lUpLeg: [-22, 0, 0], lLeg: [20, 0, 0] }),
        K(0.86, { rArm: [-40, 0, 0], lArm: [-45, 0, 5], spine1: [16, 0, 0] }),
        K(1, {})
      ] }
    ],
    heavy: { dur: 1.3, hitAt: 0.72, keys: [
      K(0, {}),
      K(0.5, { rArm: [-175, 0, -20], rForeArm: [-70, 0, 0], lArm: [-175, 0, -10], lForeArm: [-70, 0, 0], spine1: [-22, -10, 0], spine2: [-10, 0, 0], hips: [-4, 0, 0] }),
      K(0.72, { rArm: [-25, 0, 0], rForeArm: [-25, 0, 0], lArm: [-30, 0, 5], lForeArm: [-30, 0, 0], spine1: [32, 0, 0], spine2: [14, 0, 0], hips: [14, 0, 0], head: [10, 0, 0], lUpLeg: [-34, 0, 0], lLeg: [30, 0, 0], rUpLeg: [10, 0, 0], rLeg: [24, 0, 0] }),
      K(0.92, { rArm: [-25, 0, 0], lArm: [-30, 0, 5], spine1: [24, 0, 0], lUpLeg: [-26, 0, 0], lLeg: [22, 0, 0] }),
      K(1, {})
    ] }
  },

  dagger: {
    light: [
      { dur: 0.3, hitAt: 0.55, keys: [
        K(0, {}),
        K(0.3, { rArm: [-70, 0, -30], rForeArm: [-50, 0, 0], spine1: [0, -18, 0], hips: [0, -6, 0] }),
        K(0.55, { rArm: [-60, 0, 25], rForeArm: [-30, 0, 0], rHand: [0, 0, 20], spine1: [0, 20, 0], hips: [0, 8, 0] }),
        K(1, {})
      ] },
      { dur: 0.3, hitAt: 0.55, keys: [
        K(0, {}),
        K(0.3, { rArm: [-60, 0, 25], rForeArm: [-40, 0, 0], spine1: [0, 18, 0] }),
        K(0.55, { rArm: [-70, 0, -35], rForeArm: [-25, 0, 0], rHand: [0, 0, -20], spine1: [0, -20, 0], hips: [0, -8, 0] }),
        K(1, {})
      ] },
      { dur: 0.32, hitAt: 0.55, keys: [
        K(0, {}),
        K(0.3, { rArm: [-40, 0, -10], rForeArm: [-90, 0, 0], spine1: [0, -15, 0] }),
        K(0.55, { rArm: [-90, 0, 0], rForeArm: [-5, 0, 0], spine1: [10, 10, 0], hips: [5, 6, 0], lUpLeg: [-14, 0, 0] }),
        K(1, {})
      ] },
      { dur: 0.4, hitAt: 0.6, keys: [
        K(0, {}),
        K(0.3, { rArm: [10, 0, -20], rForeArm: [-30, 0, 0], spine1: [-5, -10, 0], hips: [0, -4, 0] }),
        K(0.6, { rArm: [-130, 0, 15], rForeArm: [-20, 0, 0], spine1: [-5, 14, 0], hips: [0, 6, 0] }),
        K(1, {})
      ] }
    ],
    heavy: { dur: 0.6, hitAt: 0.65, keys: [
      K(0, {}),
      K(0.4, { rArm: [-30, 0, -25], rForeArm: [-100, 0, 0], spine1: [8, -25, 0], hips: [0, -8, 0] }),
      K(0.65, { rArm: [-100, 0, 5], rForeArm: [-5, 0, 0], spine1: [25, 25, 0], hips: [12, 10, 0], lUpLeg: [-35, 0, 0], lLeg: [15, 0, 0], rUpLeg: [10, 0, 0], rLeg: [30, 0, 0] }),
      K(1, {})
    ] }
  },

  axe: {
    light: [
      { dur: 0.8, hitAt: 0.62, keys: [
        K(0, {}),
        K(0.4, { rArm: [-150, 0, -30], rForeArm: [-60, 0, 0], rHand: [20, 0, 0], spine1: [-12, -30, 0], spine: [0, -12, 0], lArm: [10, 0, 20] }),
        K(0.62, { rArm: [-40, 0, 15], rForeArm: [-20, 0, 0], rHand: [-25, 0, 0], spine1: [22, 28, 0], spine: [0, 12, 0], hips: [8, 12, 0], lUpLeg: [-20, 0, 0], lLeg: [18, 0, 0] }),
        K(0.86, { rArm: [-40, 0, 14], spine1: [14, 20, 0] }),
        K(1, {})
      ] },
      { dur: 0.85, hitAt: 0.6, keys: [
        K(0, {}),
        K(0.38, { rArm: [-80, 0, 35], rForeArm: [-70, 0, 0], spine1: [0, 30, 0], hips: [0, 10, 0], lArm: [-10, 0, 25] }),
        K(0.6, { rArm: [-85, 0, -60], rForeArm: [-15, 0, 0], spine1: [6, -36, 0], hips: [4, -16, 0], lUpLeg: [-16, 0, 0] }),
        K(0.86, { rArm: [-80, 0, -55], spine1: [0, -24, 0] }),
        K(1, {})
      ] }
    ],
    heavy: { dur: 1.1, hitAt: 0.62, keys: [
      K(0, {}),
      K(0.45, { rArm: [-175, 0, -15], rForeArm: [-75, 0, 0], spine1: [-20, 0, 0], hips: [-4, 0, 0], lArm: [-20, 0, 20] }),
      K(0.62, { rArm: [-25, 0, 0], rForeArm: [-20, 0, 0], spine1: [30, 0, 0], spine2: [10, 0, 0], hips: [12, 0, 0], head: [8, 0, 0], lUpLeg: [-30, 0, 0], lLeg: [26, 0, 0] }),
      K(0.9, { rArm: [-25, 0, 0], spine1: [22, 0, 0], lUpLeg: [-22, 0, 0], lLeg: [20, 0, 0] }),
      K(1, {})
    ] }
  },

  hammer: {
    light: [
      { dur: 1.0, hitAt: 0.65, keys: [
        K(0, {}),
        K(0.45, { rArm: [-175, 0, -10], rForeArm: [-70, 0, 0], rHand: [20, 0, 0], spine1: [-20, 0, 0], spine2: [-8, 0, 0], lArm: [-40, 0, 25] }),
        K(0.65, { rArm: [-25, 0, 0], rForeArm: [-15, 0, 0], rHand: [-25, 0, 0], spine1: [32, 0, 0], spine2: [12, 0, 0], hips: [14, 0, 0], head: [8, 0, 0], lArm: [-30, 0, 20], lUpLeg: [-26, 0, 0], lLeg: [24, 0, 0] }),
        K(0.9, { rArm: [-25, 0, 0], spine1: [24, 0, 0], lUpLeg: [-20, 0, 0], lLeg: [18, 0, 0] }),
        K(1, {})
      ] },
      { dur: 1.0, hitAt: 0.62, keys: [
        K(0, {}),
        K(0.42, { rArm: [-90, 0, -60], rForeArm: [-45, 0, 0], spine1: [0, -40, 0], spine: [0, -14, 0], hips: [0, -16, 0], lArm: [0, 0, 30] }),
        K(0.62, { rArm: [-90, 0, 50], rForeArm: [-15, 0, 0], spine1: [4, 44, 0], spine: [0, 16, 0], hips: [4, 22, 0], lUpLeg: [-20, 0, 0], lLeg: [18, 0, 0] }),
        K(0.9, { rArm: [-85, 0, 46], spine1: [0, 30, 0] }),
        K(1, {})
      ] }
    ],
    heavy: { dur: 1.3, hitAt: 0.68, keys: [
      K(0, {}),
      K(0.5, { rArm: [-180, 0, -5], rForeArm: [-70, 0, 0], spine1: [-26, 0, 0], spine2: [-10, 0, 0], hips: [-6, 0, 0], lArm: [-50, 0, 25], lUpLeg: [8, 0, 0], rUpLeg: [-8, 0, 0] }),
      K(0.68, { rArm: [-20, 0, 0], rForeArm: [-10, 0, 0], spine1: [38, 0, 0], spine2: [14, 0, 0], hips: [16, 0, 0], head: [10, 0, 0], lArm: [-35, 0, 20], lUpLeg: [-36, 0, 0], lLeg: [32, 0, 0], rUpLeg: [10, 0, 0], rLeg: [26, 0, 0] }),
      K(0.92, { rArm: [-20, 0, 0], spine1: [28, 0, 0], lUpLeg: [-28, 0, 0], lLeg: [24, 0, 0] }),
      K(1, {})
    ] }
  },

  unarmed: {
    light: [
      { dur: 0.4, hitAt: 0.5, keys: [
        K(0, {}),
        K(0.3, { rArm: [-30, 0, -15], rForeArm: [-100, 0, 0], spine1: [0, -15, 0], hips: [0, -6, 0], lArm: [-50, 0, 10], lForeArm: [-90, 0, 0] }),
        K(0.5, { rArm: [-90, 0, 0], rForeArm: [-5, 0, 0], spine1: [4, 15, 0], hips: [0, 10, 0], lArm: [-50, 0, 10], lForeArm: [-90, 0, 0] }),
        K(1, {})
      ] },
      { dur: 0.4, hitAt: 0.5, keys: [
        K(0, {}),
        K(0.3, { lArm: [-30, 0, 15], lForeArm: [-100, 0, 0], spine1: [0, 15, 0], hips: [0, 6, 0], rArm: [-50, 0, -10], rForeArm: [-90, 0, 0] }),
        K(0.5, { lArm: [-90, 0, 0], lForeArm: [-5, 0, 0], spine1: [4, -15, 0], hips: [0, -10, 0], rArm: [-50, 0, -10], rForeArm: [-90, 0, 0] }),
        K(1, {})
      ] }
    ],
    heavy: { dur: 0.7, hitAt: 0.6, keys: [
      K(0, {}),
      K(0.4, { rArm: [-20, 0, -20], rForeArm: [-110, 0, 0], spine1: [0, -35, 0], hips: [0, -14, 0], lArm: [-60, 0, 10], lForeArm: [-90, 0, 0] }),
      K(0.6, { rArm: [-95, 0, 0], rForeArm: [-5, 0, 0], spine1: [8, 40, 0], hips: [8, 20, 0], lUpLeg: [-26, 0, 0], lLeg: [20, 0, 0], lArm: [-60, 0, 10], lForeArm: [-90, 0, 0] }),
      K(1, {})
    ] }
  }
};

// ---------------------------------------------------------------------------
// ПРОЧИЕ ПОЗЫ (постоянные слои)
// ---------------------------------------------------------------------------
const POSE_HOLD_ONE = { rArm: [-14, 0, 0], rForeArm: [-28, 0, 0], rHand: [0, 0, 0] };
const POSE_HOLD_TWO = { rArm: [-38, 0, -6], rForeArm: [-48, 0, 0], lArm: [-42, 0, -22], lForeArm: [-52, 0, 0], spine1: [0, -6, 0] };
const POSE_HOLD_SHIELD = { lArm: [-28, 0, 12], lForeArm: [-72, 0, 0], lShoulder: [0, 0, 0] };
const POSE_BLOCK_SHIELD = { lArm: [-58, 0, 6], lForeArm: [-86, 0, 0], lShoulder: [0, 6, 0], spine: [0, -8, 0], spine1: [4, -14, 0], hips: [0, -8, 0], head: [4, 6, 0], lUpLeg: [-8, 0, 0], lLeg: [10, 0, 0], rUpLeg: [6, 0, 0], rLeg: [14, 0, 0] };
const POSE_BLOCK_WEAPON = { rArm: [-70, 0, 18], rForeArm: [-95, 0, 0], lArm: [-70, 0, -10], lForeArm: [-95, 0, 0], spine1: [5, 0, 0], head: [4, 0, 0], lLeg: [10, 0, 0], rLeg: [10, 0, 0], lUpLeg: [-6, 0, 0], rUpLeg: [-6, 0, 0] };
const POSE_DODGE = { spine: [10, 0, 0], spine1: [26, 0, 0], spine2: [10, 0, 0], hips: [12, 0, 0], head: [10, 0, 0], rArm: [26, 0, -12], lArm: [26, 0, 12], rForeArm: [-20, 0, 0], lForeArm: [-20, 0, 0], lUpLeg: [-38, 0, 0], lLeg: [52, 0, 0], rUpLeg: [-30, 0, 0], rLeg: [48, 0, 0] };
const POSE_HIT = { spine: [-6, 0, 0], spine1: [-16, 0, 0], spine2: [-6, 0, 0], head: [-16, 0, 0], neck: [-6, 0, 0], rArm: [18, 0, -14], lArm: [18, 0, 14], rForeArm: [-12, 0, 0], lForeArm: [-12, 0, 0], hips: [-4, 0, 0], lUpLeg: [6, 0, 0], rUpLeg: [-4, 0, 0] };
const POSE_INTERACT = { rArm: [-72, 0, -6], rForeArm: [-38, 0, 0], rHand: [-10, 0, 0], spine1: [8, -6, 0], head: [10, -6, 0], lArm: [8, 0, 6] };
const POSE_LAND = { hips: [10, 0, 0], spine1: [14, 0, 0], head: [-6, 0, 0], lUpLeg: [-34, 0, 0], lLeg: [52, 0, 0], rUpLeg: [-34, 0, 0], rLeg: [52, 0, 0], lFoot: [-16, 0, 0], rFoot: [-16, 0, 0], rArm: [10, 0, -12], lArm: [10, 0, 12] };

const BONE_KEYS = ['hips', 'spine', 'spine1', 'spine2', 'lShoulder', 'lArm', 'lForeArm', 'lHand',
  'rShoulder', 'rArm', 'rForeArm', 'rHand', 'neck', 'head', 'lUpLeg', 'lLeg', 'lFoot', 'rUpLeg', 'rLeg', 'rFoot'];

// ---------------------------------------------------------------------------
function sampleKeys(keys, t, out, w) {
  if (w <= 0.0005) return;
  t = clamp01(t);
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const f = smooth((t - a.t) / Math.max(1e-5, b.t - a.t));
  const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
  names.forEach(n => {
    const pa = a.pose[n] || Z3, pb = b.pose[n] || Z3;
    const o = out[n] || (out[n] = [0, 0, 0]);
    o[0] += lerp(pa[0], pb[0], f) * w;
    o[1] += lerp(pa[1], pb[1], f) * w;
    o[2] += lerp(pa[2], pb[2], f) * w;
  });
}

function addPose(out, pose, w) {
  if (w <= 0.0005) return;
  for (const n in pose) {
    const o = out[n] || (out[n] = [0, 0, 0]);
    o[0] += pose[n][0] * w; o[1] += pose[n][1] * w; o[2] += pose[n][2] * w;
  }
}

function add(out, n, x, y, z) {
  const o = out[n] || (out[n] = [0, 0, 0]);
  o[0] += x; o[1] += y; o[2] += z;
}

function findBone(root, name) {
  let found = null;
  const low = name.toLowerCase();
  root.traverse(o => {
    if (!found && o.name === name) found = o;
  });
  if (found) return found;
  root.traverse(o => {
    if (found) return;
    const n = (o.name || '').toLowerCase();
    if (n === low || n.endsWith(':' + low) || n.endsWith('_' + low)) found = o;
  });
  return found;
}

// ---------------------------------------------------------------------------
export function createAnimator(pivot, model, clips) {
  const mixer = new THREE.AnimationMixer(model);
  const P = CONFIG.player;

  // Кости
  const bones = {};
  for (const key of BONE_KEYS) {
    const b = findBone(model, CONFIG.bones[key]);
    if (b) bones[key] = b; else console.warn('[animations] кость не найдена:', key, CONFIG.bones[key]);
  }
  // Порядок применения: от родителей к детям (по глубине в иерархии)
  const depth = o => { let d = 0; while (o.parent) { d++; o = o.parent; } return d; };
  const order = Object.keys(bones).sort((a, b) => depth(bones[a]) - depth(bones[b]));

  // Действия миксера
  const act = {};
  for (const k of ['idle', 'walk', 'run', 'jump', 'death']) {
    if (!clips[k]) continue;
    const a = mixer.clipAction(clips[k]);
    a.enabled = true;
    a.setEffectiveWeight(k === 'idle' ? 1 : 0);
    if (k === 'jump' || k === 'death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    else a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    if (k === 'walk' || k === 'run') a.setEffectiveTimeScale(0);
    act[k] = a;
  }
  const dur = k => (clips[k] ? clips[k].duration : 1);

  // Состояние
  const S = {
    time: 0, phase: 0,
    w: { idle: 1, walk: 0, run: 0, air: 0, dead: 0 },
    air: false, lastVy: 0, jumpStarted: false,
    dead: false,
    lookYaw: 0, lookPitch: 0, twist: 0, hipsTwist: 0, lean: 0,
    hold1: 0, hold2: 0, holdShield: 0, block: 0, atkW: 0,
    climb: 0, turnAmt: 0,
    atk: null, prevAtk: null,
    dodge: null, hit: null, interact: null, land: null,
    onDeathEnd: null
  };

  const q0 = new THREE.Quaternion(), qP = new THREE.Quaternion(), qPi = new THREE.Quaternion();
  const qR = new THREE.Quaternion(), qRw = new THREE.Quaternion(), qLoc = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'XYZ');

  mixer.addEventListener('finished', e => {
    if (e.action === act.death && S.onDeathEnd) { const f = S.onDeathEnd; S.onDeathEnd = null; f(); }
  });

  let testPose = null;

  // ---------- Публичные действия ----------
  function getAttackInfo(type, index, heavy) {
    const set = STRIKES[type] || STRIKES.sword1h;
    const strike = heavy ? set.heavy : set.light[index % set.light.length];
    return { dur: strike.dur, hitAt: strike.hitAt, count: set.light.length };
  }

  // opts: { type, index, heavy, speed, onHit, onEnd }
  function attack(opts) {
    const set = STRIKES[opts.type] || STRIKES.sword1h;
    const strike = opts.heavy ? set.heavy : set.light[(opts.index || 0) % set.light.length];
    if (S.atk) S.prevAtk = { strike: S.atk.strike, f: clamp01(S.atk.t / S.atk.dur), w: 1 };
    const duration = strike.dur / Math.max(0.2, opts.speed || 1);
    S.atk = { strike, t: 0, dur: duration, hitFired: false, onHit: opts.onHit, onEnd: opts.onEnd };
    return { dur: duration, hitAt: strike.hitAt * duration };
  }
  function cancelAttack() { S.atk = null; }
  function dodge(d) { S.dodge = { t: 0, dur: d || P.dodgeTime }; S.atk = null; }
  function hit(dirX) { S.hit = { t: 0, dur: 0.42, dir: dirX || 0 }; }
  function interact() { S.interact = { t: 0, dur: 0.75 }; }
  function die(onEnd) {
    if (S.dead || !act.death) return;
    S.dead = true; S.atk = null; S.dodge = null; S.hit = null; S.interact = null;
    S.onDeathEnd = onEnd || null;
    act.death.reset(); act.death.setEffectiveTimeScale(1); act.death.play();
  }
  function revive() {
    S.dead = false;
    if (act.death) act.death.stop();
    if (act.death) { act.death.enabled = true; act.death.setEffectiveWeight(0); act.death.play(); }
    S.w.dead = 0; S.w.idle = 1;
  }
  const isBusy = () => !!(S.atk || S.dodge || S.interact || S.dead);
  const isAttacking = () => !!S.atk;
  const attackProgress = () => (S.atk ? S.atk.t / S.atk.dur : 0);

  // ---------- Обновление ----------
  function update(dt, inp) {
    dt = Math.min(dt, 0.05);
    S.time += dt;
    const t = S.time;
    const speed = inp.speed || 0;
    const rate = Math.min(1, dt * 12);

    // --- воздух / прыжок / приземление
    const grounded = inp.grounded !== false;
    if (!grounded && !S.air && !S.dead) {
      S.air = true; S.jumpStarted = true;
      if (act.jump) {
        act.jump.reset(); act.jump.setEffectiveTimeScale(1); act.jump.play();
        const vy = inp.velY || 0;
        if (vy > 1) {
          const airTime = Math.max(0.35, (2 * vy) / Math.abs(P.gravity));
          act.jump.setEffectiveTimeScale(dur('jump') / airTime);
        } else {
          act.jump.time = dur('jump') * 0.4;
          act.jump.setEffectiveTimeScale(0.4);
        }
      }
    }
    if (!grounded) S.lastVy = inp.velY || 0;
    if (grounded && S.air) {
      S.air = false;
      S.land = { t: 0, dur: 0.32, k: clamp(-S.lastVy / 9, 0.35, 1) };
    }

    // --- веса клипов
    const sN = clamp01(speed / 0.8);
    const rN = clamp01((speed - P.walkSpeed) / Math.max(0.1, P.runSpeed - P.walkSpeed));
    const tgt = {
      idle: 1 - sN, walk: sN * (1 - rN), run: sN * rN,
      air: S.air ? 1 : 0, dead: S.dead ? 1 : 0
    };
    const wRate = (S.air || S.dead) ? Math.min(1, dt * 16) : rate;
    for (const k of ['idle', 'walk', 'run']) S.w[k] += (tgt[k] - S.w[k]) * wRate;
    S.w.air += (tgt.air - S.w.air) * Math.min(1, dt * 14);
    S.w.dead += (tgt.dead - S.w.dead) * Math.min(1, dt * 14);
    const free = clamp01(1 - S.w.air - S.w.dead);
    if (act.idle) act.idle.setEffectiveWeight(S.w.idle * free);
    if (act.walk) act.walk.setEffectiveWeight(S.w.walk * free);
    if (act.run) act.run.setEffectiveWeight(S.w.run * free);
    if (act.jump) act.jump.setEffectiveWeight(S.w.air);
    if (act.death) act.death.setEffectiveWeight(S.w.dead);

    // --- общая фаза шага (ноги не скользят, переходы без рывков)
    const strideW = P.walkSpeed * dur('walk'), strideR = P.runSpeed * dur('run');
    const stride = lerp(strideW, strideR, rN) || 1;
    S.phase = (S.phase + (speed / stride) * dt) % 1;
    if (act.walk) act.walk.time = S.phase * dur('walk');
    if (act.run) act.run.time = S.phase * dur('run');

    mixer.update(dt);

    if (S.dead) return; // при смерти процедурные слои не применяются

    // --- процедурные слои
    const out = {};
    const calm = free * (1 - S.atkW * 0.5);

    // дыхание
    const br = Math.sin(t * 1.7);
    const idleK = S.w.idle * free;
    add(out, 'spine1', br * 1.1 * idleK, 0, 0);
    add(out, 'spine', br * 0.8 * idleK, 0, 0);
    add(out, 'lShoulder', 0, 0, br * 1.0 * idleK);
    add(out, 'rShoulder', 0, 0, -br * 1.0 * idleK);
    add(out, 'head', -br * 0.8 * idleK, Math.sin(t * 0.5) * 2 * idleK, 0);

    // голова и шея смотрят на цель (lookYaw: + = цель слева; lookPitch: + = вверх)
    S.lookYaw += (clamp(inp.lookYaw || 0, -1.1, 1.1) - S.lookYaw) * Math.min(1, dt * 6);
    S.lookPitch += (clamp(inp.lookPitch || 0, -0.6, 0.6) - S.lookPitch) * Math.min(1, dt * 6);
    const ly = S.lookYaw / DEG, lp = S.lookPitch / DEG;
    add(out, 'head', -lp * 0.5, ly * 0.55, 0);
    add(out, 'neck', -lp * 0.3, ly * 0.35, 0);
    add(out, 'spine', 0, ly * 0.1, 0);

    // наклон вперёд при беге и в повороте, скрутка при повороте на месте
    const lean = clamp01(speed / P.sprintSpeed);
    add(out, 'spine1', lean * 7 * free, 0, 0);
    add(out, 'spine', lean * 3 * free, 0, 0);
    add(out, 'hips', lean * 2 * free, 0, 0);
    const turn = inp.turnRate || 0;
    S.twist += (clamp(-turn * 4, -18, 18) - S.twist) * Math.min(1, dt * 8);
    S.hipsTwist += (clamp(turn * 1.5, -8, 8) - S.hipsTwist) * Math.min(1, dt * 8);
    S.lean += (clamp(-turn * 1.2, -8, 8) * clamp01(speed / 2) - S.lean) * Math.min(1, dt * 6);
    add(out, 'spine1', 0, S.twist * 0.6, S.lean * 0.7);
    add(out, 'spine', 0, S.twist * 0.4, S.lean * 0.3);
    add(out, 'hips', 0, S.hipsTwist, S.lean * 0.4);
    // шаги на месте при повороте
    S.turnAmt += ((speed < 0.3 ? clamp01(Math.abs(turn) / 2) : 0) - S.turnAmt) * Math.min(1, dt * 8);
    const stepSin = Math.sin(t * 9);
    add(out, 'lUpLeg', -Math.max(0, stepSin) * 14 * S.turnAmt, 0, 0);
    add(out, 'lLeg', Math.max(0, stepSin) * 16 * S.turnAmt, 0, 0);
    add(out, 'rUpLeg', -Math.max(0, -stepSin) * 14 * S.turnAmt, 0, 0);
    add(out, 'rLeg', Math.max(0, -stepSin) * 16 * S.turnAmt, 0, 0);

    // подъём по ступеням: колени выше, в такт шагу
    S.climb += ((inp.climb || 0) - S.climb) * Math.min(1, dt * 6);
    if (S.climb > 0.01) {
      const ps = Math.sin(S.phase * Math.PI * 2);
      add(out, 'lUpLeg', -Math.max(0, ps) * 26 * S.climb, 0, 0);
      add(out, 'lLeg', Math.max(0, ps) * 30 * S.climb, 0, 0);
      add(out, 'rUpLeg', -Math.max(0, -ps) * 26 * S.climb, 0, 0);
      add(out, 'rLeg', Math.max(0, -ps) * 30 * S.climb, 0, 0);
      add(out, 'spine1', 5 * S.climb, 0, 0);
    }

    // стойки оружия и щита
    const stance = inp.stance || 'none';
    S.hold1 += ((stance === 'one' ? 1 : 0) - S.hold1) * rate;
    S.hold2 += ((stance === 'two' ? 1 : 0) - S.hold2) * rate;
    S.holdShield += ((inp.shield ? 1 : 0) - S.holdShield) * rate;
    S.block += ((inp.blocking ? 1 : 0) - S.block) * Math.min(1, dt * 14);
    const holdGate = calm * (1 - S.block);
    addPose(out, POSE_HOLD_ONE, S.hold1 * holdGate * 0.8);
    addPose(out, POSE_HOLD_TWO, S.hold2 * holdGate * 0.8);
    addPose(out, POSE_HOLD_SHIELD, S.holdShield * holdGate * 0.9);

    // блок: со щитом или оружием
    const useShield = !!inp.shield && stance !== 'two';
    addPose(out, useShield ? POSE_BLOCK_SHIELD : POSE_BLOCK_WEAPON, S.block * (S.atk ? 0 : 1));

    // атака
    let atkTarget = 0;
    if (S.prevAtk) {
      S.prevAtk.w -= dt / 0.15;
      if (S.prevAtk.w <= 0) S.prevAtk = null;
      else sampleKeys(S.prevAtk.strike.keys, S.prevAtk.f, out, smooth(S.prevAtk.w));
    }
    if (S.atk) {
      atkTarget = 1;
      S.atk.t += dt;
      const f = S.atk.t / S.atk.dur;
      sampleKeys(S.atk.strike.keys, f, out, 1);
      if (!S.atk.hitFired && f >= S.atk.strike.hitAt) { S.atk.hitFired = true; if (S.atk.onHit) S.atk.onHit(); }
      if (f >= 1) { const e = S.atk.onEnd; S.atk = null; if (e) e(); }
    }
    S.atkW += (atkTarget - S.atkW) * Math.min(1, dt * 12);

    // уклонение
    if (S.dodge) {
      S.dodge.t += dt;
      const f = S.dodge.t / S.dodge.dur;
      addPose(out, POSE_DODGE, Math.sin(clamp01(f) * Math.PI));
      if (f >= 1) S.dodge = null;
    }
    // урон
    if (S.hit) {
      S.hit.t += dt;
      const f = S.hit.t / S.hit.dur;
      const env = f < 0.2 ? f / 0.2 : Math.max(0, 1 - (f - 0.2) / 0.8);
      addPose(out, POSE_HIT, env);
      add(out, 'spine1', 0, S.hit.dir * 10 * env, 0);
      add(out, 'head', 0, S.hit.dir * 8 * env, 0);
      if (f >= 1) S.hit = null;
    }
    // взаимодействие
    if (S.interact) {
      S.interact.t += dt;
      const f = S.interact.t / S.interact.dur;
      addPose(out, POSE_INTERACT, Math.sin(clamp01(f) * Math.PI));
      if (f >= 1) S.interact = null;
    }
    // приземление
    if (S.land) {
      S.land.t += dt;
      const f = S.land.t / S.land.dur;
      const env = f < 0.25 ? f / 0.25 : Math.max(0, 1 - (f - 0.25) / 0.75);
      addPose(out, POSE_LAND, env * S.land.k);
      if (f >= 1) S.land = null;
    }

    if (testPose) addPose(out, testPose, 1);
    applyPose(out);
  }

  // Применение накопленных поворотов: Rc (система персонажа) → локальный поворот кости
  function applyPose(out) {
    pivot.updateMatrixWorld(true);
    pivot.getWorldQuaternion(q0);
    for (const key of order) {
      const v = out[key];
      if (!v) continue;
      if (Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) < 0.02) continue;
      const bone = bones[key];
      eul.set(v[0] * DEG, v[1] * DEG, v[2] * DEG, 'XYZ');
      qR.setFromEuler(eul);
      qRw.copy(q0).multiply(qR).multiply(qPi.copy(q0).invert());   // Rw = q0 · Rc · q0⁻¹
      bone.parent.getWorldQuaternion(qP);
      qPi.copy(qP).invert();
      qLoc.copy(qPi).multiply(qRw).multiply(qP);                    // P⁻¹ · Rw · P
      bone.quaternion.premultiply(qLoc);
      bone.updateMatrixWorld(true);
    }
  }

  // Отладка: window.__anim.test('rArm', -90, 0, 0) — проверить кость вручную
  function test(key, x, y, z) { testPose = key ? { [key]: [x || 0, y || 0, z || 0] } : null; }

  return {
    mixer, bones, update, attack, cancelAttack, dodge, hit, interact, die, revive,
    getAttackInfo, isBusy, isAttacking, attackProgress, test,
    get dead() { return S.dead; },
    get state() { return S; }
  };
}
