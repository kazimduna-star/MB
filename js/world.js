// js/world.js — сцена, небо, свет, земля, объекты мира, коллизии, мини-карта
import * as THREE from 'three';
import { loadItemModel } from './loader.js';

export const WORLD_RADIUS = 60;

// Объекты деревни Sleipner (необязательные). Файлы кладутся в assets/world/ под своими именами.
// Если файла нет, объект просто пропускается, игра продолжает работать.
const PROPS = [
  { id: 'well',   file: 'assets/world/sleipner-medieval-village-well-standard.glb',   pos: [0, 0, -14],   rot: 0,    h: 2.4, r: 1.5, label: 'Набрать воды',      msg: 'Вы освежились у колодца' },
  { id: 'anvil',  file: 'assets/world/sleipner-medieval-anvil-standard.glb',          pos: [-9, 0, -6],   rot: 0.6,  h: 0.9, r: 0.8, label: 'Осмотреть наковальню', msg: 'Наковальня ещё тёплая' },
  { id: 'chest',  file: 'assets/world/sleipner-medieval-storage-chest-standard.glb',  pos: [9, 0, -6],    rot: -0.5, h: 0.8, r: 0.9, label: 'Открыть сундук',    msg: null },
  { id: 'barrel1', file: 'assets/world/sleipner-medieval-oak-barrel-standard.glb',    pos: [-12, 0, 2],   rot: 0,    h: 1.0, r: 0.6 },
  { id: 'barrel2', file: 'assets/world/sleipner-medieval-oak-barrel-standard.glb',    pos: [-11, 0, 3.2], rot: 1.2,  h: 1.0, r: 0.6 },
  { id: 'sign',   file: 'assets/world/sleipner-medieval-signpost-standard.glb',       pos: [12, 0, 4],    rot: -0.8, h: 2.2, r: 0.5, label: 'Прочитать указатель', msg: 'Указатель: «Величественный город — 823 м»' },
  { id: 'stall',  file: 'assets/world/sleipner-medieval-market-stall-standard.glb',   pos: [14, 0, -12],  rot: -0.4, h: 2.8, r: 2.0 }
];

function makeCanvasTex(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function grassTexture() {
  return makeCanvasTex(256, (g, s) => {
    g.fillStyle = '#2f5f45'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const l = 30 + Math.random() * 25;
      g.fillStyle = `hsl(${130 + Math.random() * 25},45%,${l}%)`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 3);
    }
  }, 90);
}

function plazaTexture() {
  return makeCanvasTex(512, (g, s) => {
    const n = 4, t = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 120 + Math.random() * 30;
      g.fillStyle = `rgb(${v - 20},${v - 15},${v + 40})`;
      g.fillRect(x * t, y * t, t, t);
      g.strokeStyle = 'rgba(30,25,80,.65)'; g.lineWidth = 4;
      g.strokeRect(x * t + 2, y * t + 2, t - 4, t - 4);
    }
  }, 9);
}

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,200,235,1)');
  gr.addColorStop(1, 'rgba(255,160,220,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createWorld(renderer) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x4a3a9a, 45, 170);

  // ---------- Небо ----------
  const skyGroup = new THREE.Group();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: new THREE.Color(0x14103c) },
      cMid: { value: new THREE.Color(0x5a43b0) },
      cHor: { value: new THREE.Color(0xe08fc0) }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vP; uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cHor;
      void main(){
        float h = vP.y;
        vec3 c = mix(cHor, cMid, smoothstep(0.0, 0.28, h));
        c = mix(c, cTop, smoothstep(0.22, 0.85, h));
        if (h < 0.0) c = mix(cHor, vec3(0.2,0.15,0.4), clamp(-h*3.0,0.0,1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  skyMesh.renderOrder = -10;
  skyGroup.add(skyMesh);

  const starPos = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    const a = Math.random() * Math.PI * 2, y = 0.15 + Math.random() * 0.85;
    const r = Math.sqrt(1 - y * y) * 470;
    starPos[i * 3] = Math.cos(a) * r; starPos[i * 3 + 1] = y * 470; starPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: 0xffffff, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  skyGroup.add(stars);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe6ff, fog: false }));
  moon.position.set(-170, 190, -400);
  skyGroup.add(moon);

  // Окружение для PBR-отражений строится из неба
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(skyGroup);
  scene.environment = pm.fromScene(envScene, 0, 0.1, 1000).texture;
  envScene.remove(skyGroup);
  pm.dispose();
  scene.add(skyGroup);

  // ---------- Свет ----------
  const hemi = new THREE.HemisphereLight(0x9a8bff, 0x2a2050, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xd8c4ff, 2.4);
  sun.position.set(-25, 40, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 120;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);

  // ---------- Земля ----------
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95, metalness: 0 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  const plazaMat = new THREE.MeshStandardMaterial({ map: plazaTexture(), roughness: 0.32, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(26, 64), plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // ---------- Лепестки ----------
  const N = 320;
  const pPos = new Float32Array(N * 3), pSeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pPos[i * 3] = (Math.random() - 0.5) * 60; pPos[i * 3 + 1] = Math.random() * 12; pPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    pSeed[i] = Math.random() * 6.28;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const petals = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.22, map: softDot(), transparent: true, depthWrite: false, opacity: 0.9 }));
  petals.frustumCulled = false;
  scene.add(petals);

  // ---------- Коллизии и интерактивные объекты ----------
  const colliders = [];            // {x, z, r}
  const interactables = new Map(); // id -> {id, pos, radius, label, msg}
  const props = [];
  const spawn = new THREE.Vector3(0, 0, 8);

  async function loadProps(onEach) {
    let ok = 0;
    for (const p of PROPS) {
      try {
        const model = await loadItemModel(p.file);
        const box0 = new THREE.Box3().setFromObject(model);
        const s0 = box0.getSize(new THREE.Vector3());
        if (!isFinite(s0.y) || s0.y <= 0) throw new Error('пустая модель');
        model.scale.setScalar(p.h / s0.y);
        const box = new THREE.Box3().setFromObject(model);
        const c = box.getCenter(new THREE.Vector3());
        model.position.set(-c.x, -box.min.y, -c.z);
        const g = new THREE.Group();
        g.add(model);
        g.position.set(p.pos[0], p.pos[1], p.pos[2]);
        g.rotation.y = p.rot || 0;
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g);
        props.push(g);
        colliders.push({ x: p.pos[0], z: p.pos[2], r: p.r });
        if (p.label) interactables.set(p.id, { id: p.id, pos: new THREE.Vector3(p.pos[0], 0, p.pos[2]), radius: p.r + 1.6, label: p.label, msg: p.msg });
        ok++;
      } catch (e) {
        console.warn('[world] пропущен объект ' + p.id + ':', e.message);
      }
      if (onEach) onEach(p.id);
    }
    return ok;
  }

  function addInteractable(obj) { interactables.set(obj.id, obj); }
  function removeInteractable(id) { interactables.delete(id); }
  function addCollider(x, z, r) { colliders.push({ x, z, r }); }

  function nearestInteractable(pos) {
    let best = null, bd = Infinity;
    interactables.forEach(it => {
      const d = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z);
      if (d < it.radius && d < bd) { bd = d; best = it; }
    });
    return best;
  }

  // Выталкивает позицию из объектов, ограничивает границей мира
  function resolveCollisions(pos, radius) {
    for (const c of colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + radius;
      if (d < min && d > 1e-5) { pos.x = c.x + dx / d * min; pos.z = c.z + dz / d * min; }
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d > WORLD_RADIUS) { pos.x *= WORLD_RADIUS / d; pos.z *= WORLD_RADIUS / d; }
    return pos;
  }

  const groundY = () => 0; // поверхность плоская; подъём по лестницам появится вместе с геометрией

  // ---------- Обновление ----------
  const sunOffset = new THREE.Vector3(-25, 40, -20);
  let t = 0;
  function update(dt, camera, playerPos) {
    t += dt;
    skyGroup.position.copy(camera.position);
    sun.position.copy(playerPos).add(sunOffset);
    sun.target.position.copy(playerPos);
    sun.target.updateMatrixWorld();
    const a = pGeo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      a[i * 3] += Math.sin(t * 0.6 + pSeed[i]) * dt * 0.5 + dt * 0.35;
      a[i * 3 + 1] -= dt * (0.5 + (pSeed[i] % 0.5));
      a[i * 3 + 2] += Math.cos(t * 0.5 + pSeed[i]) * dt * 0.4;
      const dx = a[i * 3] - playerPos.x, dz = a[i * 3 + 2] - playerPos.z;
      if (a[i * 3 + 1] < 0 || Math.abs(dx) > 30 || Math.abs(dz) > 30) {
        a[i * 3] = playerPos.x + (Math.random() - 0.5) * 56;
        a[i * 3 + 1] = 8 + Math.random() * 5;
        a[i * 3 + 2] = playerPos.z + (Math.random() - 0.5) * 56;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
  }

  // ---------- Качество ----------
  function setQuality(level) {
    const size = level === 'high' ? 2048 : level === 'low' ? 512 : 1024;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.mapSize.set(size, size);
    petals.visible = level !== 'low';
    stars.visible = true;
  }
  function setShadows(on) {
    sun.castShadow = on;
    if (!on && sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }

  // ---------- Мини-карта (север сверху, ось -Z) ----------
  // yaw: направление взгляда, forward = (sin yaw, cos yaw) в плоскости XZ
  function drawMinimap(ctx, px, pz, yaw, marks) {
    const W = ctx.canvas.width, H = ctx.canvas.height, cx = W / 2, cy = H / 2;
    const range = 34, s = (W / 2) / range;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#244a38'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#5b5f99';
    ctx.beginPath(); ctx.arc(cx - px * s, cy - pz * s, 26 * s, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx - px * s, cy - pz * s, 60 * s, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = '#c9a36a';
    for (const c of colliders) { ctx.beginPath(); ctx.arc(cx + (c.x - px) * s, cy + (c.z - pz) * s, Math.max(2, c.r * s * 0.6), 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = '#ffd24a';
    interactables.forEach(it => { ctx.beginPath(); ctx.arc(cx + (it.pos.x - px) * s, cy + (it.pos.z - pz) * s, 4, 0, 6.2832); ctx.fill(); });
    if (marks) for (const m of marks) { ctx.fillStyle = m.color || '#f44'; ctx.beginPath(); ctx.arc(cx + (m.x - px) * s, cy + (m.z - pz) * s, 4, 0, 6.2832); ctx.fill(); }
    // конус обзора
    const fx = Math.sin(yaw), fz = Math.cos(yaw), ang = Math.atan2(fz, fx);
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 70, ang - 0.6, ang + 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#35e0ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 6.2832); ctx.fill(); ctx.stroke();
  }

  return {
    scene, sun, spawn, colliders, interactables, props,
    loadProps, addInteractable, removeInteractable, addCollider,
    nearestInteractable, resolveCollisions, groundY,
    update, setQuality, setShadows, drawMinimap
  };
}
