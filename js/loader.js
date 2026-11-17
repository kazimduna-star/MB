// js/loader.js — загрузка GLB с прогрессом, кэшем и поддержкой файлов по частям
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from './config.js';

const gltfLoader = new GLTFLoader();
const cache = new Map();      // url -> Promise<{scene, animations}>
const sizes = new Map();      // url -> {loaded, total} для общего прогресса
let progressCb = null;
let maxAniso = 4;

export function setRenderer(renderer) {
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}
export function onProgress(cb) { progressCb = cb; }

function reportProgress() {
  if (!progressCb) return;
  let l = 0, t = 0;
  sizes.forEach(v => { l += v.loaded; t += v.total || v.loaded; });
  progressCb(t ? Math.min(1, l / t) : 0);
}

// Скачивание файла потоком, с подсчётом байтов
async function fetchBuffer(url) {
  const st = { loaded: 0, total: 0 };
  sizes.set(url, st);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не найден файл: ' + url + ' (' + res.status + ')');
  st.total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    st.loaded = st.total = buf.byteLength;
    reportProgress();
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    st.loaded += value.length;
    reportProgress();
  }
  const out = new Uint8Array(st.loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  st.total = st.loaded;
  return out.buffer;
}

// Если файл разрезан на части: url + '.part000', '.part001', ...
// Список частей лежит в url + '.parts.json' → { "parts": 3 }
async function loadBuffer(url) {
  if (CONFIG.chunked && CONFIG.chunked[url]) {
    const n = CONFIG.chunked[url];
    const bufs = [];
    for (let i = 0; i < n; i++) {
      bufs.push(await fetchBuffer(url + '.part' + String(i).padStart(3, '0')));
    }
    const total = bufs.reduce((s, b) => s + b.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const b of bufs) { out.set(new Uint8Array(b), off); off += b.byteLength; }
    return out.buffer;
  }
  return fetchBuffer(url);
}

function parse(buf, url) {
  return new Promise((resolve, reject) => {
    const base = url.substring(0, url.lastIndexOf('/') + 1);
    gltfLoader.parse(buf, base, resolve, e => reject(new Error('Ошибка разбора ' + url + ': ' + (e && e.message || e))));
  });
}

// Исправление материалов: цветовые пространства, анизотропия, защита от розовых/чёрных
export function fixMaterials(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // у скинированных мешей bounding box может быть неверным
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m) return;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = maxAniso; }
      if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      if (m.normalMap) m.normalMap.anisotropy = maxAniso;
      if (m.metalness !== undefined && m.metalness > 0.95 && !m.metalnessMap) m.metalness = 0.6;
      m.envMapIntensity = 1.0;
      m.needsUpdate = true;
    });
  });
}

async function loadRaw(url) {
  const buf = await loadBuffer(url);
  const gltf = await parse(buf, url);
  fixMaterials(gltf.scene);
  return { scene: gltf.scene, animations: gltf.animations || [] };
}

// Модель с кэшем. Возвращает оригинал (для скинированных персонажей)
export function loadModel(url) {
  if (!cache.has(url)) {
    const p = loadRaw(url).catch(e => { cache.delete(url); throw e; });
    cache.set(url, p);
  }
  return cache.get(url);
}

// Предмет (оружие, щит): статичная модель — клонируем, геометрия и текстуры общие
export async function loadItemModel(url) {
  const { scene } = await loadModel(url);
  return SkeletonUtils.clone(scene);
}

// Нормализация размера по высоте/длине (метры), центр по низу
export function measure(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  return { box, size };
}

// ---------- Miku ----------
// Базовая модель берётся из idle.glb. Из остальных файлов забираются ТОЛЬКО клипы,
// после чего их геометрия и текстуры сразу освобождаются (экономия памяти на телефоне).
export async function loadMiku() {
  const P = CONFIG.paths.miku;
  const C = CONFIG.clips;
  const base = await loadModel(P.idle);
  const clips = {};
  const idleClip = base.animations.find(a => a.name === C.idle) || base.animations[0];
  if (!idleClip) throw new Error('В idle.glb нет анимации');
  clips.idle = idleClip;

  for (const key of ['walk', 'run', 'jump', 'death']) {
    const buf = await loadBuffer(P[key]);
    const gltf = await parse(buf, P[key]);
    const clip = gltf.animations.find(a => a.name === C[key]) || gltf.animations[0];
    if (!clip) throw new Error('В ' + P[key] + ' нет анимации');
    clips[key] = clip;
    disposeObject(gltf.scene);   // меш и текстуры из этого файла нам не нужны
    sizes.delete(P[key]);
  }
  return { scene: base.scene, clips };
}

// Предзагрузка оружия/щитов по требованию
export function preloadItem(file) { return loadModel(file); }

// ---------- Освобождение ресурсов ----------
export function disposeObject(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      });
    }
    if (o.skeleton && o.skeleton.boneTexture) o.skeleton.boneTexture.dispose();
  });
}

export function unloadModel(url) {
  const p = cache.get(url);
  if (!p) return;
  p.then(m => disposeObject(m.scene)).catch(() => {});
  cache.delete(url);
  sizes.delete(url);
}

export function resetProgress() { sizes.clear(); }
