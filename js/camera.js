// js/camera.js — плавная камера от третьего лица (мышь, сенсорный экран, колесо, щипок)
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createCameraRig(camera, canvas) {
  const C = CONFIG.camera;

  const state = {
    yaw: Math.PI,            // начальный взгляд вдоль -Z (в сторону площади)
    pitch: 0.28,
    distance: C.distance,
    targetDistance: C.distance,
    sensitivity: 1,
    invertY: false,
    enabled: true,           // выключается, когда открыто меню
    shakeT: 0,
    shakeA: 0,
    fovBase: 60,
    fovKick: 0
  };

  const smoothPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let initialized = false;

  // ---------- Ввод ----------
  const pointers = new Map(); // pointerId -> {x, y}
  let pinchDist = 0;

  function rotate(dx, dy) {
    const k = C.sensitivity * state.sensitivity;
    state.yaw -= dx * k;
    state.pitch += dy * k * (state.invertY ? -1 : 1);
    state.pitch = Math.max(C.minPitch, Math.min(C.maxPitch, state.pitch));
  }

  canvas.addEventListener('pointerdown', e => {
    if (!state.enabled) return;
    if (e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!state.enabled) return;
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement === canvas) rotate(e.movementX, e.movementY);
      return;
    }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      rotate(dx, dy);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) setDistance(state.targetDistance - (d - pinchDist) * 0.02);
      pinchDist = d;
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    pinchDist = 0;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', e => {
    if (!state.enabled) return;
    e.preventDefault();
    setDistance(state.targetDistance + Math.sign(e.deltaY) * 0.5);
  }, { passive: false });

  // Мышь: захват курсора по клику (клик по холсту, когда меню закрыто)
  function lockPointer() {
    if (!state.enabled) return;
    if (canvas.requestPointerLock && document.pointerLockElement !== canvas) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* не критично */ }
    }
  }
  function unlockPointer() {
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  }

  function setDistance(d) {
    state.targetDistance = Math.max(2.4, Math.min(9, d));
  }

  // ---------- Обновление ----------
  const desired = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();

  function update(dt, targetPos, opts) {
    opts = opts || {};
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    state.distance += (state.targetDistance - state.distance) * Math.min(1, dt * 8);

    // Точка, на которую смотрим: немного выше плеч персонажа
    tmpLook.set(targetPos.x, targetPos.y + C.height, targetPos.z);

    desired.set(
      tmpLook.x - Math.sin(state.yaw) * cp * state.distance,
      tmpLook.y + sp * state.distance,
      tmpLook.z - Math.cos(state.yaw) * cp * state.distance
    );
    if (desired.y < 0.35) desired.y = 0.35; // камера не уходит под землю

    if (!initialized) {
      smoothPos.copy(desired); lookAt.copy(tmpLook); initialized = true;
    } else {
      const k = 1 - Math.exp(-C.smooth * dt);
      smoothPos.lerp(desired, k);
      lookAt.lerp(tmpLook, 1 - Math.exp(-C.smooth * 1.6 * dt));
    }

    camera.position.copy(smoothPos);

    // Тряска при ударах
    if (state.shakeT > 0) {
      state.shakeT -= dt;
      const a = state.shakeA * Math.max(0, state.shakeT / 0.3);
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.y += (Math.random() - 0.5) * a;
      camera.position.z += (Math.random() - 0.5) * a;
    }
    camera.lookAt(lookAt);

    // Лёгкое расширение угла обзора при быстром беге
    const kickTarget = opts.sprinting ? 7 : 0;
    state.fovKick += (kickTarget - state.fovKick) * Math.min(1, dt * 4);
    const fov = state.fovBase + state.fovKick;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  function shake(amount) { state.shakeA = amount || 0.15; state.shakeT = 0.3; }
  function snap() { initialized = false; }

  // Базис движения относительно взгляда камеры (согласован с world.js: forward = (sin yaw, cos yaw))
  const fwd = new THREE.Vector3(), rgt = new THREE.Vector3();
  function basis() {
    fwd.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    rgt.set(-Math.cos(state.yaw), 0, Math.sin(state.yaw));
    return { forward: fwd, right: rgt };
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    state, update, shake, snap, basis, resize, rotate,
    lockPointer, unlockPointer,
    setEnabled(v) { state.enabled = v; if (!v) { pointers.clear(); unlockPointer(); } },
    setSensitivity(v) { state.sensitivity = v; },
    setInvertY(v) { state.invertY = v; },
    get yaw() { return state.yaw; },
    set yaw(v) { state.yaw = v; }
  };
}
