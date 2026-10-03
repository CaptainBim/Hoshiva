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

console.log(`\n  Pipeline gambar: ${pass} lulus, ${fail.length} gagal`);
if (fail.length) for (const f of fail) console.log(`    x ${f}`);
process.exit(fail.length ? 1 : 0);