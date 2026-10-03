/**
 * Hoshiva - logo pipeline
 * Mengubah logo sumber (latar putih/solid) menjadi PNG transparan.
 *
 * Cara kerja:
 *  1. Baca logo, perkecil ke working size supaya flood-fill cepat.
 *  2. Flood-fill (BFS, toleransi warna) dari 4 sudut untuk menandai latar.
 *  3. Ubah piksel latar -> alpha 0, tepihalo -> alpha partial (anti-alias).
 *  4. Upscale kembali ke ukuran asli memakai Lanczos3 (bikin halus).
 *  5. Tulis logo.png (ukuran asli) + logo-512.png + favicon.png.
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC = process.argv[2] || 'C:/Users/Pongo/Downloads/Logo Hoshiva.png';
const WORK = 720; // sisi maksimal untuk analisis
const TOL = 42; // toleransi kemiripan warna dengan background (0-255)
const MIN_ALPHA = 26; // alpha minimum agar tepi tidak revoke

const isBgLike = (r, g, b, ref, tol) => {
  const d = (r - ref.r) ** 2 + (g - ref.g) ** 2 + (b - ref.b) ** 2;
  return d <= tol * tol * 3;
};

async function main() {
  const meta = await sharp(SRC).metadata();
  console.log(`[logo] source: ${meta.width}x${meta.height} ${meta.format}`);

  // 1. Sample warna background dari 4 sudut
  const thumb = await sharp(SRC)
    .resize({ width: WORK, height: WORK, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels } = thumb.info;
  const px = thumb.data;
  const idx = (x, y) => (y * w + x) * channels;
  const corners = [idx(0, 0), idx(w - 1, 0), idx(0, h - 1), idx(w - 1, h - 1)];
  const bg = {
    r: corners.reduce((s, i) => s + px[i], 0) / 4,
    g: corners.reduce((s, i) => s + px[i + 1], 0) / 4,
    b: corners.reduce((s, i) => s + px[i + 2], 0) / 4,
  };
  console.log(`[logo] bg rgb(${bg.r.toFixed(0)},${bg.g.toFixed(0)},${bg.b.toFixed(0)}) on ${w}x${h}`);

  // 2. Flood-fill dari 4 sudut
  const bgMask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (x, y) => {
    const p = y * w + x;
    if (bgMask[p]) return;
    const i = idx(x, y);
    if (!isBgLike(px[i], px[i + 1], px[i + 2], bg, TOL)) return;
    bgMask[p] = 1;
    queue[tail++] = p;
  };
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) push(x, y);

  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const bgCount = bgMask.reduce((s, v) => s + v, 0);
  console.log(`[logo] background flood-filled: ${((bgCount / (w * h)) * 100).toFixed(1)}%`);

  // 3. Alpha map: background 0, subjects opaque, tepi di soften
  const alpha = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = bgMask[p] ? 0 : 255;
  // Soft edge: piksel non-bg yang bertetangga bg dibuat semi transparan
  const soft = Uint8Array.from(alpha);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (bgMask[p]) continue;
      let n = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (bgMask[p + dy * w + dx]) n++;
      if (n) soft[p] = Math.max(MIN_ALPHA, 255 - n * 70);
    }
  }

  // 4. Tulis RGBA di working size
  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const s = idx(p % w, (p / w) | 0);
    const d = p * 4;
    rgba[d] = px[s];
    rgba[d + 1] = px[s + 1];
    rgba[d + 2] = px[s + 2];
    rgba[d + 3] = soft[p];
  }

  // 5. Trim area kosong lalu kembalikan ke ukuran asli + lossless
  const trimmed = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 12 })
    .png()
    .toBuffer();
  const tm = await sharp(trimmed).metadata();
  console.log(`[logo] trimmed: ${tm.width}x${tm.height} (dari ${w}x${h})`);

  const base = sharp(trimmed)
    .resize({
      width: Math.min(meta.width, tm.width * 2),
      height: Math.min(meta.height, tm.height * 2),
      fit: 'inside',
      withoutEnlargement: false,
      kernel: 'lanczos3',
    })
    .png({ compressionLevel: 9, palette: false });

  const outDir = path.join(ROOT, 'public', 'assets');
  const targets = [
    [path.join(outDir, 'logo.png'), null],
    [path.join(outDir, 'logo-512.png'), 512],
  ];

  for (const [out, size] of targets) {
    let img = base.clone();
    if (size) img = img.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
    const info = await img.toFile(out);
    console.log(`[logo] wrote ${path.relative(ROOT, out)} ${info.width}x${info.height} ${(info.size / 1024).toFixed(1)}kb`);
  }

  // Favicon: wordmark dijaga utuh di dalam kanvas persegi (contain + padding)
  const inner = await sharp(trimmed)
    .resize({ width: 88, height: 88, fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const padX = Math.max(0, Math.floor((96 - inner.info.width) / 2));
  const padY = Math.max(0, Math.floor((96 - inner.info.height) / 2));
  const fav = await sharp(inner.data)
    .extend({
      top: padY,
      bottom: 96 - inner.info.height - padY,
      left: padX,
      right: 96 - inner.info.width - padX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, 'public', 'favicon.png'));
  console.log(`[logo] wrote public/favicon.png ${fav.width}x${fav.height} ${(fav.size / 1024).toFixed(1)}kb`);

  // Sanity check: apakah hasil punya alpha benar-benar transparan?
  const check = await sharp(path.join(outDir, 'logo.png')).metadata();
  console.log(`[logo] done. alpha=${check.hasAlpha} channels=${check.channels}`);
}

main().catch((e) => {
  console.error('[logo] FAILED:', e.message);
  process.exit(1);
});
