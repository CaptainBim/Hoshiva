import sharp from 'sharp';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UA, FETCH_TIMEOUT, MAX_OUTPUT_PX } from './config.js';

/* ------------------------------------------------------------------ *
 * Image pipeline Hoshiva
 *  - proxy gambar (menghindari CORS + hotlink blok)
 *  - resize ke ukuran wallpaper pilihan
 *  - UPSCALE: emulasi waifu2x (denoise + lanczos3 + unsharp),
 *    atau panggil binary waifu2x asli bila terpasang.
 * ------------------------------------------------------------------ */

/**
 * Guard SSRF.
 *
 * Penting: jangan pakai regex anchor untuk mencocokkan prefix ("127."), karena
 * `$` mengharuskan kecocokan sampai akhir string sehingga prefix tidak pernah
 * cocok. Host di sini diurai menjadi angka IPv4/IPv6 lalu dibandingkan dengan
 * rentang privat secara numerik.
 */

/** Uraikan host menjadi { IPv4 | IPv6 } atau null bila bukan alamat IP. */
function parseIp(host) {
  let h = String(host || '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

  // IPv4 gaya desimal/oktal/heksadesimal ("2130706433", "0x7f000001", "0177.0.0.1").
  // URLs seperti "127.1" atau "0x7f.1" di-resolve browser ke 127.0.0.1, jadi
  // bentuk singkat harus diurai juga, mengikuti algoritma WHATWG IPv4.
  if (/^[0-9.]+$/.test(h) || /^0x[0-9a-f.]+$/.test(h)) {
    const raw = h.split('.');
    if (raw.length > 4 || raw.some((p) => p === '')) return null;
    const toInt = (p) => {
      if (/^0x[0-9a-f]+$/.test(p)) return parseInt(p.slice(2), 16);
      if (/^0[0-7]+$/.test(p)) return parseInt(p.slice(1), 8);
      if (/^\d+$/.test(p)) return Number(p);
      return NaN;
    };
    const parts = raw.map(toInt);
    if (parts.some((v) => !Number.isInteger(v))) return null;
    const last = parts[parts.length - 1];
    // Part terakhir boleh melebihi 255 karena menyerap sisa byte; sisanya <= 255.
    if (parts.slice(0, -1).some((v) => v > 255)) return null;
    if (last >= 256 ** (5 - raw.length)) return null;
    const full = [...new Array(4 - raw.length).fill(0), ...parts];
    return { v: 4, a: full[0], b: full[1], c: full[2], d: full[3] };
  }

  if (h.includes(':')) {
    // Hanya IPv6 (punya tanda titik dua).
    // "::ffff:7f00:1" adalah IPv4-mapped; URL menormalisasinya ke bentuk hex.
    const mapped = /^::ffff:(?:0{1,4}:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return { v: 4, a: hi >> 8, b: hi & 255, c: lo >> 8, d: lo & 255 };
    }
    return { v: 6, text: h };
  }
  return null;
}

/** True bila alamat berada di jaringan privat/loopback/link-local/CGNAT. */
function isPrivateIp(ip) {
  if (!ip) return false;
  if (ip.v === 4) {
    const { a, b, c } = ip;
    if (a === 0 || a === 10 || a === 127) return true;                    // 0/8, 10/8, loopback
    if (a === 169 && b === 254) return true;                              // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;                     // 172.16/12
    if (a === 192 && b === 168) return true;                              // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;                    // CGNAT 100.64/10
    if (a === 192 && b === 0 && c === 0) return true;                     // 192.0.0/24
    if (a >= 224) return true;                                             // multicast + reserved
    return false;
  }
  // IPv6
  const t = ip.text;
  if (t === '::' || t === '::1') return true;
  if (t.startsWith('fe80') || t.startsWith('fc') || t.startsWith('fd')) return true; // link-local + ULA
  return false;
}

const BLOCKED_NAMES = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback|host\.docker\.internal|metadata\.google\.internal)$/i;

/**
 * Pastikan URL aman untuk di-fetch server: hanya http/https, dan host bukan
 * alamat privat maupun nama host lokal. Melempar Error bila tidak aman.
 */
export function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new Error('URL tidak valid');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Hanya http/https yang diizinkan');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('Host kosong');
  if (BLOCKED_NAMES.test(host)) throw new Error('Host lokal diblokir');
  if (/\.(local|internal|localhost|home\.arpa)$/i.test(host)) throw new Error('Host lokal diblokir');
  if (isPrivateIp(parseIp(host))) throw new Error('Host lokal diblokir');
  return u;
}

/**
 * Unduh sumber gambar ke Buffer dengan batas ukuran.
 *
 * Redirect ditangani manual: setiap hop divalidasi ulang dengan assertSafeUrl
 * supaya host publik tidak bisa mengarahkan server ke jaringan privat.
 */
export async function download(url, { maxBytes = 40 * 1024 * 1024, timeout = FETCH_TIMEOUT, maxHops = 5 } = {}) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeout);
  try {
    let current = assertSafeUrl(url).toString();
    let res;
    for (let hop = 0; ; hop++) {
      res = await fetch(current, {
        signal: ac.signal,
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      });
      // 3xx + Location -> putuskan sendiri, jangan biarkan fetch otomatis mengikuti.
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
        if (hop >= maxHops) throw new Error('Terlalu banyak redirect');
        const next = new URL(res.headers.get('location'), current);
        assertSafeUrl(next); // validasi SETIAP hop
        current = next.toString();
        continue;
      }
      break;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > maxBytes) throw new Error(`File terlalu besar (${(len / 1048576).toFixed(1)}MB)`);

    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) throw new Error('File melebihi batas ukuran');
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), type: res.headers.get('content-type') || 'image/jpeg' };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout mengunduh gambar');
    throw e;
  } finally {
    clearTimeout(to);
  }
}

/* ------------------------- deteksi waifu2x ------------------------- */

/**
 * Cari binary waifu2x. Path dari env selalu dicek; nama perintah di PATH
 * diverifikasi benar-benar ada supaya laporan status tidak berbohong.
 */
let waifu2xBin;
const CANDIDATES = [
  process.env.WAIFU2X_PATH,
  path.join(process.cwd(), 'tools', 'waifu2x-ncnn.exe'),
  path.join(process.cwd(), 'tools', 'waifu2x.exe'),
  path.join(process.cwd(), 'tools', 'waifu2x-ncnn'),
  'waifu2x-ncnn',
  'waifu2x-ncnn.exe',
  'waifu2x',
];

function which(cmd) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    return spawnSync(finder, [cmd], { encoding: 'utf8', windowsHide: true, timeout: 4000 }).stdout.trim();
  } catch {
    return '';
  }
}

export function waifu2xAvailable() {
  if (waifu2xBin !== undefined) return !!waifu2xBin;
  for (const c of CANDIDATES.filter(Boolean)) {
    const looksLikePath = /[\\/]/.test(c);
    if (looksLikePath) {
      if (fs.existsSync(c)) {
        waifu2xBin = c;
        return true;
      }
      continue;
    }
    const found = which(c);
    if (found) {
      waifu2xBin = found.split(/\r?\n/)[0];
      return true;
    }
  }
  waifu2xBin = null;
  return false;
}

function runWaifu2x(bin, inFile, outFile, scale) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-i', inFile, '-o', outFile, '-s', String(scale), '-n', '-f', 'png'], {
      windowsHide: true,
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `exit ${code}`))));
  });
}

/* --------------------------- profile sharpen --------------------------- */

/**
 * Profil penajaman, dari yang paling ringan ke paling tegas untuk garis anime:
 *  - none  : resize Lanczos3 biasa
 *  - waifu2x: denoise median lalu crisp (pendekatan gaya waifu2x)
 *  - anime : penajaman agresif, garis paling tegas
 */
const PROFILES = {
  none: null,
  waifu2x: { denoise: 3, sharpen: { sigma: 1.1, m1: 0.7, m2: 1.6, x1: 2, y2: 10, y3: 18 } },
  anime: { denoise: 1, sharpen: { sigma: 1.7, m1: 1.1, m2: 2.4, x1: 2, y2: 12, y3: 24 } },
};

export const UPSCALE_PROFILE = PROFILES;

/* ------------------------------ pipeline ------------------------------ */

/**
 * Normalisasi dimensi. 0 / NaN / negatif berarti "tidak ditentukan" dan
 * dikembalikan apa adanya sebagai 0 — bukan dipaksa jadi 1, karena angka 1
 * membuat sharp menghasilkan gambar 1x1.
 */
const clampDim = (n) => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, MAX_OUTPUT_PX);
};

/* --------------------------------- crop --------------------------------- */

/**
 * Luas crop minimum sebagai fraksi dari tiap sisi gambar.
 *
 * Crop 100x100 dari wallpaper 4000px Technically "valid" bagi sharp, tapi
 * hasilnya bukan wallpaper — hanya thumbnail. Karena itu area terlalu kecil
 * ditolak dengan 400, bukan diam-diam menghasilkan gambar kecil.
 */
export const MIN_CROP_FRAC = 0.15;

/** Sisi terpendek hasil crop yang masih layak (piksel). */
export const MIN_CROP_PX = 320;

/** Pecahan 0..1; kembalikan null bila bukan angka. */
const asFrac = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : null;
};

/**
 * Ubah crop (fraksi 0..1) menjadi kotak piksel untuk sharp.
 *
 * @param {{width?:number,height?:number}} meta  metadata gambar sumber
 * @param {{x:number,y:number,w:number,h:number}|null} crop
 * @returns {{left:number,top:number,width:number,height:number}|null}
 * @throws {Error} bila crop tidak valid atau terlalu kecil (menjadi HTTP 400).
 */
export function resolveCrop(meta, crop) {
  if (!crop) return null;

  const x = asFrac(crop.x);
  const y = asFrac(crop.y);
  const w = asFrac(crop.w);
  const h = asFrac(crop.h);
  if (x === null || y === null || w === null || h === null) {
    throw new Error('Crop tidak valid: cx/cy/cw/ch harus angka 0..1');
  }
  if (w < MIN_CROP_FRAC || h < MIN_CROP_FRAC) {
    throw new Error(
      `Crop tidak valid: minimal ${Math.round(MIN_CROP_FRAC * 100)}% per sisi (minimal ${MIN_CROP_PX}px)`
    );
  }
  if (x + w > 1 + 1e-6 || y + h > 1 + 1e-6) {
    throw new Error('Crop tidak valid: area keluar dari gambar');
  }

  const srcW = meta?.width || 0;
  const srcH = meta?.height || 0;
  const left = Math.round(x * srcW);
  const top = Math.round(y * srcH);
  const width = Math.min(Math.round(w * srcW), srcW - left);
  const height = Math.min(Math.round(h * srcH), srcH - top);

  if (width < MIN_CROP_PX || height < MIN_CROP_PX) {
    throw new Error(`Crop tidak valid: hasil minimal ${MIN_CROP_PX}×${MIN_CROP_PX}px (gambar ${srcW}×${srcH})`);
  }
  return { left, top, width, height };
}

/**
 * @param {Buffer} buffer  gambar sumber
 * @param {object} opt
 *   w,h            target size (opsional)
 *   mode           cover | contain | width | height | raw
 *   upscale        none | waifu2x | anime
 *   fm             webp | jpg | png (default: jpg, png bila ada alpha)
 *   quality        1-100 (default 92)
 *   crop           {x,y,w,h} fraksi 0..1 (opsional), dipakai sebelum resize
 */
export async function transform(buffer, opt = {}) {
  const meta = await sharp(buffer).metadata();
  const crop = resolveCrop(meta, opt.crop);
  // Kalau sudah dicrop, "ukuran asal" untuk keperluan upscale adalah area crop.
  const srcW = crop ? crop.width : meta.width || 0;
  const srcH = crop ? crop.height : meta.height || 0;
  const mode = opt.mode || 'contain';

  // `upscale=auto`: naikkan kualitas hanya kalau target memang lebih besar
  // dari sumber. Kalau tidak, resize biasa saja — tidak ada gunanya
  // menajamkan gambar yang hanya diperkecil.
  let profile;
  if (opt.upscale === 'auto') {
    const tw = clampDim(opt.w);
    const th = clampDim(opt.h);
    const needUp = mode !== 'raw' && tw > 0 && th > 0 && (srcW < tw || srcH < th);
    profile = needUp ? PROFILES.waifu2x : null;
  } else {
    profile = PROFILES[opt.upscale] || null;
  }

  // 1. Resize target
  const w = clampDim(opt.w);
  const h = clampDim(opt.h);
  let resize = null;

  if (mode === 'raw') {
    resize = null; // unduh apa adanya
  } else if (!w && !h) {
    // Tanpa target: kalau diminta upscale, perbesar sebesar faktor `scale`
    // (meniru semantik waifu2x). Tanpa itu, kirim ulang resolusi asli.
    const factor = Math.min(Math.max(Number(opt.scale) || 0, 0), 8);
    if (profile && factor > 1 && srcW && srcH) {
      resize = { width: clampDim(srcW * factor), height: clampDim(srcH * factor), kernel: 'lanczos3' };
    }
  } else if (w && h) {
    resize = mode === 'cover'
      ? { width: w, height: h, fit: 'cover', position: 'attention', kernel: 'lanczos3' }
      : mode === 'height' || mode === 'width'
        ? (mode === 'width'
            ? { width: w, kernel: 'lanczos3' }
            : { height: h, kernel: 'lanczos3' })
        : { width: w, height: h, fit: 'contain', background: { r: 12, g: 13, b: 20, alpha: 1 }, kernel: 'lanczos3' };
  } else if (w) {
    // Hanya lebar: kunci lebar, tinggi mengikuti aspect ratio.
    resize = { width: w, kernel: 'lanczos3' };
  } else {
    // Hanya tinggi.
    resize = { height: h, kernel: 'lanczos3' };
  }

  const upscaling = !!resize && (srcW < (resize.width || srcW) || srcH < (resize.height || srcH));

  // 2. Composite hasil resize (crop dulu, lalu denoise sebelum upscale,
  //    lalu sharpen sesudahnya)
  let img = sharp(buffer, { failOn: 'none' });
  if (crop) img = img.extract(crop);
  if (profile?.denoise && upscaling) img = img.median(profile.denoise);
  if (resize) img = img.resize(resize);

  let out;
  if (profile?.sharpen && upscaling) {
    const sharpened = await img.clone().toBuffer();
    out = sharp(sharpened).sharpen(profile.sharpen);
  } else {
    out = img;
  }

  // 3. Encode
  const hasAlpha = !!meta.hasAlpha;
  const fm = opt.fm || (hasAlpha ? 'png' : 'jpg');
  const q = Math.min(Math.max(Number(opt.quality) || 92, 40), 100);
  if (fm === 'png') out = out.png({ compressionLevel: 9 });
  else if (fm === 'webp') out = out.webp({ quality: q, effort: 4 });
  else out = out.jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:4:4' });

  const { data, info } = await out.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    contentType: `image/${fm === 'jpg' ? 'jpeg' : fm}`,
    info,
    upscaled: upscaling && !!profile,
    source: { width: srcW, height: srcH },
  };
}

/** Render lengkap: download -> (opsional waifu2x asli) -> transform. */
export async function render(url, opt = {}) {
  // Mode 'auto' hanya boils down ke sharpen; binary waifu2x tidak dipakai
  // supaya hasilnya konsisten dengan fallback yang dipakai server.
  const wantsRealW2x = opt.upscale && opt.upscale !== 'none' && opt.upscale !== 'auto';

  // Coba binary waifu2x asli dulu bila diminta dan tersedia.
  // Lewati bila ada crop: crop hanya bisa di sharp, dan early-return di bawah
  // akan mengembalikan gambar mentah tanpa crop.
  if (wantsRealW2x && !opt.crop && waifu2xAvailable()) {
    try {
      const { buffer } = await download(url);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshiva-w2x-'));
      const inFile = path.join(tmp, 'in.png');
      const outFile = path.join(tmp, 'out.png');
      fs.writeFileSync(inFile, buffer);
      try {
        await runWaifu2x(waifu2xBin, inFile, outFile, opt.scale || 2);
        const upscaled = fs.readFileSync(outFile);
        const meta = await sharp(upscaled).metadata();
        if (!opt.w && !opt.h) {
          return {
            buffer: upscaled,
            contentType: 'image/png',
            info: { width: meta.width, height: meta.height },
            upscaled: true,
            engine: 'waifu2x-binary',
            source: await sharp(buffer).metadata().then((m) => ({ width: m.width, height: m.height })),
          };
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn('[img] waifu2x binary gagal, fallback sharp:', e.message);
    }
  }

  const { buffer } = await download(url);
  const res = await transform(buffer, opt);
  const engine =
    opt.upscale && opt.upscale !== 'none'
      ? res.upscaled
        ? 'sharp-waifu2x'
        : 'sharp'
      : 'sharp';
  return { ...res, engine };
}
