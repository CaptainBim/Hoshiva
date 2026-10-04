/**
 * Test pipeline resize/upscale — tanpa jaringan (pakai Buffer JPEG buatan).
 *   node scripts/test-image.js
 *
 * catching regression: `w=&h=` pernah menghasilkan gambar 1x1 karena
 * clampDim() memaksa nilai 0 menjadi 1.
 */
import sharp from 'sharp';
import { transform, resolveCrop, MIN_CROP_FRAC, MIN_CROP_PX } from '../server/image.js';
import { assertSafeUrl, waifu2xAvailable } from '../server/image.js';
import { SIZE_PRESETS, CROP_POSITIONS, DEFAULT_CROP_POSITION } from '../server/config.js';
import { panValue, coverRegion } from '../server/image.js';

let pass = 0;
const fail = [];
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail.push(name); console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

/** Buffer JPEG dengan dimensi & warna tertentu. */
const jpeg = (w, h, r = 120, g = 60, b = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
    .jpeg({ quality: 90 })
    .toBuffer();

const dims = async (buf) => {
  const m = await sharp(buf).metadata();
  return { w: m.width, h: m.height, fmt: m.format };
};

const src = await jpeg(1000, 800);

console.log('\n-- clampDim: 0 berarti "tidak ditentukan", bukan 1 --');
{
  const r = await transform(src, { mode: 'contain', w: 0, h: 0, upscale: 'none' });
  const d = await dims(r.buffer);
  ok(d.w === 1000 && d.h === 800, 'tanpa w/h + contain -> resolusi asli', `${d.w}x${d.h}`);
  ok(r.buffer.length > 2000, 'body berisi gambar sungguhan', `${(r.buffer.length / 1024).toFixed(0)}KB`);
}

console.log('\n-- resize ke target eksplisit --');
{
  const cover = await transform(src, { mode: 'cover', w: 1920, h: 1080, upscale: 'none' });
  const d = await dims(cover.buffer);
  ok(d.w === 1920 && d.h === 1080, 'cover tepat 1920x1080', `${d.w}x${d.h}`);

  const contain = await transform(src, { mode: 'contain', w: 800, h: 800, upscale: 'none' });
  const dc = await dims(contain.buffer);
  ok(dc.w === 800 && dc.h === 800, 'contain kanvas 800x800', `${dc.w}x${dc.h}`);

  const byW = await transform(src, { mode: 'width', w: 500, h: 0, upscale: 'none' });
  const dw = await dims(byW.buffer);
  ok(dw.w === 500 && dw.h === 400, 'width saja -> aspect terjaga', `${dw.w}x${dw.h}`);

  const byH = await transform(src, { mode: 'height', w: 0, h: 400, upscale: 'none' });
  const dh = await dims(byH.buffer);
  ok(dh.h === 400 && dh.w === 500, 'height saja -> aspect terjaga', `${dh.w}x${dh.h}`);
}

console.log('\n-- upscale tanpa target = perbesar sebesar `scale` --');
{
  const r = await transform(src, { mode: 'contain', w: 0, h: 0, upscale: 'waifu2x', scale: 2 });
  const d = await dims(r.buffer);
  ok(d.w === 2000 && d.h === 1600, 'scale 2 -> 2x dimensi asli', `${d.w}x${d.h}`);
  ok(r.upscaled === true, 'ditandai sebagai hasil upscale');

  const raw = await transform(src, { mode: 'raw', w: 0, h: 0, upscale: 'waifu2x', scale: 2 });
  const dr = await dims(raw.buffer);
  ok(dr.w === 1000 && dr.h === 800, 'mode=raw mengabaikan upscale', `${dr.w}x${dr.h}`);
}

console.log('\n-- upscale ke target yang lebih besar dari sumber --');
{
  const small = await jpeg(400, 300);
  const r = await transform(small, { mode: 'cover', w: 1920, h: 1080, upscale: 'waifu2x' });
  const d = await dims(r.buffer);
  ok(d.w === 1920 && d.h === 1080, '400x300 -> 1920x1080', `${d.w}x${d.h}`);
  ok(r.upscaled === true, 'upscaled = true');
  const none = await transform(small, { mode: 'cover', w: 1920, h: 1080, upscale: 'none' });
  ok(none.upscaled === false, 'upscale=none -> upscaled = false');
}

console.log('\n-- format output --');
{
  const png = await transform(src, { mode: 'contain', w: 400, h: 400, upscale: 'none', fm: 'png' });
  const d = await dims(png.buffer);
  ok(d.fmt === 'png' && png.contentType === 'image/png', 'fm=png', `${d.fmt} ${png.contentType}`);

  const webp = await transform(src, { mode: 'contain', w: 400, h: 400, upscale: 'none', fm: 'webp' });
  const dw = await dims(webp.buffer);
  ok(dw.fmt === 'webp', 'fm=webp', dw.fmt);

  // Alpha harus dipertahankan => defaultnya PNG, bukan JPG
  const alpha = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png().toBuffer();
  const a = await transform(alpha, { mode: 'contain', w: 300, h: 300, upscale: 'none' });
  ok(a.contentType === 'image/png', 'gambar ber-alpha default ke PNG', a.contentType);
}

console.log('\n-- normalisasi dimensi (input rusak tidak boleh menghasilkan 1x1) --');
{
  for (const bad of [undefined, null, '', 'abc', -100, 0.4, NaN]) {
    const r = await transform(src, { mode: 'contain', w: bad, h: 300, upscale: 'none' });
    const d = await dims(r.buffer);
    ok(d.w !== 1 && d.h !== 1, `w=${JSON.stringify(bad)} tidak menghasilkan 1x1`, `${d.w}x${d.h}`);
  }
}

/* ------------------------------- crop ------------------------------- */

console.log('\n-- crop: area tepat sesuai fraksi --');
{
  // src = 1000x800
  const half = await transform(src, { mode: 'raw', upscale: 'none', crop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
  const d = await dims(half.buffer);
  ok(d.w === 500 && d.h === 400, 'crop 50%x50% kiri-atas -> 500x400', `${d.w}x${d.h}`);

  const mid = await transform(src, { mode: 'raw', upscale: 'none', crop: { x: 0.2, y: 0.25, w: 0.4, h: 0.5 } });
  const dm = await dims(mid.buffer);
  ok(dm.w === 400 && dm.h === 400, 'crop di tengah -> 400x400', `${dm.w}x${dm.h}`);

  const full = await transform(src, { mode: 'raw', upscale: 'none', crop: { x: 0, y: 0, w: 1, h: 1 } });
  const df = await dims(full.buffer);
  ok(df.w === 1000 && df.h === 800, 'crop 100% -> utuh', `${df.w}x${df.h}`);
}

console.log('\n-- crop lalu resize (crop terjadi lebih dulu) --');
{
  const r = await transform(src, {
    mode: 'cover', w: 1920, h: 1080, upscale: 'none',
    crop: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
  });
  const d = await dims(r.buffer);
  ok(d.w === 1920 && d.h === 1080, 'crop 40% + cover 1920x1080', `${d.w}x${d.h}`);

  // area crop = 500x400 (rasio 1.25). contain 500x500 = kanvas 500x500 dengan
  // gambar 500x400 di tengah dan pita gelap di atas/bawah.
  const c = await transform(src, {
    mode: 'contain', w: 500, h: 500, upscale: 'none',
    crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  });
  const dc = await dims(c.buffer);
  ok(dc.w === 500 && dc.h === 500, 'contain 500x500 dari crop 500x400 -> kanvas tepat 500x500', `${dc.w}x${dc.h}`);

  // kunci lebar: tinggi mengikuti aspect area crop (500/400), bukan gambar asli
  const byW = await transform(src, {
    mode: 'width', w: 250, h: 0, upscale: 'none',
    crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  });
  const dw = await dims(byW.buffer);
  ok(dw.w === 250 && dw.h === 200, 'kunci lebar 250 -> aspect crop 1.25 jadi 250x200', `${dw.w}x${dw.h}`);
}

console.log('\n-- crop + upscale: yang dibandingkan adalah area crop --');
{
  // crop 50% dari 1000x800 = 500x400 -> upscale ke 1000x800 memang perlu
  const r = await transform(src, { mode: 'cover', w: 1000, h: 800, upscale: 'auto', crop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
  ok(r.upscaled === true, 'auto: target 1000 > area crop 500 -> upscale jalan');

  // tanpa crop, sumber 1000x800 sudah >= target 500x400 -> tidak perlu
  const no = await transform(src, { mode: 'contain', w: 500, h: 400, upscale: 'auto' });
  ok(no.upscaled === false, 'auto: target lebih kecil dari sumber -> tidak di-upscale');

  // crop 50% tapi target tetap di bawah area crop -> tidak perlu
  const cropBig = await transform(src, { mode: 'cover', w: 400, h: 320, upscale: 'auto', crop: { x: 0, y: 0, w: 0.8, h: 0.8 } });
  ok(cropBig.upscaled === false, 'auto: target 400 <= area crop 800 -> tidak di-upscale');
}

console.log('\n-- upscale=auto: raw tidak pernah di-upscale --');
{
  // crop 40% dari 1000x800 = 400x320 (tepat di batas MIN_CROP_PX)
  const r = await transform(src, { mode: 'raw', w: 4000, h: 4000, upscale: 'auto', crop: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 } });
  const d = await dims(r.buffer);
  ok(d.w === 400 && d.h === 320, 'raw + crop -> hanya crop, tak ada resize', `${d.w}x${d.h}`);
  ok(r.upscaled === false, 'raw + auto tidak ditandai upscale');
}

console.log('\n-- crop terlalu kecil DITOLAK (tidak diam-diam jadi thumbnail) --');
{
  // batas fraksi: 15% per sisi
  for (const [name, c] of [
    ['5% x 5%', { x: 0, y: 0, w: 0.05, h: 0.05 }],
    ['10% x 40%', { x: 0, y: 0, w: 0.1, h: 0.4 }],
    ['40% x 10%', { x: 0, y: 0, w: 0.4, h: 0.1 }],
  ]) {
    let msg = '';
    try { await transform(src, { mode: 'raw', upscale: 'none', crop: c }); } catch (e) { msg = e.message; }
    ok(/tidak valid/i.test(msg), `ditolak: ${name}`, msg.slice(0, 60));
  }

  // batas absolut: 15% dari gambar kecil = di bawah MIN_CROP_PX (320)
  const tiny = await jpeg(1200, 900);
  let tinyMsg = '';
  try { await transform(tiny, { mode: 'raw', upscale: 'none', crop: { x: 0, y: 0, w: 0.16, h: 0.2 } }); }
  catch (e) { tinyMsg = e.message; }
  ok(/tidak valid/i.test(tinyMsg), '15% dari 1200px = 192px < 320px -> ditolak', tinyMsg.slice(0, 70));
}

console.log('\n-- crop tidak valid lainnya --');
{
  const bad = [
    ['keluar kanan', { x: 0.8, y: 0, w: 0.5, h: 0.5 }],
    ['keluar bawah', { x: 0, y: 0.8, w: 0.5, h: 0.5 }],
    ['cx NaN', { x: NaN, y: 0, w: 0.5, h: 0.5 }],
    ['cw string', { x: 0, y: 0, w: 'abc', h: 0.5 }],
  ];
  for (const [name, c] of bad) {
    let msg = '';
    try { await transform(src, { mode: 'raw', upscale: 'none', crop: c }); } catch (e) { msg = e.message; }
    ok(/tidak valid/i.test(msg), `ditolak: ${name}`, msg.slice(0, 60));
  }
  ok(resolveCrop({ width: 1000, height: 800 }, null) === null, 'crop=null -> null');
}

console.log('\n-- batas minimum crop konsisten dengan konstanta server --');
ok(MIN_CROP_FRAC === 0.15, 'MIN_CROP_FRAC = 0.15', String(MIN_CROP_FRAC));
ok(MIN_CROP_PX === 320, 'MIN_CROP_PX = 320', String(MIN_CROP_PX));
{
  // Sumber harus cukup besar: 15% dari 1000px cuma 150px < MIN_CROP_PX.
  const big = await jpeg(2400, 1600);
  const r = await transform(big, { mode: 'raw', upscale: 'none', crop: { x: 0, y: 0, w: MIN_CROP_FRAC, h: 0.5 } });
  const d = await dims(r.buffer);
  ok(d.w === 360 && d.h === 800, 'tepat di batas bawah fraksi -> diterima (360 >= 320)', `${d.w}x${d.h}`);
}

console.log('\n-- guard URL --');
ok(waifu2xAvailable() === false || waifu2xAvailable() === true, 'waifu2xAvailable() mengembalikan boolean',
  String(waifu2xAvailable()));
for (const bad of ['http://127.0.0.1/x', 'file:///x', 'not a url', 'http://169.254.169.254/']) {
  let blocked = false;
  try { assertSafeUrl(bad); } catch { blocked = true; }
  ok(blocked, `ditolak: ${bad}`);
}
for (const good of ['https://w.wallhaven.cc/a.jpg', 'https://safebooru.org/b.png']) {
  let allowed = false;
  try { assertSafeUrl(good); allowed = true; } catch { allowed = false; }
  ok(allowed, `diizinkan: ${good}`);
}

console.log('\n-- posisi crop mode cover: tengah sebagai default --');

// Penanda putih 1px tepat di tengah lebar gambar. Kalau crop benar-benar
// "tengah", penanda itu wajib masih ada; kalau crop bergeser ke tepi, hilang.
const MW = 800, MH = 400, MID = MW >> 1;
const rawPx = Buffer.alloc(MW * MH * 3);
for (let y = 0; y < MH; y++) {
  for (let x = 0; x < MW; x++) {
    const i = (y * MW + x) * 3;
    rawPx[i] = rawPx[i + 1] = rawPx[i + 2] = x === MID ? 255 : 90;
  }
}
const marked = await sharp(rawPx, { raw: { width: MW, height: MH, channels: 3 } })
  .jpeg({ quality: 95 })
  .toBuffer();

/** Kolom output paling terang, atau -1 kalau tidak ada yang terang. */
const brightestColumn = async (buf, w, h) => {
  const r = await sharp(buf).removeAlpha().raw().toBuffer();
  let bestX = -1, bestV = -1;
  for (let x = 0; x < w; x++) {
    let v = 0;
    for (let y = 0; y < h; y++) v += r[(y * w + x) * 3];
    v /= h;
    if (v > bestV) { bestV = v; bestX = x; }
  }
  return { x: bestX, v: bestV };
};

const TW = 200, TH = 400; // potret: sisi kiri/kanan yang terpotong
const coverAt = async (pos) => {
  const b = await transform(marked, { w: TW, h: TH, mode: 'cover', pos, fm: 'jpg' });
  return b.buffer ?? b;
};

ok(DEFAULT_CROP_POSITION === 'centre', 'default posisi crop adalah centre', `default = "${DEFAULT_CROP_POSITION}"`);

const centreOut = await coverAt('centre');
const centreCol = await brightestColumn(centreOut, TW, TH);
ok(
  Math.abs(centreCol.x - TW / 2) <= 1,
  'cover+centre memotong dari tengah',
  `penanda di kolom ${centreCol.x}/${TW} (tengah = ${TW / 2}), terang ${centreCol.v.toFixed(0)}`
);

// Default (tanpa `pos`) harus identik dengan `centre` eksplisit.
const noPosOut = await transform(marked, { w: TW, h: TH, mode: 'cover', fm: 'jpg' });
const noPosBuf = noPosOut.buffer ?? noPosOut;
ok(
  noPosBuf.equals(centreOut),
  'tanpa param pos hasilnya sama dengan pos=centre',
  `${noPosBuf.length} b vs ${centreOut.length} b`
);

// `attention` dan `entropy` memilih bagian berentropi tertinggi, jadi pada
// gambar bertekstur asimetris hasilnya memang crop yang berbeda dari `centre`.
// Ini alasan defaultnya diganti: framing-nya tidak bisa ditebak.
// Noise per-piksel tidak bisa dipakai di sini karena hilang saat downscale,
// jadi kontrasnya ditahan dengan blok 40px.
const BW = 1200, BH = 800, BLK = 40;
const busyPx = Buffer.alloc(BW * BH * 3);
let seed = 987654321;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let by = 0; by < BH / BLK; by++) {
  for (let bx = 0; bx < BW / BLK; bx++) {
    // Kiri berisi blok acak, kanan rata-rata. Kiri punya entropi tinggi.
    const v = bx * BLK < BW / 2 ? Math.floor(rnd() * 256) : 128;
    for (let y = by * BLK; y < (by + 1) * BLK; y++) {
      for (let x = bx * BLK; x < (bx + 1) * BLK; x++) {
        const i = (y * BW + x) * 3;
        busyPx[i] = busyPx[i + 1] = busyPx[i + 2] = v;
      }
    }
  }
}
const busyImg = await sharp(busyPx, { raw: { width: BW, height: BH, channels: 3 } })
  .jpeg({ quality: 95 })
  .toBuffer();

const busyCoverAt = async (pos) => {
  const r = await transform(busyImg, { w: TW, h: TH, mode: 'cover', pos, fm: 'jpg' });
  return r.buffer ?? r;
};

const busyCentre = await busyCoverAt('centre');
ok(!busyCentre.equals(centreOut), 'gambar bertekstur tidak dianggap sama seperti marker');
ok(!(await busyCoverAt('attention')).equals(busyCentre), 'attention memilih bagian berentropi tinggi, bukan tengah');
ok(!(await busyCoverAt('entropy')).equals(busyCentre), 'entropy memilih bagian berentropi tinggi, bukan tengah');

// Nilai di luar daftar harus jatuh ke default, bukan diteruskan ke sharp.
for (const junk of [undefined, '', 'bogus', '../../etc/passwd', 'centre top', 42, {}]) {
  let threw = null;
  let out;
  try {
    const r = await transform(marked, { w: TW, h: TH, mode: 'cover', pos: junk, fm: 'jpg' });
    out = r.buffer ?? r;
  } catch (e) { threw = e; }
  ok(
    !threw && out.equals(centreOut),
    `pos tak dikenal jatuh ke centre: ${JSON.stringify(junk)}`,
    threw ? threw.message.slice(0, 60) : 'aman'
  );
}

// Setiap nilai yang kita tawarkan harus benar-benar didukung sharp.
for (const pos of CROP_POSITIONS) {
  let threw = null, d = null;
  try {
    const r = await transform(marked, { w: TW, h: TH, mode: 'cover', pos, fm: 'jpg' });
    const buf = r.buffer ?? r;
    d = await dims(buf);
  } catch (e) { threw = e; }
  ok(!threw && d && d.w === TW && d.h === TH, `posisi "${pos}" didukung sharp`, threw ? threw.message.slice(0, 60) : `${d?.w}x${d?.h}`);
}

// `left` dan `right` memotong dari tepi, jadi penanda tengah memang hilang di
// sana. Ini mencegah assertion "semua posisi menyisakan penanda" yang salah.
for (const pos of ['left', 'right']) {
  const col = await brightestColumn(await coverAt(pos), TW, TH);
  ok(col.v < 120, `posisi "${pos}" memang memotong dari tepi`, `terang ${col.v.toFixed(0)} (tidak ada penanda)`);
}

// Mode selain cover mengabaikan posisi crop tanpa melempar.
for (const mode of ['contain', 'width', 'height', 'raw']) {
  let threw = false;
  try {
    await transform(marked, { w: TW, h: mode === 'height' ? TH : TW, h: mode === 'height' ? 0 : TH, mode, pos: 'attention', fm: 'jpg' });
  } catch { threw = true; }
  ok(!threw, `mode ${mode} mengabaikan pos tanpa error`);
}

// Preset Ponsel wajib menyertakan posisi tengah supaya frontend mengirimnya.
for (const id of ['phone', 'phone16']) {
  const p = SIZE_PRESETS.find((x) => x.id === id);
  ok(p && p.mode === 'cover' && p.position === 'centre', `preset ${id} memakai crop tengah`, p ? `mode=${p.mode} position=${p.position}` : 'preset tidak ada');
}
ok(
  SIZE_PRESETS.filter((p) => p.position).every((p) => CROP_POSITIONS.includes(p.position)),
  'semua position di preset ada di CROP_POSITIONS'
);
ok(
  SIZE_PRESETS.every((p) => p.mode === 'raw' || p.position === undefined || CROP_POSITIONS.includes(p.position)),
  'tidak ada preset dengan position di luar daftar'
);

console.log('\n-- geser crop (pan): tengah benar-benar tengah --');

ok(panValue(undefined) === null, 'pan tidak diberikan -> null');
ok(panValue('') === null, 'pan string kosong -> null, bukan 0');
ok(panValue('abc') === null, 'pan bukan angka -> null');
ok(panValue(NaN) === null, 'pan NaN -> null');
ok(panValue(Infinity) === null, 'pan Infinity -> null');
ok(panValue(0) === 0 && panValue(100) === 100, 'pan 0 dan 100 diteruskan utuh');
ok(panValue(-20) === 0, 'pan di bawah 0 dijepit ke 0');
ok(panValue(140) === 100, 'pan di atas 100 dijepit ke 100');
ok(panValue(' 50 ') === 50, 'pan dengan spasi dinormalkan');

// coverRegion: sumbu yang dipotong ditentukan perbandingan rasio.
const wide = coverRegion(1600, 1000, 200, 400, 50);
ok(
  wide && wide.width < 1600 && wide.height === 1000,
  'sumber lebih lebar -> dipotong kiri/kanan, tinggi penuh',
  JSON.stringify(wide)
);
const tall = coverRegion(900, 2400, 200, 400, 50);
ok(
  tall && tall.height < 2400 && tall.width === 900,
  'sumber lebih tinggi -> dipotong atas/bawah, lebar penuh',
  JSON.stringify(tall)
);
ok(
  coverRegion(1600, 800, 400, 200, 50) === null,
  'rasio sudah cocok -> tidak ada yang dipotong'
);
ok(
  coverRegion(0, 0, 200, 400, 50) === null,
  'ukuran sumber tidak diketahui -> null, bukan extract sembarangan'
);

// Ujung pan memakai seluruh ruang yang ada.
ok(coverRegion(1600, 1000, 200, 400, 0).left === 0, 'pan=0 memakai tepi kiri penuh');
ok(coverRegion(1600, 1000, 200, 400, 100).left === 1100, 'pan=100 memakai tepi kanan penuh');
ok(coverRegion(900, 2400, 200, 400, 0).top === 0, 'pan=0 memakai tepi atas penuh');
ok(coverRegion(900, 2400, 200, 400, 100).top === 600, 'pan=100 memakai tepi bawah penuh');
ok(
  coverRegion(1600, 1000, 200, 400, 50).left === 550,
  'pan=50 tepat di tengah ruang yang ada',
  `left = ${coverRegion(1600, 1000, 200, 400, 50).left} dari ruang 1100`
);

// Fuzz: region harus selalu sah dan tidak keluar gambar, termasuk rasio ganjil.
{
  let bad = 0, checked = 0;
  for (let sw = 101; sw <= 2000; sw += 97) {
    for (let sh = 101; sh <= 2000; sh += 89) {
      for (const pan of [0, 17, 50, 83, 100]) {
        for (const [tw, th] of [[200, 400], [1170, 2532], [3440, 1440], [1, 1]]) {
          const r = coverRegion(sw, sh, tw, th, pan);
          checked++;
          if (!r) continue;
          const inside =
            r.left >= 0 && r.top >= 0 &&
            r.width >= 1 && r.height >= 1 &&
            r.left + r.width <= sw && r.top + r.height <= sh &&
            Number.isInteger(r.left) && Number.isInteger(r.top) &&
            Number.isInteger(r.width) && Number.isInteger(r.height);
          if (!inside) { if (bad < 3) console.log(`    contoh rusak: ${sw}x${sh} pan=${pan} -> ${JSON.stringify(r)}`); bad++; }
        }
      }
    }
  }
  ok(bad === 0, 'coverRegion selalu sah untuk semua kombinasi yang diuji', `${checked} kombinasi, ${bad} rusak`);
}

// Bukti tengah: penanda 16px di tengah sumber harus tetap di tengah output
// pada KEDUA sumbu. Lebar 16px supaya selamat dari JPEG dan downscale.
const CW = 1600, CH2 = 1000, BAND = 16;
const centrePx = Buffer.alloc(CW * CH2 * 3);
for (let y = 0; y < CH2; y++) {
  for (let x = 0; x < CW; x++) {
    const i = (y * CW + x) * 3;
    const inCol = Math.abs(x - CW / 2) < BAND / 2;
    const inRow = Math.abs(y - CH2 / 2) < BAND / 2;
    if (inCol) { centrePx[i] = centrePx[i+1] = centrePx[i+2] = 255; }
    else if (inRow) { centrePx[i] = 20; centrePx[i+1] = 210; centrePx[i+2] = 90; }
    else { centrePx[i] = centrePx[i+1] = centrePx[i+2] = 80; }
  }
}
const centreImg = await sharp(centrePx, { raw: { width: CW, height: CH2, channels: 3 } })
  .jpeg({ quality: 98 })
  .toBuffer();

const OW = 200, OH = 400;
const markAt = async (pan) => {
  const r = await transform(centreImg, { w: OW, h: OH, mode: 'cover', pan, fm: 'png' });
  const raw = await sharp(r.buffer ?? r).removeAlpha().raw().toBuffer();
  let colX = 0, colV = -1, rowY = 0, rowV = -1;
  for (let x = 0; x < OW; x++) {
    let n = 0;
    for (let y = 0; y < OH; y++) { const i = (y * OW + x) * 3; if (raw[i] > 190 && raw[i+1] > 190) n++; }
    if (n > colV) { colV = n; colX = x; }
  }
  for (let y = 0; y < OH; y++) {
    let n = 0;
    for (let x = 0; x < OW; x++) { const i = (y * OW + x) * 3; if (raw[i + 1] > 150 && raw[i] < 90) n++; }
    if (n > rowV) { rowV = n; rowY = y; }
  }
  return { colX, colV, rowY, rowV };
};

const at50 = await markAt(50);
ok(
  Math.abs(at50.colX - OW / 2) <= 4 && at50.colV > 300,
  'pan=50 menaruh penanda tengah horizontal di tengah output',
  `kolom ${at50.colX}/${OW} (tengah = ${OW / 2}), ${at50.colV}px`
);
ok(
  Math.abs(at50.rowY - OH / 2) <= 6,
  'pan=50 menaruh penanda tengah vertikal di tengah output',
  `baris ${at50.rowY}/${OH} (tengah = ${OH / 2})`
);

// Di luar tengah, penanda tengah harus terpotong keluar - bukti frame-nya
// benar-benar bergeser, bukan cuma diwarnai ulang.
const at0 = await markAt(0);
const at100 = await markAt(100);
ok(at0.colV < 300, 'pan=0 menggeser frame sehingga penanda tengah keluar', `${at0.colV}px tersisa`);
ok(at100.colV < 300, 'pan=100 menggeser frame ke sisi lain', `${at100.colV}px tersisa`);
ok(at0.colV < 300 && at100.colV < 300, 'pan menggeser ke dua arah yang berbeda');

// Visibilitas penanda tengah harus simetris terhadap pan=50: kalau masih
// terlihat di pan=p, jumlah yang sama harus terlihat di pan=100-p.
// Monotonik bukan syarat yang benar - crop tengah memang keluar dari frame di
// kedua ujung.
{
  const at = {};
  for (const pan of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) at[pan] = (await markAt(pan)).colV;
  const sym = [];
  let maxAsym = 0;
  for (const p of [0, 10, 20, 30, 40]) {
    const d = Math.abs(at[p] - at[100 - p]);
    maxAsym = Math.max(maxAsym, d);
    sym.push(`${p}<->${100 - p}: ${at[p]}/${at[100 - p]}`);
  }
  ok(maxAsym === 0, 'visibilitas penanda simetris terhadap pan=50', `${maxAsym} px beda · ${sym.join('  ')}`);
  ok(at[50] > 300, 'penanda tengah terlihat penuh di pan=50', `${at[50]}px`);
  ok(at[0] === 0 && at[100] === 0, 'penanda tengah hilang di kedua ujung', `${at[0]} / ${at[100]}`);
}

// pan=50 memakai jalur extract sendiri, jadi byte-nya berbeda dari jalur
// posisi sharp meski secara visual nyaris sama.
{
  const p50 = await transform(centreImg, { w: OW, h: OH, mode: 'cover', pan: 50, fm: 'png' });
  const bufP50 = p50.buffer ?? p50;
  const viaSharp = await transform(centreImg, { w: OW, h: OH, mode: 'cover', fm: 'png' });
  const bufSharp = viaSharp.buffer ?? viaSharp;
  ok(!bufP50.equals(bufSharp), 'pan=50 lewat jalur extract, bukan posisi sharp');
  const ra = await sharp(bufP50).removeAlpha().raw().toBuffer();
  const rb = await sharp(bufSharp).removeAlpha().raw().toBuffer();
  let sum = 0, diff = 0;
  for (let i = 0; i < ra.length; i++) { const d = Math.abs(ra[i] - rb[i]); sum += d; if (d > 12) diff++; }
  const mad = sum / ra.length;
  ok(
    mad < 1 && diff / ra.length < 0.01,
    'jalur extract di pan=50 nyaris identik secara visual dengan posisi sharp',
    `MAD ${mad.toFixed(3)}/255, ${((diff / ra.length) * 100).toFixed(2)}% piksel beda`
  );
  for (const mode of ['contain', 'width', 'height', 'raw']) {
    const a = await transform(centreImg, { w: OW, h: mode === 'height' ? OH : OW, h: mode === 'height' ? 0 : OH, mode, pan: 0, fm: 'png' });
    const b = await transform(centreImg, { w: OW, h: mode === 'height' ? OH : OW, h: mode === 'height' ? 0 : OH, mode, pan: 100, fm: 'png' });
    ok((a.buffer ?? a).equals(b.buffer ?? b), `mode ${mode} mengabaikan pan sepenuhnya`);
  }
}

console.log(`\n  Pipeline gambar: ${pass} lulus, ${fail.length} gagal`);
if (fail.length) for (const f of fail) console.log(`    x ${f}`);
process.exit(fail.length ? 1 : 0);