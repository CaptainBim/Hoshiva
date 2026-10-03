/* Hoshiva — helper DOM & util kecil */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

/**
 * Ganti seluruh anak elemen, dengan menyaring `null`/`undefined`/`false`.
 *
 * `replaceChildren()` tidak melewati nilai falsy — `null` justru dikonversi jadi
 * text node berisi teks "null" yang tampil di layar. Conditional rendering
 * (`cond ? el(...) : null`) jadi wajib dibungkus helper ini.
 */
export function setKids(node, ...kids) {
  node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return node;
}

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ------------------------------ format ------------------------------ */

export const nf = new Intl.NumberFormat('id-ID');

export function fmtBytes(b) {
  if (!b && b !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'hari ini';
  if (days === 1) return 'kemarin';
  if (days < 30) return `${days} hari lalu`;
  if (days < 365) return `${Math.floor(days / 30)} bulan lalu`;
  return `${Math.floor(days / 365)} tahun lalu`;
}

export const titleCase = (s) =>
  String(s || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/* ------------------------------ toast ------------------------------ */

let toastHost;
export function toast(msg, kind = '', ico = '') {
  toastHost ||= qs('#toasts');
  if (!toastHost) return;
  const t = el(
    'div',
    { class: `toast ${kind ? `toast--${kind}` : ''}` },
    ico && el('span', { class: 'toast__ico', text: ico }),
    el('span', { text: msg })
  );
  toastHost.append(t);
  setTimeout(() => {
    t.classList.add('is-out');
    setTimeout(() => t.remove(), 320);
  }, 3400);
}

/* ------------------------------ storage ------------------------------ */

const NS = 'hoshiva:';
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(NS + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch {
      /* penuh */
    }
  },
};

/* --------------------------- image loader --------------------------- */

const imgCache = new Map();
export function preload(url) {
  if (!url || imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = im.onerror = () => res(url);
    im.src = url;
  });
  imgCache.set(url, p);
  return p;
}

/** Deteksi ukuran layar kerja (termasuk DPR) untuk preset default. */
export function screenSize() {
  const w = Math.round((window.screen?.width || window.innerWidth || 1920) * (window.devicePixelRatio || 1));
  const h = Math.round((window.screen?.height || window.innerHeight || 1080) * (window.devicePixelRatio || 1));
  return { w: Math.min(w, 7680), h: Math.min(h, 4320) };
}

/** Skor "seworthiness" wallpaper: tinggi, lebar, dan selalu proporsional. */
export function wallpaperScore(item, target) {
  if (!item.width || !item.height) return 0;
  const tw = target?.w || 1920;
  const th = target?.h || 1080;
  const tr = tw / th;
  const r = item.width / item.height;
  let s = Math.min(item.width, tw) / Math.min(tw, item.width);
  // rasio yang mirip target = lebih cocok jadi wallpaper
  const ratioFit = Math.exp(-Math.abs(Math.log(r / tr)) * 1.6);
  // butuh resolusi >= target agar tidak pecah
  const hasEnough = item.width >= tw && item.height >= th ? 1 : 0.45;
  return ratioFit * hasEnough * (0.7 + 0.3 * Math.min(item.mp / 4, 1));
}
