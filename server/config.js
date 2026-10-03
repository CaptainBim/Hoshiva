import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
/** Lokasi cache disk. `HOSHIVA_CACHE_DIR` dipakai test agar terisolasi. */
export const CACHE_DIR = process.env.HOSHIVA_CACHE_DIR || path.join(DATA_DIR, 'cache');
export const PORT = Number(process.env.PORT || 4173);
export const HOST = process.env.HOST || '127.0.0.1';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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
  { id: '5k', label: '5K', w: 5120, h: 2880, mode: 'contain' },
  { id: 'uw', label: 'Ultrawide 21:9', w: 3440, h: 1440, mode: 'cover' },
  { id: 'uw32', label: 'Super Ultrawide 32:9', w: 5120, h: 1440, mode: 'cover' },
  { id: 'squat', label: 'Square 1:1', w: 1440, h: 1440, mode: 'cover' },
  { id: 'phone', label: 'Ponsel 19.5:9', w: 1170, h: 2532, mode: 'cover' },
  { id: 'phone16', label: 'Ponsel 16:9', w: 1080, h: 1920, mode: 'cover' },
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

/** Kategori dasar yang selalu ada, sisanya auto-derived dari tag API. */
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
