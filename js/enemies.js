// js/enemies.js — противники: модели из ваших паков (FBX + PBR-текстуры), ИИ, реакция на удары
//
// ВАЖНО: FBX из Undead/Fallen Enemy Pack не содержат скелета и анимаций (проверено: ни костей,
// ни скиннинга). Поэтому тело врага двигается как единое целое процедурно: наклоны, замах,
// выпад, оглушение, падение. Для настоящей анимации конечностей нужен риг (например, Mixamo).
// Если FBX не найден, появляется тренировочный манекен (запасной вариант), игра не ломается.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const $ = id => document.getElementById(id);
const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Прозрачный пиксель вместо текстур, на которые ссылается FBX (мы ставим свои PBR-текстуры)
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const mgr = new THREE.LoadingManager();
mgr.setURLModifier(u => (/\.(png|jpe?g|tga|bmp)$/i.test(u) ? PIX : u));
const fbxLoader = new FBXLoader(mgr);
const texLoader = new THREE.TextureLoader();

function mk(id, name, o) {
  return Object.assign({
    id, name, dir: 'assets/enemies/' + id + '/', fbx: id + '.fbx',
    tex: { base: 'textures/' + id + '_basecolor.png', normal: 'textures/' + id + '_normal.png', metal: 'textures/' + id + '_metallic.png', rough: 'textures/' + id + '_roughness.png' },
    height: 2.0, hp: 8000, dmg: 1200, speed: 2.6, reach: 2.1, aggro: 12, yawOffset: 0, radius: 0.6
  }, o || {});
}
export const ENEMY_TYPES = {
  'ossuary-legionary': mk('ossuary-legionary', 'Костяной легионер'),
  'necromancer': mk('necromancer', 'Некромант', { hp: 6500, dmg: 1000, speed: 2.2 }),
  'rotwalker': mk('rotwalker', 'Гнилоход', { hp: 9000, dmg: 1100, speed: 2.0 }),
  'chainwraith': mk('chainwraith', 'Цепной призрак', { hp: 7000, dmg: 1300, speed: 3.0 }),
  'the-unborn': mk('the-unborn', 'Нерождённый', { hp: 7500, dmg: 1200 }),
  'blind-seraph': mk('blind-seraph', 'Слепой серафим', { hp: 9500 }),
  'broken-cherub': mk('broken-cherub', 'Сломанный херувим', { height: 1.6, hp: 6000 }),
  'burning-reliquary': mk('burning-reliquary', 'Пылающая реликвия', { hp: 10000 }),
  'lucifer-avatar': mk('lucifer-avatar', 'Аватар Люцифера', { height: 2.4, hp: 16000, dmg: 1800 }),
  'the-apostate': mk('the-apostate', 'Отступник', { hp: 8000 }),
  'dummy': { id: 'dummy', name: 'Тренировочный манекен', hp: 20000, dmg: 0, speed: 0, reach: 0, aggro: 0, yawOffset: 0, radius: 0.55, height: 1.8, dummy: true }
};

export async function createEnemies({ scene, world, player, camera, lite, onKill }) {
  const enemies = [];
  const templates = new Map();   // type -> Promise<{model, tex}>
  const layer = $('dmgLayer');
  const v3 = new THREE.Vector3();

  function loadFBX(url) {
    return new Promise((res, rej) => fbxLoader.load(url, res, undefined, () => rej(new Error('Не найден файл: ' + url))));
  }
  function loadTex(url, srgb) {
    return new Promise(res => {
      texLoader.load(url, t => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; res(t);
      }, undefined, () => res(null));
    });
  }

  function loadTemplate(type) {
    if (!templates.has(type.id)) {
      templates.set(type.id, (async () => {
        const model = await loadFBX(type.dir + type.fbx);
        const tex = {
          base: await loadTex(type.dir + type.tex.base, true),
          normal: lite ? null : await loadTex(type.dir + type.tex.normal, false),
          metal: await loadTex(type.dir + type.tex.metal, false),
          rough: await loadTex(type.dir + type.tex.rough, false)
        };
        if (!tex.base) throw new Error('Не найдена текстура: ' + type.dir + type.tex.base);
        // Нормализация размера: высота модели → type.height, ноги на y = 0, центр по XZ
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        const k = type.height / (size.y || 1);
        const holder = new THREE.Group();
        model.position.set(-c.x, -box.min.y, -c.z);
        const inner = new THREE.Group(); inner.add(model); inner.scale.setScalar(k);
        holder.add(inner);
        return { holder, tex };
      })().catch(e => { templates.delete(type.id); throw e; }));
    }
    return templates.get(type.id);
  }

  function pbrMaterial(tex) {
    return new THREE.MeshStandardMaterial({
      map: tex.base, normalMap: tex.normal || null, metalnessMap: tex.metal || null, roughnessMap: tex.rough || null,
      metalness: tex.metal ? 1 : 0.2, roughness: tex.rough ? 1 : 0.8,
      emissive: 0xffffff, emissiveIntensity: 0, side: THREE.FrontSide
    });
  }

  function buildDummy() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0 });
    const sack = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.7, 12), wood); post.position.y = 0.85;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.12), wood); bar.position.y = 1.35;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.8, 16), sack); body.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), sack); head.position.y = 1.65;
    g.add(post, bar, body, head);
    return { group: g, mats: [wood, sack] };
  }

  // ---------------------------------------------------------------------------
  class Enemy {
    constructor(type, x, z, parts) {
      this.type = type; this.spawn = new THREE.Vector3(x, 0, z);
      this.root = new THREE.Group(); this.body = new THREE.Group();
      this.root.add(this.body); this.body.add(parts.group);
      parts.group.rotation.y = type.yawOffset || 0;
      this.mats = parts.mats;
      this.root.position.set(x, 0, z);
      scene.add(this.root);
      this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      this.maxHp = type.hp; this.hp = type.hp;
      this.state = 'idle'; this.t = 0; this.cd = 1.2; this.yaw = Math.PI * Math.random();
      this.kx = 0; this.kz = 0; this.flash = 0; this.hitFired = false; this.bob = Math.random() * 6;
      this.deadT = 0; this.shown = 0;
      this.radius = type.radius;
      // полоса здоровья
      this.bar = document.createElement('div');
      this.bar.style.cssText = 'position:absolute;display:none;transform:translate(-50%,-100%);text-align:center;font-size:12px;font-weight:700;text-shadow:0 1px 3px #000;white-space:nowrap';
      this.bar.innerHTML = `<div>${type.name}</div><div style="margin-top:2px;width:84px;height:7px;border-radius:4px;background:rgba(0,0,0,.55);box-shadow:0 0 0 1px #fff5;overflow:hidden"><i style="display:block;height:100%;width:100%;background:linear-gradient(180deg,#ff7a6b,#d12a2a)"></i></div>`;
      layer.appendChild(this.bar);
      this.fill = this.bar.querySelector('i');
    }
    get pos() { return this.root.position; }
    get dead() { return this.state === 'dead'; }

    setState(s) { this.state = s; this.t = 0; this.hitFired = false; }

    takeHit(dmg, fromPos, opts) {
      opts = opts || {};
      if (this.dead) return { hit: false, killed: false };
      this.hp = Math.max(0, this.hp - dmg);
      this.flash = 0.14; this.shown = 6;
      const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z, d = Math.hypot(dx, dz) || 1;
      const kn = opts.knock != null ? opts.knock : 3;
      this.kx = dx / d * kn; this.kz = dz / d * kn;
      floatText(this.pos, dmg, opts.crit ? 'crit' : '');
      if (this.hp <= 0) { this.setState('dead'); this.deadT = 0; this.bar.style.display = 'none'; onKill && onKill(this); return { hit: true, killed: true }; }
      if (this.state !== 'strike' && !this.type.dummy) { this.setState('stagger'); this.stagger = opts.stagger != null ? opts.stagger : 0.35; }
      if (this.type.dummy) { this.wobble = 0.5; }
      return { hit: true, killed: false };
    }

    update(dt) {
      const T = this.type, p = player.pos;
      this.bob += dt * 6;
      this.flash = Math.max(0, this.flash - dt);
      this.mats.forEach(m => { m.emissiveIntensity = this.flash > 0 ? 0.9 * (this.flash / 0.14) : (this.state === 'windup' ? 0.25 + Math.sin(this.t * 25) * 0.1 : 0); m.emissive.setHex(this.state === 'windup' ? 0xff3322 : 0xffffff); });
      if (this.shown > 0) this.shown -= dt;

      // отбрасывание
      this.pos.x += this.kx * dt; this.pos.z += this.kz * dt;
      const kd = Math.exp(-7 * dt); this.kx *= kd; this.kz *= kd;
      this.t += dt;

      const dx = p.x - this.pos.x, dz = p.z - this.pos.z, dist = Math.hypot(dx, dz);
      const toPlayer = Math.atan2(dx, dz);
      const body = this.body;
      let leanTarget = 0, offZ = 0, offY = 0, roll = 0;

      if (this.state === 'dead') {
        this.deadT += dt;
        const f = clamp(this.deadT / 0.9, 0, 1), e = 1 - Math.pow(1 - f, 3);
        body.rotation.x = -Math.PI / 2 * e; body.position.y = 0.18 * e;
        if (this.deadT > 3.5) body.position.y -= (this.deadT - 3.5) * 0.35;   // уходит под землю
        if (this.deadT > 7) { this.remove(); respawnLater(this); }
        return;
      }

      if (T.dummy) {
        this.wobble = Math.max(0, (this.wobble || 0) - dt);
        body.rotation.x = Math.sin(this.t * 14) * this.wobble * 0.18 * (this.kz >= 0 ? 1 : -1);
        body.rotation.z = Math.cos(this.t * 11) * this.wobble * 0.1;
        return;
      }

      switch (this.state) {
        case 'idle':
          offY = Math.sin(this.bob * 0.4) * 0.015; leanTarget = Math.sin(this.bob * 0.3) * 0.02;
          if (!player.state.dead && dist < T.aggro) this.setState('chase');
          break;
        case 'chase': {
          this.yaw += wrapAngle(toPlayer - this.yaw) * (1 - Math.exp(-6 * dt));
          if (dist > T.reach * 0.8) {
            this.pos.x += Math.sin(this.yaw) * T.speed * dt; this.pos.z += Math.cos(this.yaw) * T.speed * dt;
            offY = Math.abs(Math.sin(this.bob)) * 0.07; roll = Math.sin(this.bob) * 0.05; leanTarget = 0.12;
          }
          this.cd -= dt;
          if (player.state.dead || dist > T.aggro * 1.7) this.setState('idle');
          else if (dist <= T.reach * 0.95 && this.cd <= 0) this.setState('windup');
          break;
        }
        case 'windup': {
          this.yaw += wrapAngle(toPlayer - this.yaw) * (1 - Math.exp(-4 * dt));
          const f = clamp(this.t / 0.7, 0, 1);
          leanTarget = -0.4 * f; offZ = -0.15 * f; offY = 0.05 * f;
          if (f >= 1) this.setState('strike');
          break;
        }
        case 'strike': {
          const f = clamp(this.t / 0.25, 0, 1);
          leanTarget = 0.55 * f; offZ = 0.35 * f;
          if (!this.hitFired && f >= 0.5) {
            this.hitFired = true;
            const ang = Math.abs(wrapAngle(toPlayer - this.yaw));
            if (dist <= T.reach + 0.4 && ang < 1.0) player.takeDamage(T.dmg * (0.9 + Math.random() * 0.2), this.pos, { knock: 4 });
          }
          if (this.t >= 0.4) { this.cd = 1.6 + Math.random() * 0.8; this.setState('recover'); }
          break;
        }
        case 'recover':
          leanTarget = 0.2 * (1 - clamp(this.t / 0.5, 0, 1));
          if (this.t >= 0.5) this.setState('chase');
          break;
        case 'stagger': {
          const f = clamp(this.t / this.stagger, 0, 1);
          leanTarget = -0.45 * (1 - f); roll = Math.sin(this.t * 30) * 0.06 * (1 - f);
          if (f >= 1) this.setState('chase');
          break;
        }
      }

      // мягкое расталкивание с игроком
      if (dist < 0.9 && dist > 1e-3) {
        const push = (0.9 - dist) * 0.5;
        this.pos.x -= dx / dist * push; this.pos.z -= dz / dist * push;
        p.x += dx / dist * push * 0.6; p.z += dz / dist * push * 0.6;
      }
      world.resolveCollisions(this.pos, this.radius * 0.6);

      body.rotation.x += (leanTarget - body.rotation.x) * (1 - Math.exp(-14 * dt));
      body.rotation.z += (roll - body.rotation.z) * (1 - Math.exp(-14 * dt));
      body.position.set(0, offY, offZ);
      this.root.rotation.y = this.yaw;
    }

    remove() {
      scene.remove(this.root);
      this.bar.remove();
      const i = enemies.indexOf(this); if (i >= 0) enemies.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------
  function floatText(worldPos, value, cls) {
    camera.updateMatrixWorld();
    v3.set(worldPos.x, worldPos.y + 2.0, worldPos.z).project(camera);
    if (v3.z > 1) return;
    const el = document.createElement('div');
    el.className = 'dmg ' + (cls || '');
    el.textContent = value;
    el.style.left = ((v3.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30) + 'px';
    el.style.top = ((-v3.y * 0.5 + 0.5) * innerHeight) + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  async function spawn(typeId, x, z) {
    const type = ENEMY_TYPES[typeId];
    if (!type) throw new Error('Неизвестный тип врага: ' + typeId);
    let parts, used = type;
    if (type.dummy) {
      const d = buildDummy(); parts = { group: d.group, mats: d.mats };
    } else {
      try {
        const { holder, tex } = await loadTemplate(type);
        const group = holder.clone(true);
        const mats = [];
        group.traverse(o => { if (o.isMesh) { o.material = pbrMaterial(tex); mats.push(o.material); } });
        parts = { group, mats };
      } catch (e) {
        console.warn('[enemies]', e.message, '→ тренировочный манекен');
        const d = buildDummy(); parts = { group: d.group, mats: d.mats }; used = ENEMY_TYPES.dummy;
      }
    }
    const e = new Enemy(used, x, z, parts);
    e.originType = typeId;
    enemies.push(e);
    return e;
  }

  function respawnLater(e) {
    setTimeout(() => { spawn(e.originType, e.spawn.x, e.spawn.z).catch(() => {}); }, 1500);
  }

  // ---------------------------------------------------------------------------
  function update(dt) {
    dt = Math.min(dt, 0.05);
    for (const e of [...enemies]) e.update(dt);
    // полосы здоровья
    camera.updateMatrixWorld();
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      v3.set(e.pos.x, e.pos.y + e.type.height + 0.35, e.pos.z).project(camera);
      const show = v3.z < 1 && (d < 14 || e.shown > 0) && Math.abs(v3.x) < 1.1;
      e.bar.style.display = show ? 'block' : 'none';
      if (show) {
        e.bar.style.left = ((v3.x * 0.5 + 0.5) * innerWidth) + 'px';
        e.bar.style.top = ((-v3.y * 0.5 + 0.5) * innerHeight) + 'px';
        e.fill.style.width = (e.hp / e.maxHp * 100).toFixed(1) + '%';
      }
    }
  }

  // Враги в конусе перед игроком (для ударов): origin, forward (единичный вектор), дальность, полуугол
  function queryCone(origin, forward, range, halfAngle) {
    const out = [];
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > range) continue;
      const ang = d < 1e-3 ? 0 : Math.acos(clamp((dx * forward.x + dz * forward.z) / d, -1, 1));
      const slack = Math.atan2(e.radius, Math.max(d, 0.01));   // широкая цель легче попадается
      if (ang - slack <= halfAngle) out.push({ e, d });
    }
    return out.sort((a, b) => a.d - b.d).map(o => o.e);
  }
  function nearest(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  const marks = () => enemies.filter(e => !e.dead).map(e => ({ x: e.pos.x, z: e.pos.z, color: '#ff4a4a' }));

  return { enemies, spawn, update, queryCone, nearest, marks, floatText, types: ENEMY_TYPES };
}
