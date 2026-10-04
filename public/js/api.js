/* Hoshiva — API client tipis (semua lewat server proxy) */

const j = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b.error) msg = b.error;
    } catch {
      /* bukan json */
    }
    throw new Error(msg);
  }
  return res.json();
};

export const getConfig = () => j('/api/config');

export const search = (p) => {
  const u = new URL('/api/search', location.origin);
  for (const [k, v] of Object.entries(p)) {
    if (v === '' || v === null || v === undefined) continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return j(u.toString());
};

export const getPost = (source, id) => j(`/api/post/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);

export const getCategories = () => j('/api/categories');
export const getFresh = (limit = 30) => j(`/api/categories/fresh?limit=${limit}`);
export const getSourcesStatus = () => j('/api/sources/status');

/** Bangun URL proxy gambar untuk resize + crop + upscale. */
export function imgUrl(url, o = {}) {
  if (!url) return '';
  const u = new URL('/api/img', location.origin);
  u.searchParams.set('url', url);
  if (o.w) u.searchParams.set('w', o.w);
  if (o.h) u.searchParams.set('h', o.h);
  if (o.mode && o.mode !== 'raw') u.searchParams.set('mode', o.mode);
  // Posisi crop untuk mode cover. Tanpa ini server memakai default `centre`.
  if (o.pos) u.searchParams.set('pos', o.pos);
  // Geser crop 0..100 (50 = tengah). Hanya bermakna untuk mode cover.
  if (o.pan !== undefined && o.pan !== null && o.mode === 'cover') {
    u.searchParams.set('pan', String(Math.min(Math.max(Math.round(o.pan), 0), 100)));
  }
  if (o.upscale && o.upscale !== 'none') u.searchParams.set('upscale', o.upscale);
  if (o.fm) u.searchParams.set('fm', o.fm);
  if (o.quality) u.searchParams.set('quality', o.quality);
  if (o.download) u.searchParams.set('download', '1');
  if (o.ttl) u.searchParams.set('ttl', o.ttl);
  // Crop manual: fraksi 0..1 dari tiap sisi gambar.
  if (o.crop) {
    const c = o.crop;
    u.searchParams.set('cx', c.x.toFixed(4));
    u.searchParams.set('cy', c.y.toFixed(4));
    u.searchParams.set('cw', c.w.toFixed(4));
    u.searchParams.set('ch', c.h.toFixed(4));
  }
  return u.toString();
}

export const downloadUrl = (url) => j(`/api/img/meta?url=${encodeURIComponent(url)}`);
