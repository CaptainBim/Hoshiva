/**
 * Bangun logo varian TEMA GELAP dari file sumber berlatar solid.
 *
 * Sumbernya ada di src/logo terang.png. Folder src/ di-ignore git supaya
 * repo tetap ringan; setiap orang menaruh berkas kerja sendiri di sana.
 * Aslinya kanvas 2000x2000 dengan latar near-black, sementara yang dipakai
 * di header adalah wordmark lebar 3.51:1.
 *
 * Sumber bisa ditimpa lewat argumen pertama atau env HOSHIVA_LOGO_SRC.
 * Cara kerja (prinsip sama dengan scripts/make-logo.js):
 *   1. Sample warna latar dari 4 sudut.
 *   2. Flood-fill BFS dari 4 sudut -> hanya latar yang TERHUBUNG tepi yang
 *      dibuang. Kalau pakai keying global, bagian dalam huruf yang punya
 *      warna sama dengan latar akan ikut berlubang.
 *   3. Alpha 0 untuk latar, 255 untuk isi; tepi di-soft-kan.
 *   4. Un-premultiply terhadap warna latar supaya tepi tidak bergaris gelap.
 *   5. NAIKKAN luminansi isi (lihat MIN_L) supaya terbaca di latar gelap.
 *   6. Trim ke bounding box isi, lalu tulis logo-dark.png + logo-dark-512.png.
 */
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets');

const SRC = process.argv[2] || process.env.HOSHIVA_LOGO_SRC || path.join(ROOT, 'src', 'logo terang.png');
const TOL = 8; // toleransi kemiripan warna dengan latar (0-255)
const MIN_ALPHA = 26; // alpha minimum di tepi agar garis letter tak hilang

/**
 * Luminansi minimum (HSL) untuk isi logo yang berwarna, plus ambang
 * saturasi minimal agar sebuah piksel dianggap warna brand, bukan abu-abu.
 *
 * Kenapa ini perlu. Script aslinya hanya membuang latar; semua warna di
 * dalam huruf ikut terbawa apa adanya. Padahal artwork itu cyan gelap
 * rgb(0,96,256) yang hanya reads 3.9:1 di atas rgb(8,8,15). Di footer yang
 * opacity-nya dikurangi, cyan itu efektif tinggal 2.2:1 - praktis tak
 * terlihat. Syndromnya: 24% pixel putih tetap terang, jadi pengukuran
 * kontras yang memakai pixel putih terlihat bagus, padahal 59% logo
 * (cyan) lenyap di latar hampir hitam.
 *
 * Yang dipakai di sini adalah HSL lightness, bukan luminansi WCAG. Keduanya
 * jauh berbeda untuk warna jenuh: cyan rgb(0,96,256) punya HSL L=0,50 tapi
 * luminansi WCAG hanya 0,156, karena biru hanya menyumbang 0,0722.
 * Menilai dengan HSL L saja akan salah.
 *
 * Lift hanya kena piksel jenuh; Hue dan Saturation tetap utuh. Kalau semua
 * piksel dinaikkan, accent rgb(32,32,32) ikut jadi abu-abu terang dan
 * muncul bercak di sekeliling huruf.
 *
 * Kenapa 0,65 dan bukan lebih tinggi. Ada dua syarat yang harus terpenuhi
 * bersamaan, dan keduanya berlawanan arah:
 *
 *   - cyan harus terbaca di latar gelap            (kontras eksternal)
 *   - bentuk putih harus tetap terpisah dari cyan   (kontras internal)
 *
 * Peta spasial logo menunjukkan kolom ke-4 sekitar 97% putih di keempat
 * baris, jadi putih itu elemen tersendiri di tengah wordmark, bukan
 * highlight tipis di dalam huruf. Menaikkan cyan terlalu jauh membuat
 * putih dan cyan berdekatan.
 *
 * Angka di bawah diukur pada aset yang benar-benar di-deploy, bukan pada
 * tebakan. Dua metrik, dua kondisi ukur:
 *
 *   - cyan/latar dan sebaran kontras: ukuran render footer yang sebenarnya,
 *     105x30, hanya piksel inti alpha>=128, opacity 0,70, latar rgb(8,8,15).
 *     Downscaling 4,9x itu sendiri mengubah kontras, jadi angka pada file
 *     512x146 akan terlalu optimistis.
 *   - putih/cyan (kontras internal): resolusi native, karena downscale tidak
 *     boleh ikut Responsibilities dalam penilaian batas antar-warna.
 *
 *   MIN_L   cyan/latar   >= 3:1   >= 4,5:1   putih/cyan   cyan jadi
 *   (asis)     2.2:1      -          -          5.1:1     rgb(0,96,256)
 *   0,58       4.96:1   92.6%       28%         3.98:1     rgb(52,126,243)
 *   0,65       4.95:1   92.6%       27%         3.08:1     rgb(86,147,245)
 *
 * 0,65 dipilih karena kontras internalnya 3,08:1 masih di atas 3:1, jadi
 * bentuk putih tidak menyatu dengan sian pada 30px. Nilai 0,72 ke atas
 * ditolak: putih/cyan turun ke sekitar 2,4:1 atau kurang.
 *
 * Sisa sekitar 3% piksel yang tetap di bawah 1,5:1 adalah accent
 * rgb(32,32,32). Di sumber aslinya accent itu juga tidak terlihat di atas
 * rgb(25,25,25), jadi bukan bagian dari desain yang dirasakan.
 *
 * Sisa sekitar 3% yang tetap tak terlihat adalah accent rgb(32,32,32).
 * Di sumber aslinya itu juga tak terlihat di atas rgb(25,25,25), jadi
 * bukan bagian dari desain yang dirasakan.
 */
const MIN_L = 0.65;
const MIN_SAT = 0.15;

/* ------------------------------ warna ------------------------------ */

const dist2 = (r, g, b, ref) => (r - ref.r) ** 2 + (g - ref.g) ** 2 + (b - ref.b) ** 2;
const TOL2 = TOL * TOL * 3;

/** RGB (0..255) -> HSL; h in degrees, s dan l 0..1. */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** HSL -> RGB (0..255). */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`Sumber tidak ditemukan: ${SRC}`);

  const meta = await sharp(SRC).metadata();
  console.log(`[logo-dark] sumber: ${meta.width}x${meta.height} ${meta.format}`);

  // 1. Sample latar dari 4 sudut.
  const raw = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const { width: W, height: H, channels: C } = info;
  const at = (x, y) => (y * W + x) * C;
  const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
  const bg = {
    r: corners.reduce((s, i) => s + data[i], 0) / 4,
    g: corners.reduce((s, i) => s + data[i + 1], 0) / 4,
    b: corners.reduce((s, i) => s + data[i + 2], 0) / 4,
  };
  console.log(`[logo-dark] latar rgb(${bg.r.toFixed(0)},${bg.g.toFixed(0)},${bg.b.toFixed(0)})`);

  // 2. Flood-fill dari 4 sudut.
  const mask = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const push = (x, y) => {
    const p = y * W + x;
    if (mask[p]) return;
    const i = p * C;
    if (dist2(data[i], data[i + 1], data[i + 2], bg) > TOL2) return;
    mask[p] = 1;
    queue[tail++] = p;
  };
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) push(x, y);
  while (head < tail) {
    const p = queue[head++];
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  const bgCount = mask.reduce((s, v) => s + v, 0);
  console.log(`[logo-dark] latar ter-flood: ${((bgCount / (W * H)) * 100).toFixed(1)}%`);

  // 3. Alpha map + un-premultiply pada tepi.
  const rgba = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const s = p * C;
    const d = p * 4;
    if (mask[p]) {
      rgba[d + 3] = 0;
      continue;
    }
    // Berapa banyak tetangga yang sudah jadi latar (menandai tepi).
    const x = p % W;
    const y = (p / W) | 0;
    let edge = 0;
    if (x === 0 || x === W - 1 || y === 0 || y === H - 1) edge = 1;
    else {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (mask[p + dy * W + dx]) edge++;
    }
    const a = edge ? Math.max(MIN_ALPHA, 255 - edge * 70) / 255 : 1;
    // Un-premultiply: sumber masih "tempat" latarnya, jadi tepi perlu
    // dikoreksi supaya tidak sisa garis gelap (fringing).
    const un = (c) => Math.round(Math.min(255, Math.max(0, (c - bg.r * (1 - a)) / a)));
    const r0 = un(data[s]);
    const g0 = un(data[s + 1]);
    const b0 = un(data[s + 2]);

    // 5. Naikkan luminansi isi yang berwarna (lihat MIN_L). Hue & saturasi
    //    tetap, jadi brand cyan tidak berubah jadi abu-abu.
    let [r, g, b] = [r0, g0, b0];
    const hsl = rgbToHsl(r0, g0, b0);
    if (hsl.s >= MIN_SAT && hsl.l < MIN_L) [r, g, b] = hslToRgb(hsl.h, hsl.s, MIN_L);

    rgba[d] = r;
    rgba[d + 1] = g;
    rgba[d + 2] = b;
    rgba[d + 3] = Math.round(a * 255);
  }

  // 4. Trim ke isi, lalu tulis PNG lossless.
  const trimmed = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .trim({ threshold: 10 })
    .png()
    .toBuffer();
  const tm = await sharp(trimmed).metadata();
  console.log(`[logo-dark] trim: ${tm.width}x${tm.height} (rasio ${(tm.width / tm.height).toFixed(2)}:1)`);

  const targets = [
    [path.join(OUT_DIR, 'logo-dark.png'), null],
    [path.join(OUT_DIR, 'logo-dark-512.png'), 512],
  ];
  for (const [out, size] of targets) {
    let img = sharp(trimmed).png({ compressionLevel: 9 });
    if (size) img = img.resize({ width: size, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' });
    const info = await img.toFile(out);
    console.log(`[logo-dark] tulis ${path.relative(ROOT, out)} ${info.width}x${info.height} ${(info.size / 1024).toFixed(1)}kb`);
  }

  const check = await sharp(path.join(OUT_DIR, 'logo-dark.png')).metadata();
  console.log(`[logo-dark] selesai. alpha=${check.hasAlpha} channels=${check.channels}`);
}

main().catch((e) => {
  console.error('[logo-dark] GAGAL:', e.message);
  process.exit(1);
});