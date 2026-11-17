// js/player.js — управляемый персонаж: ввод (клавиатура, мышь, сенсор), движение, прыжок,
// уклонение, выносливость, урон, связь с анимациями и миром
import * as THREE from 'three';
import { CONFIG } from './config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const $ = id => document.getElementById(id);

export function createPlayer({ pivot, animator, equipment, world, camRig }) {
  const P = CONFIG.player;
  const listeners = {};
  const on = (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); };
  const emit = (evt, ...a) => (listeners[evt] || []).forEach(f => f(...a));

  const state = {
    hp: P.maxHp, maxHp: P.maxHp, stamina: 100, maxStamina: 100, exhausted: false,
    yaw: Math.PI, vx: 0, vz: 0, vy: 0, grounded: true,
    blocking: false, sprinting: false, dead: false, invulnerable: false,
    dodgeT: 0, dodgeCd: 0, dodgeDirX: 0, dodgeDirZ: 0,
    coyote: 0, jumpBuf: 0, knockX: 0, knockZ: 0, impX: 0, impZ: 0,
    enabled: true, fullPushT: 0, lastY: 0, climb: 0,
    nearby: null, lookTarget: null, walkToggle: false
  };
  const pos = pivot.position;
  pos.copy(world.spawn);
  pivot.rotation.y = state.yaw;

  // ---------------- ВВОД ----------------
  const keys = new Set();
  const joy = { x: 0, y: 0, id: null };
  let mouseBlock = false, uiBlock = false;

  function resetInput() {
    keys.clear(); joy.x = joy.y = 0; joy.id = null; mouseBlock = false; uiBlock = false;
    const knob = $('joyKnob'); if (knob) knob.style.transform = '';
    setBlocking(false);
  }
  function setEnabled(v) { state.enabled = v; if (!v) resetInput(); }

  function setBlocking(v) {
    if (v && (state.dead || state.dodgeT > 0 || animator.isAttacking())) return;
    if (state.blocking === v) return;
    state.blocking = v;
    emit(v ? 'blockstart' : 'blockend');
  }
  const refreshBlock = () => setBlocking(mouseBlock || uiBlock || keys.has('KeyB'));

  window.addEventListener('keydown', e => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Escape') { emit('menu', 'escape'); return; }
    if (!state.enabled) return;
    if (e.repeat) { if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); return; }
    keys.add(e.code);
    switch (e.code) {
      case 'Space': e.preventDefault(); state.jumpBuf = 0.14; break;
      case 'ControlLeft': case 'ControlRight': case 'KeyV': e.preventDefault(); tryDodge(); break;
      case 'KeyQ': emit('heavy'); break;
      case 'KeyF': tryInteract(); break;
      case 'KeyI': emit('menu', 'inventory'); break;
      case 'KeyE': emit('menu', 'equip'); break;
      case 'KeyC': emit('menu', 'char'); break;
      case 'KeyZ': state.walkToggle = !state.walkToggle; break;
      case 'KeyB': refreshBlock(); break;
      default: if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyB') refreshBlock(); });
  window.addEventListener('blur', resetInput);

  // Мышь по холсту: первый клик захватывает курсор, дальше ЛКМ — атака, ПКМ — блок
  const canvas = $('game');
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || !state.enabled) return;
    if (document.pointerLockElement !== canvas) { camRig.lockPointer(); return; }
    if (e.button === 0) emit('attack');
    if (e.button === 2) { mouseBlock = true; refreshBlock(); }
  });
  canvas.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse' && e.button === 2) { mouseBlock = false; refreshBlock(); }
  });

  // Джойстик
  const joyBase = $('joyBase'), joyKnob = $('joyKnob');
  function moveJoy(e) {
    const r = joyBase.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width * 0.36;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = dx / R; joy.y = -dy / R;
  }
  function endJoy(e) {
    if (e.pointerId !== joy.id) return;
    joy.id = null; joy.x = joy.y = 0; joyKnob.style.transform = '';
  }
  joyBase.addEventListener('pointerdown', e => {
    if (!state.enabled || joy.id !== null) return;
    e.preventDefault(); joy.id = e.pointerId; joyBase.setPointerCapture(e.pointerId); moveJoy(e);
  });
  joyBase.addEventListener('pointermove', e => { if (e.pointerId === joy.id) moveJoy(e); });
  joyBase.addEventListener('pointerup', endJoy);
  joyBase.addEventListener('pointercancel', endJoy);

  // Кнопки действий
  function bindButton(id, down, up) {
    const el = $(id); if (!el) return;
    el.addEventListener('pointerdown', e => {
      if (!state.enabled) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('pressed'); down && down();
    });
    const release = () => { el.classList.remove('pressed'); up && up(); };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }
  bindButton('btnJump', () => { state.jumpBuf = 0.14; });
  bindButton('btnAttack', () => emit('attack'));
  bindButton('btnHeavy', () => emit('heavy'));
  bindButton('btnDodge', () => tryDodge());
  bindButton('btnBlock', () => { uiBlock = true; refreshBlock(); }, () => { uiBlock = false; refreshBlock(); });
  bindButton('btnInteract', () => tryInteract());

  // ---------------- ДЕЙСТВИЯ ----------------
  function useStamina(n) {
    if (state.stamina < n) return false;
    state.stamina -= n;
    return true;
  }

  function tryDodge() {
    if (state.dead || state.dodgeT > 0 || state.dodgeCd > 0 || !state.grounded) return;
    if (state.stamina < 10) return;
    state.stamina = Math.max(0, state.stamina - 20);
    setBlocking(false);
    const dir = inputDir();
    if (dir.len > 0.1) { state.dodgeDirX = dir.x / dir.len; state.dodgeDirZ = dir.z / dir.len; }
    else { state.dodgeDirX = -Math.sin(state.yaw); state.dodgeDirZ = -Math.cos(state.yaw); } // без ввода — шаг назад
    state.dodgeT = P.dodgeTime; state.dodgeCd = P.dodgeTime + 0.25;
    state.invulnerable = true;
    animator.dodge(P.dodgeTime);
    emit('dodge');
  }

  function tryInteract() {
    if (state.dead || !state.nearby || animator.isBusy()) return;
    animator.interact();
    emit('interact', state.nearby);
  }

  function jump() {
    state.vy = P.jumpVelocity; state.grounded = false; state.coyote = 0; state.jumpBuf = 0;
    emit('jump');
  }

  // Направление ввода в мировых координатах относительно камеры
  const dirOut = { x: 0, z: 0, len: 0, mag: 0 };
  function inputDir() {
    let ix = joy.x, iy = joy.y;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iy += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iy -= 1;
    let mag = Math.hypot(ix, iy);
    if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }
    if (mag < 0.12) { dirOut.x = dirOut.z = dirOut.len = dirOut.mag = 0; return dirOut; }
    const b = camRig.basis();
    dirOut.x = b.forward.x * iy + b.right.x * ix;
    dirOut.z = b.forward.z * iy + b.right.z * ix;
    dirOut.len = Math.hypot(dirOut.x, dirOut.z);
    dirOut.mag = mag;
    return dirOut;
  }

  // ---------------- УРОН ----------------
  // Возвращает { hit, blocked, dmg }
  function takeDamage(amount, fromPos, opts) {
    opts = opts || {};
    if (state.dead || state.invulnerable) return { hit: false, blocked: false, dmg: 0 };
    let dmg = amount, blocked = false;
    const dx = fromPos ? fromPos.x - pos.x : 0, dz = fromPos ? fromPos.z - pos.z : 0;
    const dist = Math.hypot(dx, dz) || 1;
    if (state.blocking && fromPos) {
      const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
      const dot = (dx * fx + dz * fz) / dist;
      if (dot > Math.cos(100 * Math.PI / 180)) {
        const sh = equipment.get('offHand');
        const reduce = sh && sh.block ? sh.block : 0.45;
        dmg = amount * (1 - reduce);
        blocked = true;
        state.stamina = Math.max(0, state.stamina - Math.min(25, 6 + amount * 0.01));
        if (state.stamina <= 0) { blocked = false; dmg = amount; setBlocking(false); }
      }
    }
    dmg = Math.max(1, Math.round(dmg));
    state.hp = Math.max(0, state.hp - dmg);
    if (!blocked) {
      const lx = Math.cos(state.yaw), lz = -Math.sin(state.yaw);
      animator.hit(((dx * lx + dz * lz) / dist) > 0 ? 1 : -1);
      state.knockX = -dx / dist * (opts.knock || 3); state.knockZ = -dz / dist * (opts.knock || 3);
      camRig.shake(0.18);
    } else {
      state.knockX = -dx / dist * 1.2; state.knockZ = -dz / dist * 1.2;
      camRig.shake(0.08);
    }
    emit('damaged', dmg, blocked);
    if (state.hp <= 0) die();
    return { hit: true, blocked, dmg };
  }

  function die() {
    if (state.dead) return;
    state.dead = true; setBlocking(false); state.invulnerable = true;
    animator.die(() => emit('deathend'));
    emit('death');
  }

  function respawn() {
    state.dead = false; state.invulnerable = false; state.hp = state.maxHp; state.stamina = state.maxStamina;
    state.vx = state.vz = state.vy = 0; state.knockX = state.knockZ = 0;
    pos.copy(world.spawn); state.yaw = Math.PI; pivot.rotation.y = state.yaw;
    animator.revive(); camRig.snap();
    emit('respawn');
  }

  function heal(n) { state.hp = Math.min(state.maxHp, state.hp + n); }
  function addImpulse(dx, dz) { state.impX += dx; state.impZ += dz; }
  const forward = () => new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));

  // ---------------- ОБНОВЛЕНИЕ ----------------
  function update(dt) {
    dt = Math.min(dt, 0.05);
    const dead = state.dead;
    const attacking = animator.isAttacking();
    if (state.enabled && !dead) refreshBlock();   // удерживаемый блок включается снова после атаки/уклонения
    state.dodgeCd = Math.max(0, state.dodgeCd - dt);
    state.jumpBuf = Math.max(0, state.jumpBuf - dt);

    // --- желаемая скорость
    const dir = state.enabled && !dead ? inputDir() : { x: 0, z: 0, len: 0, mag: 0 };
    let maxSpeed = 0, wantSprint = false;
    if (dir.len > 0) {
      const joyFull = joy.id !== null && Math.hypot(joy.x, joy.y) > 0.96;
      state.fullPushT = joyFull ? state.fullPushT + dt : 0;
      const walkKey = state.walkToggle || keys.has('AltLeft');
      if (keys.has('ShiftLeft') || keys.has('ShiftRight') || state.fullPushT > 0.7) wantSprint = true;
      if (walkKey || (joy.id !== null && dir.mag < 0.55)) maxSpeed = P.walkSpeed * (0.6 + dir.mag * 0.4);
      else maxSpeed = P.runSpeed;
    } else state.fullPushT = 0;

    if (state.exhausted && state.stamina > 25) state.exhausted = false;
    state.sprinting = wantSprint && !state.exhausted && !state.blocking && !attacking && maxSpeed >= P.runSpeed && state.grounded;
    if (state.sprinting) {
      maxSpeed = P.sprintSpeed;
      state.stamina = Math.max(0, state.stamina - 12 * dt);
      if (state.stamina <= 0) { state.exhausted = true; state.sprinting = false; maxSpeed = P.runSpeed; }
    } else if (!state.dodgeT) {
      state.stamina = Math.min(state.maxStamina, state.stamina + (state.blocking ? 6 : 16) * dt);
    }
    if (state.blocking) maxSpeed = Math.min(maxSpeed, P.walkSpeed * 0.7);
    if (attacking) maxSpeed *= 0.35;
    if (animator.state.interact) maxSpeed = 0;
    if (dead) maxSpeed = 0;

    let tx = dir.len > 0 ? dir.x / dir.len * maxSpeed : 0;
    let tz = dir.len > 0 ? dir.z / dir.len * maxSpeed : 0;

    // --- уклонение
    if (state.dodgeT > 0) {
      state.dodgeT -= dt;
      const f = 1 - state.dodgeT / P.dodgeTime;
      const sp = P.dodgeSpeed * Math.max(0.15, 1.25 - f);
      tx = state.dodgeDirX * sp; tz = state.dodgeDirZ * sp;
      state.vx = tx; state.vz = tz;
      state.invulnerable = f < 0.72;
      if (state.dodgeT <= 0) { state.dodgeT = 0; state.invulnerable = false; }
    } else {
      const accel = state.grounded ? (dir.len > 0 ? 14 : 12) : 4;
      const k = 1 - Math.exp(-accel * dt);
      state.vx += (tx - state.vx) * k;
      state.vz += (tz - state.vz) * k;
    }

    // --- прыжок и гравитация
    if (state.grounded) state.coyote = 0.1; else state.coyote = Math.max(0, state.coyote - dt);
    if (state.jumpBuf > 0 && state.coyote > 0 && !dead && !attacking && state.dodgeT <= 0) jump();
    if (!state.grounded) state.vy += P.gravity * dt;

    // --- перемещение
    const moveX = (state.vx + state.knockX + state.impX) * dt;
    const moveZ = (state.vz + state.knockZ + state.impZ) * dt;
    state.knockX *= Math.exp(-8 * dt); state.knockZ *= Math.exp(-8 * dt);
    state.impX *= Math.exp(-10 * dt); state.impZ *= Math.exp(-10 * dt);
    pos.x += moveX; pos.z += moveZ;
    pos.y += state.vy * dt;
    world.resolveCollisions(pos, 0.35);
    const gy = world.groundY(pos.x, pos.z);
    if (pos.y <= gy) {
      pos.y = gy;
      if (!state.grounded) state.grounded = true;
      state.vy = 0;
    } else if (pos.y > gy + 0.06 && state.vy !== 0) state.grounded = false;
    else if (state.grounded && pos.y > gy + 0.3) state.grounded = false;
    const rise = (pos.y - state.lastY) / Math.max(dt, 1e-3);
    state.climb = state.grounded && rise > 0.6 ? 1 : 0;
    state.lastY = pos.y;

    // --- поворот корпуса
    let desired = state.yaw;
    const hv = Math.hypot(state.vx, state.vz);
    if (state.dodgeT > 0) desired = Math.atan2(state.dodgeDirX, state.dodgeDirZ);
    else if (state.blocking || (attacking && dir.len === 0)) desired = camRig.yaw;
    else if (dir.len > 0 && !dead) desired = Math.atan2(dir.x, dir.z);
    else desired = state.yaw;
    const diff = wrapAngle(desired - state.yaw);
    const turnK = attacking ? 0.35 : 1;
    const step = diff * (1 - Math.exp(-P.turnSpeed * turnK * dt));
    state.yaw = wrapAngle(state.yaw + step);
    pivot.rotation.y = state.yaw;
    const turnRate = step / Math.max(dt, 1e-3);

    // --- взаимодействие: ближайший объект
    const it = dead ? null : world.nearestInteractable(pos);
    if (it !== state.nearby) {
      state.nearby = it;
      const b = $('btnInteract');
      if (b) { b.classList.toggle('hidden', !it); b.title = it ? it.label : ''; }
      emit('nearby', it);
    }

    // --- взгляд головы
    let lookYaw, lookPitch = 0;
    if (state.lookTarget) {
      lookYaw = wrapAngle(Math.atan2(state.lookTarget.x - pos.x, state.lookTarget.z - pos.z) - state.yaw);
    } else {
      lookYaw = wrapAngle(camRig.yaw - state.yaw);
      if (Math.abs(lookYaw) > 2.2) lookYaw = 0;       // камера смотрит в спину — голова прямо
      lookPitch = -(camRig.state.pitch - 0.3) * 0.6;
    }

    // --- анимации
    animator.update(dt, {
      speed: hv, grounded: state.grounded, velY: state.vy,
      lookYaw, lookPitch, turnRate,
      blocking: state.blocking && !dead,
      stance: equipment.stance(), shield: equipment.hasShield(),
      climb: state.climb
    });
    equipment.update(dt);

    updateHud();
  }

  // ---------------- HUD ----------------
  const hpFill = $('hpFill'), hpText = $('hpText'), stamFill = $('stamFill'), partyHp = $('partyHp1');
  let lastHp = -1, lastSt = -1;
  function updateHud() {
    if (state.hp !== lastHp) {
      lastHp = state.hp;
      const p = (state.hp / state.maxHp * 100).toFixed(1) + '%';
      if (hpFill) hpFill.style.width = p;
      if (partyHp) partyHp.style.width = p;
      if (hpText) hpText.textContent = state.hp + ' / ' + state.maxHp;
    }
    const s = Math.round(state.stamina);
    if (s !== lastSt) {
      lastSt = s;
      if (stamFill) { stamFill.style.width = s + '%'; stamFill.style.background = state.exhausted ? '#ff6b4a' : '#ffd24a'; }
    }
  }
  updateHud();

  return {
    state, pos, on, emit, update, takeDamage, heal, respawn, addImpulse, forward,
    setEnabled, resetInput, useStamina, setBlocking,
    setLookTarget(v) { state.lookTarget = v; },
    get yaw() { return state.yaw; }
  };
}
