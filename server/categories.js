import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, SEED_CATEGORIES } from './config.js';

/**
 * Taksonomi otomatis Hoshiva.
 *
 * Ide: setiap wallpaper yang masuk dari API "diumati" (ingest). Tag-nya
 * dicocokkan ke pola kategori yang sudah ada, dan tag yang belum dikenal
 * tapi sering muncul akan promoted menjadi kategori baru secara otomatis.
 * Semua counter dipersist ke disk supaya kategori terus belajar seiring
 * waktu tanpa perlu restart.
 */

/**
 * Lokasi file taksonomi. `HOSHIVA_TAXONOMY_FILE` dipakai test agar ingest
 * sintetis tidak mencampuradukkan data pengguna yang sedang berjalan.
 */
const FILE = process.env.HOSHIVA_TAXONOMY_FILE || path.join(DATA_DIR, 'taxonomy.json');

/** Pola tag -> kategori. Semua lowercase, tanpa underscore. */
const PATTERNS = {
  anime: ['anime', 'manga', 'anime_screenshot', 'adventurers', 'genre_fantasy'],
  girl: [
    '1girl', 'girls_focus', 'solo', 'female_focus', 'waifu', 'goddess', 'elf', 'miko',
    'schoolgirl', 'idol', 'headdress', 'hair_bow', 'blouse', 'white_legwear',
  ],
  landscape: ['landscape', 'scenery', 'panorama', 'vista', 'horizon', 'distant_view', 'outdoors', 'mountain'],
  nature: [
    'nature', 'flowers', 'cherry_blossom', 'sakura', 'forest', 'tree', 'waterfall', 'river',
    'sunflower', 'blue_sky', 'cloud', 'rain', 'snow', 'beach', 'sea', 'petals', 'grass', 'field',
  ],
  city: [
    'cityscape', 'city', 'night', 'skyline', 'street', 'building', 'skyscraper', 'neon',
    'lantern', 'alley', 'rooftop', 'shibuya', 'tokyo', 'bridge', 'train', 'station',
  ],
  cyberpunk: ['cyberpunk', 'futuristic', 'mecha', 'android', 'robot', 'techwear', 'circuit', 'neon_lights'],
  space: ['space', 'starry_sky', 'stars', 'galaxy', 'planet', 'cosmos', 'nebula', 'milky_way', 'moon'],
  fantasy: ['fantasy', 'magic', 'sword', 'wizard', 'dragon', 'elf', 'demon_girl', 'knight', 'goddess'],
  school: ['school', 'uniform', 'serafuku', 'blazer', 'school_uniform', 'classroom', 'desk'],
  sunset: ['sunset', 'sunrise', 'golden_hour', 'dusk', 'twilight', 'sunbeam', 'godrays'],
  minimal: ['simple_background', 'white_background', 'monochrome', 'closed_mouth', 'gradient', 'blank_background'],
  abstract: ['abstract', 'pattern', 'geometric', 'fractal', 'wallpaper', 'background', 'texture'],
};

/**
 * Tag yang perlu diabaikan saat menghitung kategori (terlalu umum / noise).
 * PENTING: semua entri harus sudah ternormalisasi (lowercase, spasi) karena
 * pencocokan terjadi setelah `norm()` mengganti underscore jadi spasi.
 */
const STOP_TAGS = new Set([
  'highres', 'absurd res', 'absurdres', 'wallpaper', 'wallpaper hd', 'background', 'rating safe',
  'japanese text', 'text', 'commentary', 'english text', 'translated', 'scan', 'official art',
  'pixelated', 'jpeg artifacts', 'lowres', 'bad picture', 'artist request', 'cosplay',
  'outdoors', 'indoors', 'people', 'person', 'others', 'original', 'default', 'tagme',
  'rating', 'safe', 'questionable', 'sensitive', 'animal', 'photo', 'favorite', 'unknown',
]);

/**
 * Atribut generik (warna/penampilan/pakaian/ekspresi/anatomi). Jangan pernah
 * dijadikan kategori otomatis — "Pink Hair" atau "Detached Sleeves" bukan
 * kategori yang berguna.
 *
 * CATATAN: `norm()` mengganti underscore jadi spasi sebelum pencocokan, jadi
 * SELURUH pattern di bawah otomatis dinormalisasi juga (`_` -> spasi). Tanpa
 * itu term seperti `looking_at_viewer` tidak akan pernah match.
 */
const GENERIC_ATTR = new RegExp(
  ('\\b(' +
  'hair|eye|eyes|eyebrow|eyebrows|skin|face|cheek|cheeks|lips|nose|ears|fringe|bangs|twintails|' +
  'ponytail|twisted|bun|braid|hairband|hairclip|headband|ahoge|' +
  'dress|shirt|skirt|uniform|thighhighs|thighhigh|stockings|stocking|shoes|shoe|gloves|hat|' +
  'ribbon|bow|necktie|neckwear|boots|socks|jacket|coat|hoodie|shorts|pants|jeans|tie|bra|' +
  'swimsuit|bikini|underwear|panties|sleeves|sleeve|shoulders|collar|buttons|detached|' +
  // bentuk turunan pakaian. `\b` tidak menangkap "sleeve" -> "sleeveless",
  // jadi bentuk jamak harus ditulis eksplisit.
  'sleeveless|clothes|clothing|outfit|sweater|apron|scarf|belt|bag|bags|' +
  'glasses|eyewear|helmet|mask|crown|veil|cape|robe|sandals|' +
  'smile|smirk|grin|wink|blush|open_mouth|closed_mouth|expressionless|serious|looking_at_viewer|' +
  'looking_back|one_eye|two_eyes|bust|cropped|half_body|full_body|upper_body|lower_body|' +
  'bare|horn|horns|weapon|holding|hand|hands|arm|arms|leg|legs|foot|feet|finger|fingers|neck|back|' +
  'chest|cleavage|breast|breasts|thigh|thighs|calves|ankle|ankles|elbow|knees|topless|' +
  // anatomi turunan: "tooth" -> "teeth", plus keluarga skeleton
  'teeth|tooth|fang|fangs|tongue|tusk|mane|skull|skeleton|humanoid|' +
  'standing|sitting|squatting|kneeling|leaning|crouching|posing|from_side|' +
  'tall|large|small|big|huge|tiny|square|rectangle|circular|horizontal|' +
  'vertical|close_up|fullscreen|widescreen|' +
  'color|colour|long|short|medium|redhead|blonde|brunette|' +
  'media|book|copyright|commission|metadata|tagger|theme|mood|setting|scene' +
  ')\\b').replace(/_/g, ' '),
  'i'
);

/**
 * Noise: penanda kualitas/lokasi/sumber dan tag yang tidak pernah layak jadi
 * kategori. Dicocokkan sebagai kata utuh di mana pun dalam tag, sehingga
 * "english commentary" dan "women outdoors" ikut tertangkap.
 */
const NOISE_TAGS = new RegExp(
  ('\\b(' +
  'outdoor|outdoors|indoor|indoors|inside|highres|lowres|absurdres|absurd_res|wallpaper|' +
  'jpeg_artifacts|pixelated|official_art|scan|scanlation|translated|commentary|tagme|' +
  'rating|safe|questionable|sensitive|animal|people|person|persons|others|unknown|default|' +
  'original|cosplay|photo|photos|favorite|comment|text|signature|watermark|shading|voice|' +
  'lipsync|multiple_views|female|male|child|background|girl|girls|boy|boys|solo|model' +
  ')\\b').replace(/_/g, ' '),
  'i'
);

/**
 * Tag placeholder: "field mana yang tidak diisi", bukan deskripsi gambar.
 *
 * Cocoknya PERSIS (set, bukan regex) dan itu penting. Kata-kata yang sama dalam
 * bentuk "(character)" / "(series)" justru penanda tag sah: Danbooru memakai
 * sufiks itu untuk membedakan nama yang sama antar karakter/series. Kalau
 * "character" atau "series" masuk daftar regex, yang terbuang bukan placeholder
 * melainkan entitas asli — Devilman (character), Fate (series), Project Diva
 * (series), Pokemon (creature), Aikatsu! (series), Eo (artist).
 *
 * Tanpa daftar ini, Character Name(958) dan Digital Media(172) duduk di
 * peringkat teratas daftar kategori padahal tidak pernah berguna difilter.
 */
const DUMMY_TAGS = new Set([
  'character name', 'artist name', 'copyright name', 'copyright holder',
  'original creator', 'series name', 'series', 'digital media',
  'traditional media', 'digital media software', 'computer software',
  'first appearance', 'second appearance', 'third appearance',
  'character doll', 'other focus', 'vehicle focus', 'voice actor',
  'free wallpaper', 'no backstory', 'for wikia',
]);

/**
/**
 * Waktu & suasana - filter lapis kedua.
 * Tag-nya tetap berguna untuk panel trending, tapi tidak pernah layak jadi
 * kategori otomatis. Sebagian sudah tercakup seed PATTERNS ("night", "sunset",
 * "dusk", "twilight"), tapi saudara-saudaranya - "dawn", "evening" - akan bocor
 * jadi kategori otomatis begitu tag-nya sering muncul.
 * Dicek di canPromote(), bukan isUsefulTag().
 *
 * "day" dan "days" sengaja TIDAK ada di sini. Keduanya substring yang terlalu
 * berbahaya: "Theater Days", "Summer Days", "Blue Days" semuanya nama series.
 * Memblokirnya sebagai substring membuat entitas sebesar
 * "Idolmaster Million Live! Theater Days" (869 hit) ikut terbuang. Karena itu
 * keduanya ditangani terpisah oleh SCENE_TIME_EXACT di bawah.
 */
const SCENE_TIME = new RegExp(
  ('\\b(' +
  'daytime|daylight|daytime sky|dawn|daybreak|morning|afternoon|' +
  'evening|midday|noon|midnight|night|nighttime|sunlit|moonlit|' +
  'sunrise|sunset|golden hour|dusk|twilight' +
  ')\\b').replace(/_/g, ' '),
  'i'
);

/**
 * Waktu & suasana yang hanya bermakna sebagai tag utuh.
 *
 * Dipisah dari SCENE_TIME karena "day" dan "days" harus tetap ditolak saat
 * berdiri sendiri sebagai tag kategori, tapi boleh muncul di dalam nama
 * yang lebih panjang. Karena itu pencocokannya sama-sebentarnya dengan
 * string, bukan pencarian substring.
 */
const SCENE_TIME_EXACT = new Set(['day', 'days']);

/** Tag berawalan angka: "1girl", "2boys" — jumlah orang, bukan identitas. */
const NUMBER_PREFIX = /^\d+\s*(girls?|boys?|females?|males?|other)\b/;

/** Entitas (karakter / series) — layak jadi kategori otomatis. */
const ENTITY_HINT = /\([^)]+\)|!$|series|project|gakuen|shoujo|shounen|clannad|genshin|hololive|idolmaster|love_ru|touhou|kancolle|blue_archive|arknights|azur_lane/gi;

/**
 * Tag yang sudah tercakup oleh kategori seed (PATTERNS di atas). Dipromosikan
 * sebagai kategori auto hanya akan menghasilkan duplikat — "Landscape" punya
 * seed sendiri, sehingga muncul dua kali di sidebar.
 */
const SEED_TAGS = new Set(Object.values(PATTERNS).flat());

/**
 * Sama seperti SEED_TAGS, tapi sudah dinormalisasi (spasi, lowercase), termasuk
 * bentuk jamak. Tanpa ini tag "clouds" lolos dan membuat kategori otomatis
 * kembar dari kategori seed "Nature".
 */
const SEED_TAGS_NORM = new Set(
  [...SEED_TAGS].flatMap((t) => {
    const n = t.replace(/_/g, ' ');
    return n.endsWith('s') ? [n, `${n}es`] : [n, `${n}s`];
  })
);

/**
 * Tag yang layak masuk trending (kategori & deskriptor generik dieliminasi)
 * supaya panel "Tag populer" benar-benar berguna.
 *
 * DUMMY_TAGS ikut dicek di sini, bukan hanya di canPromote(). Placeholder
 * seperti "character name" tidak berguna di dua tempat: bukan kategori, dan
 * bukan juga tag populer yang ingin diklik pengguna.
 */
export function isUsefulTag(tag) {
  const t = norm(tag);
  if (t.length < 3 || STOP_TAGS.has(t)) return false;
  if (NUMBER_PREFIX.test(t)) return false;
  if (GENERIC_ATTR.test(t)) return false;
  if (NOISE_TAGS.test(t)) return false;
  if (DUMMY_TAGS.has(t)) return false;
  return true;
}

const norm = (t) => String(t).toLowerCase().replace(/_/g, ' ').trim();

/**
 * Empat rem yang menjaga kategori auto tetap ringan.
 *
 * Tanpa rem, jumlah kategori auto tumbuh linear dengan jumlah wallpaper yang
 * masuk: pada data sekarang rasionya 0,0908 kategori per ingest, jadi
 * 200.000 ingest ~= 18.000 kategori (payload /api/categories naik dari 69 KB ke
 * ~1,7 MB, sort jadi O(n log n), dan sidebar harus merender ribuan pill).
 * Sebagian besar dari itu sampah: 61% kategori punya <= 12 hit dan ekornya
 * berisi tag satu-hit yang tidak pernah berguna.
 *
 * 1. PROMO_MIN_* menaikkan ambang promote. 12 -> 22 untuk tag biasa.
 * 2. MAX_AUTO_CATS memberi plafon keras yang tidak bisa dilewati.
 * 3. STALE_* meluruhkan kategori yang sudah lama tidak tersentuh, supaya
 *    daftar bisa memberi tempat ke kategori yang baru relevan.
 * 4. CAP_CHECK_MS / STALE_CHECK_MS menunda pekerjaan itu. Tanpa penundaan,
 *    cap dan sweep akan berjalan setiap ingest; keduanya menyortir seluruh
 *    kategori auto, jadi biayanya tidak sesepele yang kelihatan.
 */

const DAY = 86400000;

/** Ambang promote. Entitas (nama karakter/series) boleh lebih rendah. */
const PROMO_MIN_ENTITY = 5;
const PROMO_MIN_PLAIN = 22;

const MAX_AUTO_CATS = 400;

/** Kategori auto dianggap basi setelah ini tidak tersentuh. */
const STALE_AFTER = 30 * DAY;
/** ...dan pun hanya diluruhkan kalau memang tidak pernah dipakai serius. */
const STALE_MIN_HITS = 12;
const STALE_BATCH = 120;

/** Penundaan: cap dicek paling sering segitu, meluruh paling sering segitu. */
const CAP_CHECK_MS = 5 * 60 * 1000;
const STALE_CHECK_MS = 6 * 60 * 60 * 1000;

const state = {
  cats: {},        // id -> { id, label, emoji, auto, hits, lastSeen }
  tagStats: {},    // tag -> { count, lastSeen }
  posts: {},       // "src:id" -> { at, title, width, height, thumb }
  totalIngested: 0,
  lastIngestAt: 0,
};

function seedCats() {
  for (const c of SEED_CATEGORIES) {
    const prev = state.cats[c.id];
    // JANGAN menimpa hits/lastSeen yang sudah ada. seedCats() dipanggil dua
    // kali di load() — kalau assignment polos, setiap restart server menghapus
    // jejak pemakaian kategori seed, lalu karena listCategories() memfilter
    // minHits >= 1 kategori seed itu hilang dari sidebar sampai_SEARCH baru.
    state.cats[c.id] = prev
      ? { ...prev, ...c, auto: false }
      : { ...c, auto: false, hits: 0, lastSeen: 0 };
  }
}

/**
 * Bersihkan kategori auto yang sudah tidak layak.
 *
 * Ini bukan satu-dua kasus hardcode: setiap kali filter GENERIC_ATTR/STOP_TAGS/
 * SEED_TAGS diperketat, kategori lama yang dulu lolos harus ikut dibersihkan.
 * Counter-nya dipindahkan ke kategori seed bila labelnya cocok, lalu disimpan
 * ke tagStats supaya tidak ter-promosikan lagi di ingest berikutnya.
 */
function pruneAutoCategories() {
  const seedByLabel = new Map(SEED_CATEGORIES.map((c) => [norm(c.label), c.id]));
  const dropped = [];
  for (const [id, cat] of Object.entries(state.cats)) {
    if (!cat.auto) continue;
    const lbl = norm(cat.label);
    const dupesSeed = seedByLabel.has(lbl);
    if (!dupesSeed && canPromote(lbl)) continue; // masih layak

    demote(cat, { seedByLabel, keepCounter: true });
    dropped.push(cat.label);
  }
  return dropped;
}

/**
 * Kembalikan satu kategori auto ke tagStats, lalu hapus dari daftar.
 *
 * `keepCounter` memilih apa counter tag-nya ikut dikembalikan:
 *
 * - true (kategori melanggar aturan): counter dikembalikan utuh. Ia
 *   tidak akan promoted lagi karena `canPromote` masih menolak tag itu, jadi
 *   tidak ada risiko langsung naik kembali.
 * - false (kategori basi / melebihi cap): counter di-NOL-kan. Ini yang
 *   memberi jeda: tag harus mengumpulkan bukti baru dari nol sebelum boleh
 *   promoted lagi. Kalau counter-nya utuh, ia akan langsung melewati ambang
 *   pada ingest berikutnya dan kita masuk siklus promote-demote-promote.
 */
function demote(cat, { seedByLabel = null, keepCounter = false } = {}) {
  const lbl = norm(cat.label);
  if (seedByLabel) {
    const seedId = seedByLabel.get(lbl);
    if (seedId && state.cats[seedId]) {
      const seed = state.cats[seedId];
      seed.hits += cat.hits || 0;
      seed.lastSeen = Math.max(seed.lastSeen, cat.lastSeen || 0);
    }
  }
  const st = state.tagStats[lbl] || { count: 0, lastSeen: 0 };
  if (keepCounter) {
    st.count += cat.hits || 0;
    st.lastSeen = Math.max(st.lastSeen, cat.lastSeen || 0);
  } else {
    st.count = 0;
    st.lastSeen = 0;
  }
  state.tagStats[lbl] = st;
  delete state.cats[cat.id];
}

/** Kategori auto diurutkan dari yang paling lemah: hit paling sedikit dulu. */
function autoWeakestFirst() {
  return Object.values(state.cats)
    .filter((c) => c.auto)
    .sort((a, b) => (a.hits || 0) - (b.hits || 0) || (a.lastSeen || 0) - (b.lastSeen || 0));
}

/**
 * Meluruhkan kategori auto yang sudah lama tidak tersentuh dan tidak pernah
 * dipakai serius. Inilah yang membuat daftar bisa "bernapas": kategori yang
 * terbukti masih relevan akan bertahan, sisanya menyingkir sendiri tanpa
 * perlu campur tangan.
 */
function sweepStale(now) {
  const cutoff = now - STALE_AFTER;
  const dropped = [];
  for (const cat of autoWeakestFirst()) {
    if (dropped.length >= STALE_BATCH) break;
    // sudah terurut naik berdasarkan hits, jadi setelah ini tidak ada lagi
    // yang cukup lemah untuk diluruhkan.
    if ((cat.hits || 0) > STALE_MIN_HITS) break;
    if ((cat.lastSeen || 0) >= cutoff) continue; // masih baru, biarkan saja
    demote(cat, { keepCounter: false });
    dropped.push(cat.label);
  }
  return dropped;
}

/**
 * Pangkas kategori auto yang melebihi MAX_AUTO_CATS, mulai dari yang terlemah.
 * Berbeda dari sweep, yang ini tidak menunggu waktu: plafon harus berlaku juga
 * ketika banyak kategori baru datang di burst yang sama.
 */
function trimToCap() {
  const auto = autoWeakestFirst();
  const over = auto.length - MAX_AUTO_CATS;
  if (over <= 0) return [];
  const dropped = [];
  for (let i = 0; i < over; i++) {
    demote(auto[i], { keepCounter: false });
    dropped.push(auto[i].label);
  }
  return dropped;
}

let lastCapAt = 0;
let lastStaleAt = 0;

/**
 * Jadwalkan pemeliharaan kategori. Sengaja dipanggil dari ingest() tapi hanya
 * jalan kalau sudah lewat interval-nya — inilah "delay" yang membuat cap dan
 * sweep tidak menambah beban ke setiap pencarian.
 */
function scheduleMaintenance(now) {
  const doStale = now - lastStaleAt >= STALE_CHECK_MS;
  const doCap = now - lastCapAt >= CAP_CHECK_MS;
  if (!doStale && !doCap) return null;

  const notes = [];
  if (doStale) {
    lastStaleAt = now;
    const dropped = sweepStale(now);
    if (dropped.length) notes.push(`sweep: ${dropped.length} basi dibuang (${sample(dropped)})`);
  }
  if (doCap) {
    lastCapAt = now;
    const trimmed = trimToCap();
    if (trimmed.length) notes.push(`cap ${MAX_AUTO_CATS}: ${trimmed.length} terlemah dibuang (${sample(trimmed)})`);
  }
  if (!notes.length) return null;
  const line = `[taxonomy] ${notes.join(' | ')}`;
  console.log(line);
  return line;
}

/** Ringkas daftar label supaya baris log tidak membanjiri terminal. */
function sample(labels, n = 8) {
  const head = labels.slice(0, n).join(', ');
  return labels.length > n ? `${head}, +${labels.length - n} lagi` : head;
}

function load() {
  seedCats();
  try {
    if (!fs.existsSync(FILE)) return;
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [id, v] of Object.entries(raw.cats || {})) state.cats[id] = { ...state.cats[id], ...v };
    state.tagStats = raw.tagStats || {};
    state.posts = raw.posts || {};
    state.totalIngested = raw.totalIngested || 0;
    state.lastIngestAt = raw.lastIngestAt || 0;
    seedCats();
    const dropped = pruneAutoCategories();
    if (dropped.length) {
      console.log(`[taxonomy] ${dropped.length} kategori auto tidak layak dibuang: ${sample(dropped)}`);
      save();
    }
  } catch (e) {
    console.warn('[taxonomy] gagal load, pakai cache kosong:', e.message);
  }

  // Cap & sweep juga dijalankan sekali saat boot, supaya plafon langsung berlaku
  // tanpa harus menunggu pencarian pertama. Timestamp di-set supaya jadwal
  // ingest berikutnya tidak langsung mengulang pekerjaan yang sama.
  if (scheduleMaintenance(Date.now())) save();
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(state));
    } catch (e) {
      console.warn('[taxonomy] gagal simpan:', e.message);
    }
  }, 1200);
  saveTimer.unref?.();
}

const PATTERN_INDEX = (() => {
  const idx = [];
  for (const [cat, pats] of Object.entries(PATTERNS)) {
    for (const p of pats) idx.push({ cat, words: norm(p).split(' ').filter((w) => w.length > 2) });
  }
  return idx;
})();

function matchPatterns(tags) {
  const hay = tags.map(norm);
  const hits = new Set();
  for (const { cat, words } of PATTERN_INDEX) {
    for (const t of hay) {
      const ok = words.every((w) => t.includes(w));
      if (ok) {
        hits.add(cat);
        break;
      }
    }
  }
  return hits;
}

/**
 * Kategori baru dibuat dari tag berulang. Hanya entitas (nama karakter/series)
 * yang boleh dipromosikan —Atribut generik seperti "brown_hair" diabaikan.
 */
/**
 * Bolehkah tag ini dipromosikan menjadi kategori otomatis?
 *
 * Berbeda dari `isUsefulTag` (tag masih berguna untuk seed kategori & trending),
 * di sini tag juga harus benar-benar *entitas* dan belum tercakup kategori seed.
 */
export function canPromote(tag) {
  const t = norm(tag);
  if (!isUsefulTag(t)) return false;
  if (SEED_TAGS_NORM.has(t)) return false; // sudah ada kategorinya sendiri
  if (DUMMY_TAGS.has(t)) return false; // placeholder: "character name", "series"
  if (SCENE_TIME.test(t)) return false; // berguna untuk trending, tapi bukan identitas
  if (SCENE_TIME_EXACT.has(t)) return false; // "days" utuh, tapi bukan dalam "Theater Days"
  return true;
}

function autoPromote(tag, count) {
  const id = `auto:${tag.replace(/\s+/g, '_')}`;
  if (state.cats[id]) return id;
  if (!canPromote(tag)) return null;
  // entitas boleh mulai dari 5 kemunculan; tag biasa harus sangat sering
  if (count < (ENTITY_HINT.test(tag) ? PROMO_MIN_ENTITY : PROMO_MIN_PLAIN)) return null;

  // Sudah di cap? Jangan promoted membabi buta. Kategori yang dipromosikan harus
  // lebih kuat daripada kategori auto yang terlemah, kalau tidak ia langsung
  // menyingkirkan yang lain di sweep berikutnya. Ini membuat cap bekerja sebagai
  // penyaring kualitas, bukan sekadar quota yang membeku.
  if (autoCount() >= MAX_AUTO_CATS) {
    const weakest = autoWeakestFirst()[0];
    if (!weakest) return null;
    if ((weakest.hits || 0) >= count) return null; // pendatang baru tidak lebih berguna
    demote(weakest, { keepCounter: false });
  }

  const label = tag
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\s+[a-z]$/, '') // buang ekor terpotong, mis. "Idolmaster T"
    .slice(0, 32);
  state.cats[id] = { id, label, emoji: '🏷️', auto: true, hits: 0, lastSeen: Date.now() };
  return id;
}

function autoCount() {
  let n = 0;
  for (const c of Object.values(state.cats)) if (c.auto) n++;
  return n;
}

/**
 * Ingest wallpaper baru. Dipanggil setiap hasil search.
 * Mengembalikan statisti singkat supaya UI bisa menampilkan toast "kategori baru".
 */
export function ingest(items = []) {
  const before = new Set(Object.keys(state.cats));
  const now = Date.now();

  for (const it of items) {
    state.totalIngested++;

    const tags = (it.tags || []).filter((t) => !STOP_TAGS.has(norm(t)));
    const matched = matchPatterns(tags.length ? tags : [norm(it.title || '')]);
    if (it.orientation === 'landscape') matched.add('landscape');
    // Wallhaven hanya memberi kategori kasar: anime / people / general
    if (it.category === 'anime') {
      matched.add('anime');
      matched.add('girl');
    }
    if (it.category === 'people') matched.add('girl');
    if (it.category === 'general' && it.orientation === 'landscape') matched.add('nature');
    for (const c of matched) {
      const cat = state.cats[c];
      if (cat) {
        cat.hits += 1;
        cat.lastSeen = Math.max(cat.lastSeen, now);
      }
    }

    const seen = new Set();
    for (const raw of tags) {
      const t = norm(raw);
      if (!isUsefulTag(t) || seen.has(t)) continue;
      seen.add(t);
      const rec = state.tagStats[t] || { count: 0, lastSeen: 0 };
      rec.count += 1;
      rec.lastSeen = now;
      state.tagStats[t] = rec;
      const newId = autoPromote(t, rec.count);
      if (newId) {
        state.cats[newId].hits += 1;
        state.cats[newId].lastSeen = now;
      }
    }

    const key = `${it.source}:${it.id}`;
    if (!state.posts[key]) {
      state.posts[key] = {
        at: now,
        title: it.title,
        width: it.width,
        height: it.height,
        thumb: it.thumb,
        source: it.source,
        id: it.id,
      };
    }
  }

  const postKeys = Object.keys(state.posts);
  if (postKeys.length > 3000) {
    postKeys
      .sort((a, b) => state.posts[a].at - state.posts[b].at)
      .slice(0, postKeys.length - 3000)
      .forEach((k) => delete state.posts[k]);
  }

  state.lastIngestAt = now;

  // Cap + sweep kategori. Dipanggil di sini supaya bisa memberi ruang pada
  // kategori baru, tapi scheduleMaintenance() menundanya sendiri kecuali sudah
  // lewat intervalnya — jadi ini tidak menambah beban ke setiap pencarian.
  scheduleMaintenance(now);

  const fresh = [...Object.keys(state.cats)].filter((id) => !before.has(id));
  save();

  return {
    ingested: items.length,
    newCategories: fresh.map((id) => ({ id, label: state.cats[id].label, emoji: state.cats[id].emoji })),
    totalCategories: Object.keys(state.cats).length,
  };
}

export function listCategories({ includeAuto = true, minHits = 1, limit = 60 } = {}) {
  return Object.values(state.cats)
    .filter((c) => (includeAuto ? true : !c.auto))
    .filter((c) => c.hits >= minHits)
    .sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      label: c.label,
      emoji: c.emoji,
      auto: !!c.auto,
      hits: c.hits,
      tags: (PATTERNS[c.id] || []).slice(0, 6),
    }));
}

export function topTags(limit = 40) {
  return Object.entries(state.tagStats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([tag, v]) => ({ tag, count: v.count, lastSeen: v.lastSeen }));
}

export function freshPosts(limit = 24) {
  return Object.entries(state.posts)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([key, v]) => ({ key, ...v }));
}

export function stats() {
  return {
    totalIngested: state.totalIngested,
    totalCategories: Object.values(state.cats).filter((c) => c.hits > 0).length,
    autoCategories: Object.values(state.cats).filter((c) => c.auto).length,
    trackedTags: Object.keys(state.tagStats).length,
    knownPosts: Object.keys(state.posts).length,
    lastIngestAt: state.lastIngestAt,
  };
}

export function categoryToTags(catId) {
  if (PATTERNS[catId]) return PATTERNS[catId].slice(0, 4);
  return [catId.replace(/^auto:/, '').replace(/_/g, ' ')];
}

load();
