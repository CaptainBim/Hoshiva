import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CACHE_DIR } from './config.js';

/**
 * Cache 2-lapis: memori (Map LRU) + disk (TTL).
 * Sumber API anime sering rate-limit, jadi cache sangat vital.
 */
const mem = new Map();
const MEM_MAX = 400;
/** Di atas ambang ini, hasil hanya disimpan di memori (jangan tulis ke disk). */
const DISK_MAX_BYTES = 2 * 1024 * 1024;

let ready = false;
function ensureDir() {
  if (ready) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  ready = true;
}

const keyOf = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex');

/**
 * Serialisasi aman untuk cache disk.
 *
 * Buffer TIDAK boleh di-JSON.stringify langsung: ia berubah jadi
 * `{ type: "Buffer", data: [...] }` dan tidak kembali menjadi Buffer saat
 * dibaca, sehingga `res.end()` melempar "chunk argument must be Buffer".
 * karena itu payload di-encode sebagai base64 bertanda.
 */
function encode(value) {
  if (Buffer.isBuffer(value)) return { __t: 'buf', v: value.toString('base64') };
  if (value instanceof Uint8Array) return { __t: 'buf', v: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = encode(v);
    return o;
  }
  return value;
}

function decode(value) {
  if (value && typeof value === 'object') {
    if (value.__t === 'buf') return Buffer.from(value.v, 'base64');
    // Bentuk lama hasil JSON.stringify(Buffer). Tetap dikembalikan agar file
    // lama tidak menyebabkan crash, tapi akan dianggap basi lewat versi.
    if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
    if (Array.isArray(value)) return value.map(decode);
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = decode(v);
    return o;
  }
  return value;
}

/**
 * Naikkan bila format serialisasi berubah. Record versi lama diperlakukan
 * sebagai cache miss lalu dihapus, jadi tidak ada payload basi yang terbaca.
 */
const CACHE_VERSION = 2;

function memGet(k) {
  if (!mem.has(k)) return undefined;
  const v = mem.get(k);
  mem.delete(k);
  mem.set(k, v);
  return v;
}

function memSet(k, v) {
  mem.set(k, v);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

const fileOf = (k) => path.join(CACHE_DIR, `${k}.json`);

export function cacheGet(key) {
  const k = keyOf(key);
  const hit = memGet(k);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) mem.delete(k);

  try {
    ensureDir();
    const raw = fs.readFileSync(fileOf(k), 'utf8');
    const rec = JSON.parse(raw);
    if (rec.v === CACHE_VERSION && rec.expires > Date.now()) {
      // WAJIB simpan nilai yang sudah di-decode: kalau yang dimasukkan ke
      // memori adalah bentuk mentah, hit berikutnya mengembalikan Buffer
      // sebagai objek biasa dan res.end() meledak.
      const value = decode(rec.value);
      memSet(k, { ...rec, value });
      return value;
    }
    fs.unlinkSync(fileOf(k));
  } catch {
  }
  return undefined;
}

export function cacheSet(key, value, ttlSec = 600) {
  const k = keyOf(key);
  const rec = { v: CACHE_VERSION, value, expires: Date.now() + ttlSec * 1000, at: Date.now() };
  memSet(k, rec);
  try {
    // Render 4K bisa jadi ratusan KB; base64 menambah 1.33x dan tiap URL punya
    // beberapa varian. Lewati disk untuk payload besar supaya folder cache tidak
    // tumbuh tanpa batas — cache memori tetap melayani request berikutnya.
    if (Buffer.byteLength(JSON.stringify(encode(value))) > DISK_MAX_BYTES) return;
    ensureDir();
    fs.writeFileSync(fileOf(k), JSON.stringify({ ...rec, value: encode(value) }));
  } catch {
    /* cache penuh / tidak writable: memori saja cukup */
  }
}

/** Jalankan fn dengan cache (dedup in-flight agar tidak request paralel ganda). */
const inflight = new Map();
export async function cached(key, ttlSec, fn) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const value = await fn();
    cacheSet(key, value, ttlSec);
    return value;
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** Bersihkan file cache kedaluwarsa (dipanggil saat boot). */
export function cacheSweep() {
  let removed = 0;
  let kept = 0;
  try {
    ensureDir();
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(CACHE_DIR, f);
      try {
        const rec = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (rec.v !== CACHE_VERSION || rec.expires < Date.now()) {
          fs.unlinkSync(fp);
          removed++;
        } else kept++;
      } catch {
        fs.unlinkSync(fp);
        removed++;
      }
    }
  } catch {
  }
  return { removed, kept };
}

/**
 * Hitungan cache tanpa efek samping: TIDAK membaca isi file dan TIDAK
 * menghapus apa pun.
 *
 * Ini sengaja dipisah dari `cacheSweep` karena `/api/health` dipakai Railway
 * sebagai healthcheck dan dipanggil berkali-kali. Sweep di dalam probe akan
 * (a) menghapus file tiap kali Railway mem-ping, dan (b) memblokir event loop
 * karena read + parse setiap entri. Hitungan disk cukup dari nama file, dan
 * dimemoisasi sebentar supaya probe berdekatan tidak mengulang readdir.
 */
let statsMemo = { at: 0, disk: 0 };
export function cacheStats() {
  const now = Date.now();
  if (now - statsMemo.at > 60_000) {
    let disk = 0;
    try {
      for (const f of fs.readdirSync(CACHE_DIR)) if (f.endsWith('.json')) disk++;
    } catch {
      disk = 0;
    }
    statsMemo = { at: now, disk };
  }
  return { mem: mem.size, disk: statsMemo.disk };
}
