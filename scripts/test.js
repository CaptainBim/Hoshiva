/**
 * Hoshiva API test suite.
 *
 *   npm start          # terminal 1
 *   npm test           # terminal 2
 *
 * Semua assertion hanya memanggil API publik Hoshiva, jadi server harus
 * sudah jalan. Override host lewat HOSHIVA_URL bila perlu.
 */
const B = process.env.HOSHIVA_URL || 'http://127.0.0.1:4173';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

const get = async (p) => {
  const r = await fetch(B + p);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 300), status: r.status }; }
};

const getImg = async (p) => {
  const r = await fetch(B + p);
  return { r, buf: Buffer.from(await r.arrayBuffer()) };
};

/** Baca dimensi dari header PNG (IHDR di byte 16..24). */
function pngSize(buf) {
  if (buf.length < 24 || buf.slice(1, 4).toString() !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Baca dimensi JPEG tanpa decode penuh: cari marker SOF0..SOF15. */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // SOF0-SOF15 kecuali marker non-frame (DHT=C4, JPG=C8, DAC=CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** Dimensi dari body apa pun (PNG atau JPEG). */
const sizeOf = (buf) => jpegSize(buf) || pngSize(buf);

const hr = (s) => console.log('\n' + '='.repeat(68) + '\n  ' + s + '\n' + '='.repeat(68));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (v) => encodeURIComponent(v);

(async () => {
  // Beri waktu server menutup koneksi pool sebelum test pertama.
  await sleep(1500);

  let items = [];
  let first = null;

  /* ---------------------------------------------------------------- 1 */
  hr('1. KONFIGURASI');
  const c = await get('/api/config');
  check('brand = Hoshiva', c.brand === 'Hoshiva', `${c.brand} / ${c.tagline}`);
  check('preset ukuran lengkap', c.presets?.length >= 10, `${c.presets?.length} preset`);
  check('mode upscale terdaftar', (c.upscaleModes || []).some((m) => m.id === 'waifu2x'), (c.upscaleModes || []).map((m) => m.id).join(', '));
  check('sort default = fit', (c.sorts || []).some((s) => s.id === 'fit'));
  console.log('  preset :', (c.presets || []).map((p) => `${p.label}(${p.width ? `${p.width}x${p.height}` : p.mode})`).join(', '));
  console.log('  sumber :', (c.sources || []).map((s) => s.id).join(', '));
  console.log('  waifu2x:', c.waifu2xBinary || '(tidak ada binary, pakai sharp)');

  /* ---------------------------------------------------------------- 2 */
  hr('2. PENCARIAN (multi-source, sort=fit)');
  const s = await get('/api/search?limit=12&sort=fit&minWidth=1280');
  items = s.items || [];
  first = items[0];
  check('ada hasil', items.length > 0, `${items.length}/${s.total} item`);
  check('semua item punya dimensi', items.every((i) => i.width > 0 && i.height > 0));
  check('semua item punya thumbnail', items.every((i) => !!i.thumb));
  // Sumber yang tidak terjangkau dari jaringan ini akan dilaporkan sebagai error;
  // yang penting hasil tetap berasal dari minimal satu sumber yang hidup.
  check('minimal satu sumber hidup', (s.sources || []).length > 0,
    (s.errors || []).length ? `error: ${(s.errors || []).join(' | ')}` : 'semua sumber hidup');
  const dist = {};
  for (const i of items) dist[i.sourceLabel] = (dist[i.sourceLabel] || 0) + 1;
  console.log('  distribusi :', JSON.stringify(dist));
  for (const i of items)
    console.log(`    ${i.sourceLabel.padEnd(10)} ${`${i.width}x${i.height}`.padEnd(11)} ${i.orientation.padEnd(10)} tags=${String(i.tagCount).padEnd(3)} ${i.title.slice(0, 32)}`);

  /* ---------------------------------------------------------------- 3 */
  hr('3. URUTAN & ORIENTASI');
  const ori = items.map((i) => i.orientation);
  check('orientasi konsisten', !ori.includes('unknown'), [...new Set(ori)].join(', '));

  // Filter rasio harus benar-benar menyaring, bukan cuma dikirim ke sumber:
  // Wallhaven punya daftar `ratios` sendiri dan booru hanya mengandalkan tag.
  const rangeOf = { landscape: [1.15, Infinity], portrait: [0, 0.87], square: [0.87, 1.15], tall: [0, 0.7], ultrawide: [2, Infinity] };
  for (const id of Object.keys(rangeOf)) {
    const [lo, hi] = rangeOf[id];
    const d = await get(`/api/search?ratio=${id}&sort=fit&limit=24`);
    const got = (d.items || []).map((i) => i.width / i.height);
    const inside = got.filter((v) => v >= lo && v < hi).length;
    check(`filter rasio "${id}" menyaring`, got.length === 0 || inside === got.length,
      got.length ? `${inside}/${got.length} dalam [${lo}, ${hi === Infinity ? '∞' : hi}) — ${got.map((v) => v.toFixed(2)).join(' ')}` : '0 hasil');
  }

  /* ---------------------------------------------------------------- 4 */
  hr('4. DETAIL / TAG ENRICHMENT');
  const wh = items.find((i) => i.source === 'wallhaven');
  const booru = items.find((i) => i.source !== 'wallhaven');
  const target = wh || booru;
  if (target) {
    const t0 = Date.now();
    const d = await get(`/api/post/${target.source}/${target.id}`);
    check('detail punya judul', !!d.title && d.title !== '—', `${d.title} (${Date.now() - t0}ms)`);
    check('detail punya tag', (d.tags || []).length > 0, `${d.tags.length} tag: ${(d.tags || []).slice(0, 8).join(', ')}`);
    check('detail punya URL gambar', !!d.full);
  } else check('ada item untuk didetailkan', false);

  /* ---------------------------------------------------------------- 5 */
  hr('5. KATEGORI OTOMATIS (dari entitas, bukan atribut generik)');
  const cat = await get('/api/categories');
  const cats = cat.categories || [];
  check('kategori terbentuk', cats.length > 0, `${cats.length} kategori, stats=${JSON.stringify(cat.stats)}`);
  // Hanya kategori AUTO yang diautomasi; seed category boleh memakai kata umum.
  const GENERIC = /^(1girl|1boy|girl|boy|long hair|short hair|blue hair|smile|looking|highres|absurdres|blue eyes|hair|twintails|blurry|comment|tagme|rating|safe|questionable|sensitive|translated|scanlation|official art|wallpaper|outdoors|day|night)$/i;
  const autoCats = cats.filter((x) => x.auto);
  const dirty = autoCats.filter((x) => GENERIC.test(x.label));
  check('kategori auto bebas atribut generik', dirty.length === 0,
    dirty.map((x) => x.label).join(', ') || `${autoCats.length} auto kategori bersih`);
  // Label kategori harus unik: tag yang sudah punya kategori seed tidak boleh
  // dipromosikan lagi (bikin "Landscape" muncul dua kali di sidebar).
  const byLabel = new Map();
  for (const x of cats) byLabel.set(x.label.toLowerCase(), [...(byLabel.get(x.label.toLowerCase()) || []), x]);
  const dupes = [...byLabel.values()].filter((v) => v.length > 1);
  check('label kategori unik', dupes.length === 0,
    dupes.map((d) => `${d[0].label}(${d.map((x) => (x.auto ? 'auto' : 'seed')).join('+')})`).join(', ') || 'tidak ada duplikat');
  for (const x of cats.slice(0, 14))
    console.log(`    ${(x.emoji || '?').padEnd(3)} ${x.label.padEnd(26)} hits=${String(x.hits).padEnd(5)} auto=${x.auto}`);
  console.log('  trending :', (cat.trending || []).slice(0, 10).map((t) => `${t.tag}(${t.count})`).join(', ') || '(kosong)');

  /* ---------------------------------------------------------------- 6 */
  hr('6. PROXY GAMBAR + UPSCALE');
  if (first) {
    for (const mode of ['none', 'waifu2x', 'anime']) {
      const { r, buf } = await getImg(`/api/img?url=${q(first.full)}&w=3840&h=2160&mode=contain&upscale=${mode}`);
      const ok = r.status === 200 && buf.length > 5000;
      check(`upscale=${mode}`, ok,
        `${r.status} ${r.headers.get('content-type')} ${(buf.length / 1024).toFixed(0)}KB ` +
        `engine=${r.headers.get('x-hoshiva-engine')} upscaled=${r.headers.get('x-hoshiva-upscaled')}`);
    }
    // mode=cover harus tepat ukuran target
    const cover = await getImg(`/api/img?url=${q(first.full)}&w=1920&h=1080&mode=cover&upscale=none`);
    const cw = sizeOf(cover.buf);
    check('cover = tepat 1920x1080', cw?.w === 1920 && cw?.h === 1080, cw ? `${cw.w}x${cw.h}` : 'dimensi tak terbaca');
    // contain tidak boleh memotong gambar sumber
    const cont = await getImg(`/api/img?url=${q(first.full)}&w=800&h=800&mode=contain&upscale=none`);
    const cn = sizeOf(cont.buf);
    check('contain = canvas 800x800', cn?.w === 800 && cn?.h === 800, cn ? `${cn.w}x${cn.h}` : '?');
    // Tanpa w/h + upscale -> harus memperbesar dari resolusi asli (bukan 1x1)
    const meta0 = await get(`/api/img/meta?url=${q(first.full)}`);
    const scaled = await getImg(`/api/img?url=${q(first.full)}&upscale=waifu2x&scale=2`);
    const sn = sizeOf(scaled.buf);
    check('upscale tanpa w/h -> 2x asli', sn && meta0.width && sn.w >= meta0.width * 1.5,
      `${sn?.w}x${sn?.h} dari ${meta0.width}x${meta0.height}`);
  } else check('butuh item untuk tes gambar', false);

  /* ---------------------------------------------------------------- 7 */
  hr('7. PRESET UKURAN');
  // Preset memakai field `w`/`h` (bukan width/height). Preset `screen` dan
  // `original` tidak punya dimensi tetap, jadi diuji terpisah.
  const sized = (c.presets || []).filter((p) => p.w && p.h);
  check('preset berdimensi tersedia', sized.length >= 8,
    sized.map((p) => `${p.label}=${p.w}x${p.h}/${p.mode}`).join(', '));
  for (const p of sized) {
    const { r, buf } = await getImg(`/api/img?url=${q(first.full)}&w=${p.w}&h=${p.h}&mode=${p.mode}&upscale=waifu2x`);
    const d = jpegSize(buf) || pngSize(buf);
    check(`preset ${p.label}`, r.status === 200 && buf.length > 5000 && d,
      `${r.status} ${d ? `${d.w}x${d.h}` : `${(buf.length / 1024).toFixed(0)}KB`}`);
  }
  // "Asli (Full Res)" -> mode=raw, tanpa resize sama sekali
  {
    const { r, buf } = await getImg(`/api/img?url=${q(first.full)}&mode=raw`);
    const meta = await get(`/api/img/meta?url=${q(first.full)}`);
    const d = jpegSize(buf) || pngSize(buf);
    check('preset "Asli (Full Res)"', r.status === 200 && buf.length > 5000,
      `${r.status} ${d ? `${d.w}x${d.h}` : `${(buf.length / 1024).toFixed(0)}KB`} (meta ${meta.width}x${meta.height})`);
  }

  /* ---------------------------------------------------------------- 8 */
  hr('8. UNDUH (content-disposition)');
  if (first) {
    const { r, buf } = await getImg(`/api/img?url=${q(first.full)}&w=1920&h=1080&mode=cover&download=1`);
    const cd = r.headers.get('content-disposition') || '';
    check('status 200', r.status === 200);
    check('header content-disposition', cd.startsWith('attachment'), cd || '(kosong)');
    check('body berisi data', buf.length > 3000, `${(buf.length / 1024).toFixed(0)}KB`);
  }

  /* ---------------------------------------------------------------- 9 */
  hr('9. PENCARIAN BERTEGORI');
  for (const term of ['sakura', 'cyberpunk girl', 'sunset landscape']) {
    const r = await get(`/api/search?q=${q(term)}&limit=6&sort=fit&minWidth=1600`);
    check(`q="${term}"`, (r.items || []).length > 0,
      `${r.items?.length} item dari [${(r.sources || []).map((x) => x.label).join(', ')}]${(r.errors || []).length ? ' err: ' + r.errors.join('|') : ''}`);
    for (const i of (r.items || []).slice(0, 2))
      console.log(`      ${i.sourceLabel.padEnd(10)} ${i.width}x${i.height}  ${i.title.slice(0, 30)}`);
  }

  /* --------------------------------------------------------------- 10 */
  hr('10. STATUS SUMBER');
  const st = await get('/api/sources/status');
  for (const x of st.status || [])
    console.log(`    ${x.up ? 'UP  ' : 'DOWN'} ${x.label.padEnd(12)} ${x.ms}ms`);
  check('minimal satu sumber hidup', (st.status || []).some((x) => x.up));

  /* --------------------------------------------------------------- 11 */
  hr('11. KEAMANAN PROXY (SSRF)');
  const attacks = [
    ['http://127.0.0.1:' + new URL(B).port + '/api/config', 'loopback server sendiri'],
    ['http://localhost/x.png', 'localhost'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata AWS'],
    ['http://10.0.0.1/x.png', 'jaringan privat 10/8'],
    ['http://192.168.0.1/x.png', 'jaringan privat 192.168/16'],
    ['http://[::1]/x.png', 'IPv6 loopback'],
    ['http://2130706433/x.png', 'IPv4 desimal'],
    ['http://127.1/x.png', 'IPv4 singkat'],
    ['file:///C:/Windows/win.ini', 'skema file'],
  ];
  for (const [evil, label] of attacks) {
    const r = await fetch(`${B}/api/img?url=${q(evil)}&w=400&h=400`);
    const txt = (await r.text()).slice(0, 60).replace(/\s+/g, ' ');
    check(`tolak: ${label}`, r.status === 400, `${r.status} ${txt}`);
  }
  // /api/img/meta harus menolak juga
  const metaEvil = await fetch(`${B}/api/img/meta?url=${q('http://127.0.0.1:' + new URL(B).port + '/api/config')}`);
  check('tolak: /api/img/meta loopback', metaEvil.status === 400, String(metaEvil.status));

  /* --------------------------------------------------------------- 12 */
  hr('12. ASET STATIS');
  const html = await (await fetch(B + '/')).text();
  check('index memuat logo', html.includes('/assets/logo.png'));
  check('index memuat <title>Hoshiva', html.includes('<title>Hoshiva'));
  for (const asset of ['/assets/logo-512.png', '/favicon.png', '/css/style.css', '/js/app.js', '/js/api.js', '/js/ui.js']) {
    const r = await fetch(B + asset);
    check(`aset ${asset}`, r.status === 200, r.headers.get('content-type'));
  }

  /* ------------------------------------------------------------------ */
  const pass = results.filter((x) => x.ok).length;
  const fail = results.length - pass;
  hr('RINGKASAN');
  console.log(`  ${pass} lulus, ${fail} gagal, dari ${results.length} assertion\n`);
  if (fail) for (const x of results.filter((y) => !y.ok)) console.log(`  x ${x.name}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nFATAL:', e.message);
  console.error('Server belum jalan? Jalankan `npm start` dulu.');
  process.exit(1);
});