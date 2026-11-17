// js/main.js — запуск игры: загрузка, меню, настройки, задания, мини-карта, игровой цикл
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { setRenderer, onProgress, loadMiku } from './loader.js';
import { createWorld } from './world.js';
import { createCameraRig } from './camera.js';
import { createAnimator } from './animations.js';
import { createEquipment } from './equipment.js';
import { createPlayer } from './player.js';
import { createInventory, LOOT_TABLE } from './inventory.js';
import { createEnemies } from './enemies.js';
import { createCombat } from './combat.js';

const $ = id => document.getElementById(id);
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);

// ---------------------------------------------------------------------------
// ОШИБКИ (на iPhone нет консоли — показываем текст на экране)
const errBox = $('errorBox');
function showError(msg) {
  errBox.textContent = '⚠ ' + msg + '  (нажмите, чтобы скрыть)';
  errBox.classList.remove('hidden');
}
errBox.addEventListener('click', () => errBox.classList.add('hidden'));
window.addEventListener('error', e => showError((e.message || 'Ошибка') + (e.filename ? ' — ' + e.filename.split('/').pop() + ':' + e.lineno : '')));
window.addEventListener('unhandledrejection', e => showError(String((e.reason && e.reason.message) || e.reason || 'Ошибка загрузки')));

// Запрет жестов масштабирования и прокрутки страницы в Safari (кроме списков в меню)
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => {
  if (!e.target.closest || !e.target.closest('.grid,.detail,.set-body,.eq-col,.char-body,.tabs,.inv-body,.eq-body,.log')) e.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------------------
// НАСТРОЙКИ
const DEFAULT_SETTINGS = { quality: isMobile ? 'mid' : 'high', shadows: true, fps: true, invert: false, sens: 100, btn: 100 };
let settings = Object.assign({}, DEFAULT_SETTINGS);
try { Object.assign(settings, JSON.parse(localStorage.getItem('mbw_settings') || '{}')); } catch (_) { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('mbw_settings', JSON.stringify(settings)); } catch (_) { /* ignore */ } };

// ---------------------------------------------------------------------------
// ЭКРАН ЗАГРУЗКИ
const TIPS = [
  'Исследуйте мир, находите скрытые сундуки и открывайте новые возможности!',
  'Разные виды оружия имеют разные комбо: тяжёлое оружие бьёт медленнее, но сильнее.',
  'Блок щитом гасит 70% урона, но тратит выносливость.',
  'Уклонение даёт короткую неуязвимость, используйте его перед ударом врага.',
  'Колодец в центре деревни восстановит часть здоровья.'
];
let tipI = 0;
setInterval(() => { tipI = (tipI + 1) % TIPS.length; const t = $('tipText'); if (t) t.textContent = TIPS[tipI]; }, 4500);

let progress = 0;
function setProgress(p) {
  progress = Math.max(progress, Math.min(1, p));
  const pct = Math.round(progress * 100);
  $('loadFill').style.width = pct + '%';
  $('loadStar').style.left = pct + '%';
  $('loadText').textContent = 'Загрузка... ' + pct + '%';
}
function setLoadText(t) { $('loadText').textContent = t; }

// ---------------------------------------------------------------------------
// ТОСТЫ И ЖУРНАЛ
const logLines = [];
function log(msg) { logLines.push(new Date().toLocaleTimeString().slice(0, 5) + '  ' + msg); if (logLines.length > 60) logLines.shift(); }
function toast(msg) {
  log(msg);
  const box = $('toastBox');
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

// ---------------------------------------------------------------------------
// МЕНЮ (панели)
const overlay = $('overlay');
const panelIds = ['pInv', 'pEquip', 'pChar', 'pSettings', 'pQuests', 'pLog', 'pAccount', 'pHelp', 'pView'];
let openId = null, stack = [], onLoading = true;
let player = null, camRig = null, inventory = null;

function showPanel(id) {
  panelIds.forEach(p => $(p).classList.add('hidden'));
  $(id).classList.remove('hidden');
  openId = id;
  if (id === 'pQuests') renderQuests();
  if (id === 'pLog') { const l = $('logList'); l.innerHTML = logLines.slice().reverse().map(x => '<div>' + x + '</div>').join('') || '<div>Журнал пуст</div>'; }
  if (id === 'pSettings') syncSettingsUi();
  if (id === 'pAccount') $('accName').value = localStorage.getItem('mbw_name') || '';
  if (inventory) inventory.onShow(id);
}
function openPanel(id, push) {
  overlay.style.zIndex = onLoading ? 150 : 50;
  if (openId && push) stack.push(openId);
  else if (openId && !push) stack = [];
  overlay.classList.remove('hidden', 'closing');
  showPanel(id);
  if (player) { player.setEnabled(false); }
  if (camRig) camRig.setEnabled(false);
}
function closePanel() {
  if (!openId) return;
  if (inventory) inventory.onHide();
  if (stack.length) { showPanel(stack.pop()); return; }
  openId = null;
  overlay.classList.add('closing');
  setTimeout(() => {
    if (openId) return;
    overlay.classList.add('hidden'); overlay.classList.remove('closing');
    panelIds.forEach(p => $(p).classList.add('hidden'));
  }, 220);
  if (!onLoading) { if (player) player.setEnabled(true); if (camRig) camRig.setEnabled(true); }
}
function togglePanel(id) { if (openId === id) closePanel(); else openPanel(id); }
const isPaused = () => !!openId;

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closePanel));
overlay.addEventListener('pointerdown', e => { if (e.target === overlay) closePanel(); });

// Кнопки HUD и экрана загрузки
const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
bind('ldSettings', () => openPanel('pSettings'));
bind('ldAccount', () => openPanel('pAccount'));
bind('ldHelp', () => openPanel('pHelp'));
bind('btnInv', () => togglePanel('pInv'));
bind('btnEquip', () => togglePanel('pEquip'));
bind('btnChar', () => togglePanel('pChar'));
bind('btnPlayerCard', () => togglePanel('pChar'));
bind('btnSettings', () => togglePanel('pSettings'));
bind('btnQuests', () => togglePanel('pQuests'));
bind('btnQuest', () => togglePanel('pQuests'));
bind('btnLog', () => togglePanel('pLog'));
bind('btnCenterMap', () => { if (camRig && player) { camRig.yaw = player.state.yaw; toast('Камера повёрнута за спину'); } });
document.querySelectorAll('.slot').forEach(s => s.addEventListener('click', () => {
  toast(s.dataset.slot === '1' ? 'Miku ведёт отряд' : 'В этом слоте нет персонажа');
}));

// ---------------------------------------------------------------------------
// НАСТРОЙКИ UI
let renderer = null, world = null, enemies = null;
function applySettings() {
  const dprCap = settings.quality === 'low' ? 1 : settings.quality === 'mid' ? 1.5 : CONFIG.quality.maxPixelRatio;
  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, dprCap));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.shadowMap.enabled = settings.shadows;
  }
  if (world) { world.setQuality(settings.quality); world.setShadows(settings.shadows); }
  if (camRig) { camRig.setSensitivity(settings.sens / 100); camRig.setInvertY(settings.invert); }
  document.documentElement.style.setProperty('--btn', settings.btn / 100);
  $('fpsText').parentElement.style.display = settings.fps ? '' : 'none';
}
function syncSettingsUi() {
  $('setQuality').value = settings.quality; $('setShadows').checked = settings.shadows; $('setFps').checked = settings.fps;
  $('setInvert').checked = settings.invert; $('setSens').value = settings.sens; $('setBtn').value = settings.btn;
}
function bindSetting(id, key, read) {
  $(id).addEventListener('input', e => { settings[key] = read(e.target); saveSettings(); applySettings(); });
}
bindSetting('setQuality', 'quality', t => t.value);
bindSetting('setShadows', 'shadows', t => t.checked);
bindSetting('setFps', 'fps', t => t.checked);
bindSetting('setInvert', 'invert', t => t.checked);
bindSetting('setSens', 'sens', t => Number(t.value));
bindSetting('setBtn', 'btn', t => Number(t.value));
bind('setReset', () => { settings = Object.assign({}, DEFAULT_SETTINGS); saveSettings(); applySettings(); syncSettingsUi(); toast('Настройки сброшены'); });
bind('accSave', () => { localStorage.setItem('mbw_name', $('accName').value.trim()); toast('Имя сохранено'); });
bind('accClear', async () => {
  if (!inventory) { try { localStorage.clear(); } catch (_) { /* */ } toast('Сохранение удалено'); return; }
  await inventory.resetAll(); questState = freshQuests(); saveQuests(); toast('Сохранение удалено');
});

// ---------------------------------------------------------------------------
// ЗАДАНИЯ
function freshQuests() {
  return { kill: { title: 'Победите врагов', need: 3, have: 0 }, well: { title: 'Освежитесь у колодца', need: 1, have: 0 }, chest: { title: 'Откройте сундук', need: 1, have: 0 } };
}
let questState = freshQuests();
try { const q = JSON.parse(localStorage.getItem('mbw_quests') || 'null'); if (q) questState = Object.assign(freshQuests(), q); } catch (_) { /* */ }
const saveQuests = () => { try { localStorage.setItem('mbw_quests', JSON.stringify(questState)); } catch (_) { /* */ } };
const questAvailable = id => id === 'kill' || (world && world.interactables.has(id));
function questProgress(id, n) {
  const q = questState[id];
  if (!q || q.have >= q.need) return;
  q.have = Math.min(q.need, q.have + (n || 1));
  if (q.have >= q.need) { toast('Задание выполнено: ' + q.title); inventory && inventory.addItem('potion_heal', 1); }
  saveQuests();
}
function renderQuests() {
  const ids = Object.keys(questState).filter(questAvailable);
  $('questList').innerHTML = ids.map(id => {
    const q = questState[id];
    return `<div class="quest-item${q.have >= q.need ? ' done' : ''}">${q.title} — ${q.have}/${q.need}</div>`;
  }).join('') || '<div class="quest-item">Нет активных заданий</div>';
}
function updateQuestHud() {
  const id = Object.keys(questState).filter(questAvailable).find(k => questState[k].have < questState[k].need);
  const title = $('questTitle'), dist = $('questDist');
  if (!id) { title.textContent = 'Все задания выполнены'; dist.textContent = ''; return; }
  const q = questState[id];
  title.textContent = q.title + ' (' + q.have + '/' + q.need + ')';
  let target = null;
  if (id === 'kill') { const e = enemies && enemies.nearest(player.pos, 1e9); target = e ? e.pos : null; }
  else { const it = world.interactables.get(id); target = it ? it.pos : null; }
  dist.textContent = target ? '▲ ' + Math.round(Math.hypot(target.x - player.pos.x, target.z - player.pos.z)) + ' м' : '';
}

// ---------------------------------------------------------------------------
// ЗАПУСК
async function boot() {
  setProgress(0.02);
  const canvas = $('game');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  setRenderer(renderer);

  world = createWorld(renderer);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 800);
  camRig = createCameraRig(camera, canvas);
  camRig.setEnabled(false);
  applySettings();
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camRig.resize(innerWidth, innerHeight); });
  setProgress(0.05);

  // --- персонаж Miku
  setLoadText('Загрузка персонажа...');
  onProgress(f => setProgress(0.05 + 0.6 * f));
  const miku = await loadMiku();
  const pivot = new THREE.Group();
  pivot.add(miku.scene);
  miku.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  world.scene.add(pivot);
  const animator = createAnimator(pivot, miku.scene, miku.clips);
  const equipment = createEquipment({ pivot, animator, onChange: () => { if (inventory) inventory.onEquipChange(); } });
  player = createPlayer({ pivot, animator, equipment, world, camRig });
  camRig.yaw = player.state.yaw;
  player.setEnabled(false);   // ввод включится после нажатия «Начать»

  // --- мир
  setLoadText('Загрузка мира...');
  let done = 0;
  await world.loadProps(() => { done++; setProgress(0.65 + 0.2 * (done / 7)); });
  setProgress(0.85);

  // --- инвентарь и экипировка
  setLoadText('Подготовка экипировки...');
  onProgress(f => setProgress(0.85 + 0.12 * f));
  inventory = createInventory({ renderer, scene: world.scene, pivot, equipment, player, toast, openPanel: id => openPanel(id, true) });
  await inventory.restore();
  setProgress(0.97);

  // --- враги и бой
  enemies = await createEnemies({
    scene: world.scene, world, player, camera, lite: settings.quality === 'low',
    onKill: e => {
      toast('Побеждён: ' + e.type.name);
      questProgress('kill', 1);
      if (Math.random() < 0.4) inventory.addItem(LOOT_TABLE[Math.floor(Math.random() * LOOT_TABLE.length)], 1);
    }
  });
  await enemies.spawn('dummy', 5, -9);
  enemies.spawn('ossuary-legionary', -5, -9).catch(e => console.warn('[enemies]', e.message));
  const combat = createCombat({ player, animator, equipment, enemies, camRig });

  // --- события игрока
  const chestReady = { t: 0 };
  player.on('menu', name => {
    if (name === 'escape') { if (openId) closePanel(); else if (!onLoading) openPanel('pSettings'); }
    else togglePanel({ inventory: 'pInv', equip: 'pEquip', char: 'pChar' }[name]);
  });
  player.on('interact', it => {
    if (it.id === 'chest') {
      if (performance.now() < chestReady.t) { toast('Сундук пуст'); return; }
      chestReady.t = performance.now() + 45000;
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) inventory.addItem(LOOT_TABLE[Math.floor(Math.random() * LOOT_TABLE.length)], 1 + Math.floor(Math.random() * 2));
      questProgress('chest', 1);
    } else if (it.id === 'well') {
      player.heal(Math.round(player.state.maxHp * 0.25)); toast('Вы освежились: +25% здоровья'); questProgress('well', 1);
    } else if (it.msg) toast(it.msg);
  });
  player.on('death', () => toast('Вы погибли'));
  player.on('deathend', () => setTimeout(() => { player.respawn(); toast('Вы возродились на площади'); }, 1200));
  player.on('respawn', () => { camRig.yaw = player.state.yaw; });

  window.__game = { player, enemies, combat, world, equipment, inventory, animator, camRig };
  window.__anim = animator; window.__eq = equipment;
  inventory.refreshAll();

  // --- мини-карта
  const mmCtx = $('minimap').getContext('2d');
  let mmT = 0;

  // --- игровой цикл
  const clock = new THREE.Clock();
  let fpsN = 0, fpsT = 0;
  function frame() {
    requestAnimationFrame(frame);
    const raw = Math.min(clock.getDelta(), 0.1);
    const paused = isPaused() || onLoading;
    const dt = paused ? raw : raw * combat.timeScale;

    if (!paused) combat.update(raw);
    player.update(dt);
    camRig.update(dt, player.pos, { sprinting: player.state.sprinting });
    world.update(dt, camera, player.pos);
    if (!paused) enemies.update(dt);
    inventory.tick(raw);

    mmT += raw;
    if (mmT > 0.08) { mmT = 0; world.drawMinimap(mmCtx, player.pos.x, player.pos.z, camRig.yaw, enemies.marks()); updateQuestHud(); }
    fpsN++; fpsT += raw;
    if (fpsT >= 0.5) { $('fpsText').textContent = Math.round(fpsN / fpsT) + ' fps'; fpsN = 0; fpsT = 0; }

    renderer.render(world.scene, camera);
  }
  frame();

  // --- готово
  setProgress(1); setLoadText('Загрузка... 100%');
  const start = $('btnStart');
  start.classList.remove('hidden');
  start.addEventListener('click', () => {
    onLoading = false;
    $('loading').classList.add('fade');
    setTimeout(() => $('loading').classList.add('hidden'), 650);
    $('hud').classList.remove('hidden');
    player.setEnabled(true); camRig.setEnabled(true);
    toast('Добро пожаловать в MB Universe!');
  }, { once: true });
}

boot().catch(e => {
  console.error(e);
  setLoadText('Ошибка загрузки');
  showError(e.message || String(e));
});
