import express from 'express';
import path from 'node:path';
import { ROOT, PORT, HOST, PLATFORM, SIZE_PRESETS, UPSCALE_MODES, SORTS, RATIOS } from './config.js';
import { searchSources, detailSource, defaultSourceOrder, publicSources, matchesRatio } from './sources.js';
import {
  render, download, assertSafeUrl, waifu2xAvailable,
  MIN_CROP_FRAC, MIN_CROP_PX,
} from './image.js';
import { cached, cacheSweep, cacheStats } from './cache.js';
import * as taxonomy from './categories.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

/* ------------------------------ helpers ------------------------------ */

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v) => v === '1' || v === 'true' || v === true || v === 'on';

/** Batas aman untuk URL gambar eksternal (hydration simple). */
function hydrateImage(u) {
  if (!u) return null;
  try {
    assertSafeUrl(u);
  } catch {
    return null;
  }
  return u;
}

/** Error akibat input/sub-request yang tidak valid -> 400, bukan 500. */
class BadRequest extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'BadRequest';
  }
}

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    const clientError = e.name === 'BadRequest' || /tidak valid|diizinkan|diblokir|wajib|URL tidak/i.test(e.message || '');
    if (!clientError) console.warn(`[api] ${req.method} ${req.originalUrl} ->`, e.message);
    if (!res.headersSent) res.status(clientError ? 400 : 500).json({ error: e.message || 'Server error' });
  });
};

/* ------------------------------- config ------------------------------- */

app.get(
  '/api/config',
  wrap(async (_req, res) => {
    res.json({
      brand: 'Hoshiva',
      tagline: 'Anime wallpaper search engine',
      presets: SIZE_PRESETS,
      upscaleModes: UPSCALE_MODES,
      crop: { minFrac: MIN_CROP_FRAC, minPx: MIN_CROP_PX },
      sorts: SORTS,
      ratios: RATIOS,
      sources: publicSources(),
      waifu2xBinary: waifu2xAvailable(),
      stats: taxonomy.stats(),
    });
  })
);

app.get(
  '/api/health',
  wrap(async (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), stats: taxonomy.stats(), cache: cacheStats() });
  })
);

/* -------------------------------- search ------------------------------- */

/** Cek kesehatan tiap sumber (dengan cache pendek). */
app.get(
  '/api/sources/status',
  wrap(async (_req, res) => {
    const status = await cached('sources:status', 300, async () => {
      const out = [];
      for (const s of publicSources()) {
        const t = Date.now();
        try {
          const probe =
            s.kind === 'wallhaven'
              ? `${s.base}/search?categories=011&purity=100&page=1`
              : `${s.base}/index.php?page=dapi&s=post&q=index&limit=1&tags=rating:safe`;
          const ac = new AbortController();
          const to = setTimeout(() => ac.abort(), 8000);
          const r = await fetch(probe, {
            signal: ac.signal,
            headers: { 'user-agent': 'Mozilla/5.0' },
          });
          clearTimeout(to);
          out.push({ id: s.id, label: s.label, up: r.ok, ms: Date.now() - t });
        } catch {
          out.push({ id: s.id, label: s.label, up: false, ms: Date.now() - t });
        }
      }
      return out;
    });
    res.json({ status });
  })
);

app.get(
  '/api/search',
  wrap(async (req, res) => {
    const q = req.query;
    const limit = Math.min(Math.max(num(q.limit, 24), 1), 60);
    const page = Math.max(num(q.page, 1), 1);
    const sort = ['fit', 'newest', 'top', 'random'].includes(q.sort) ? q.sort : 'fit';
    const ratio = RATIOS.some((r) => r.id === q.ratio) ? q.ratio : 'any';

    const opts = {
      q: (q.q || '').slice(0, 120),
      tags: (q.tags || '')
        .split(',')
        .map((t) => t.trim().replace(/\s+/g, '_'))
        .filter(Boolean)
        .slice(0, 8),
      purity: ['safe', 'sfw', 'nsfw'].includes(q.purity) ? q.purity : 'safe',
      minWidth: num(q.minWidth, 0),
      minHeight: num(q.minHeight, 0),
      ratio,
      includeGeneral: bool(q.includeGeneral),
      sort,
      limit,
      page,
    };

    const order = defaultSourceOrder(q.source && q.source !== 'auto' ? q.source : null);
    // Filter rasio tidak selalu dihormati sumber (Wallhaven punya daftar `ratios`
    // sendiri, booru hanya mengandalkan tag yang sering tidak lengkap), jadi kita
    // minta kelebihan item lalu menyaring sendiri di bawah.
    const fetchOpts = ratio === 'any' ? opts : { ...opts, limit: Math.min(limit * 3, 60) };
    const { results, errors } = await searchSources(order.slice(0, 3), fetchOpts);

    if (!results.length) {
      return res.status(200).json({ items: [], total: 0, page, errors, sourcesTried: order.slice(0, 3), items0: true });
    }

    // Gabungkan multi-sumber secara round-robin supaya Wallhaven tidak
    // mengambil seluruh halaman sendirian.
    const seen = new Set();
    const buckets = results.map((r) => r.items.filter((it) => it.thumb && matchesRatio(it, ratio)));
    const items = [];
    for (let i = 0; items.length < limit; i++) {
      let progressed = false;
      for (const b of buckets) {
        const it = b[i];
        if (!it) continue;
        progressed = true;
        const key = it.md5 || `${it.source}:${it.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          ...it,
          thumb: hydrateImage(it.thumb),
          sample: hydrateImage(it.sample),
          full: hydrateImage(it.full),
        });
        if (items.length >= limit) break;
      }
      if (!progressed) break;
    }

    // Kategori otomatis: setiap wallpaper baru "dimumati" taksonomi
    const tax = taxonomy.ingest(items);

    res.json({
      items,
      total: results.reduce((s, r) => s + (r.total || r.items.length), 0),
      page,
      sources: results.map((r) => ({ id: r.source, label: r.sourceLabel, total: r.total })),
      errors,
      taxonomy: tax,
    });
  })
);

/** Detail satu wallpaper (tag lengkap, metadata asli). */
app.get(
  '/api/post/:source/:id',
  wrap(async (req, res) => {
    const { source, id } = req.params;
    const item = await cached(`post:${source}:${id}`, 1800, () => detailSource(source, id));
    taxonomy.ingest([item]);
    res.json({
      ...item,
      thumb: hydrateImage(item.thumb),
      sample: hydrateImage(item.sample),
      full: hydrateImage(item.full),
    });
  })
);

/* ------------------------------ taxonomy ------------------------------ */

app.get(
  '/api/categories',
  wrap(async (req, res) => {
    const includeAuto = req.query.auto !== '0';
    const minHits = num(req.query.minHits, 1);
    // Default sengaja longgar: UI menampilkan seluruh daftar kategori tanpa
    // tombol "tampilkan lagi". Yang paling banyak dipakai tetap di atas karena
    // listCategories() sudah diurutkan berdasarkan hits.
    const limit = num(req.query.limit, 500);
    res.json({
      categories: taxonomy.listCategories({ includeAuto, minHits, limit }),
      trending: taxonomy.topTags(40),
      stats: taxonomy.stats(),
    });
  })
);

app.get(
  '/api/categories/fresh',
  wrap(async (req, res) => {
    res.json({ items: taxonomy.freshPosts(Math.min(num(req.query.limit, 24), 60)) });
  })
);

/* -------------------------------- image -------------------------------- */

/**
 * Proxy + resize + upscale.
 * Tanpa w/h/upscale -> stream file asli (kualitas penuh untuk unduhan).
 */
app.get(
  '/api/img',
  wrap(async (req, res) => {
    const { url, w, h, mode, upscale, fm, quality, scale, download: dl, cx, cy, cw, ch } = req.query;
    if (!url) return res.status(400).json({ error: 'Parameter url wajib diisi' });
    try {
      assertSafeUrl(url);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Crop manual: fraksi 0..1 (x, y, w, h). Kalau hanya sebagian yang dikirim,
    // tolak — lebih baik error jelas daripada crop diam-diam bergerak.
    let crop = null;
    const cropGiven = [cx, cy, cw, ch].filter((v) => v !== undefined && v !== '').length;
    if (cropGiven) {
      if (cropGiven < 4) throw new BadRequest('Crop tidak valid: cx, cy, cw, ch harus dikirim bersama-sama');
      const frac = (v, name) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new BadRequest(`Crop tidak valid: ${name} bukan angka`);
        if (n < 0 || n > 1) throw new BadRequest(`Crop tidak valid: ${name} harus antara 0 dan 1`);
        return n;
      };
      crop = { x: frac(cx, 'cx'), y: frac(cy, 'cy'), w: frac(cw, 'cw'), h: frac(ch, 'ch') };
      if (crop.w < MIN_CROP_FRAC || crop.h < MIN_CROP_FRAC) {
        throw new BadRequest(
          `Crop tidak valid: minimal ${Math.round(MIN_CROP_FRAC * 100)}% per sisi (minimal ${MIN_CROP_PX}px)`
        );
      }
      if (crop.x + crop.w > 1 + 1e-6 || crop.y + crop.h > 1 + 1e-6) {
        throw new BadRequest('Crop tidak valid: area keluar dari gambar');
      }
    }

    const wants = w || h || crop || (upscale && upscale !== 'none');
    if (!wants) {
      const { buffer, type } = await download(url);
      res.set('content-type', type);
      res.set('cache-control', 'public, max-age=86400');
      res.set('content-disposition', dl === '1' ? `attachment; filename="hoshiva-${Date.now()}.jpg"` : 'inline');
      return res.end(buffer);
    }

    const cropKey = crop ? [crop.x, crop.y, crop.w, crop.h].map((v) => v.toFixed(4)).join(',') : '';
    const key = `img:${url}:${w}:${h}:${mode}:${upscale}:${fm}:${quality}:${scale}:${cropKey}`;
    const out = await cached(key, num(req.query.ttl, 3600), () =>
      render(url, {
        w: num(w, 0),
        h: num(h, 0),
        mode: ['cover', 'contain', 'width', 'height', 'raw'].includes(mode) ? mode : 'contain',
        upscale: ['none', 'auto', 'waifu2x', 'anime'].includes(upscale) ? upscale : 'none',
        fm: ['jpg', 'png', 'webp'].includes(fm) ? fm : undefined,
        quality: num(quality, 92),
        scale: num(scale, 2),
        crop,
      })
    );

    res.set('content-type', out.contentType);
    res.set('cache-control', 'public, max-age=604800, immutable');
    res.set('x-hoshiva-engine', out.engine || 'sharp');
    if (out.upscaled) res.set('x-hoshiva-upscaled', '1');
    if (dl === '1') {
      res.set('content-disposition', `attachment; filename="hoshiva-${out.info.width}x${out.info.height}.${out.contentType.split('/')[1]}"`);
    }
    res.end(out.buffer);
  })
);

/** Metadata gambar (untuk info di modal). */
app.get(
  '/api/img/meta',
  wrap(async (req, res) => {
    if (!req.query.url) return res.status(400).json({ error: 'url wajib' });
    try {
      assertSafeUrl(req.query.url);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const key = `imgmeta:${req.query.url}`;
    const meta = await cached(key, 3600, async () => {
      const { download } = await import('./image.js');
      const { buffer } = await download(req.query.url);
      const { default: sharp } = await import('sharp');
      const m = await sharp(buffer).metadata();
      return { width: m.width, height: m.height, format: m.format, hasAlpha: !!m.hasAlpha, bytes: buffer.length };
    });
    res.json(meta);
  })
);

/* -------------------------------- static -------------------------------- */

app.use(
  express.static(path.join(ROOT, 'public'), {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.(png|svg|webp|ico)$/.test(filePath)) res.set('cache-control', 'public, max-age=604800');
    },
  })
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[err]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const swept = cacheSweep();
console.log(`[hoshiva] cache sweep: -${swept.removed} / ${swept.kept} kept`);

/**
 * Sweep hanya sekali di boot akan menyisakan entri kedaluwarsa menumpuk di
 * container yang hidup lama, jadi ulangi secara berkala. Berjeda longgar supaya
 * tidak ikut memblokir event loop saat sedang sibuk.
 */
const SWEEP_MS = 30 * 60 * 1000;
setInterval(() => {
  try {
    const r = cacheSweep();
    if (r.removed) console.log(`[hoshiva] cache sweep: -${r.removed} / ${r.kept} kept`);
  } catch {
    /* ignore */
  }
}, SWEEP_MS).unref();

app.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  ✦ Hoshiva siap  →  http://${shown}:${PORT}\n`);
  console.log(`    platform: ${PLATFORM}  |  bind: ${HOST}:${PORT}`);
  console.log(`    waifu2x binary: ${waifu2xAvailable() ? 'TERPASANG (dipakai)' : 'tidak ada (pakai emulasi sharp)'}`);
  console.log(`    taksonomi: ${taxonomy.stats().totalCategories} kategori aktif\n`);
});
