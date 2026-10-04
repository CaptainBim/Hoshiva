import { UA, FETCH_TIMEOUT } from './config.js';

/* ------------------------------------------------------------------ *
 * Hoshiva source registry
 *
 * Semua sumber dinormalisasi ke shape yang sama:
 *   { id, source, sourceLabel, title, thumb, sample, full,
 *     width, height, ratio, orientation, mp, rating, score,
 *     tags[], createdAt, pageUrl, author, colors? }
 *
 * Sumber "booru" memakai DAPI yang identik, jadi satu adapter cukup untuk
 * semuanya.
 *
 * Catatan: gelbooru, konachan, rule34, dan xbooru sudah dihapus. Sertifikat
 * TLS keempatnya kedaluwarsa 22 Januari 2025 dan domainnya kini dialihkan ke
 * halaman ISP pihak ketiga, jadi tidak lagi menjadi booru yang bisa dipakai.
 * ------------------------------------------------------------------ */

export const BOORU_SOURCES = [
  {
    id: 'safebooru',
    label: 'Safebooru',
    base: 'https://safebooru.org',
    kind: 'booru',
    wallpaperTags: ['wallpaper', 'wallpaper_hd'],
    priority: 1,
  },
];

export const WALLHAVEN = {
  id: 'wallhaven',
  label: 'Wallhaven',
  base: 'https://wallhaven.cc/api/v1',
  kind: 'wallhaven',
  purity: 'sfw',
  priority: 0, // wallpaper-murni, paling relevan
};

export const ALL_SOURCES = [WALLHAVEN, ...BOORU_SOURCES];

const byId = new Map(ALL_SOURCES.map((s) => [s.id, s]));
export const getSource = (id) => byId.get(id);

/* ----------------------------- utils ----------------------------- */

const decodeXml = (s = '') =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** Parser minimal untuk XML DAPI: elemen <post attr="v" ... /> */
function parseBooruXml(xml) {
  const total = Number((xml.match(/<posts[^>]*count="(\d+)"/) || [])[1] || 0);
  const offset = Number((xml.match(/<posts[^>]*offset="(\d+)"/) || [])[1] || 0);
  const items = [];
  const tagRe = /<post\b([^>]*?)\/>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const attrs = {};
    const aRe = /([\w:.-]+)="([^"]*)"/g;
    let a;
    while ((a = aRe.exec(m[1]))) attrs[a[1]] = decodeXml(a[2]);
    if (attrs.file_url) items.push(attrs);
  }
  return { total, offset, items };
}

export function aspectInfo(w, h) {
  const ratio = h > 0 ? w / h : 0;
  let orientation = 'square';
  if (ratio > 1.15) orientation = 'landscape';
  else if (ratio < 0.87) orientation = 'portrait';
  return { ratio, orientation, mp: +((w * h) / 1e6).toFixed(2) };
}

/**
 * Batas rasio (lebar/tinggi) untuk tiap filter orientasi.
 *
 * Filter ini dipakai ulang sebagai *jaring pengaman* setelah hasil digabung:
 * Wallhaven hanya menerima `ratios` miliknya sendiri dan booru mengandalkan tag
 * `landscape`/`portrait` yang sering tidak konsisten, sehingga tanpa penyaring
 * lokal hasil "Portrait" masih bisa memuat gambar lanskap.
 */
export const RATIO_RANGE = {
  landscape: [1.15, Infinity],
  portrait: [0, 0.87],
  square: [0.87, 1.15],
  tall: [0, 0.7],
  ultrawide: [2, Infinity],
};

/** True bila `item` cocok dengan filter rasio `id` (true juga untuk 'any'). */
export function matchesRatio(item, id) {
  if (!id || id === 'any') return true;
  const range = RATIO_RANGE[id];
  if (!range) return true;
  const r = typeof item === 'number' ? item : Number(item?.ratio);
  if (!Number.isFinite(r) || r <= 0) return false; // dimensi tidak diketahui -> jangan lolos
  return r >= range[0] && r < range[1];
}

const titleCase = (s) =>
  s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: { 'user-agent': UA, accept: '*/*', ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(to);
  }
}

/* --------------------------- booru adapter --------------------------- */

const BOORU_SORT = { fit: ['score', 'desc'], newest: ['id', 'desc'], top: ['score', 'desc'], random: ['random', ''] };

/**
 * Sinonim orang -> tag booru. Tanpa ini "girl" tidak akan nyantol ke tag
 * `1girl` sehingga hasil kosong.
 */
const BOORU_SYNONYM = {
  girl: '1girl', girls: '1girl', woman: '1girl', women: '1girl', female: '1girl', waifu: '1girl',
  boy: '1boy', boys: '1boy', man: '1boy', men: '1boy', male: '1boy', guy: '1boy',
  kid: 'child', kids: 'child', chibi: 'chibi',
  scenery: 'landscape', view: 'landscape', wallpaper: null, background: null,
  city: 'cityscape', cityscape: 'cityscape', cityscape_night: 'night',
  night: 'night', nighttime: 'night', sunset: 'sunset', sunrise: 'sunrise',
  forest: 'forest', trees: 'tree', mountain: 'mountain', mountains: 'mountain',
  beach: 'beach', ocean: 'sea', flower: 'flowers', flowers: 'flowers', sakura: 'cherry_blossom',
  space: 'space', stars: 'starry_sky', galaxy: 'starry_sky', starry: 'starry_sky',
  school: 'school', uniform: 'uniform', cyberpunk: 'cyberpunk', neon: 'neon',
  fantasy: 'fantasy', magic: 'magic', cute: 'cute', kawaii: 'cute',
  ultra_wide: null, ultrawide: null, hd: null, '4k': null, phone: null, desktop: null,
};

/** Bersihkan query user -> tag booru yang valid (AND semantics). */
function toBooruTags(q) {
  if (!q) return [];
  return String(q)
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .map((t) => t.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter((t) => t.length > 1)
    .map((t) => {
      if (Object.prototype.hasOwnProperty.call(BOORU_SYNONYM, t)) return BOORU_SYNONYM[t];
      return t;
    })
    .filter((t) => t && t.length > 1)
    .slice(0, 12);
}

function buildBooruTagQuery(opts) {
  const parts = [];
  const rating = opts.purity || 'safe';
  if (rating === 'safe') parts.push('rating:safe');
  else if (rating === 'sfw') parts.push('rating:safe');

  for (const t of toBooruTags(opts.q)) parts.push(t);
  for (const t of opts.tags || []) parts.push(t);

  if (opts.minWidth) parts.push(`width:>=${Math.round(opts.minWidth)}`);
  if (opts.minHeight) parts.push(`height:>=${Math.round(opts.minHeight)}`);
  if (opts.landscapeOnly) parts.push('-vertical', 'landscape');

  const ratioMap = {
    landscape: 'landscape',
    portrait: 'portrait',
    tall: 'tall',
    square: 'square',
  };
  if (opts.ratio && opts.ratio !== 'any' && ratioMap[opts.ratio]) parts.push(ratioMap[opts.ratio]);
  if (opts.ratio === 'ultrawide') parts.push('width:>=2560');

  return [...new Set(parts)].join(' ');
}

/** Tag generik yang tidak pantas jadi judul (warna rambut, pakaian, pose). */
const TITLE_NOISE = [
  'hair', 'eyes', 'eye', 'skin', 'dress', 'shirt', 'skirt', 'uniform', 'thighhighs', 'stockings',
  'smile', 'blush', 'looking_at_viewer', 'long_hair', 'short_hair', 'twintails', 'ponytail',
  'white_background', 'simple_background', 'outdoors', 'upper_body', 'solo', 'closed_mouth',
  'large_breasts', 'medium_breasts', 'small_breasts', 'absurd_res', 'highres', 'blue_eyes',
  'brown_hair', 'black_hair', 'blonde_hair', 'one_eye', 'female_focus', 'girls_focus',
];
/** Tag yang isinya cuma atribut fisik — tidak pernah jadi judul. */
const DESCRIPTOR_RE =
  /(^|_)(hair|eyes?|skin|dress|shirt|skirt|uniform|thighhighs?|stockings?|boots?|shoes?|gloves?|hat|bow|ribbon|necktie|boots|bra|swimsuit|bikini|smile|blush|open_mouth|closed_mouth|looking_at_viewer|female|male|child|eyeshadow|lips|nose|ears|hairband|hairclip|headband|collar|buttons|shading)(_|$)|(color|colour)$|_color$|^color_/i;
const TITLE_NOISE_RE = new RegExp(
  `^(${TITLE_NOISE.join('|')})(_|$)|^\\d+(girl|boy)s?(_|$)|_(girl|boy|child)$`,
  'i'
);
/** Tag yang menandakan entitas (karakter / series) — dipakai sebagai judul. */
const SERIES_HINT = /(series|project|gakuen|shoujo|shounen|clannad|genshin|hololive|idolmaster|love_ru)/i;

/**
 * Pilih judul terbaik dari tag: utamakan nama karakter (pakai tanda kurung),
 * lalu nama series, baru atribut non-generik. Tag deskriptor ("blue hair",
 * "aqua eyes") selalu paling akhir karena tidak informatif.
 */
function deriveTitle(tags) {
  if (!tags?.length) return 'Wallpaper';
  const clean = tags.filter((t) => t && !TITLE_NOISE_RE.test(t));

  // 1) karakter: "nama_(series)" — paling informatif
  const char = clean.find((t) => /\([^)]+\)/.test(t) && !SERIES_HINT.test(t));
  if (char) return titleCase(char.replace(/\([^)]*\)/g, '').trim() || char);

  // 2) series / franchise
  const series = clean.find((t) => /!$/.test(t) || SERIES_HINT.test(t));
  if (series) return titleCase(series.replace(/!$/, ''));

  // 3) tag non-deskriptif, pilih yang paling informatif
  const meaningful = clean.filter((t) => !DESCRIPTOR_RE.test(t) && t.length > 3);
  if (meaningful.length) {
    const multi = meaningful.find((t) => t.includes('_'));
    return titleCase(multi || meaningful[0]);
  }
  if (clean.length) return titleCase(clean.find((t) => !DESCRIPTOR_RE.test(t)) || clean[0]);

  // 4) benar-benar tidak ada yang bagus — pakai tag pertama
  return titleCase(tags.find((t) => !TITLE_NOISE_RE.test(t)) || tags[0]);
}

function normalizeBooruPost(p, src) {
  const w = Number(p.width || 0);
  const h = Number(p.height || 0);
  const tags = String(p.tags || '').split(/\s+/).filter(Boolean);
  const { ratio, orientation, mp } = aspectInfo(w, h);
  const id = String(p.id);
  const thumb = p.preview_url || p.sample_url || p.file_url;
  const sample = p.sample_url || p.file_url;

  const post = {
    id,
    source: src.id,
    sourceLabel: src.label,
    title: deriveTitle(tags),
    thumb,
    sample,
    full: p.file_url,
    width: w,
    height: h,
    ratio: +ratio.toFixed(3),
    orientation,
    mp,
    rating: p.rating || 's',
    score: Number(p.score || 0),
    tags: tags.slice(0, 60),
    tagCount: tags.length,
    createdAt: p.created_at || (p.change ? new Date(Number(p.change) * 1000).toISOString() : null),
    author: p.creator_id ? `uid:${p.creator_id}` : null,
    md5: p.md5 || null,
    pageUrl: `${src.base}/index.php?page=post&s=view&id=${id}`,
    hasChildren: p.has_children === 'true',
  };
  indexPost(post);
  return post;
}

async function searchBooru(src, opts) {
  const [sortKey, sortOrder] = BOORU_SORT[opts.sort] || BOORU_SORT.newest;
  const limit = Math.min(Math.max(Number(opts.limit) || 24, 1), 100);
  const page = Math.max(Number(opts.page) || 1, 1);

  const attempt = async (tags, extraSort) => {
    const u = new URL(`${src.base}/index.php`);
    // NOTE: DAPI memakai `page=dapi` sebagai selector; nomor halaman harus `pid`
    // (kalau `page` dipakai dua kali, yang terakhir menimpa dan DAPI mati).
    u.searchParams.set('page', 'dapi');
    u.searchParams.set('s', 'post');
    u.searchParams.set('q', 'index');
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('pid', String(page));
    if (tags) u.searchParams.set('tags', tags);
    if (extraSort && extraSort !== 'random') {
      u.searchParams.set('sort', extraSort);
      if (sortOrder) u.searchParams.set('order', sortOrder);
    }
    const res = await fetchWithTimeout(u.toString());
    if (!res.ok) throw new Error(`${src.label} HTTP ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      const parsed = parseBooruXml(text);
      if (!parsed.items.length) throw new Error(`${src.label} balasan XML kosong / kena rate-limit`);
      return parsed;
    }
    try {
      const j = JSON.parse(text); // beberapa fork balas JSON
      return { total: j.posts?.length || 0, items: (j.posts || []).map(normalizeBooruPost) };
    } catch {
      throw new Error(`${src.label} format tidak dikenal`);
    }
  };

  const baseTags = buildBooruTagQuery(opts);
  const queryTags = toBooruTags(opts.q);
  const hasRatio = /\b(landscape|portrait|tall|square)\b/.test(baseTags);

  /**
   * Relaksasi progresif:_results kosong itu membosankan, jadi coba longgar
   * satu per satu — lepas rasio, lalu jumlah kata kunci, lalu rating, lalu filter.
   */
  const attempts = [];
  const push = (t) => {
    const v = [...new Set(t.split(' ').filter(Boolean))].join(' ');
    if (v && !attempts.includes(v)) attempts.push(v);
  };

  push(baseTags);
  if (hasRatio) push(baseTags.replace(/\s*\b(ratio:)?(landscape|portrait|tall|square)\b/g, ''));
  // lepas kata kunci bertahap dari belakang
  for (let i = queryTags.length - 1; i >= 0; i--) {
    const relaxed = [...new Set([...baseTags.split(' '), ...queryTags].filter(Boolean))];
    relaxed.splice(relaxed.indexOf(queryTags[i]), 1);
    if (i === 0) break;
    push(relaxed.join(' '));
  }
  // tanpa kata kunci, tanpa rating, tanpa filter dimensi
  push([...new Set(baseTags.split(' ').filter((t) => t && !/^rating:/.test(t) && !/^width:|^height:/.test(t)))].join(' '));
  push([...new Set(baseTags.split(' ').filter((t) => t && !/^rating:/.test(t) && !/^width:|^height:/.test(t) && !queryTags.includes(t)))].join(' '));

  let parsed = { items: [], total: 0 };
  let used = baseTags;
  for (const tags of attempts) {
    try {
      parsed = await attempt(tags, sortKey);
    } catch (e) {
      if (attempts.indexOf(tags) === attempts.length - 1) throw e;
      continue;
    }
    used = tags;
    if (parsed.items?.length) break;
  }
  const items = parsed.items || [];

  return {
    source: src.id,
    sourceLabel: src.label,
    total: parsed.total || items.length,
    query: used,
    relaxed: used !== baseTags,
    items: items.map((p) => normalizeBooruPost(p, src)),
  };
}

async function detailBooru(src, id) {
  const u = new URL(`${src.base}/index.php`);
  u.searchParams.set('page', 'dapi');
  u.searchParams.set('s', 'post');
  u.searchParams.set('q', 'index');
  u.searchParams.set('tags', `id:${encodeURIComponent(id)}`);
  const res = await fetchWithTimeout(u.toString());
  if (!res.ok) throw new Error(`${src.label} HTTP ${res.status}`);
  const text = await res.text();
  const { items } = parseBooruXml(text);
  if (!items.length) throw new Error('Post tidak ditemukan');
  return normalizeBooruPost(items[0], src);
}

/* ------------------------- wallhaven adapter ------------------------- */

const WH_SORT = {
  fit: 'toprange',
  newest: 'new',
  top: 'toprange',
  random: 'random',
};
const WH_RATIO = {
  landscape: 'landscape',
  portrait: 'portrait',
  square: 'square',
  ultrawide: '21x9',
  tall: '0.6x1',
};

/** Wallhaven base untuk halaman publik (dipakai scraping tag). */
const WH_WEB = 'https://wallhaven.cc/w';

/**
 * Index post terbaru di memori (max 600). Dipakai supaya endpoint detail
 * bisa melengkapi tag di atas data yang sudah kita punya, tanpa fetch ulang
 * seluruh metadata.
 */
const postIndex = new Map();
function indexPost(p) {
  postIndex.set(p.id, p);
  if (postIndex.size > 600) {
    // buang yang paling lama insertion-order
    const first = postIndex.keys().next().value;
    postIndex.delete(first);
  }
}

/** Ambil tag Wallhaven dari halaman publiknya (API detail butuh API key). */
async function scrapeWhTags(id) {
  const res = await fetchWithTimeout(`${WH_WEB}/${id}`);
  if (!res.ok) throw new Error(`Wallhaven HTML HTTP ${res.status}`);
  const html = await res.text();

  // 1) tag dari <title>: "Cardcaptor Sakura, Kinomoto Sakura | 3508x2480 Wallpaper"
  const metaTitle = (html.match(/<meta\s+name="title"\s+content="([^"]+)"/i) || [])[1] || '';
  const fromTitle = metaTitle
    .split('|')[0]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 2) tag dari <a class="tagname">
  const fromLinks = [...html.matchAll(/<a[^>]*class="tagname"[^>]*>([^<]+)<\/a>/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.length > 1 && !t.includes('{') && !t.startsWith('+'));

  const tags = [...new Set([...fromLinks, ...fromTitle])];
  const dims = metaTitle.match(/(\d{2,5})x(\d{2,5})/);
  return { tags, dims: dims ? { width: +dims[1], height: +dims[2] } : null };
}

function normalizeWhPost(w) {
  const dim = aspectInfo(w.dimension_x || 0, w.dimension_y || 0);
  const catLabel = w.category === 'anime' ? 'Anime' : w.category === 'people' ? 'Character' : 'Wallpaper';
  const p = {
    id: w.id,
    source: WALLHAVEN.id,
    sourceLabel: WALLHAVEN.label,
    // placeholder: akan diganti tag asli begitu detail di-scrape
    title: w.source || `${catLabel} Wallpaper`,
    thumb: w.thumbs?.small || w.thumbs?.large,
    sample: w.thumbs?.large || w.path,
    full: w.path,
    width: w.dimension_x,
    height: w.dimension_y,
    ratio: Number(w.ratio) || +dim.ratio.toFixed(3),
    orientation: dim.orientation,
    mp: dim.mp,
    resolution: w.resolution,
    fileSize: w.file_size,
    fileType: w.file_type,
    rating: w.purity || 'sfw',
    category: w.category,
    score: w.favorites || 0,
    views: w.views || 0,
    tags: [],
    tagCount: 0,
    colors: w.colors || [],
    createdAt: w.created_at || null,
    pageUrl: w.url,
    source_author: w.source || null,
  };
  indexPost(p);
  return p;
}

async function searchWallhaven(opts) {
  const limit = Math.min(Math.max(Number(opts.limit) || 24, 1), 50);
  const page = Math.max(Number(opts.page) || 1, 1);

  // PENTING: jangan `new URL('/search', base)` — path absolut '/search' akan
  // membuang '/api/v1' dari base dan kena halaman HTML, bukan endpoint API.
  const u = new URL(`${WALLHAVEN.base}/search`);
  // general(1) + anime(10) = 011 -> wallpaper fokus anime, tapi tetap ada pilihan
  u.searchParams.set('categories', opts.includeGeneral ? '111' : '011');
  u.searchParams.set('purity', opts.purity === 'nsfw' ? '110' : '100');
  u.searchParams.set('sorting', WH_SORT[opts.sort] || 'toprange');
  u.searchParams.set('page', String(page));
  if (opts.q) u.searchParams.set('q', String(opts.q).trim());
  for (const t of opts.tags || []) u.searchParams.set('q', [opts.q, t].filter(Boolean).join(' '));
  if (opts.ratio && opts.ratio !== 'any' && WH_RATIO[opts.ratio]) u.searchParams.set('ratios', WH_RATIO[opts.ratio]);
  if (opts.minWidth && opts.minHeight) {
    u.searchParams.set('atleast', `${Math.round(opts.minWidth)}x${Math.round(opts.minHeight)}`);
  }

  const res = await fetchWithTimeout(u.toString());
  if (!res.ok) throw new Error(`Wallhaven HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim().startsWith('{')) {
    // Wallhaven kadang balas halaman HTML (rate-limit / Cloudflare) -> coba lagi
    throw new Error('Wallhaven membalas non-JSON (rate-limit?)');
  }
  const json = JSON.parse(text);
  let items = (json.data || []).map(normalizeWhPost);
  // Guardrail: Wallhaven ignoring `atleast` -> filter ulang di sisi server
  if (opts.minWidth) items = items.filter((i) => i.width >= opts.minWidth);
  return {
    source: WALLHAVEN.id,
    sourceLabel: WALLHAVEN.label,
    total: json.meta?.last_page ? json.meta.last_page * items.length : items.length,
    page,
    items,
  };
}

async function detailWallhaven(id) {
  const base = postIndex.get(id);
  let tags = [];
  let dims = base ? { width: base.width, height: base.height } : null;

  // 1) coba API resmi (kalau someday tanpa key / ada key punyamu)
  try {
    const res = await fetchWithTimeout(`${WALLHAVEN.base}/search/${encodeURIComponent(id)}`);
    if (res.ok) {
      const j = await res.json();
      if (j.data) {
        const d = normalizeWhPost(j.data);
        d.tags = (j.data.tags || []).map((t) => t.name || t);
        d.tagCount = d.tags.length;
        if (d.tags.length) {
          d.title = deriveTitle(d.tags.map((t) => String(t).toLowerCase().replace(/\s+/g, '_')));
        }
        return d;
      }
    }
  } catch {
    /* lanjut scraping */
  }

  // 2) fallback: scrape tag dari halaman publik
  const scraped = await scrapeWhTags(id);
  tags = scraped.tags;
  dims = scraped.dims || dims;

  if (base) {
    const merged = { ...base, tags, tagCount: tags.length };
    if (tags.length) merged.title = deriveTitle(tags.map((t) => t.toLowerCase().replace(/\s+/g, '_')));
    indexPost(merged);
    return merged;
  }

  // 3) tidak pernah terlihat di search -> bangun dari data yang ada
  const w = dims?.width || 0;
  const h = dims?.height || 0;
  const dim = aspectInfo(w, h);
  const built = {
    id,
    source: WALLHAVEN.id,
    sourceLabel: WALLHAVEN.label,
    title: deriveTitle(tags.map((t) => t.toLowerCase().replace(/\s+/g, '_'))) || 'Wallpaper',
    thumb: `https://th.wallhaven.cc/small/${id.slice(0, 2)}/${id}.jpg`,
    sample: `https://th.wallhaven.cc/lg/${id.slice(0, 2)}/${id}.jpg`,
    full: `https://w.wallhaven.cc/full/${id.slice(0, 2)}/wallhaven-${id}.jpg`,
    width: w,
    height: h,
    ratio: +dim.ratio.toFixed(3),
    orientation: dim.orientation,
    mp: dim.mp,
    rating: 'sfw',
    tags,
    tagCount: tags.length,
    colors: [],
    createdAt: null,
    pageUrl: `${WH_WEB}/${id}`,
  };
  indexPost(built);
  return built;
}

/* ------------------------------ public ------------------------------ */

export async function searchSources(order, opts) {
  const results = [];
  const errors = [];
  for (const id of order) {
    const src = byId.get(id);
    if (!src) continue;
    try {
      const r = src.kind === 'wallhaven' ? await searchWallhaven(opts) : await searchBooru(src, opts);
      if (r.items.length) {
        results.push(r);
        continue;
      }
      errors.push(`${src.label}: 0 hasil`);
    } catch (e) {
      errors.push(`${src.label}: ${e.message}`);
    }
  }
  return { results, errors };
}

export function detailSource(id, postId) {
  const src = byId.get(id);
  if (!src) throw new Error(`Sumber tidak dikenal: ${id}`);
  return src.kind === 'wallhaven' ? detailWallhaven(postId) : detailBooru(src, postId);
}

/** Urutan sumber default: coba wallhaven dulu (wallpaper), lalu booru fallback. */
export function defaultSourceOrder(preferred) {
  const list = preferred
    ? [preferred, ...ALL_SOURCES.map((s) => s.id).filter((i) => i !== preferred)]
    : [...ALL_SOURCES].sort((a, b) => a.priority - b.priority).map((s) => s.id);
  return list;
}

export function publicSources() {
  return ALL_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    kind: s.kind,
    base: s.base,
    purity: s.purity || 'safe',
    wallpaper: s.kind === 'wallhaven' || (s.wallpaperTags || []).length > 0,
  }));
}
