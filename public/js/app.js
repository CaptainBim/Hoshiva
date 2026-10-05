import { getConfig, search, getPost, getCategories, getSourcesStatus, imgUrl } from './api.js';
import {
  qs, qsa, el, setKids, esc, debounce, nf, fmtBytes, fmtDate, titleCase,
  toast, store, preload, screenSize, wallpaperScore,
} from './ui.js';

const LS = store.get('filters', {});

const state = {
  q: '',
  tags: [],
  selCats: [],       // id kategori yang sedang dipilih
  source: 'auto',
  sort: LS.sort || 'fit',
  ratio: LS.ratio || 'any',
  purity: 'safe',
  includeGeneral: false,

  preset: LS.preset || 'screen',
  w: LS.w || 0,
  h: LS.h || 0,
  fit: LS.fit || 'cover',
  /**
   * Posisi crop saat mode cover. Preset Ponsel mengaturnya ke 'centre' supaya
   * subjek di tengah tidak bergeser. Nilai lain tetap pakai default server.
   */
  pos: LS.pos || '',
  /**
   * Geser crop 0..100, 50 = tengah. Berlaku hanya untuk mode cover dan hanya
   * di sumbu yang benar-benar dipotong; lihat updatePanVisibility().
   */
  pan: Number.isFinite(LS.pan) ? Math.min(Math.max(LS.pan, 0), 100) : 50,
  /** 'auto' = upscale hanya bila target lebih besar dari sumber. */
  upscale: LS.upscale || 'auto',
  /** Crop aktif (fraksi 0..1): {x, y, w, h}. null = tanpa crop. */
  crop: null,
  /** Crop sementara saat pengguna sedang menyunting. */
  cropDraft: null,

  page: 1,
  items: [],
  total: 0,
  loading: false,
  done: false,
  view: store.get('view', 'grid'),

  allCats: [],       // daftar kategori dari taksonomi
  trending: [],
  freshKeys: new Set(),

  lbIndex: -1,
  lbItems: [],
  favorites: new Set(store.get('favorites', [])),
  seen: new Set(store.get('seen', [])),
  sourcesStatus: [],
};

let cfg = null;
let progressTimer = null;

/** Batas crop, diselaraskan dengan server lewat /api/config. */
const cropLimits = { min: 0.15, minPx: 320 };

/**
 * Akses elemen via id: dom.panel, dom.grid, ...
 * Pakai Proxy supaya id baru otomatis ter-resolve (dan ketahuan kalau salah tulis).
 */
const domStore = new Map();
const dom = new Proxy(
  {},
  {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!domStore.has(prop)) domStore.set(prop, document.getElementById(prop));
      return domStore.get(prop);
    },
    has(_t, prop) {
      return typeof prop === 'string' && !!document.getElementById(prop);
    },
  }
);

/** Id yang wajib ada. Kalau ada yang hilang, gagal cepat & jelas. */
const REQUIRED_IDS = [
  'searchForm', 'q', 'clearQ', 'quickChips', 'btnTheme', 'btnNew', 'newDot',
  'scrim', 'panel', 'closePanel', 'btnFilters', 'filterDot', 'applyFilters', 'resetFilters',
  'sourceRow', 'srcStatus', 'srcHint', 'ratioSel', 'catRow', 'catBadge', 'trendRow', 'sortRow',
  'grid', 'statline', 'empty', 'emptyTitle', 'emptyText', 'emptyRetry', 'loadMore', 'spinner', 'progress',
  'lb', 'lbStage', 'lbImg', 'lbSpin', 'lbSrc', 'lbTitle', 'lbMeta', 'lbInfo', 'dlBtn', 'dlLabel',
  'copyBtn', 'favBtn', 'origBtn', 'specGrid', 'upscaleNote', 'runUpscale',
  'tagCloud', 'tagCount', 'similar', 'lbPrev', 'lbNext', 'lbDims',
  'tbFit', 'tbActual', 'tbCrop', 'tbZoom', 'tbZoomIn', 'tbZoomOut', 'tbWb',
  'cropper', 'cropFrame',
  // ukuran + crop (di dalam lightbox)
  'presetRow', 'sizeBadge', 'screenHint', 'wNum', 'hNum', 'btnScreen', 'btnSwap', 'btnOriginal',
  'fitMode', 'cropHint', 'cropSize', 'cropClear', 'cropCancel', 'cropApply', 'cropStart',
];

function cacheDom() {
  const missing = REQUIRED_IDS.filter((id) => !document.getElementById(id));
  if (missing.length) {
    console.error('[hoshiva] id element tidak ditemukan di index.html:', missing);
  }
}

async function boot() {
  cacheDom();

  const theme = store.get('theme', 'dark');
  document.documentElement.dataset.theme = theme;

  if (!LS.w || !LS.h) {
    const s = screenSize();
    state.w = s.w;
    state.h = s.h;
  }

  dom.q.value = state.q;
  dom.grid.dataset.view = state.view;
  setProgress(true, 0.35);
  qsa('.viewtoggle .iconbtn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));

  try {
    cfg = await getConfig();
  } catch (e) {
    setProgress(false);
    dom.empty.hidden = false;
    dom.emptyTitle.textContent = 'Server belum jalan';
    dom.emptyText.textContent = `Tidak bisa menghubungi API Hoshiva (${e.message}). Jalankan: npm start`;
    return;
  }
  setProgress(false);

  // Batas crop ikut dari server supaya UI & validasi server tidak berbeda.
  cropLimits.min = cfg.crop?.minFrac || 0.15;
  cropLimits.minPx = cfg.crop?.minPx || 320;

  buildPresets();
  buildRatio();
  buildSort();
  buildSources();
  applySizeToInputs();
  // <select> cara-fit harus ikut state tersimpan; kalau tidak, tampilan
  // dan nilai yang benar-benar dipakai saat render jadi tidak sinkron.
  dom.fitMode.value = state.fit;
  dom.panRange.value = String(state.pan);
  dom.panVal.textContent = `${state.pan}%`;
  // Posisi crop diturunkan dari preset yang tersimpan, bukan dari nilai yang
  // disimpan terpisah: presetlah satu-satunya sumber kebenaran. Kalau
  // nilainya sama sekali belum ada (localStorage versi lama), tetap ikut preset.
  if (LS.pos === undefined) {
    state.pos = cfg.presets.find((p) => p.id === state.preset)?.position || '';
  }
  dom.ratioSel.value = state.ratio;
  updateSizeBadge();

  const s = screenSize();
  dom.screenHint.textContent = `Layar kamu ${s.w}×${s.h}px — ini default ukuran unduhan.`;

  refreshCategories();
  loadSourcesStatus();
  wire();
  runSearch({ reset: true });

  setInterval(refreshCategories, 45000);
  checkFreshBadge();
}

function buildPresets() {
  dom.presetRow.replaceChildren(
    ...cfg.presets.map((p) =>
      el(
        'button',
        {
          type: 'button',
          role: 'radio',
          'data-preset': p.id,
          class: state.preset === p.id ? 'is-on' : '',
          title: p.hint || `${p.w || 'auto'}×${p.h || 'auto'} · ${p.mode}`,
          onclick: () => applyPreset(p.id, { openCrop: true }),
        },
        p.label
      )
    )
  );
}

/**
 * Radio sumber — hanya sumber yang benar-benar bisa dipanggil.
 *
 * `state.sourcesStatus` diisi oleh loadSourcesStatus(). Sumber yang DOWN
 * disembunyikan supaya user tidak memilih sesuatu yang pasti gagal; kalau
 * tidak ada satu pun sumber hidup, hanya "Otomatis" yang ditampilkan.
 *
 * Labelnya cukup "Otomatis" saja. Keterangan "(semua sumber hidup)" dulu
 * disertakan, tapi di panel sempit teks itu lebih banyak memakan ruang
 * daripada yang ia jelaskan. "Otomatis" sudah di posisi pertama, di atas
 * daftar sumber individual yang juga ditampilkan.
 */
function buildSources() {
  const AUTO = { id: 'auto', label: 'Otomatis', kind: 'auto' };

  // Status belum diketahui (halaman baru dimuat) -> tampilkan semua, nanti
  // dibangun ulang begitu /api/sources/status menjawab.
  if (!state.sourcesStatus.length) {
    dom.sourceRow.replaceChildren(sourceRadio(AUTO));
    return;
  }

  const up = state.sourcesStatus.filter((s) => s.up);
  const list = up.length
    ? [AUTO, ...up.map((s) => ({ id: s.id, label: s.label, kind: cfg.sources.find((x) => x.id === s.id)?.kind }))]
    : [AUTO];

  dom.sourceRow.replaceChildren(...list.map(sourceRadio));
  dom.srcHint.hidden = up.length > 0;
  if (!up.length) {
    dom.srcHint.textContent =
      'Tidak ada sumber yang bisa dihubungi saat ini — semua pencarian memakai mode Otomatis.';
  }

  if (state.source !== 'auto' && !list.some((s) => s.id === state.source)) {
    state.source = 'auto';
    runSearch({ reset: true });
  }
}

function sourceRadio(s) {
  return el(
    'label',
    { class: 'radio' },
    el('input', {
      type: 'radio',
      name: 'source',
      value: s.id,
      checked: state.source === s.id,
      onchange: () => {
        state.source = s.id;
        runSearch({ reset: true });
      },
    }),
    el('span', { text: s.label }),
    s.kind ? el('span', { class: 'radio__hint', text: s.kind === 'wallhaven' ? 'wallpaper' : 'booru' }) : null
  );
}

function buildRatio() {
  dom.ratioSel.replaceChildren(
    ...cfg.ratios.map((r) => el('option', { value: r.id, selected: r.id === state.ratio }, r.label))
  );
}

function buildSort() {
  dom.sortRow.replaceChildren(
    ...cfg.sorts.map((s) =>
      el(
        'button',
        {
          type: 'button',
          class: state.sort === s.id ? 'is-on' : '',
          onclick: () => {
            state.sort = s.id;
            buildSort();
            runSearch({ reset: true });
          },
        },
        s.label
      )
    )
  );
}

let searchToken = 0;

function currentParams() {
  return {
    q: state.q,
    tags: state.tags,
    source: state.source,
    sort: state.sort,
    ratio: state.ratio,
    purity: state.purity,
    includeGeneral: state.includeGeneral ? 1 : 0,
    page: state.page,
    limit: 24,
  };
}

async function runSearch({ reset = false } = {}) {
  if (reset) {
    state.page = 1;
    state.done = false;
    state.items = [];
    dom.grid.replaceChildren(...skeletons(24));
  }
  if (state.loading) return;

  const token = ++searchToken;
  state.loading = true;
  setProgress(true, 0.55);
  dom.spinner.hidden = false;
  dom.loadMore.disabled = true;

  try {
    const data = await search(currentParams());
    if (token !== searchToken) return; // request lama sudah tidak relevan

    let items = data.items || [];

    // "Paling Cocok": skor & urutkan berdasarkan kecocokan ukuran layar.
    // Sort lain (terbaru/populer/acak) tetap dihormati apa adanya.
    if (state.sort === 'fit') {
      const target = { w: state.w, h: state.h };
      items.sort((a, b) => wallpaperScore(b, target) - wallpaperScore(a, target));
    }

    if (reset) {
      state.items = items;
      state.total = data.total || items.length;
      dom.grid.replaceChildren();
    } else {
      const known = new Set(state.items.map((i) => `${i.source}:${i.id}`));
      const fresh = items.filter((i) => !known.has(`${i.source}:${i.id}`));
      state.items.push(...fresh);
    }

    state.freshKeys = new Set();
    for (const it of items) {
      const key = `${it.source}:${it.id}`;
      if (!state.seen.has(key)) state.freshKeys.add(key);
      state.seen.add(key);
    }
    if (state.seen.size > 1200) state.seen = new Set([...state.seen].slice(-600));
    store.set('seen', [...state.seen].slice(-1200));

    renderGrid();
    renderStatline(data);
    handleTaxonomy(data.taxonomy);

    state.done = items.length === 0;
    dom.empty.hidden = !state.done;
    if (state.done) {
      dom.emptyTitle.textContent = 'Tidak ada hasil';
      dom.emptyText.textContent = data.errors?.length
        ? `Semua sumber gagal/ kosong: ${data.errors.join(' · ')}`
        : 'Coba kata kunci lain, kurangi filter, atau longgarkan resolusi minimum.';
    }
    dom.loadMore.hidden = state.done;
  } catch (e) {
    toast(`Gagal memuat: ${e.message}`, 'err', '⚠️');
    dom.empty.hidden = false;
    dom.emptyTitle.textContent = 'Koneksi bermasalah';
    dom.emptyText.textContent = e.message;
  } finally {
    if (token === searchToken) {
      state.loading = false;
      setProgress(false);
      dom.spinner.hidden = true;
      dom.loadMore.disabled = false;
    }
  }
}

function skeletons(n = 18) {
  return Array.from({ length: n }, () => el('div', { class: 'card card--sk' }));
}

function setProgress(on, pct) {
  clearTimeout(progressTimer);
  if (on) {
    dom.progress.classList.add('is-on');
    dom.progress.style.width = '35%';
    progressTimer = setTimeout(() => (dom.progress.style.width = `${(pct || 70) + Math.random() * 22}%`), 220);
  } else {
    dom.progress.style.width = '100%';
    progressTimer = setTimeout(() => {
      dom.progress.classList.remove('is-on');
      setTimeout(() => (dom.progress.style.width = '0%'), 300);
    }, 260);
  }
}

function renderStatline(data) {
  const chips = (data.sources || []).map((s) => el('span', { text: `${s.label} · ${nf.format(s.total || 0)}` }));
  setKids(dom.statline,
    el('b', { text: `${nf.format(state.items.length)} wallpaper` }),
    el('span', { class: 'sep', text: '•' }),
    el('span', { text: state.q ? `kata kunci "${state.q}"` : state.tags.length ? 'kategori aktif' : 'jelajah terbaru' }),
    state.tags.length ? el('span', { class: 'sep', text: '•' }) : null,
    state.tags.length ? el('span', { text: `tag: ${state.tags.slice(0, 3).join(', ')}` }) : null,
    state.ratio !== 'any' ? el('span', { class: 'sep', text: '•' }) : null,
    state.ratio !== 'any' ? el('span', { text: `rasio ${state.ratio}` }) : null,
    el('span', { class: 'srcs' }, ...chips)
  );
  updateFilterDot();
}

/** Titik oranye pada tombol Filter kalau ada filter selain "Otomatis". */
function updateFilterDot() {
  const active =
    state.source !== 'auto' ||
    state.ratio !== 'any' ||
    state.selCats.length > 0 ||
    state.tags.length > 0 ||
    state.sort !== 'fit';
  dom.filterDot.hidden = !active;
}

function handleTaxonomy(tax) {
  if (!tax) return;
  if (tax.newCategories?.length) {
    const names = tax.newCategories.map((c) => `${c.emoji} ${c.label}`).join(', ');
    toast(`Kategori otomatis baru: ${names}`, 'ok', '✨');
    refreshCategories();
  }
  if (tax.totalCategories) dom.catBadge.textContent = tax.totalCategories;
}

async function refreshCategories() {
  try {
    const d = await getCategories();
    state.allCats = d.categories || [];
    state.trending = d.trending || [];
    dom.catBadge.textContent = d.stats?.totalCategories ?? state.allCats.length;
    renderCategories();
    renderTrending();
  } catch {
  }
}

/** Semua kategori ditampilkan — tanpa pagination atau tombol "tampilkan lagi". */
function renderCategories() {
  const list = state.allCats;
  dom.catRow.replaceChildren(
    ...list.map((c) =>
      el(
        'button',
        {
          type: 'button',
          class: `pill ${state.selCats.includes(c.id) ? 'is-on' : ''}`,
          title: `${c.label} — ${nf.format(c.hits)} wallpaper${c.auto ? ' · dibuat otomatis' : ''}`,
          onclick: () => toggleCat(c),
        },
        `${c.emoji} ${c.label}`,
        el('span', { class: 'pill__n', text: nf.format(c.hits) })
      )
    )
  );
}

function renderTrending() {
  dom.trendRow.replaceChildren(
    ...state.trending.slice(0, 22).map((t) =>
      el(
        'button',
        {
          type: 'button',
          class: `pill ${state.tags.includes(t.tag.replace(/ /g, '_')) ? 'is-on' : ''}`,
          title: `${nf.format(t.count)} kemunculan`,
          onclick: () => toggleTag(t.tag),
        },
        `#${t.tag}`,
        el('span', { class: 'pill__n', text: nf.format(t.count) })
      )
    )
  );
}

function renderGrid() {
  const frag = document.createDocumentFragment();
  const target = { w: state.w, h: state.h };

  for (const it of state.items) {
    const key = `${it.source}:${it.id}`;
    frag.append(card(it, key, state.freshKeys.has(key), target));
  }
  dom.grid.replaceChildren(frag);
  observeEnrichment();
}

/**
 * Wallhaven hanya mengembalikan ID di hasil search (tag-nya ada di halaman
 * detail). Jadi begitu kartu masuk viewport, kita ambil tag-nya diam-diam:
 * judul jadi akurat dan taksonomi otomatis ikut belajar.
 */
const enrichQueue = [];
let enrichActive = 0;
const ENRICH_MAX = 3;
let enrichObserver = null;

function observeEnrichment() {
  enrichObserver?.disconnect();
  enrichObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const key = e.target.dataset.key;
        enrichObserver.unobserve(e.target);
        if (key) enqueueEnrich(key);
      }
    },
    { rootMargin: '400px 0px' }
  );
  for (const node of dom.grid.children) {
    if (node.dataset?.key) enrichObserver.observe(node);
  }
}

function enqueueEnrich(key) {
  const it = state.items.find((i) => `${i.source}:${i.id}` === key);
  if (!it || it.tagCount > 0) return;
  if (enrichQueue.includes(key)) return;
  enrichQueue.push(key);
  pumpEnrich();
}

function pumpEnrich() {
  while (enrichActive < ENRICH_MAX && enrichQueue.length) {
    const key = enrichQueue.shift();
    const it = state.items.find((i) => `${i.source}:${i.id}` === key);
    if (!it || it.tagCount > 0) continue;
    enrichActive++;
    getPost(it.source, it.id)
      .then((full) => {
        const target = state.items.find((i) => `${i.source}:${i.id}` === key);
        if (!target) return;
        target.tags = full.tags || [];
        target.tagCount = full.tagCount || target.tags.length;
        if (full.title) target.title = full.title;
        if (full.category) target.category = full.category;
        patchCard(key, target);
      })
      .catch(() => {
      })
      .finally(() => {
        enrichActive--;
        pumpEnrich();
      });
  }
}

/** Perbarui kartu di tempat tanpa menggambar ulang seluruh grid. */
function patchCard(key, it) {
  const node = dom.grid.querySelector(`.card[data-key="${CSS.escape(key)}"]`);
  if (!node) return;
  const t = node.querySelector('.card__title');
  if (t && it.title) t.textContent = it.title;
  const g = node.querySelector('.card__tags');
  if (g && it.tags?.length) g.textContent = it.tags.slice(0, 4).map(titleCase).join(' · ');
  node.title = `${it.title} — ${it.width}×${it.height}`;
}

function card(it, key, isNew, target) {
  // Grid selalu memakai thumbnail remote: paling cepat, dan tidak butuh
  // upscale. Upscale hanya berlaku di lightbox (preview + unduhan), sesuai
  // tempat pengguna_stock picking ukuran akhir.
  const src = it.sample || it.thumb || it.full;
  const upscaled = false;

  const fits = it.width >= target.w && it.height >= target.h;

  const img = el('img', {
    class: 'card__img',
    src,
    alt: it.title,
    loading: 'lazy',
    decoding: 'async',
  });
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  img.addEventListener(
    'error',
    () => {
      if (it.thumb && img.src !== it.thumb) img.src = it.thumb;
    },
    { once: true }
  );

  const ov = el(
    'div',
    { class: 'card__ov' },
    el(
      'div',
      { class: 'card__top' },
      el('span', { class: 'card__res', text: `${it.width}×${it.height}` }),
      el('span', {
        class: 'card__badge',
        text: state.fit === 'cover' ? 'COVER' : it.orientation.toUpperCase(),
      })
    ),
    el(
      'div',
      {},
      el('div', { class: 'card__title', text: it.title }),
      el('div', { class: 'card__tags', text: (it.tags || []).slice(0, 4).map(titleCase).join(' · ') || it.sourceLabel }),
      el(
        'div',
        { class: 'card__foot' },
        el(
          'button',
          {
            class: 'card__act card__act--go',
            onclick: (e) => {
              e.stopPropagation();
              openLB(key, true);
            },
          },
          'Detail'
        ),
        el(
          'button',
          {
            class: 'card__act',
            title: 'Unduh langsung',
            onclick: (e) => {
              e.stopPropagation();
              quickDownload(it);
            },
          },
          '⬇ Unduh'
        )
      )
    )
  );

  const node = el(
    'div',
    {
      class: `card ${upscaled ? 'is-upscaled' : ''}`,
      onclick: () => openLB(key),
      title: `${it.title} — ${it.width}×${it.height}`,
      dataset: { key },
    },
    state.view === 'list'
      ? [el('div', { class: 'card__thumb' }, img), el('div', { class: 'card__body' }, ov)]
      : [img, ov]
  );

  if (isNew) node.append(el('span', { class: 'card__flag', text: 'BARU' }));
  if (upscaled) node.append(el('span', { class: 'card__up', text: `↑ ${state.upscale}` }));
  if (!fits) node.append(el('span', { class: 'card__low', text: `${it.width}p` }));

  return node;
}

async function quickDownload(it) {
  const useUpscale = state.upscale !== 'none' && it.width < state.w;
  const url = imgUrl(it.full || it.sample, {
    w: state.fit === 'raw' ? 0 : state.w,
    h: state.fit === 'raw' ? 0 : state.h,
    mode: state.fit,
    pos: state.pos,
        pan: state.pan,
    upscale: useUpscale ? state.upscale : 'none',
    fm: 'jpg',
    quality: 95,
    download: 1,
  });
  const a = el('a', { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
  toast(
    useUpscale
      ? `Mengunduh ${state.w}×${state.h} dengan ${state.upscale}…`
      : `Mengunduh ${it.width}×${it.height} (file asli)`,
    'ok',
    '⬇️'
  );
}

function applyPreset(id, opts = {}) {
  const p = cfg.presets.find((x) => x.id === id);
  if (!p) return;
  state.preset = id;
  if (p.id === 'screen') {
    const s = screenSize();
    state.w = s.w;
    state.h = s.h;
  } else if (p.id === 'original') {
    state.w = 0;
    state.h = 0;
  } else {
    state.w = p.w;
    state.h = p.h;
  }
  state.fit = p.mode;
  // Hanya preset yang menyebutkannya yang mengaturnya. Preset lain dibiarkan
  // kosong supaya ikut default server ('centre'), bukan mewarisi posisi dari
  // preset sebelumnya. Mengganti preset tidak boleh diam-diam membawa posisi
  // crop yang salah.
  state.pos = p.position || '';
  qsa('[data-preset]', dom.presetRow).forEach((b) => b.classList.toggle('is-on', b.dataset.preset === id));
  dom.fitMode.value = state.fit;
  applySizeToInputs();
  persistFilters();
  rerenderGrid();
  updateSizeBadge();
  updateDlInfo();
  // Kotak crop dibuka lebih dulu. Begitu cropDraft ada, gambar yang ditampilkan
  // menjadi file asli 1:1; kalau urutannya dibalik, refresh di bawah masih
  // meminta versi ter-resize dan akan menimpanya.
  if (opts.openCrop) openCropForSize();
  // Lightbox yang terbuka harus ikut berubah: gambar utama di-resize ke preset
  // baru, tanpa ini preview & bar dimensi tetap menampilkan ukuran lama.
  refreshLbIfOpen();
}

/** Segarkan lightbox bila sedang terbuka (dipanggil setiap perubahan ukuran/fit/upscale). */
function refreshLbIfOpen() {
  if (dom.lb.hidden || !lbItem) return;
  paintLB({ sizeOnly: true });
}

/**
 * Ukuran sumber SETELAH crop. Kalau crop aktif, area crop itulah yang jadi
 * acuan — baik untuk "apakah perlu upscale" maupun untuk preset Asli.
 */
function srcSize() {
  const it = lbItem;
  if (!it) return { w: 0, h: 0 };
  return {
    w: state.crop ? Math.round(state.crop.w * it.width) : it.width,
    h: state.crop ? Math.round(state.crop.h * it.height) : it.height,
  };
}

/**
 * Ukuran target yang benar-benar dikirim ke server. `state.w`/`state.h` bernilai
 * 0 berarti "pakai ukuran asli", jadi di sini harus di.resolve ke angka nyata —
 * kalau tidak, label unduhan akan menampilkan "1000×0".
 */
function targetSize() {
  const s = srcSize();
  return { w: state.w || s.w, h: state.h || s.h };
}

/** Tulis state ukuran ke input angka (dipakai juga saat preset/swap berubah). */
function applySizeToInputs() {
  const t = targetSize();
  // Angka asli ditampilkan, bukan kolom kosong: "Asli (Full Res)" yang kosong
  // terlihat seperti gagal load, padahal itu memang maksudnya.
  dom.wNum.value = t.w || '';
  dom.hNum.value = t.h || '';
  dom.wNum.placeholder = String(screenSize().w);
  dom.hNum.placeholder = String(screenSize().h);
}

/**
 * Sumbu mana yang dipotong mode `cover` untuk gambar ini: 'x' (kiri/kanan),
 * 'y' (atas/bawah), atau null kalau rasionya sudah cocok sehingga tidak ada
 * yang dibuang.
 *
 * Geser hanya berguna di sumbu itu. Slider disembunyikan kalau tidak ada yang
 * bisa digeser, karena slider yang diam-diam tidak melakukan apa-apa lebih
 * buruk daripada tidak ada.
 */
function croppedAxis() {
  if (state.fit !== 'cover') return null;
  const s = srcSize();
  const t = targetSize();
  if (!s.w || !s.h || !t.w || !t.h) return null;
  const d = s.w * t.h - s.h * t.w;
  return d > 0 ? 'x' : d < 0 ? 'y' : null;
}

/** Tampilkan slider geser hanya kalau ada yang bisa digeser. */
function updatePanVisibility() {
  // Crop yang aktif menggantikan geser sepenuhnya: posisinya sudah ditentukan
  // kotak, jadi slider akan jadi kontrol kedua yang sunyi tanpa efek.
  const cropping = !!state.crop || !!state.cropDraft;
  const axis = croppedAxis();
  const show = axis !== null && !cropping;
  dom.panField.hidden = !show;
  dom.panHint.hidden = !show;
  if (!show) return;
  dom.panVal.textContent = `${state.pan}%`;
  dom.panRange.value = String(state.pan);
  dom.panRange.setAttribute(
    'aria-label',
    axis === 'x' ? 'Geser crop kiri kanan' : 'Geser crop atas bawah'
  );
  dom.panHint.textContent =
    axis === 'x'
      ? 'Tengah sudah otomatis. Geser hanya kalau subjeknya meleset ke kiri atau kanan.'
      : 'Tengah sudah otomatis. Gambar ini dipotong atas-bawah, jadi geser ke atas atau bawah.';
}

/**
 * Baca input angka -> state ukuran. Nilai diklem ke rentang yang masuk akal;
 * dikosongkan berarti "asli" (0), bukan 1 — angka 1 bikin sharp error.
 */
function readSizeInputs({ markCustom = true } = {}) {
  const min = 320;
  const maxW = 7680;
  const maxH = 4320;
  const clamp = (v, max) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || v === '') return 0;
    return Math.min(Math.max(n, min), max);
  };
  state.w = clamp(dom.wNum.value, maxW);
  state.h = clamp(dom.hNum.value, maxH);
  // Tulis balik hasil clamp ke input. <input type=number> tidak pernah benar-benar
  // menolak angka di luar min/max saat diketik, jadi tanpa ini kolom bisa
  // menampilkan 9999 sementara yang dikirim ke server 7680.
  if (dom.wNum.value !== '' && Number(dom.wNum.value) !== state.w) dom.wNum.value = String(state.w);
  if (dom.hNum.value !== '' && Number(dom.hNum.value) !== state.h) dom.hNum.value = String(state.h);
  // Kolom kosong berarti "asli" — tampilkan angka aslinya supaya tidak terlihat
  // seperti gagal load. state.w/h tetap 0 supaya preset 'original' tetap valid.
  if (dom.wNum.value === '' && state.w === 0) dom.wNum.value = String(srcSize().w);
  if (dom.hNum.value === '' && state.h === 0) dom.hNum.value = String(srcSize().h);
  if (markCustom) {
    const p = cfg?.presets.find((x) => x.id === state.preset);
    const stillPreset =
      p && p.id !== 'original' && p.w === state.w && p.h === state.h;
    if (!stillPreset && state.preset !== 'original' && state.preset !== 'screen') {
      state.preset = 'custom';
    }
    // 'screen' & 'original' hanya valid bila angkanya masih sama.
    if (state.preset === 'screen') {
      const s = screenSize();
      if (state.w !== s.w || state.h !== s.h) state.preset = 'custom';
    }
    if (state.preset === 'original' && (state.w || state.h)) state.preset = 'custom';
    syncPresetButtons();
  }
}

/** Tandai tombol preset yang sedang aktif (`custom` = tidak ada yang menyala). */
function syncPresetButtons() {
  qsa('[data-preset]', dom.presetRow).forEach((b) => b.classList.toggle('is-on', b.dataset.preset === state.preset));
}

function updateSizeBadge() {
  const p = cfg.presets.find((x) => x.id === state.preset);
  dom.sizeBadge.textContent =
    p?.id === 'original' || !state.w ? 'Original' : `${state.w}×${state.h}`;
}

function setUpscale(mode) {
  state.upscale = mode;
  persistFilters();
  rerenderGrid();
  refreshLbIfOpen();
}

function rerenderGrid() {
  if (!state.items.length) return;
  renderGrid();
  updateSizeBadge();
}

function persistFilters() {
  store.set('filters', {
    sort: state.sort, ratio: state.ratio, preset: state.preset,
    w: state.w, h: state.h, fit: state.fit, upscale: state.upscale,
    pos: state.pos,
        pan: state.pan,
  });
}

let lbItem = null;

function openLB(key, dl = false) {
  const idx = state.items.findIndex((i) => `${i.source}:${i.id}` === key);
  if (idx < 0) return;
  state.lbIndex = idx;
  state.lbItems = state.items;
  lbItem = state.items[idx];
  restoreCrop();

  dom.lb.hidden = false;
  document.body.style.overflow = 'hidden';
  paintLB(dl);
  preload(nextImageSrc(1));
}

function closeLB() {
  dom.lb.hidden = true;
  document.body.style.overflow = '';
  state.cropDraft = null;
  lbItem = null;
}

/**
 * URL gambar utama di lightbox: resize ke ukuran target + upscale bila aktif.
 *
 * Saat sedang menyunting crop (`state.cropDraft`), gambar ditampilkan apa adanya
 * supaya koordinat crop persis 1:1 dengan piksel gambar — kalau sudah di-resize,
 * kotak crop tidak akan cocok dengan area yang benar-benar terpotong.
 */
function lbImageSrc(it = lbItem, step = 0) {
  if (!it) return '';
  const next = state.lbItems[state.lbIndex + step];
  if (!next) return '';
  const raw = next.full || next.sample;
  if (!raw) return '';

  if (state.cropDraft) return raw; // mode crop: asli, 1:1

  return imgUrl(raw, {
    w: state.fit === 'raw' ? 0 : state.w,
    h: state.fit === 'raw' ? 0 : state.h,
    mode: state.fit,
    pos: state.pos,
    pan: state.pan,
    upscale: state.upscale,
    fm: 'jpg',
    quality: 95,
    ttl: 43200,
    ...(state.crop ? { crop: state.crop } : {}),
  });
}
const nextImageSrc = (step) => lbImageSrc(lbItem, step);

/**
 * Render panel lightbox.
 *
 * `sizeOnly: true` dipakai saat hanya ukuran/fit/upscale yang berubah (mis.
 * slider diseret): gambar, bar dimensi, dan label unduh ikut berubah, tapi
 * detail tag & pencarian "serupa" tidak diulang supaya tidak membanjiri API.
 */
async function paintLB({ sizeOnly = false } = {}) {
  const it = lbItem;
  if (!it) return;

  dom.lbSrc.textContent = `${it.sourceLabel} · ${it.rating === 's' || it.rating === 'sfw' ? 'SFW' : it.rating.toUpperCase()}`;
  dom.lbTitle.textContent = it.title;
  setKids(dom.lbMeta,
    el('span', { class: 'mchip mchip--hi', html: `<b>${it.width}</b>×<b>${it.height}</b>` }),
    el('span', { class: 'mchip', text: `${it.ratio}:1 · ${it.orientation}` }),
    it.mp ? el('span', { class: 'mchip', text: `${it.mp} MP` }) : null,
    el('span', { class: 'mchip', text: fmtDate(it.createdAt) }),
    it.score ? el('span', { class: 'mchip', text: `★ ${nf.format(it.score)}` }) : null
  );

  const cropPx = state.crop && it.width
    ? { w: Math.round(state.crop.w * it.width), h: Math.round(state.crop.h * it.height) }
    : null;
  const panAxis = croppedAxis();
  setKids(dom.specGrid,
    spec('Resolusi asli', `${it.width}×${it.height}`),
    spec('Target wallpaper', state.w ? `${state.w}×${state.h}` : 'tidak diubah'),
    spec('Cara pas', titleCase(state.fit)),
    spec('Crop', state.crop ? `${cropPx.w}×${cropPx.h}` : 'tidak ada'),
    panAxis ? spec('Geser crop', `${state.pan}% ke ${panAxis === 'x' ? 'samping' : 'atas-bawah'}`) : null,
    spec('Rasio', `${it.ratio}:1`),
    spec('Orientasi', titleCase(it.orientation)),
    spec('Mega piksel', `${it.mp} MP`),
    spec('Sumber', it.sourceLabel),
    it.views ? spec('Dilihat', nf.format(it.views)) : null,
    it.fileSize ? spec('Ukuran file', fmtBytes(it.fileSize)) : null,
    spec('Warna dominan', it.colors?.length ? it.colors.slice(0, 3).join(' ') : '—'),
    spec('Ditambahkan', fmtDate(it.createdAt))
  );

  // Geser crop ikut berubah setiap kali ukuran, mode, atau gambar yang dibuka
  // berubah, jadi satu tempat ini cukup untuk semuanya.
  updatePanVisibility();

  // Catatan upscale — mode fully otomatis, tidak ada pilihan.
  const factor = it.width && state.w ? state.w / it.width : null;
  const factorTxt = factor === null
    ? '—'
    : factor >= 1
      ? `${factor.toFixed(1)}× lebih besar`
      : `${(1 / factor).toFixed(1)}× lebih kecil`;
  const needUp = !!factor && factor >= 1 && state.fit !== 'raw';
  dom.upscaleNote.textContent = !state.w
    ? 'Ukuran target belum diisi — pilih preset atau isi lebar/tinggi di atas.'
    : needUp
      ? `Target ${state.w}×${state.h} — ${factorTxt} dari gambar asli, jadi akan di-upscale` +
        (state.crop ? ' setelah di-crop' : '') +
        (cfg.waifu2xBinary ? '. Binary waifu2x dipakai.' : ' (Lanczos3 + denoise + sharpen).')
      : `Gambar ini ${factorTxt} dari target ${state.w}×${state.h} — tidak perlu upscale.`;
  dom.runUpscale.disabled = !state.w;

  paintCropUi();
  updateSizeBadge();

  // download button -> sesuai ukuran, crop & upscale aktif
  updateDlInfo();

  // tags (langsung dari cache hasil search, lalu di-refresh dari API)
  paintTags(it.tags || []);
  updateFavBtn();

  if (sizeOnly) {
    updateLbImage();
    requestAnimationFrame(updateCropFrame);
    return;
  }

  dom.similar.replaceChildren(...Array.from({ length: 8 }, () => el('div', { class: 'sim' })));

  if (it.tagCount) paintTags(it.tags);
  else loadDetail(it);

  loadSimilar(it);
  updateLbImage();
  // Panel info baru terisi di sini, jadi tinggi stage bisa berubah lagi
  // setelah gambar selesai dimuat. Kotak crop harus menggambar ulang supaya
  // tidak tertinggal di geometri yang sudah tidak berlaku.
  requestAnimationFrame(updateCropFrame);
}

function spec(k, v) {
  return el('div', { class: 'spec' }, el('dt', { text: k }), el('dd', { title: String(v), text: String(v) }));
}

function paintTags(tags) {
  const safe = (tags || []).filter(Boolean).slice(0, 90);
  dom.tagCount.textContent = safe.length;
  dom.tagCloud.replaceChildren(
    ...safe.map((t) =>
      el(
        'button',
        {
          type: 'button',
          class: `tag ${/^(explicit|sex|nsfw)/i.test(t) ? 'tag--nsfw' : ''}`,
          title: `Cari "${titleCase(t)}"`,
          onclick: () => {
            state.q = titleCase(t);
            dom.q.value = state.q;
            closeLB();
            runSearch({ reset: true });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          },
        },
        titleCase(t)
      )
    )
  );
}

async function loadDetail(it) {
  try {
    const full = await getPost(it.source, it.id);
    lbItem = { ...it, ...full };
    paintTags(full.tags || []);
    dom.similar.replaceChildren();
    loadSimilar(full);
  } catch {
  }
}

async function loadSimilar(it) {
  const seed =
    (it.tags || [])
      .filter((t) => t.length > 3 && !['wallpaper', 'highres', 'absurd_res'].includes(t))
      .slice(0, 2)
      .join(' ') || it.title;
  try {
    const d = await search({ q: seed, sort: 'top', limit: 12, purity: state.purity });
    const picks = (d.items || []).filter((x) => `${x.source}:${x.id}` !== `${it.source}:${it.id}`).slice(0, 8);
    dom.similar.replaceChildren(
      ...picks.map((x) => {
        const im = el('img', { src: x.thumb || x.sample, alt: x.title, loading: 'lazy' });
        im.addEventListener('error', () => im.remove(), { once: true });
        return el(
          'div',
          {
            class: 'sim',
            title: x.title,
            onclick: () => {
              const i = state.items.findIndex((y) => `${y.source}:${y.id}` === `${x.source}:${x.id}`);
              if (i >= 0) {
                state.lbIndex = i;
                lbItem = state.items[i];
                paintLB();
              } else {
                lbItem = x;
                paintLB();
              }
            },
          },
          im
        );
      })
    );
  } catch {
    dom.similar.replaceChildren();
  }
}

function updateDlInfo() {
  if (!lbItem) return;
  const it = lbItem;
  const src = srcSize();
  const tgt = targetSize();
  // Upscale bila salah satu sisi target lebih besar dari sumber (dicek setelah
  // crop) — crop 4:5 dengan target landscape tetap perlu naik.
  const doUpscale = state.upscale !== 'none' && (tgt.w > src.w || tgt.h > src.h);
  const url = imgUrl(it.full || it.sample, {
    w: state.fit === 'raw' ? 0 : state.w,
    h: state.fit === 'raw' ? 0 : state.h,
    mode: state.fit,
    pos: state.pos,
        pan: state.pan,
    upscale: doUpscale ? state.upscale : 'none',
    fm: 'jpg',
    quality: 96,
    download: 1,
    ttl: 43200,
    ...(state.crop ? { crop: state.crop } : {}),
  });
  dom.dlBtn.href = url;
  dom.dlLabel.textContent =
    state.fit === 'raw' && !state.crop
      ? `Unduh asli ${it.width}×${it.height}`
      : `Unduh ${tgt.w}×${tgt.h}${state.crop ? ' (crop)' : ''}${doUpscale ? ' · upscale' : ''}`;
  dom.origBtn.href = it.full || it.sample;
}

let lbImageGen = 0;
function updateLbImage() {
  const src = lbImageSrc();
  if (!src) return;
  // Slider geser, crop, dan preset bisa menyalin beberapa permintaan dalam
  // hitungan milidetik. Tanpa penomoran, jawaban yang telat akan menimpa gambar
  // yang benar dan preview menampilkan hal yang sudah tidak berlaku.
  const gen = ++lbImageGen;
  dom.lbSpin.hidden = false;
  dom.lbImg.classList.remove('is-actual');
  const tmp = new Image();
  const done = () => {
    if (gen !== lbImageGen) return; // permintaan lama, sudah tidak relevan
    dom.lbImg.src = src;
    dom.lbSpin.hidden = true;
    if (!state.cropDraft) return;
    // Kotak crop mengikuti kotak elemen img, dan kotak itu baru benar begitu
    // sumber baru benar-benar terpasang di elemen. Event load adalah penanda
    // itu; satu frame saja belum tentu cukup karena gambar masih di-decode.
    dom.lbImg.addEventListener('load', () => updateCropFrame(), { once: true });
    requestAnimationFrame(() => requestAnimationFrame(updateCropFrame));
  };
  tmp.onload = done;
  tmp.onerror = () => {
    if (gen !== lbImageGen) return;
    if (lbItem?.sample) {
      dom.lbImg.src = imgUrl(lbItem.sample, {
        w: state.w, h: state.h, mode: state.fit, pos: state.pos,
        pan: state.pan, upscale: state.upscale,
        ...(state.crop ? { crop: state.crop } : {}),
      });
    }
    dom.lbSpin.hidden = true;
  };
  tmp.src = src;

  const it = lbItem;
  if (it) {
    const from = state.cropDraft
      ? `Area crop <b>${Math.round(state.cropDraft.w * it.width)}×${Math.round(state.cropDraft.h * it.height)}</b>`
      : `Asli <b>${it.width}×${it.height}</b>`;
    dom.lbDims.innerHTML = state.cropDraft
      ? `${from} · seret kotak untuk memotong`
      : `${from} → target <b>${state.w || it.width}×${state.h || it.height}</b> · ${state.fit} · ${state.upscale === 'auto' ? 'upscale auto' : state.upscale}`;
  }
  if (!actualMode) dom.tbZoom.textContent = 'Fit';
}

let actualMode = false;

function step(delta) {
  const next = state.lbIndex + delta;
  if (next < 0 || next >= state.lbItems.length) return;
  state.lbIndex = next;
  lbItem = state.lbItems[next];
  // Crop bersifat per-gambar: pindah wallpaper = kembali ke crop sebelumnya.
  if (state.cropDraft) exitCropMode();
  paintLB();
  preload(lbImageSrc(1));
}

/* ============================== CROP MANUAL ==============================
   Kotak crop disimpan sebagai FRaksi 0..1 dari sisi gambar, bukan piksel.
   Alasannya: ukuran gambar yang tampil di layar berubah-ubah (zoom, mode
   fit, DPI layar), sedangkan fraksi selalu memetakan ke area yang sama.
   Server juga menerima fraksi, jadi tidak ada konversi bolak-balik yang bisa
   meleset.
   ------------------------------------------------------------------ */

/**
 * Batas bawah crop per sisi DALAM FRASI, untuk gambar yang sedang dibuka.
 *
 * Yang lebih besar yang menang — kalau tidak, pengguna bisa menyeret kotak sampai
 * 248px pada gambar 1653px, lalu baru ditolak server dengan 400.
 */
function cropMinFrac(dim) {
  const it = lbItem;
  const fromPx = it && it[dim] > 0 ? cropLimits.minPx / it[dim] : 0;
  return Math.max(cropLimits.min, fromPx);
}

/** Kembalikan {x, y, w, h} agar berada di dalam [0,1] dan >= batas minimum. */
function clampCrop(c) {
  const minW = cropMinFrac('width');
  const minH = cropMinFrac('height');
  // Batas atas wajib ada: tanpa ini w bisa > 1, lalu 1 - w jadi negatif dan
  // x ikut menjadi negatif — kotaknya melebar ke luar gambar di kedua sisi.
  const w = Math.min(Math.max(c.w, minW), 1);
  const h = Math.min(Math.max(c.h, minH), 1);
  const x = Math.min(Math.max(c.x, 0), 1 - w);
  const y = Math.min(Math.max(c.y, 0), 1 - h);
  return { x, y, w, h };
}

/**
 * Area gambar (bukan area img 100%-contain) dalam koordinat stage.
 *
 * `max-width/max-height: 100%` membuat kotak elemen mengikuti rasio intrinsik,
 * jadi kotak elemen sama dengan kotak yang benar-benar tergambar.
 */
function imageRect() {
  const stage = dom.lbStage.getBoundingClientRect();
  const img = dom.lbImg.getBoundingClientRect();
  if (!img.width || !img.height) return null;
  return {
    stage,
    left: img.left - stage.left,
    top: img.top - stage.top,
    width: img.width,
    height: img.height,
  };
}

function updateCropFrame() {
  const r = imageRect();
  const c = state.cropDraft;
  if (!r || !c || dom.cropper.hidden) return;
  const f = dom.cropFrame.style;
  f.left = `${r.left + c.x * r.width}px`;
  f.top = `${r.top + c.y * r.height}px`;
  f.width = `${c.w * r.width}px`;
  f.height = `${c.h * r.height}px`;

  const it = lbItem;
  if (it) {
    dom.cropSize.textContent = `Area ${Math.round(c.w * it.width)}×${Math.round(c.h * it.height)}px dari ${it.width}×${it.height}`;
  }
}

/**
 * Kotak crop harus selalu mengikuti ukuran gambar di layar. ResizeObserver
 * dipasang sekali karena gambar bisa berganti sumber, diperbesar, atau
 * stage-nya berubah ukuran tanpa satu pun memanggil updateCropFrame(). Tanpa
 * ini kotak tertinggal di geometri gambar sebelumnya dan crop jadi salah area.
 */
let cropFrameWatch = null;
function watchCropFrame() {
  if (cropFrameWatch || typeof ResizeObserver === 'undefined') return;
  cropFrameWatch = new ResizeObserver(() => updateCropFrame());
  cropFrameWatch.observe(dom.lbImg);
}

/** Status tombol & label di panel crop. */
function paintCropUi() {
  const editing = !!state.cropDraft;
  const it = lbItem;
  // Status geser ikut bergantung pada ada-tidaknya crop, jadi harus dihitung
  // di sini juga. Kalau hanya di paintLB(), membuka crop dari preset tidak
  // pernah menyegerakannya dan slider lama masih kelihatan.
  updatePanVisibility();
  dom.cropper.hidden = !editing;
  dom.tbCrop.classList.toggle('is-on', editing);
  dom.tbCrop.setAttribute('aria-pressed', String(editing));
  dom.cropApply.hidden = !editing;
  dom.cropCancel.hidden = !editing;
  dom.cropStart.hidden = editing || !!state.crop;
  dom.cropClear.hidden = !state.crop;

  if (editing) {
    updateCropFrame();
  } else if (state.crop && it) {
    dom.cropSize.textContent = `Dipotong ke ${Math.round(state.crop.w * it.width)}×${Math.round(state.crop.h * it.height)}px`;
  } else {
    dom.cropSize.textContent = 'Tanpa crop — gambar utuh';
  }

  // Batas minimum per sisi: aturan yang lebih besar dari dua (fraksi vs piksel)
  // yang menang, supaya batas drag identik dengan batas server.
  if (!it) return;
  const minW = Math.round(cropMinFrac('width') * it.width);
  const minH = Math.round(cropMinFrac('height') * it.height);
  // Kalau rasio kotak sudah sama dengan ukuran wallpaper, sebut saja. Orang
  // perlu tahu bahwa menggeser kotak tidak mengubah ukuran hasilnya.
  const t = targetSize();
  const d = state.cropDraft;
  const matchesTarget =
    editing && d && t.w && t.h
      ? Math.abs((d.w * it.width) / (d.h * it.height) - t.w / t.h) < 0.02
      : false;
  // Rasionya tidak selalu bisa persis sama dengan ukuran: server menolak crop
  // di bawah 320px per sisi, dan pada gambar kecil frame ideal bisa lebih
  // kecil dari itu. Kotaknya lalu dijepit ke batas minimum dan rasionya
  // meleset. Itu harus disebut, kalau tidak orang mengira ukurannya tepat
  // padahal tidak.
  const atFloor =
    editing && d &&
    (Math.abs(d.w - cropMinFrac('width')) < 1e-6 ||
     Math.abs(d.h - cropMinFrac('height')) < 1e-6);
  const note = matchesTarget
    ? ` Rasio kotak sudah sama dengan ukuran ${t.w}×${t.h}, jadi hasilnya persis sebesar itu.`
    : atFloor
      ? ' Rasio kotak tidak bisa persis sama dengan ukuran: bagian yang dipotong ' +
        'akan terlalu kecil untuk dijadikan wallpaper, jadi rasio dibatasi server.'
      : '';
  dom.cropHint.innerHTML = editing
    ? 'Seret kotak atau sudutnya. Area di luar kotak akan dipotong saat diunduh. ' +
      `Minimal <b>${minW}×${minH}px</b> dari ${it.width}×${it.height}.` + note
    : 'Tekan <b>Mulai crop</b> lalu seret kotak di gambar untuk memotong bagian yang diinginkan. ' +
      `Minimal <b>${minW}×${minH}px</b> — crop 100×100 dari wallpaper besar tidak berguna sebagai wallpaper.`;
}

/**
 * Frame crop dengan rasio ukuran wallpaper aktif, sebesar mungkin dan di tengah.
 *
 * Dipakai setiap kali ukuran berubah. Tanpa ini, mode `cover` harus memilih
 * framing sendiri dan sering memotong wajah karakter, padahal yang tinggal
 * dibuang hanya bagian tepi.
 *
 * Titik tengah crop yang sudah ada ikut dipertahankan, jadi mengganti ukuran
 * tidak menghapus hasil kerja orang.
 */
function cropForTarget() {
  const it = lbItem;
  if (!it || !it.width || !it.height) return null;
  const t = targetSize();
  if (!t.w || !t.h) return null;
  const ar = t.w / t.h;
  // Rasio yang menentukan sisi mana yang penuh. Sumber lebih lebar dari target
  // berarti tinggi yang jadi pembatas, dan sebaliknya.
  let w;
  let h;
  if (it.width / it.height > ar) {
    h = 1;
    w = (ar * it.height) / it.width;
  } else {
    w = 1;
    h = it.width / (ar * it.height);
  }
  // Kombinasi gambar dan rasio ekstrem bisa menghasilkan frame di bawah batas
  // server. Angkat ke batas minimum; sisanya berarti rasionya tidak persis.
  w = Math.max(w, cropMinFrac('width'));
  h = Math.max(h, cropMinFrac('height'));
  const prev = state.cropDraft || state.crop;
  const cx = prev ? prev.x + prev.w / 2 : 0.5;
  const cy = prev ? prev.y + prev.h / 2 : 0.5;
  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/**
 * Buka kotak crop yang sudah disetel ke rasio ukuran yang baru dipilih.
 *
 * Dipanggil setiap kali ukuran berubah, termasuk saat kotak sudah terbuka.
 * Kalau menolak jalan saat kotak ada, memilih preset kedua diam-diam tidak
 * mengubah apa pun dan kotak tetap memakai rasio ukuran yang lama.
 *
 * Hanya jalan saat lightbox terbuka: crop menentukan bagian gambar, bukan
 * ukurannya. Tanpa target tidak ada rasio untuk diikuti, jadi cropper yang
 * dibuka hanya jadi kotak tanpa arah.
 */
function openCropForSize() {
  if (!lbItem) return false;
  // Ukuran "asli" dan mode raw tidak punya target, jadi tidak ada yang bisa
  // disetel dan crop akan menggantung di atas gambar tanpa hasil.
  if (state.fit === 'raw' || !state.w || !state.h) return false;
  const c = cropForTarget();
  if (!c) return false;
  // Kalau kotaknya sudah terbuka, gambar yang tampil sudah file asli 1:1 dan
  // tidak perlu dimuat ulang; yang perlu digambar ulang hanya kotaknya.
  const baru = !state.cropDraft;
  state.cropDraft = c;
  paintCropUi();
  if (!baru) return true;
  updateLbImage();
  toast('Kotak crop sudah disesuaikan ukurannya. Seret untuk memilih bagian gambar.', 'info', '✂️');
  return true;
}

function startCrop() {
  if (!lbItem || state.cropDraft) return;
  state.cropDraft = state.crop ? { ...state.crop } : clampCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  paintCropUi();
  updateLbImage();
}

function applyCrop() {
  if (!state.cropDraft) return;
  const c = clampCrop(state.cropDraft);
  // Tolak crop yang hasilnya cuma beberapa ratus piksel di gambar besar —
  // sama persis aturan server, supaya tombol tidak diam-diam gagal.
  if (lbItem && Math.min(c.w * lbItem.width, c.h * lbItem.height) < cropLimits.minPx) {
    toast(`Crop terlalu kecil — minimal ${cropLimits.minPx}px per sisi`, 'err', '⚠️');
    return;
  }
  state.crop = c;
  state.cropDraft = null;
  // Kotak crop sudah menentukan bagian gambarnya, jadi geseran otomatis tidak
  // boleh ikut menentukan lagi. Kalau tidak, ada dua kontrol yang memilih
  // region dan hasilnya jadi tidak bisa ditebak.
  state.pan = 50;
  paintCropUi();
  persistCrop();
  paintLB({ sizeOnly: true });
  toast(`Crop diterapkan: ${Math.round(c.w * lbItem.width)}×${Math.round(c.h * lbItem.height)}px`, 'ok', '✂️');
}

function cancelCrop() {
  state.cropDraft = null;
  paintCropUi();
  paintLB({ sizeOnly: true });
}

function exitCropMode() {
  state.cropDraft = null;
  paintCropUi();
}

function clearCrop() {
  state.crop = null;
  state.cropDraft = null;
  persistCrop();
  paintCropUi();
  paintLB({ sizeOnly: true });
}

/** Crop ikut disimpan per wallpaper (key = `source:id`) lewat localStorage. */
function persistCrop() {
  try {
    if (!lbItem) return;
    const all = store.get('crops', {}) || {};
    const key = `${lbItem.source}:${lbItem.id}`;
    if (state.crop) all[key] = state.crop;
    else delete all[key];
    store.set('crops', all);
  } catch {
    /* penyimpanan penuh — crop tetap berlaku di sesi ini */
  }
}

function restoreCrop() {
  if (!lbItem) return;
  try {
    const saved = store.get('crops', {}) || {};
    state.crop = saved[`${lbItem.source}:${lbItem.id}`] || null;
  } catch {
    state.crop = null;
  }
}

/** Seret: pindah kotak (drag di dalam) atau ubah ukuran (drag di sudut). */
function onCropPointerDown(e) {
  if (!state.cropDraft) return;
  const grip = e.target.closest('.cropper__grip');
  const mode = grip ? grip.dataset.grip : 'move';
  const start = state.cropDraft;
  const rect = imageRect();
  if (!rect) return;

  e.preventDefault();
  // Pointer sintetis (test/otomasi) tidak punya pointer aktif, jadi capture
  // bisa ditolak. Jangan sampai itu mematikan seluruh drag.
  try {
    dom.cropper.setPointerCapture(e.pointerId);
  } catch (_) { /* lanjut tanpa capture */ }

  const startX = e.clientX;
  const startY = e.clientY;

  const move = (ev) => {
    //-pixel bergerak -> fraksi gambar (dx dalam satuan 0..1 dari lebar gambar)
    const dx = (ev.clientX - startX) / rect.width;
    const dy = (ev.clientY - startY) / rect.height;
    let next;

    if (mode === 'move') {
      next = { ...start, x: start.x + dx, y: start.y + dy };
    } else {
      next = { ...start };
      if (mode.includes('w')) { next.x = start.x + dx; next.w = start.w - dx; }
      if (mode.includes('e')) { next.w = start.w + dx; }
      if (mode.includes('n')) { next.y = start.y + dy; next.h = start.h - dy; }
      if (mode.includes('s')) { next.h = start.h + dy; }
      // Saat satu sudut digeser, hanya sisi yang ikut sudut itu yang berubah
      // ukuran. Tiap sisi punya lantai, jadi kotak sekecil 100x100 tidak
      // mungkin terjadi lewat drag.
      next.w = Math.max(next.w, cropMinFrac('width'));
      next.h = Math.max(next.h, cropMinFrac('height'));
    }
    state.cropDraft = clampCrop(next);
    updateCropFrame();
  };

  const up = () => {
    dom.cropper.removeEventListener('pointermove', move);
    dom.cropper.removeEventListener('pointerup', up);
    dom.cropper.removeEventListener('pointercancel', up);
  };

  dom.cropper.addEventListener('pointermove', move);
  dom.cropper.addEventListener('pointerup', up);
  dom.cropper.addEventListener('pointercancel', up);
}

function toggleCat(c) {
  const i = state.selCats.indexOf(c.id);
  if (i >= 0) state.selCats.splice(i, 1);
  else state.selCats.push(c.id);

  // kategori -> tag pencarian (kategori bawaan pakai tag representatif,
  // kategori otomatis pakai nama tagnya langsung)
  state.tags = state.selCats.flatMap(catTags);

  renderCategories();
  runSearch({ reset: true });
}

/**
 * Kategori -> tag pencarian.
 * Pakai SATU tag representatif, bukan semua: booru mengAND-kan tag, jadi
 * "landscape scenery panorama" akan terlalu sempit dan hasilnya nol.
 */
function catTags(id) {
  const found = state.allCats.find((c) => c.id === id);
  const tag = found?.tags?.[0] || (id.startsWith('auto:') ? id.slice(5).replace(/_/g, ' ') : id);
  return [tag.replace(/\s+/g, '_')];
}

function toggleTag(tag) {
  const t = tag.replace(/ /g, '_');
  const i = state.tags.indexOf(t);
  if (i >= 0) state.tags.splice(i, 1);
  else state.tags.push(t);
  state.selCats = [];
  renderCategories();
  renderTrending();
  runSearch({ reset: true });
}

function updateFavBtn() {
  if (!lbItem) return;
  const key = `${lbItem.source}:${lbItem.id}`;
  const on = state.favorites.has(key);
  dom.favBtn.textContent = on ? '★ Tersimpan' : '☆ Favorit';
  dom.favBtn.classList.toggle('btn--primary', on);
}

function saveFav() {
  if (!lbItem) return;
  const key = `${lbItem.source}:${lbItem.id}`;
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
    toast('Dihapus dari favorit', '', '☆');
  } else {
    state.favorites.add(key);
    toast('Disimpan ke favorit', 'ok', '★');
  }
  store.set('favorites', [...state.favorites]);
  updateFavBtn();
}

async function loadSourcesStatus() {
  try {
    const d = await getSourcesStatus();
    state.sourcesStatus = d.status || [];
    // Hanya sumber hidup yang ditampilkan — sesuai daftar radio di atasnya.
    // Sumber mati disembunyikan, bukan ditampilkan sebagai "tidak terjangkau".
    const live = state.sourcesStatus.filter((s) => s.up);
    dom.srcStatus.replaceChildren(
      ...live.map((s) =>
        el(
          'span',
          { class: 'srcchip up', title: `Aktif · ${s.ms}ms` },
          el('i'),
          s.label
        )
      )
    );
    // Bangun ulang radio sumber: yang mati tidak boleh dipilih.
    buildSources();
  } catch {
  }
}

async function checkFreshBadge() {
  try {
    const known = new Set(state.seen);
    let fresh = 0;
    for (let p = 1; p <= 3; p++) {
      const d = await search({ sort: 'newest', page: p, limit: 24 });
      for (const it of d.items || []) if (!known.has(`${it.source}:${it.id}`)) fresh++;
    }
    dom.newDot.hidden = fresh === 0;
  } catch {
  }
}

async function checkFreshInFeed() {
  // muat ulang feed "terbaru"; penanda BARU tetap pakai logika seen di runSearch
  state.page = 1;
  await runSearch({ reset: true });
  dom.newDot.hidden = true;
  toast(`Feed terbaru dimuat — ${state.items.length} wallpaper`, 'ok', '✨');
}

function wire() {
  watchCropFrame();
  dom.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = dom.q.value.trim();
    dom.clearQ.hidden = !state.q;
    runSearch({ reset: true });
    dom.q.blur();
  });

  dom.q.addEventListener(
    'input',
    debounce(() => {
      dom.clearQ.hidden = !dom.q.value;
    }, 120)
  );

  dom.clearQ.addEventListener('click', () => {
    dom.q.value = '';
    state.q = '';
    dom.clearQ.hidden = true;
    dom.q.focus();
  });

  const quick = ['sakura', 'waifu', 'cyberpunk', 'landscape', 'sunset', 'city night', 'fantasy', 'school', 'minimal', 'space'];
  dom.quickChips.replaceChildren(
    ...quick.map((t) =>
      el(
        'button',
        { type: 'button', class: 'pill', onclick: () => {
            state.q = t;
            dom.q.value = t;
            dom.clearQ.hidden = false;
            runSearch({ reset: true });
          } },
        t
      )
    )
  );

  dom.btnFilters.addEventListener('click', () => togglePanel());
  dom.closePanel.addEventListener('click', closePanel);
  dom.scrim.addEventListener('click', closePanel);
  dom.applyFilters.addEventListener('click', closePanel);

  dom.btnTheme.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    toast(`Tema ${next === 'dark' ? 'gelap' : 'terang'}`, '', next === 'dark' ? '🌙' : '☀️');
  });

  qsa('.viewtoggle .iconbtn').forEach((b) =>
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      store.set('view', state.view);
      dom.grid.dataset.view = state.view;
      qsa('.viewtoggle .iconbtn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderGrid();
    })
  );

  // ukuran — input angka (bukan slider) di dalam lightbox
  const onSizeInput = () => {
    readSizeInputs();
    updateSizeBadge();
    updateDlInfo();
    refreshLbIfOpen();
  };
  dom.wNum.addEventListener('input', onSizeInput);
  dom.hNum.addEventListener('input', onSizeInput);
  // `change` baru menyala saat angka selesai diketik (blur atau Enter), bukan
  // tiap ketikan. Kalau crop box dibuka di `input`, mengetik "1920" akan
  // membukanya tiga kali dan menutupi preview di tengah jalan.
  dom.wNum.addEventListener('change', () => {
    persistFilters();
    openCropForSize();
  });
  dom.hNum.addEventListener('change', () => {
    persistFilters();
    openCropForSize();
  });

  dom.btnScreen.addEventListener('click', () => applyPreset('screen', { openCrop: true }));
  dom.btnSwap.addEventListener('click', () => {
    [state.w, state.h] = [state.h, state.w];
    state.preset = 'custom';
    syncPresetButtons();
    applySizeToInputs();
    persistFilters();
    renderGrid();
    updateSizeBadge();
    updateDlInfo();
    refreshLbIfOpen();
  });
  dom.btnOriginal.addEventListener('click', () => applyPreset('original'));

  dom.fitMode.addEventListener('change', () => {
    state.fit = dom.fitMode.value;
    // Geser hanya berlaku di mode cover. Reset ke tengah supaya kembali ke
    // cover nanti tidak diam-diam memakai geseran dari mode lain.
    if (state.fit !== 'cover') state.pan = 50;
    persistFilters();
    renderGrid();
    updateDlInfo();
    refreshLbIfOpen();
  });

  // geser crop - hanya berlaku untuk mode cover, jadi nilainya dikembalikan
  // ke tengah begitu mode berubah agar tidak ada nilai tersembunyi yang
  // tiba-tiba aktif lagi.
  dom.panRange.addEventListener('input', () => {
    state.pan = Math.min(Math.max(Number(dom.panRange.value) || 0, 0), 100);
    dom.panVal.textContent = `${state.pan}%`;
    persistFilters();
    updateDlInfo();
    refreshLbIfOpen();
  });

  dom.cropStart.addEventListener('click', startCrop);
  dom.tbCrop.addEventListener('click', () => (state.cropDraft ? cancelCrop() : startCrop()));
  dom.cropApply.addEventListener('click', applyCrop);
  dom.cropCancel.addEventListener('click', cancelCrop);
  dom.cropClear.addEventListener('click', clearCrop);
  dom.cropper.addEventListener('pointerdown', onCropPointerDown);
  window.addEventListener('resize', debounce(() => {
    if (state.cropDraft) updateCropFrame();
    closePanel();
  }, 120));

  // rasio (orientasi) — <select>, bukan papan tombol
  dom.ratioSel.addEventListener('change', () => {
    state.ratio = dom.ratioSel.value;
    persistFilters();
    updateFilterDot();
    runSearch({ reset: true });
  });

  dom.resetFilters.addEventListener('click', () => {
    state.q = '';
    state.tags = [];
    state.selCats = [];
    state.ratio = 'any';
    state.source = 'auto';
    state.sort = 'newest';
    dom.q.value = '';
    dom.clearQ.hidden = true;
    dom.ratioSel.value = 'any';
    buildRatio();
    buildSort();
    buildSources();
    renderCategories();
    updateFilterDot();
    applyPreset('screen');
    runSearch({ reset: true });
    closePanel();
    toast('Filter direset', 'ok', '↺');
  });

  dom.loadMore.addEventListener('click', () => {
    state.page += 1;
    runSearch();
  });
  dom.emptyRetry.addEventListener('click', () => runSearch({ reset: true }));

  dom.btnNew.addEventListener('click', () => {
    state.sort = 'newest';
    buildSort();
    checkFreshInFeed();
  });

  qsa('[data-close]').forEach((n) => n.addEventListener('click', closeLB));
  dom.lbPrev.addEventListener('click', () => step(-1));
  dom.lbNext.addEventListener('click', () => step(1));
  dom.favBtn.addEventListener('click', saveFav);
  dom.copyBtn.addEventListener('click', async () => {
    const url = lbImageSrc() || lbItem?.full || '';
    try {
      await navigator.clipboard.writeText(url);
      toast('Link gambar disalin', 'ok', '🔗');
    } catch {
      toast('Gagal menyalin', 'err', '⚠️');
    }
  });

  dom.tbFit.addEventListener('click', () => {
    actualMode = false;
    dom.lbImg.classList.remove('is-actual');
    dom.tbActual.classList.remove('is-on');
    dom.lbImg.style.transform = 'scale(1)';
    dom.tbZoom.textContent = 'Fit';
    updateLbImage();
  });
  dom.tbActual.addEventListener('click', () => {
    actualMode = true;
    dom.lbImg.classList.add('is-actual');
    dom.tbActual.classList.add('is-on');
    dom.lbImg.src = lbItem?.full || lbItem?.sample || '';
    dom.tbZoom.textContent = '100%';
    // Ukuran elemen berubah total (is-actual melepas batas max-width/height).
    updateCropFrame();
  });
  dom.tbZoomIn.addEventListener('click', () => zoom(1.25));
  dom.tbZoomOut.addEventListener('click', () => zoom(0.8));
  dom.tbWb.addEventListener('click', () => {
    if (!lbItem) return;
    toast(`${lbItem.width}×${lbItem.height} — ${lbItem.ratio}:1, ${lbItem.mp} MP`, '', '📐');
  });

  // Upscale: tanpa pilihan mode — tekan tombol, server yang memutuskan
  // (naikkan kualitas hanya kalau target memang lebih besar dari sumber).
  dom.runUpscale.addEventListener('click', () => {
    if (!state.w || !state.h) {
      toast('Isi lebar & tinggi dulu, atau pilih preset di atas', 'err', '⚠️');
      return;
    }
    if (state.upscale !== 'auto') setUpscale('auto');
    else {
      persistFilters();
      rerenderGrid();
      refreshLbIfOpen();
    }
    const srcW = state.crop && lbItem ? Math.round(state.crop.w * lbItem.width) : lbItem?.width || 0;
    toast(
      srcW && srcW < state.w
        ? `Memperbesar ${srcW}px → ${state.w}px (rasio ${(state.w / srcW).toFixed(1)}×)`
        : `Menyesuaikan ke ${state.w}×${state.h}`,
      'ok', '✨'
    );
  });

  dom.lbImg.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.12 : 0.9);
  }, { passive: false });

  dom.lbStage.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    // Saat menyunting crop, klik di dalam area crop tidak boleh mengganti gambar.
    if (state.cropDraft && e.target.closest('.cropper')) return;
    const r = dom.lbStage.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.22) step(-1);
    else if (e.clientX - r.left > r.width * 0.78) step(1);
  });

  window.addEventListener(
    'scroll',
    debounce(() => {
      if (state.loading || state.done) return;
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 900) {
        state.page += 1;
        runSearch();
      }
    }, 260)
  );

  window.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      dom.q.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (state.cropDraft) { cancelCrop(); return; }
      if (!dom.lb.hidden) closeLB();
      else closePanel();
      return;
    }
    if (dom.lb.hidden) {
      // ESC / panel tetap bisa dipakai walau lightbox tertutup
      if (dom.panel.classList.contains('is-open')) closePanel();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft': step(-1); break;
      case 'ArrowRight': step(1); break;
      case 'f': case 'F': saveFav(); break;
      case '1': dom.tbActual.click(); break;
      case 'c': case 'C': dom.tbCrop.click(); break;
      case '+': case '=': zoom(1.25); break;
      case '-': zoom(0.8); break;
      case 'Enter': dom.dlBtn.click(); break;
      default: break;
    }
  });
}

function togglePanel() {
  const open = !dom.panel.classList.contains('is-open');
  if (open) {
    dom.panel.classList.add('is-open');
    dom.panel.setAttribute('aria-hidden', 'false');
    dom.btnFilters.setAttribute('aria-expanded', 'true');
    dom.scrim.hidden = false;
    // Paksa browser menghitung gaya awal (opacity 0) dulu sebelum ditambah
    // is-on, supaya transisi benar-benar jalan. requestAnimationFrame TIDAK
    // boleh dipakai di sini: tab yang sedang ter-background tidak pernah
    // memanggilnya, sehingga scrim tetap tak terlihat padahal sudah menutupi
    // layar dan memblokir seluruh klik.
    void dom.scrim.offsetHeight;
    dom.scrim.classList.add('is-on');
    dom.closePanel.focus();
  } else {
    closePanel();
  }
}

function closePanel() {
  if (!dom.panel.classList.contains('is-open')) return;
  dom.panel.classList.remove('is-open');
  dom.panel.setAttribute('aria-hidden', 'true');
  dom.btnFilters.setAttribute('aria-expanded', 'false');
  dom.scrim.classList.remove('is-on');
  setTimeout(() => {
    if (!dom.panel.classList.contains('is-open')) dom.scrim.hidden = true;
  }, 240);
}

function zoom(k) {
  const cur = parseFloat(String(dom.tbZoom.textContent).replace(/[^\d.]/g, '')) / 100 || 1;
  const next = Math.min(Math.max(cur * k, 0.1), 8);
  dom.lbImg.style.transform = `scale(${next})`;
  dom.lbImg.classList.add('is-actual');
  dom.tbActual.classList.add('is-on');
  dom.tbZoom.textContent = `${Math.round(next * 100)}%`;
  // Transform tidak memicu ResizeObserver, jadi posisi kotak crop harus
  // dihitung ulang secara manual di sini.
  updateCropFrame();
}

boot();
