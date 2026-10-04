/**
 * Test cache: round-trip Buffer lewat disk + dedup in-flight.
 *   node scripts/test-cache.js
 *
 * catching regression: JSON.stringify(Buffer) menghasilkan {type:"Buffer",...}
 * yang tidak kembali menjadi Buffer, sehingga res.end() meledak dengan
 * "The chunk argument must be of type string or an instance of Buffer".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Arahkan cache ke direktori sementara supaya data asli tidak tersentuh.
const DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoshiva-cache-')), 'cache');
process.env.HOSHIVA_CACHE_DIR = DIR;

const { cacheGet, cacheSet, cached, cacheSweep, cacheStats } = await import('../server/cache.js');

let pass = 0;
const fail = [];
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail.push(name); console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};
/** Nama constructor untuk log: Buffer tampil sebagai "Buffer", bukan "object". */
const kind = (v) => (Buffer.isBuffer(v) ? 'Buffer' : Array.isArray(v) ? 'Array' : typeof v);

console.log('\n-- Buffer harus kembali sebagai Buffer --');
{
  const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  cacheSet('img-test', { buffer: buf, info: { width: 10, height: 20 } }, 60);
  const got = cacheGet('img-test');
  ok(Buffer.isBuffer(got?.buffer), 'top-level Buffer', kind(got?.buffer));
  ok(got?.buffer && Buffer.compare(got.buffer, buf) === 0, 'isi identik setelah JSON');
  ok(got?.info?.width === 10, 'field biasa tidak rusak');
}

console.log('\n-- Buffer bersarang --');
{
  const val = {
    buffer: Buffer.from('top'),
    nested: { deep: { b: Buffer.from('mid') } },
    list: [Buffer.from('a'), { b: Buffer.from('b') }],
    n: 42, s: 'teks', nil: null, t: true,
  };
  cacheSet('nested-test', val, 60);
  const g = cacheGet('nested-test');
  ok(Buffer.isBuffer(g.nested.deep.b), 'Buffer di object dalam object');
  ok(g.nested.deep.b.toString() === 'mid', 'isi benar');
  ok(Buffer.isBuffer(g.list[0]) && g.list[0].toString() === 'a', 'Buffer di dalam array');
  ok(Buffer.isBuffer(g.list[1].b) && g.list[1].b.toString() === 'b', 'Buffer di object dalam array');
  ok(g.n === 42 && g.s === 'teks' && g.nil === null && g.t === true, 'tipe non-Buffer terjaga');
}

console.log('\n-- memori dan disk konsisten --');
{
  // Memo-kan encode hanya dilakukan saat menulis disk; nilai di memori harus
  // tetap Buffer pada hit kedua (regression: memSet menyimpan bentuk mentah).
  const buf = Buffer.from([9, 8, 7, 6]);
  cacheSet('mem-test', { buffer: buf }, 60);
  for (const attempt of [1, 2, 3]) {
    const g = cacheGet('mem-test');
    ok(Buffer.isBuffer(g?.buffer), `hit ke-${attempt} tetap Buffer`, kind(g?.buffer));
  }
}

console.log('\n-- miss & TTL --');
{
  ok(cacheGet('tidak-ada-key-ini') === undefined, 'key yang tidak ada -> undefined');
  cacheSet('ttl-test', { v: 1 }, -1); // sudah kedaluwarsa
  ok(cacheGet('ttl-test') === undefined, 'TTL habis -> undefined');
}

console.log('\n-- dedup in-flight --');
{
  let calls = 0;
  const slow = () => new Promise((r) => setTimeout(() => r({ n: ++calls }), 60));
  const [a, b, c] = await Promise.all([
    cached('inflight-test', 60, slow),
    cached('inflight-test', 60, slow),
    cached('inflight-test', 60, slow),
  ]);
  ok(calls === 1, 'tiga request paralel -> satu eksekusi', `${calls} kali`);
  ok(a.n === b.n && b.n === c.n, 'semua dapat hasil sama');
}

console.log('\n-- payload besar tidak ditulis ke disk --');
{
  const big = Buffer.alloc(3 * 1024 * 1024, 7); // 3MB > ambang 2MB
  cacheSet('big-test', { buffer: big }, 60);
  const g = cacheGet('big-test');
  ok(Buffer.isBuffer(g?.buffer), 'payload besar tetap lewat memori', kind(g?.buffer));
  const files = fs.readdirSync(DIR).filter((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).at > 0 && f; } catch { return false; }
  });
  const onDisk = files.some((f) => fs.statSync(path.join(DIR, f)).size > 3 * 1024 * 1024);
  ok(!onDisk, 'payload 3MB tidak masuk ke file cache disk');
}

console.log('\n-- sweep membersihkan yang kedaluwarsa --');
{
  cacheSet('sweep-old', { v: 1 }, -10);
  cacheSet('sweep-new', { v: 2 }, 600);
  const r = cacheSweep();
  ok(r.removed >= 1, 'file kedaluwarsa dihapus', `removed=${r.removed} kept=${r.kept}`);
  ok(cacheGet('sweep-new') !== undefined, 'file yang masih hidup dipertahankan');
}

console.log('\n-- cacheStats(): probe health tidak boleh menyapu --');
{
  cacheSet('stats-old', { v: 1 }, -10);
  const s1 = cacheStats();
  ok(typeof s1.mem === 'number' && s1.mem >= 0, 'cacheStats().mem adalah angka', `mem=${s1.mem}`);
  ok(typeof s1.disk === 'number' && s1.disk >= 0, 'cacheStats().disk adalah angka', `disk=${s1.disk}`);
  ok(fs.readdirSync(DIR).length >= s1.disk, 'hitungan disk tidak melebihi file yang ada');
  // File kedaluwarsa harus masih ada: stats hanya menghitung, tidak menghapus.
  const stillThere = fs.readdirSync(DIR).some((f) => f.endsWith('.json'));
  ok(stillThere, 'cacheStats tidak menghapus file');
  const s2 = cacheStats();
  ok(s2.disk === s1.disk, 'hitungan kedua mememoisasi (tidak berubah)', `${s1.disk} -> ${s2.disk}`);
}

console.log(`\n  Cache: ${pass} lulus, ${fail.length} gagal`);
if (fail.length) for (const f of fail) console.log(`    x ${f}`);
fs.rmSync(path.dirname(DIR), { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);