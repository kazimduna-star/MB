// js/inventory.js — предметы, инвентарь, меню экипировки, окно персонажа, 3D-просмотр, сохранение
//
// 3D-превью рисуются тем же WebGL-рендерером, что и игра (текстуры не дублируются в памяти):
// кадр рендерится в WebGLRenderTarget, затем копируется на 2D-холст меню.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { itemDefFromConfig, SLOT_INFO } from './equipment.js';
import { loadItemModel } from './loader.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'mbw_save_v1';

const RARITY_NAME = { common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };
const WTYPE_NAME = { sword1h: 'Одноручный меч', sword2h: 'Двуручный меч', dagger: 'Кинжал', axe: 'Топор', hammer: 'Молот', spear: 'Копьё', staff: 'Посох' };
const CAT_NAME = { weapon: 'Оружие', armor: 'Броня', shield: 'Щит', material: 'Материал', other: 'Предмет' };

// Иконки (векторные, собственные)
const SYMBOLS = {
  axe: '<path d="M29 6h6v54h-6z" fill="currentColor"/><path d="M35 10c16-4 22 12 14 28-3-8-8-11-14-12z" fill="currentColor"/>',
  hammer: '<path d="M12 8h40v18H12z" fill="currentColor"/><path d="M28 26h8v34h-8z" fill="currentColor"/>',
  dagger: '<path d="M32 3l9 33H23z" fill="currentColor"/><path d="M16 36h32v6H16zM28 42h8v16h-8z" fill="currentColor"/>',
  potion: '<path d="M26 4h12v4h-3v10l14 24a14 14 0 0 1-12 20H27A14 14 0 0 1 15 42l14-24V8h-3z" fill="currentColor"/>',
  ingot: '<path d="M6 46 18 22h28l12 24z" fill="currentColor"/><path d="M18 22h28" stroke="#fff6" stroke-width="3"/>',
  leather: '<path d="M10 18C22 6 42 6 54 18l-4 32C40 60 24 60 14 50z" fill="currentColor"/>',
  plank: '<path d="M6 16h52v10H6zM6 30h52v10H6zM6 44h52v10H6z" fill="currentColor"/>',
  key: '<circle cx="20" cy="22" r="13" fill="none" stroke="currentColor" stroke-width="7"/><path d="M29 31l27 27M44 46l8-8M52 54l8-8" stroke="currentColor" stroke-width="7" fill="none"/>',
  helmet: '<path d="M10 40C10 18 22 6 32 6s22 12 22 34v12H40V42H24v10H10z" fill="currentColor"/>'
};

// Обычные предметы без 3D-модели (материалы и расходники)
const MISC_ITEMS = [
  { id: 'potion_heal', cat: 'other', name: 'Целебное зелье', rarity: 'uncommon', icon: 'potion', emoji: '🧪', count: 3, use: { heal: 6000 }, desc: 'Восстанавливает 6000 здоровья. Нажмите «Использовать».', stats: [['Лечение', 6000]] },
  { id: 'old_key', cat: 'other', name: 'Ржавый ключ', rarity: 'common', icon: 'key', emoji: '🗝️', count: 1, desc: 'Старый ключ от неизвестного замка.', stats: [] },
  { id: 'iron_ingot', cat: 'material', name: 'Железный слиток', rarity: 'common', icon: 'ingot', emoji: '🔶', count: 5, desc: 'Основа для кузнечного дела.', stats: [] },
  { id: 'leather_scrap', cat: 'material', name: 'Кожаные лоскуты', rarity: 'common', icon: 'leather', emoji: '🧵', count: 8, desc: 'Прочная выделанная кожа.', stats: [] },
  { id: 'oak_plank', cat: 'material', name: 'Дубовая доска', rarity: 'uncommon', icon: 'plank', emoji: '🪵', count: 4, desc: 'Сухое дубовое дерево из деревенской мастерской.', stats: [] }
];

// Лут для сундука
export const LOOT_TABLE = ['potion_heal', 'iron_ingot', 'leather_scrap', 'oak_plank'];

// ---------------------------------------------------------------------------
export function createInventory(ctx) {
  // ctx: { renderer, scene, pivot, equipment, player, toast(msg), openPanel(id), closePanels() }
  const { renderer, equipment } = ctx;

  // --- символы иконок
  const symHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  symHost.setAttribute('width', '0'); symHost.setAttribute('height', '0'); symHost.style.position = 'absolute';
  symHost.innerHTML = Object.entries(SYMBOLS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 64 64">${v}</symbol>`).join('');
  document.body.appendChild(symHost);

  // --- база предметов
  const ITEMS = {};
  for (const id in CONFIG.weapons) {
    const d = itemDefFromConfig(id), w = CONFIG.weapons[id];
    const icon = w.type === 'axe' ? 'axe' : w.type === 'hammer' ? 'hammer' : w.type === 'dagger' ? 'dagger' : 'sword';
    ITEMS[id] = { id, cat: 'weapon', name: w.name, rarity: w.rarity, icon, wtype: w.type, def: d, file: w.file, count: 1,
      stats: [['Тип', WTYPE_NAME[w.type] || w.type], ['Урон', w.damage], ['Скорость атаки', w.speed.toFixed(2) + '×'], ['Длина', w.length + ' м'], ['Хват', d.twoHanded ? 'Двуручный' : 'Одноручный']],
      desc: w.desc || 'Оружие из набора кузнеца.' };
  }
  for (const id in CONFIG.shields) {
    const d = itemDefFromConfig(id), s = CONFIG.shields[id];
    ITEMS[id] = { id, cat: 'shield', name: s.name, rarity: s.rarity, icon: 'shield', def: d, file: s.file, count: 1,
      stats: [['Блок урона', Math.round((s.block || 0.45) * 100) + '%']], desc: 'Надёжный щит. Занимает левую руку.' };
  }
  const ARMOR = CONFIG.armor || {};
  for (const id in ARMOR) {
    const a = ARMOR[id];
    const d = { id, kind: 'armor', slot: a.slot, name: a.name, rarity: a.rarity, file: a.file, fit: a.fit, rot: a.rot, pos: a.pos, grip: a.grip || {} };
    ITEMS[id] = { id, cat: 'armor', name: a.name, rarity: a.rarity || 'common', icon: a.slot === 'head' ? 'helmet' : 'armor', def: d, file: a.file, count: 1,
      stats: [['Слот', (SLOT_INFO[a.slot] || {}).label || a.slot], ['Защита', (a.stats && a.stats.defense) || 0]], desc: a.desc || 'Элемент брони.' };
  }
  MISC_ITEMS.forEach(m => { ITEMS[m.id] = Object.assign({}, m); });

  // --- сумка
  const bag = {};             // id -> количество
  function defaultBag() {
    Object.keys(ITEMS).forEach(id => { bag[id] = ITEMS[id].count || 1; });
  }
  defaultBag();

  // --- сохранение
  function save() {
    try {
      const eq = {};
      Object.keys(SLOT_INFO).forEach(s => { const d = equipment.get(s); if (d) eq[s] = d.id; });
      localStorage.setItem(SAVE_KEY, JSON.stringify({ bag, eq, name: localStorage.getItem('mbw_name') || '' }));
    } catch (_) { /* приватный режим Safari — игнорируем */ }
  }
  function loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (_) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* */ } }

  async function restore() {
    const sv = loadSave();
    let eq = { mainHand: 'sword_sigil_06', offHand: 'kite_shield' };
    if (sv && sv.bag) {
      Object.keys(bag).forEach(k => { bag[k] = 0; });
      Object.keys(sv.bag).forEach(k => { if (ITEMS[k]) bag[k] = sv.bag[k]; });
      eq = sv.eq || {};
    }
    for (const slot in eq) {
      const it = ITEMS[eq[slot]];
      if (it && it.def && bag[it.id] > 0) await equipment.equip(it.def);
    }
    refreshAll();
  }

  // ---------------------------------------------------------------------------
  // ВЫБОР И КНОПКИ
  let cat = 'weapon', slotFilter = null, selected = null, active = null; // active — открытая панель

  const equippedIds = () => new Set(Object.keys(SLOT_INFO).map(s => (equipment.get(s) || {}).id).filter(Boolean));

  function iconHtml(it, style) {
    return `<svg style="${style}"><use href="#i-${it.icon}"/></svg>`;
  }

  function renderGrid() {
    const grid = $('invGrid');
    const eqIds = equippedIds();
    let list = Object.values(ITEMS).filter(it => it.cat === cat && bag[it.id] > 0);
    if (slotFilter && cat === 'armor') list = list.filter(it => it.def && it.def.slot === slotFilter);
    if (!list.length) {
      const hint = cat === 'armor'
        ? 'Предметов брони пока нет. Положите модели в assets/armor/ и добавьте их в js/config.js → armor.'
        : 'В этой категории пока ничего нет.';
      grid.innerHTML = `<div style="grid-column:1/-1;padding:18px;opacity:.75;font-size:14px;line-height:1.4">${hint}</div>`;
      return;
    }
    grid.innerHTML = '';
    list.forEach(it => {
      const b = document.createElement('button');
      b.className = 'cell' + (selected === it.id ? ' sel' : '') + (eqIds.has(it.id) ? ' equipped' : '');
      b.style.setProperty('--rc', CONFIG.rarity[it.rarity] || '#aaa');
      b.innerHTML = iconHtml(it, `position:absolute;inset:8px 8px 26px;width:calc(100% - 16px);height:calc(100% - 34px);color:${CONFIG.rarity[it.rarity] || '#ddd'}`) +
        `<span>${it.name}${bag[it.id] > 1 ? ' ×' + bag[it.id] : ''}</span>`;
      b.addEventListener('click', () => select(it.id));
      grid.appendChild(b);
    });
  }

  function renderTabs() {
    document.querySelectorAll('#invTabs button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
  }

  function select(id) {
    selected = id;
    viewScene = null; viewKey = null;
    renderGrid(); renderDetail();
  }

  function renderDetail() {
    const it = selected ? ITEMS[selected] : null;
    const name = $('dName'), rar = $('dRarity'), typ = $('dType'), stats = $('dStats'), desc = $('dDesc');
    const bEq = $('dEquip'), bUn = $('dUnequip'), bView = $('dView');
    if (!it || !(bag[it.id] > 0)) {
      name.textContent = 'Выберите предмет'; rar.textContent = ''; typ.textContent = ''; stats.innerHTML = ''; desc.textContent = '';
      bEq.disabled = bUn.disabled = bView.disabled = true; bEq.textContent = 'Экипировать';
      clearCanvas($('invPreview'));
      return;
    }
    const isEq = equippedIds().has(it.id);
    name.textContent = it.name + (bag[it.id] > 1 ? ' ×' + bag[it.id] : '');
    rar.textContent = RARITY_NAME[it.rarity] || ''; rar.style.color = CONFIG.rarity[it.rarity] || '#fff';
    typ.textContent = CAT_NAME[it.cat] || '';
    stats.innerHTML = it.stats.map(s => `<li><span>${s[0]}</span><b>${s[1]}</b></li>`).join('');
    desc.textContent = it.desc || '';
    if (it.use) { bEq.textContent = 'Использовать'; bEq.disabled = false; bUn.disabled = true; }
    else if (it.def) { bEq.textContent = 'Экипировать'; bEq.disabled = isEq; bUn.disabled = !isEq; }
    else { bEq.textContent = 'Экипировать'; bEq.disabled = true; bUn.disabled = true; }
    bView.disabled = !it.file;
    if (!it.file) drawEmoji($('invPreview'), it.emoji || '❔');
  }

  function clearCanvas(c) { if (!c) return; c.style.transform = ''; c.getContext('2d').clearRect(0, 0, c.width, c.height); }
  function drawEmoji(c, e) {
    c.style.transform = '';
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    g.font = Math.round(c.height * 0.5) + 'px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(e, c.width / 2, c.height / 2);
  }

  async function equipItem(it) {
    if (!it || !it.def) return;
    const res = await equipment.equip(it.def);
    if (!res.ok) { if (res.reason !== 'cancelled') ctx.toast(res.reason); return; }
    ctx.toast('Экипировано: ' + it.name);
    res.removed.forEach(d => ctx.toast('Снято: ' + d.name));
    flashSlot(it.def.slot);
    refreshAll(); save();
  }

  function useItem(it) {
    if (!it || !it.use || !(bag[it.id] > 0)) return;
    if (it.use.heal) {
      if (ctx.player.state.hp >= ctx.player.state.maxHp) { ctx.toast('Здоровье уже полное'); return; }
      ctx.player.heal(it.use.heal);
      ctx.toast(it.name + ': +' + it.use.heal + ' здоровья');
    }
    bag[it.id]--; refreshAll(); save();
  }

  $('dEquip').addEventListener('click', () => { const it = ITEMS[selected]; if (!it) return; it.use ? useItem(it) : equipItem(it); });
  $('dUnequip').addEventListener('click', () => {
    const it = ITEMS[selected]; if (!it || !it.def) return;
    equipment.unequip(it.def.slot); ctx.toast('Снято: ' + it.name); flashSlot(it.def.slot); refreshAll(); save();
  });
  $('dView').addEventListener('click', () => {
    const it = ITEMS[selected]; if (!it || !it.file) return;
    $('viewTitle').textContent = it.name;
    viewScene = null; viewKey = null; viewBig = true;
    ctx.openPanel('pView');
  });
  document.querySelectorAll('#invTabs button').forEach(b => b.addEventListener('click', () => {
    cat = b.dataset.cat; slotFilter = null; selected = null; renderTabs(); renderGrid(); renderDetail();
  }));

  // ---------------------------------------------------------------------------
  // ЭКИПИРОВКА
  const LEFT = ['head', 'shoulders', 'chest', 'bracers', 'gloves', 'belt'];
  const RIGHT = ['cloak', 'pants', 'boots', 'extra', 'mainHand', 'offHand'];
  const SLOT_ICON = { head: 'helmet', shoulders: 'armor', chest: 'armor', bracers: 'armor', gloves: 'armor', belt: 'armor', cloak: 'armor', pants: 'armor', boots: 'armor', extra: 'armor', mainHand: 'sword', offHand: 'shield' };

  function slotHtml(slot) {
    const d = equipment.get(slot);
    const it = d ? ITEMS[d.id] : null;
    const col = it ? (CONFIG.rarity[it.rarity] || '#fff') : '#fff';
    return `<svg style="width:30px;height:30px;flex:none;opacity:${it ? 1 : 0.4};color:${col}"><use href="#i-${it ? it.icon : SLOT_ICON[slot]}"/></svg>` +
      `<span>${SLOT_INFO[slot].label}<small>${it ? it.name : 'Пусто'}</small></span>`;
  }
  function renderEquip() {
    const mk = (box, slots) => {
      box.innerHTML = '';
      slots.forEach(slot => {
        const d = equipment.get(slot), it = d ? ITEMS[d.id] : null;
        const b = document.createElement('button');
        b.className = 'eq-slot' + (it ? ' filled' : ''); b.dataset.slot = slot;
        if (it) b.style.setProperty('--rc', CONFIG.rarity[it.rarity] || '#fff');
        b.innerHTML = slotHtml(slot);
        b.addEventListener('click', () => onSlotClick(slot));
        box.appendChild(b);
      });
    };
    mk($('eqLeft'), LEFT); mk($('eqRight'), RIGHT);
  }
  function onSlotClick(slot) {
    if (equipment.get(slot)) {
      const d = equipment.unequip(slot);
      ctx.toast('Снято: ' + d.name); refreshAll(); save(); flashSlot(slot);
      return;
    }
    cat = slot === 'mainHand' ? 'weapon' : slot === 'offHand' ? 'shield' : 'armor';
    slotFilter = (cat === 'armor') ? slot : null; selected = null;
    renderTabs(); renderGrid(); renderDetail();
    ctx.openPanel('pInv');
  }
  function flashSlot(slot) {
    const el = document.querySelector(`.eq-slot[data-slot="${slot}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  // ---------------------------------------------------------------------------
  // ПЕРСОНАЖ
  function renderChar() {
    const w = equipment.getWeapon(), sh = equipment.get('offHand'), st = ctx.player.state;
    const rows = [
      ['Имя', localStorage.getItem('mbw_name') || 'Путешественник'],
      ['Уровень', 1],
      ['Здоровье', st.hp + ' / ' + st.maxHp],
      ['Выносливость', Math.round(st.stamina) + ' / ' + st.maxStamina],
      ['Оружие', w ? w.name : 'Кулаки'],
      ['Урон', w ? w.damage : 25],
      ['Скорость атаки', (w ? w.speed : 1.1).toFixed(2) + '×'],
      ['Щит', sh ? sh.name : '—'],
      ['Блок урона', sh ? Math.round((sh.block || 0.45) * 100) + '%' : '45% (оружием)']
    ];
    $('charStats').innerHTML = rows.map(r => `<div class="stat-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
  }

  function refreshAll() {
    renderTabs(); renderGrid(); renderDetail(); renderEquip(); renderChar();
  }

  // ---------------------------------------------------------------------------
  // 3D-ПРЕВЬЮ
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
  const tmpColor = new THREE.Color();

  function makePreviewer(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const buf = new Uint8Array(w * h * 4);
    const img = new ImageData(w, h);
    return {
      w, h,
      render(scene, camera, canvas) {
        const prevRT = renderer.getRenderTarget(), prevA = renderer.getClearAlpha();
        renderer.getClearColor(tmpColor); const prevC = tmpColor.getHex();
        renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
        renderer.setRenderTarget(prevRT); renderer.setClearColor(prevC, prevA);
        const d = img.data;
        for (let i = 0; i < buf.length; i += 4) {
          d[i] = lut[buf[i]]; d[i + 1] = lut[buf[i + 1]]; d[i + 2] = lut[buf[i + 2]]; d[i + 3] = buf[i + 3];
        }
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        canvas.style.transform = 'scaleY(-1)';        // readRenderTargetPixels отдаёт кадр вверх ногами
        canvas.getContext('2d').putImageData(img, 0, 0);
      }
    };
  }
  let pvEq = null, pvInv = null, pvView = null;

  // сцена просмотра одного предмета
  let viewScene = null, viewKey = null, viewBig = false, viewYaw = 0.6, viewLoading = false, viewDrag = null;
  async function buildView(file) {
    viewLoading = true;
    const key = file;
    const scene = new THREE.Scene();
    scene.environment = ctx.scene.environment;
    scene.add(new THREE.HemisphereLight(0xb9a8ff, 0x3a2a70, 1.1));
    const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(2, 3, 4); scene.add(dl);
    const model = await loadItemModel(file);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = 1.7 / Math.max(size.x, size.y, size.z, 1e-3);
    model.position.set(-c.x, -c.y, -c.z);
    const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(k);
    const tilt = new THREE.Group(); tilt.add(wrap);
    const it = ITEMS[selected];
    if (it && it.cat === 'weapon') tilt.rotation.z = -0.55;
    const spin = new THREE.Group(); spin.add(tilt); scene.add(spin);
    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 20); cam.position.set(0, 0, 3.4);
    viewLoading = false;
    if (selected && ITEMS[selected] && ITEMS[selected].file === key) { viewScene = { scene, cam, spin }; viewKey = key; }
  }

  // предпросмотр игрока
  let eqYaw = 0, eqDrag = null;
  const eqCam = new THREE.PerspectiveCamera(32, 300 / 420, 0.1, 30);
  const camTarget = new THREE.Vector3();

  function renderPlayerPreview() {
    if (!pvEq) pvEq = makePreviewer(300, 420);
    const p = ctx.pivot, yaw = ctx.player.state.yaw + eqYaw;
    camTarget.set(p.position.x, p.position.y + 0.9, p.position.z);
    eqCam.position.set(camTarget.x + Math.sin(yaw) * 3.9, camTarget.y + 0.1, camTarget.z + Math.cos(yaw) * 3.9);
    eqCam.lookAt(camTarget);
    const stash = [];
    ctx.scene.children.forEach(ch => { if (ch !== p && !ch.isLight && ch.visible) { ch.visible = false; stash.push(ch); } });
    const fog = ctx.scene.fog; ctx.scene.fog = null;
    pvEq.render(ctx.scene, eqCam, $('eqPreview'));
    ctx.scene.fog = fog;
    stash.forEach(ch => { ch.visible = true; });
  }

  function dragRotate(canvas, onMove) {
    let id = null, lx = 0;
    canvas.addEventListener('pointerdown', e => { id = e.pointerId; lx = e.clientX; canvas.setPointerCapture(id); });
    canvas.addEventListener('pointermove', e => { if (e.pointerId !== id) return; onMove(e.clientX - lx); lx = e.clientX; });
    const end = e => { if (e.pointerId === id) id = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  }
  dragRotate($('eqPreview'), dx => { eqYaw -= dx * 0.012; });
  dragRotate($('invPreview'), dx => { viewYaw += dx * 0.012; });
  dragRotate($('viewCanvas'), dx => { viewYaw += dx * 0.012; });

  let acc = 0;
  function tick(dt) {
    if (!active) return;
    acc += dt; if (acc < 1 / 24) return; const step = acc; acc = 0;
    if (active === 'pEquip') { renderPlayerPreview(); return; }
    const showInv = active === 'pInv', showView = active === 'pView';
    if (!showInv && !showView) return;
    const it = selected ? ITEMS[selected] : null;
    if (!it || !it.file) return;
    if (!viewScene || viewKey !== it.file) { if (!viewLoading) buildView(it.file).catch(e => { viewLoading = false; console.warn('[inventory] просмотр:', e); }); return; }
    if (!viewDrag) viewYaw += step * 0.6;
    viewScene.spin.rotation.y = viewYaw;
    if (showView) { if (!pvView) pvView = makePreviewer(360, 360); pvView.render(viewScene.scene, viewScene.cam, $('viewCanvas')); }
    else { if (!pvInv) pvInv = makePreviewer(256, 256); pvInv.render(viewScene.scene, viewScene.cam, $('invPreview')); }
  }

  // ---------------------------------------------------------------------------
  // ВЗАИМОДЕЙСТВИЕ С МЕНЮ ИЗ main.js
  function onShow(panelId) {
    active = panelId; acc = 1;
    if (panelId === 'pInv') { renderTabs(); renderGrid(); renderDetail(); }
    if (panelId === 'pEquip') { eqYaw = 0; renderEquip(); }
    if (panelId === 'pChar') renderChar();
    if (panelId === 'pView') { viewBig = true; }
  }
  function onHide() { active = null; slotFilter = null; }

  function addItem(id, n) {
    if (!ITEMS[id]) return false;
    bag[id] = (bag[id] || 0) + (n || 1);
    ctx.toast('Получено: ' + ITEMS[id].name + (n > 1 ? ' ×' + n : ''));
    refreshAll(); save();
    return true;
  }
  function usePotion() { useItem(ITEMS.potion_heal); }
  function resetAll() {
    clearSave(); defaultBag(); equipment.unequipAll(); selected = null; refreshAll();
    return restore();
  }

  return { ITEMS, bag, addItem, usePotion, save, restore, resetAll, refreshAll, onShow, onHide, tick,
    onEquipChange() { refreshAll(); save(); } };
}
