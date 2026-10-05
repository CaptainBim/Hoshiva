import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
/** Lokasi cache disk. `HOSHIVA_CACHE_DIR` dipakai test agar terisolasi. */
export const CACHE_DIR = process.env.HOSHIVA_CACHE_DIR || path.join(DATA_DIR, 'cache');
export const PORT = Number(process.env.PORT || 4173);

/**
 * Platform-hosted (PaaS) menyuntik PORT tapi tidak menyetel HOST, dan proxy
 * mereka menjangkau container lewat eth0. Kalau kita tetap bind ke 127.0.0.1,
 * health check mereka tidak akan pernah lolos.
 *
 * Karena itu default ke 0.0.0.0 hanya kalau ada tanda platform. Lokal tetap
 * loopback: /api/img memproxy URL arbitrer, jadi membukanya ke seluruh jaringan
 * LAN tanpa sadar adalah gift untuk siapa pun yang memindai port tersebut.
 * Host eksplisit lewat HOST selalu menang, jadi override manual tetap bisa.
 */
const PAAS = [
  ['Railway', process.env.RAILWAY_ENVIRONMENT],
  ['Render', process.env.RENDER],
  ['Fly.io', process.env.FLY_APP_NAME],
  ['Heroku', process.env.HEROKU_APP_NAME],
].filter(([, v]) => v);

export const HOST = process.env.HOST || (PAAS.length ? '0.0.0.0' : '127.0.0.1');

/**
 * Label platform untuk banner boot: nama yang terdeteksi, `HOST` kalau di-set
 * manual, atau `lokal`. Berguna untuk memastikan bind address dari log saat
 * menelusuri masalah deploy, tanpa perlu menebak.
 */
export const PLATFORM = process.env.HOST ? 'HOST' : PAAS.length ? PAAS[0][0] : 'lokal';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Posisi crop untuk mode `cover`.
 *
 * Dulu hardcoded `attention`: sharp memilih area dengan entropi tertinggi, yaitu
 * bagian paling "ramai". Untuk wallpaper itu sering salah — subjek karakter
 * terpotong, atau yang terpilih justru background yang paling detail.
 * Terukur pada tiga wallpaper nyata, `attention` menggeser framing pada
 * 56-70% piksel dibanding `centre`, dan tidak konsisten dari gambar ke gambar.
 *
 * `centre` framingnya bisa ditebak, dan itulah yang benar untuk wallpaper: isi
 * yang di tengah tetap di tengah. Nilai dari klien tetap diterima selama ada di
 * daftar ini, jadi `attention` masih bisa diminta kalau memang diinginkan.
 */
export const CROP_POSITIONS = [
  'centre', 'attention', 'entropy', 'top', 'bottom', 'left', 'right',
];
export const DEFAULT_CROP_POSITION = 'centre';

/**
 * Preset ukuran wallpaper. `mode` menentukan cara fit:
 *  - cover  : potong/scalable memenuhi kotak ( wallpaper desktop )
 *  - contain: seluruh gambar muat di dalam canvas ( wallpaper tanpa crop )
 *  - width  : kunci lebar, tinggi mengikuti aspect
 *  - height : kunci tinggi, lebar mengikuti aspect
 */
export const SIZE_PRESETS = [
  { id: 'screen', label: 'Layar Saya', mode: 'cover', auto: true, hint: 'mengikuti resolusi layar + DPR' },
  { id: 'fhd', label: 'Full HD', w: 1920, h: 1080, mode: 'contain' },
  { id: 'qhd', label: 'QHD 2K', w: 2560, h: 1440, mode: 'contain' },
  { id: '4k', label: '4K UHD', w: 3840, h: 2160, mode: 'contain' },
  { id: 'uw', label: 'Ultrawide 21:9', w: 3440, h: 1440, mode: 'cover' },
  { id: 'uw32', label: 'Super Ultrawide 32:9', w: 5120, h: 1440, mode: 'cover' },
  { id: 'squat', label: 'Square 1:1', w: 1440, h: 1440, mode: 'cover' },
  // Potret: dipotong dari sisi yang lebar. Ambil tengah, bukan `attention`,
  // supaya wajah/subyek yang di tengah tidak bergeser unpredictably.
  { id: 'phone', label: 'Ponsel 19.5:9', w: 1170, h: 2532, mode: 'cover', position: 'centre', hint: 'potong dari tengah' },
  { id: 'phone16', label: 'Ponsel 16:9', w: 1080, h: 1920, mode: 'cover', position: 'centre', hint: 'potong dari tengah' },
  { id: 'ipad', label: 'iPad 4:3', w: 2048, h: 1536, mode: 'cover' },
  { id: 'original', label: 'Asli (Full Res)', mode: 'raw', hint: 'tanpa resize, unduh file asli' },
];

export const UPSCALE_MODES = [
  { id: 'none', label: 'Tanpa AI', hint: 'Lanczos3 biasa' },
  { id: 'waifu2x', label: 'waifu2x', hint: 'Lanczos3 + unsharp anime (auto-deteksi binary, fallback)' },
  { id: 'anime', label: 'Anime Sharpen', hint: 'Unmask + sharpen agresif' },
];

export const SORTS = [
  { id: 'fit', label: 'Paling Cocok' },
  { id: 'newest', label: 'Terbaru' },
  { id: 'top', label: 'Populer' },
  { id: 'random', label: 'Acak' },
];

export const RATIOS = [
  { id: 'any', label: 'Semua' },
  { id: 'landscape', label: 'Landscape' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'square', label: 'Square' },
  { id: 'tall', label: 'Tall' },
  { id: 'ultrawide', label: 'Ultrawide' },
];

export const SEED_CATEGORIES = [
  { id: 'anime', label: 'Anime', emoji: '🌸' },
  { id: 'girl', label: 'Waifu', emoji: '💗' },
  { id: 'landscape', label: 'Landscape', emoji: '🏔️' },
  { id: 'nature', label: 'Nature', emoji: '🌿' },
  { id: 'city', label: 'City / Night', emoji: '🌆' },
  { id: 'cyberpunk', label: 'Cyberpunk', emoji: '🛸' },
  { id: 'space', label: 'Space', emoji: '🌌' },
  { id: 'fantasy', label: 'Fantasy', emoji: '🧝' },
  { id: 'school', label: 'School', emoji: '🎒' },
  { id: 'sunset', label: 'Sunset', emoji: '🌅' },
  { id: 'minimal', label: 'Minimalis', emoji: '⚪' },
  { id: 'abstract', label: 'Abstract', emoji: '🌀' },
];

/** Timeout fetch ke sumber eksternal */
export const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT || 15000);
/** Batas ukuran hasil upscale (guardrails RAM) */
export const MAX_OUTPUT_PX = Number(process.env.MAX_OUTPUT_PX || 12000);
