// js/combat.js — боевая система: комбо, сильные атаки, попадания, урон, критические удары, захват цели
//
// Анимации атак берутся из animations.js (у каждого типа оружия свои). Урон наносится в кадр
// удара (onHit) по врагам в конусе перед персонажем. Блок и уклонение реализованы в player.js.
import { CONFIG } from './config.js';

export const DMG_SCALE = 8;   // урон оружия из config.js умножается на это число (под здоровье врагов)

// Дальность (м), полуугол конуса (градусы), метание вперёд при ударе, отбрасывание, удар по площади
const WEAPON_FX = {
  sword1h: { range: 2.4, arc: 70, lunge: 5.0, knock: 2.5, sweep: false },
  sword2h: { range: 2.9, arc: 90, lunge: 4.0, knock: 3.8, sweep: true },
  dagger:  { range: 1.8, arc: 50, lunge: 7.0, knock: 1.2, sweep: false },
  axe:     { range: 2.5, arc: 80, lunge: 4.5, knock: 3.5, sweep: true },
  hammer:  { range: 2.7, arc: 85, lunge: 3.0, knock: 5.0, sweep: true },
  unarmed: { range: 1.6, arc: 50, lunge: 5.0, knock: 1.5, sweep: false }
};
const COST_LIGHT = 6, COST_HEAVY = 20, HEAVY_CD = 1.2;
const DEG = Math.PI / 180;
const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export function createCombat({ player, animator, equipment, enemies, camRig }) {
  const S = player.state;
  let time = 0, lastEndT = -99, idx = -1, queued = null, cur = null;
  let heavyCd = 0, hitstop = 0;
  const heavyBtn = document.getElementById('btnHeavy');
  const dodgeBtn = document.getElementById('btnDodge');

  const canAct = () => !S.dead && S.dodgeT <= 0 && !animator.state.interact && !animator.state.hit;

  // Плавный доворот на ближайшего врага перед ударом
  function aimAssist() {
    const near = enemies.nearest(player.pos, 5);
    if (!near) return;
    const dx = near.pos.x - player.pos.x, dz = near.pos.z - player.pos.z;
    const diff = wrapAngle(Math.atan2(dx, dz) - S.yaw);
    if (Math.abs(diff) < 100 * DEG) S.yaw = wrapAngle(S.yaw + diff * 0.8);
  }

  function start(heavy) {
    const type = equipment.weaponType();
    const cfg = CONFIG.combat[type] || CONFIG.combat.sword1h;
    const fx = WEAPON_FX[type] || WEAPON_FX.sword1h;
    const info = animator.getAttackInfo(type, 0, false);
    const count = Math.max(1, Math.min(cfg.combo, info.count));

    if (heavy) {
      if (heavyCd > 0) return;
      if (!player.useStamina(COST_HEAVY)) return;
    } else {
      if (!player.useStamina(COST_LIGHT)) return;
    }

    if (!heavy) idx = (idx >= 0 && time - lastEndT <= cfg.window) ? (idx + 1) % count : 0;
    else idx = 0;

    player.setBlocking(false);
    aimAssist();
    const f = player.forward();
    player.addImpulse(f.x * fx.lunge * (heavy ? 1.3 : 1), f.z * fx.lunge * (heavy ? 1.3 : 1));

    const w = equipment.getWeapon();
    const speed = Math.max(0.8, Math.min(1.4, Math.sqrt(w ? w.speed : 1.1)));
    const c = { type, cfg, fx, heavy, idx, count };
    cur = c;
    if (heavy) heavyCd = HEAVY_CD;

    animator.attack({
      type, index: idx, heavy, speed,
      onHit: () => doHit(c),
      onEnd: () => {
        lastEndT = time; cur = null;
        if (heavy) idx = -1;
        const q = queued; queued = null;
        if (q && canAct()) start(q === 'heavy');
      }
    });
  }

  function request(heavy) {
    if (!canAct()) return;
    if (cur) { queued = heavy ? 'heavy' : 'light'; return; }   // ввод запоминается для следующего удара комбо
    start(heavy);
  }

  function doHit(c) {
    if (cur !== c) return;
    const w = equipment.getWeapon();
    const base = (w ? w.damage : 25) * DMG_SCALE;
    const finisher = !c.heavy && c.idx === c.count - 1 && c.count > 1;
    const range = c.fx.range * (c.heavy ? 1.1 : 1);
    const arc = c.fx.arc * (c.heavy ? 1.15 : 1) * DEG;
    const f = player.forward();
    let targets = enemies.queryCone(player.pos, f, range, arc);
    targets = (c.fx.sweep || c.heavy) ? targets.slice(0, 3) : targets.slice(0, 1);
    if (!targets.length) return;

    const mult = (c.heavy ? c.cfg.heavyMul : 1) * (finisher ? 1.25 : 1);
    const critChance = c.heavy ? 0.22 : 0.12;
    let anyKill = false;
    targets.forEach(t => {
      const crit = Math.random() < critChance;
      const dmg = Math.round(base * mult * (0.92 + Math.random() * 0.16) * (crit ? 1.8 : 1));
      const knock = c.fx.knock * (c.heavy ? 1.6 : 1) * (finisher ? 1.4 : 1);
      const res = t.takeHit(dmg, player.pos, { knock, stagger: c.heavy ? 0.6 : (finisher ? 0.5 : 0.35), crit });
      if (res.killed) anyKill = true;
    });
    hitstop = c.heavy ? 0.1 : 0.05;
    camRig.shake(c.heavy ? 0.22 : 0.1);
    player.emit('hit', { heavy: c.heavy, kill: anyKill, count: targets.length });
  }

  player.on('attack', () => request(false));
  player.on('heavy', () => request(true));
  player.on('dodge', () => { cur = null; queued = null; idx = -1; });
  player.on('death', () => { cur = null; queued = null; idx = -1; animator.cancelAttack(); });

  // dt — реальное время кадра (до замедления хитстопом)
  function update(dt) {
    time += dt;
    heavyCd = Math.max(0, heavyCd - dt);
    hitstop = Math.max(0, hitstop - dt);
    if (cur && !animator.isAttacking()) { cur = null; queued = null; }   // атаку прервали (уклонение, смерть)
    if (!cur && time - lastEndT > 1.5) idx = -1;

    // захват цели: голова следит за ближайшим врагом
    const t = S.dead ? null : enemies.nearest(player.pos, 8);
    player.setLookTarget(t ? t.pos : null);

    if (heavyBtn) heavyBtn.classList.toggle('cd', heavyCd > 0);
    if (dodgeBtn) dodgeBtn.classList.toggle('cd', S.dodgeCd > 0);
  }

  return {
    update,
    get timeScale() { return hitstop > 0 ? 0.08 : 1; },
    get attacking() { return !!cur; },
    get comboIndex() { return idx; }
  };
}
