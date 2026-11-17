// js/equipment.js — экипировка: оружие, щиты и броня крепятся к костям Miku и двигаются вместе с телом
//
// Как работает крепление:
//  • При создании запоминается положение каждой кости в T-позе (это исходная поза модели).
//  • Предмет ориентируется в системе персонажа T-позы (+Z вперёд, +X влево, +Y вверх),
//    затем пересчитывается в локальную систему кости. Поэтому предмет следует за костью
//    при любой анимации, не зависит от локальных осей кости и не искажается её масштабом (0.01).
//  • createEquipment() нужно вызывать ДО первого animator.update(), пока скелет в T-позе.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { loadItemModel } from './loader.js';

const DEG = Math.PI / 180;

export const SLOT_INFO = {
  head:      { label: 'Шлем' },
  shoulders: { label: 'Наплечники' },
  chest:     { label: 'Нагрудник' },
  bracers:   { label: 'Наручи' },
  gloves:    { label: 'Перчатки' },
  belt:      { label: 'Пояс' },
  cloak:     { label: 'Плащ' },
  pants:     { label: 'Штаны' },
  boots:     { label: 'Обувь' },
  extra:     { label: 'Доп. элемент' },
  mainHand:  { label: 'Оружие' },
  offHand:   { label: 'Щит' }
};
export const SLOT_ORDER = ['head', 'shoulders', 'chest', 'bracers', 'gloves', 'belt', 'cloak', 'pants', 'boots', 'extra', 'mainHand', 'offHand'];

// Где на скелете сидит броня (координаты в метрах в системе персонажа в T-позе).
// fit: [ось модели, желаемый размер в метрах]. Для парных слотов правая сторона зеркалится.
const ARMOR_MOUNT = {
  head:      { bone: 'head', pos: [0, 0.145, 0.015], fit: ['y', 0.30] },
  chest:     { bone: 'spine', pos: [0, -0.08, 0], fit: ['y', 0.46] },
  shoulders: { pair: true, bone: ['lArm', 'rArm'], pos: [0.045, 0.025, 0], fit: ['y', 0.2] },
  bracers:   { pair: true, bone: ['lForeArm', 'rForeArm'], pos: [0.09, 0, 0], fit: ['y', 0.17], rot: [0, 0, -90] },
  gloves:    { pair: true, bone: ['lHand', 'rHand'], pos: [0.045, 0, 0], fit: ['y', 0.15], rot: [0, 0, -90] },
  belt:      { bone: 'hips', pos: [0, 0.11, 0], fit: ['x', 0.34] },
  cloak:     { bone: 'spine', pos: [0, -0.2, -0.1], fit: ['y', 0.8] },
  pants:     { bone: 'hips', pos: [0, -0.12, 0], fit: ['y', 0.5] },
  boots:     { pair: true, bone: ['lFoot', 'rFoot'], pos: [0, 0.03, 0.05], fit: ['y', 0.16] },
  extra:     { bone: 'spine', pos: [0, 0, -0.12], fit: ['y', 0.3] }
};

// Положение центра рукояти от низа оружия (доля длины)
const GRIP_FRAC = { sword1h: 0.13, sword2h: 0.15, dagger: 0.12, axe: 0.22, hammer: 0.24, spear: 0.4, staff: 0.45 };
const HAND_CENTER = { r: [-0.065, -0.005, 0], l: [0.065, -0.005, 0] }; // от кости кисти до центра ладони

// Ориентация модели оружия в T-позе: клинок (+Y модели) вперёд (+Z), плоскость клинка вбок
const WEAPON_BASIS = [[-1, 0, 0], [0, 0, 1], [0, 1, 0]];
// Щит: верх вдоль предплечья (+X для левой руки), лицевая сторона вперёд при согнутой руке
const SHIELD_BASIS = [[0, 1, 0], [1, 0, 0], [0, 0, -1]];

// Преобразование записи из CONFIG в описание предмета
export function itemDefFromConfig(id) {
  const w = CONFIG.weapons[id];
  if (w) return { id, kind: 'weapon', slot: 'mainHand', wtype: w.type, name: w.name, rarity: w.rarity,
    file: w.file, length: w.length, grip: w.grip || {}, twoHanded: w.type === 'sword2h', damage: w.damage, speed: w.speed };
  const s = CONFIG.shields[id];
  if (s) return { id, kind: 'shield', slot: 'offHand', name: s.name, rarity: s.rarity,
    file: s.file, length: s.length || 0.72, grip: s.grip || {}, block: s.block };
  return null;
}

export function createEquipment({ pivot, animator, onChange }) {
  const bones = animator.bones;
  const equipped = {};   // slot -> { def, holders[], wraps[], base[], pop }
  const tokens = {};     // защита от гонок при быстрых кликах

  // ---- Запоминаем T-позу ----
  pivot.updateMatrixWorld(true);
  const q0c = pivot.getWorldQuaternion(new THREE.Quaternion());
  const pScale = pivot.getWorldScale(new THREE.Vector3()).x || 1;
  const rest = {};
  for (const k in bones) {
    const b = bones[k];
    rest[k] = {
      q: b.getWorldQuaternion(new THREE.Quaternion()),
      s: (b.getWorldScale(new THREE.Vector3()).x / pScale) || 1
    };
  }

  const basisQuat = ([x, y, z]) => {
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  };
  const eulerQuat = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler((r[0] || 0) * DEG, (r[1] || 0) * DEG, (r[2] || 0) * DEG, 'XYZ'));

  // Держатель на кости: положение и ориентация заданы в системе персонажа в T-позе
  function makeHolder(boneKey, posChar, quatChar) {
    const bone = bones[boneKey];
    if (!bone) return null;
    const r = rest[boneKey];
    const bqi = r.q.clone().invert();
    const h = new THREE.Object3D();
    h.quaternion.copy(bqi).multiply(q0c).multiply(quatChar);
    h.position.copy(posChar).applyQuaternion(q0c).applyQuaternion(bqi).divideScalar(r.s);
    h.scale.setScalar(1 / r.s);          // внутри держателя единицы = метры
    bone.add(h);
    return h;
  }

  function sizeOf(model) {
    const box = new THREE.Box3().setFromObject(model);
    return { box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
  }

  function castShadows(o) { o.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = false; n.frustumCulled = false; } }); }

  // ---- Сборка креплений для предмета ----
  function build(slot, def, models) {
    const rec = equipped[slot] || (equipped[slot] = {});
    models.forEach(m => { m.position.set(0, 0, 0); m.updateMatrixWorld(true); });
    // убрать прежние держатели
    (rec.holders || []).forEach(h => h && h.parent && h.parent.remove(h));
    rec.def = def; rec.holders = []; rec.wraps = []; rec.base = [];
    const g = def.grip || {};
    const tilt = g.tilt != null ? g.tilt : 10;
    const gpos = g.pos || [0, 0, 0];
    const grot = g.rot || [0, 0, 0];
    const mul = g.mul != null ? g.mul : 1;

    if (def.kind === 'weapon') {
      const model = models[0];
      const { size } = sizeOf(model);
      const len = size.y || 1;
      const k = ((def.length || len) / len) * mul;
      const frac = GRIP_FRAC[def.wtype] != null ? GRIP_FRAC[def.wtype] : 0.15;
      model.position.set(0, -frac * len, 0);
      const quat = eulerQuat(grot).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tilt * DEG)).multiply(basisQuat(WEAPON_BASIS));
      const holder = makeHolder('rHand', new THREE.Vector3(...HAND_CENTER.r), quat);
      if (!holder) throw new Error('нет кости правой кисти');
      const wrap = new THREE.Object3D();
      wrap.position.set(gpos[0], gpos[1], gpos[2]);
      wrap.add(model); holder.add(wrap);
      rec.holders.push(holder); rec.wraps.push(wrap); rec.base.push(k);
    } else if (def.kind === 'shield') {
      const model = models[0];
      const { size, center } = sizeOf(model);
      const k = ((def.length || size.y) / (size.y || 1)) * mul;
      model.position.set(-center.x, -center.y, -center.z);
      const flip = g.flip ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) : new THREE.Quaternion();
      const quat = eulerQuat(grot).multiply(basisQuat(SHIELD_BASIS)).multiply(flip);
      const holder = makeHolder('lForeArm', new THREE.Vector3(0.09, 0, -0.07), quat);
      if (!holder) throw new Error('нет кости левого предплечья');
      const wrap = new THREE.Object3D();
      wrap.position.set(gpos[0], gpos[1], gpos[2]);
      wrap.add(model); holder.add(wrap);
      rec.holders.push(holder); rec.wraps.push(wrap); rec.base.push(k);
    } else {
      const m = ARMOR_MOUNT[slot];
      if (!m) throw new Error('неизвестный слот: ' + slot);
      const sides = m.pair ? 2 : 1;
      for (let i = 0; i < sides; i++) {
        const model = models[i];
        const { size, center } = sizeOf(model);
        const axis = (def.fit && def.fit[0]) || m.fit[0];
        const want = (def.fit && def.fit[1]) || m.fit[1];
        const k = (want / (size[axis] || 1)) * mul;
        model.position.set(-center.x, -center.y, -center.z);
        const mirrored = i === 1;
        const mrot = m.rot || [0, 0, 0];
        const drot = def.rot || [0, 0, 0];
        const rr = mirrored ? [mrot[0], -mrot[1], -mrot[2]] : mrot;
        const dr = mirrored ? [drot[0] + grot[0], -(drot[1] + grot[1]), -(drot[2] + grot[2])] : [drot[0] + grot[0], drot[1] + grot[1], drot[2] + grot[2]];
        const quat = eulerQuat(dr).multiply(eulerQuat(rr));
        const px = (m.pos[0] + (def.pos ? def.pos[0] : 0)) * (mirrored ? -1 : 1);
        const pos = new THREE.Vector3(px, m.pos[1] + (def.pos ? def.pos[1] : 0), m.pos[2] + (def.pos ? def.pos[2] : 0));
        const boneKey = Array.isArray(m.bone) ? m.bone[i] : m.bone;
        const holder = makeHolder(boneKey, pos, quat);
        if (!holder) throw new Error('нет кости: ' + boneKey);
        const wrap = new THREE.Object3D();
        wrap.position.set(gpos[0] * (mirrored ? -1 : 1), gpos[1], gpos[2]);
        wrap.add(model); holder.add(wrap);
        if (mirrored) wrap.scale.x = -1;
        rec.holders.push(holder); rec.wraps.push(wrap); rec.base.push(k * (mirrored ? -1 : 1));
      }
    }
    rec.models = models;
    rec.pop = 0;                                       // анимация появления
    rec.wraps.forEach((w, i) => { const b = rec.base[i]; w.scale.set(Math.abs(b) * 0.01 * Math.sign(b), Math.abs(b) * 0.01, Math.abs(b) * 0.01); });
    models.forEach(castShadows);
  }

  // ---- Надеть ----
  async function equip(def) {
    if (!def || !def.slot) return { ok: false, reason: 'Предмет нельзя надеть' };
    if (!def.file) return { ok: false, reason: 'У предмета нет 3D-модели' };
    const slot = def.slot;
    const tok = (tokens[slot] = (tokens[slot] || 0) + 1);
    let models;
    try {
      const count = (ARMOR_MOUNT[slot] && ARMOR_MOUNT[slot].pair) ? 2 : 1;
      models = [];
      for (let i = 0; i < count; i++) models.push(await loadItemModel(def.file));
    } catch (e) {
      console.warn('[equipment]', e);
      return { ok: false, reason: 'Не удалось загрузить модель: ' + def.name };
    }
    if (tokens[slot] !== tok) return { ok: false, reason: 'cancelled' };

    const removed = [];
    if (def.twoHanded && equipped.offHand && equipped.offHand.def) { removed.push(equipped.offHand.def); detach('offHand'); }
    if (slot === 'offHand' && equipped.mainHand && equipped.mainHand.def && equipped.mainHand.def.twoHanded) { removed.push(equipped.mainHand.def); detach('mainHand'); }
    if (equipped[slot] && equipped[slot].def) detach(slot);

    try { build(slot, def, models); }
    catch (e) { console.warn('[equipment]', e); delete equipped[slot]; return { ok: false, reason: e.message }; }

    onChange && onChange(slot, def);
    removed.forEach(d => onChange && onChange(d.slot, null));
    return { ok: true, removed };
  }

  function detach(slot) {
    const rec = equipped[slot];
    if (!rec) return null;
    (rec.holders || []).forEach(h => h && h.parent && h.parent.remove(h));
    const def = rec.def;
    delete equipped[slot];
    return def;
  }

  function unequip(slot) {
    tokens[slot] = (tokens[slot] || 0) + 1;
    const def = detach(slot);
    if (def && onChange) onChange(slot, null);
    return def;
  }
  function unequipAll() { Object.keys(equipped).forEach(unequip); }

  // ---- Запросы ----
  const get = slot => (equipped[slot] ? equipped[slot].def : null);
  const isEquipped = id => Object.values(equipped).some(r => r.def && r.def.id === id);
  function stance() {
    const m = get('mainHand');
    return !m ? 'none' : (m.twoHanded ? 'two' : 'one');
  }
  const hasShield = () => !!get('offHand');
  const weaponType = () => (get('mainHand') ? get('mainHand').wtype : 'unarmed');
  const getWeapon = () => get('mainHand');

  // ---- Анимация появления ----
  function update(dt) {
    for (const slot in equipped) {
      const rec = equipped[slot];
      if (rec.pop >= 1) continue;
      rec.pop = Math.min(1, rec.pop + dt / 0.28);
      const e = rec.pop, s = e < 1 ? 1 - Math.pow(1 - e, 3) + Math.sin(e * Math.PI) * 0.12 : 1; // лёгкий «отскок»
      rec.wraps.forEach((w, i) => {
        const b = rec.base[i];
        w.scale.set(Math.abs(b) * s * Math.sign(b), Math.abs(b) * s, Math.abs(b) * s);
      });
    }
  }

  // ---- Подгонка хвата вживую (для настройки grip) ----
  // __eq.tune('mainHand', { pos:[0,0,0], rot:[0,0,0], tilt:10, mul:1, flip:false })
  function tune(slot, patch) {
    const rec = equipped[slot];
    if (!rec) return null;
    const def = rec.def;
    def.grip = Object.assign({}, def.grip, patch);
    const models = rec.models;
    models.forEach(m => m.parent && m.parent.remove(m));
    build(slot, def, models);
    equipped[slot].pop = 1;
    equipped[slot].wraps.forEach((w, i) => { const b = equipped[slot].base[i]; w.scale.set(b, Math.abs(b), Math.abs(b)); });
    return def.grip;
  }

  return { equip, unequip, unequipAll, get, isEquipped, stance, hasShield, weaponType, getWeapon, update, tune, equipped };
}
