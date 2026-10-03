/**
 * Test filter rasio/orientasi.
 *   node scripts/test-ratio.js
 *
 * catching regression: Wallhaven hanya menerima daftar `ratios` miliknya sendiri
 * dan booru mengandalkan tag `landscape`/`portrait` yang sering tidak lengkap,
 * sehingga tanpa penyaring lokal hasil "Portrait" masih memuat gambar lanskap.
 */
import { matchesRatio, RATIO_RANGE, aspectInfo } from '../server/sources.js';
import { RATIOS } from '../server/config.js';

let pass = 0;
const fail = [];
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail.push(name); console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

const r = (w, h) => w / h;

console.log('\n-- setiap id di RATIOS punya rentang --');
{
  const ids = RATIOS.map((x) => x.id);
  ok(ids.includes('any'), 'RATIOS memuat "any"');
  for (const id of ids) {
    if (id === 'any') continue;
    ok(!!RATIO_RANGE[id], `rentang tersedia: ${id}`);
  }
}

console.log('\n-- batas batas jepit (tidak tumpang tindih ke kanan) --');
{
  ok(matchesRatio(r(1920, 1080), 'landscape'), '16:9 -> landscape');
  ok(!matchesRatio(r(1080, 1920), 'landscape'), '9:16 bukan landscape');
  ok(matchesRatio(r(1080, 1920), 'portrait'), '9:16 -> portrait');
  ok(!matchesRatio(r(1920, 1080), 'portrait'), '16:9 bukan portrait');
  ok(matchesRatio(r(1080, 1080), 'square'), '1:1 -> square');
  ok(!matchesRatio(r(1920, 1080), 'square'), '16:9 bukan square');
  ok(matchesRatio(r(3440, 1440), 'ultrawide'), '21:9 -> ultrawide');
  ok(!matchesRatio(r(1920, 1080), 'ultrawide'), '16:9 bukan ultrawide');
  ok(matchesRatio(r(1170, 2532), 'tall'), '19.5:9 -> tall');
  ok(matchesRatio(r(1080, 1920), 'tall'), '9:16 -> tall');
  ok(!matchesRatio(r(3, 4), 'tall'), '3:4 portrait tapi belum tall');
  ok(matchesRatio(r(3, 4), 'portrait'), '3:4 -> portrait');
}

console.log('\n-- batas eksak tidak bocor --');
{
  // landscape >= 1.15, portrait < 0.87, square [0.87, 1.15), tall < 0.7, ultrawide >= 2
  ok(matchesRatio(1.15, 'landscape'), 'tepat 1.15 -> landscape');
  ok(!matchesRatio(1.1499, 'landscape'), '1.1499 bukan landscape');
  ok(!matchesRatio(0.87, 'portrait'), 'tepat 0.87 bukan portrait');
  ok(matchesRatio(0.8699, 'portrait'), '0.8699 -> portrait');
  ok(matchesRatio(0.87, 'square'), 'tepat 0.87 -> square');
  ok(!matchesRatio(1.15, 'square'), 'tepat 1.15 bukan square');
  ok(!matchesRatio(0.7, 'tall'), 'tepat 0.7 bukan tall');
  ok(matchesRatio(0.6999, 'tall'), '0.6999 -> tall');
  ok(matchesRatio(2, 'ultrawide'), 'tepat 2.0 -> ultrawide');
  ok(!matchesRatio(1.9999, 'ultrawide'), '1.9999 bukan ultrawide');
}

console.log('\n-- "any" dan id tak dikenal --');
{
  ok(matchesRatio(0.5, 'any'), 'any menerima potret');
  ok(matchesRatio(4, 'any'), 'any menerima ultrawide');
  ok(matchesRatio(1.5, 'entah'), 'id tak dikenal -> lolos (bukan crash)');
  ok(matchesRatio(1.5, undefined), 'ratio kosong -> lolos');
}

console.log('\n-- dimensi tidak diketahui tidak boleh lolos --');
{
  ok(!matchesRatio({ ratio: 0 }, 'landscape'), 'ratio 0 ditolak');
  ok(!matchesRatio({ ratio: NaN }, 'landscape'), 'ratio NaN ditolak');
  ok(!matchesRatio({ ratio: 'abc' }, 'landscape'), 'ratio non-numerik ditolak');
  ok(!matchesRatio({}, 'landscape'), 'field ratio hilang ditolak');
  ok(matchesRatio({ ratio: 1.777 }, 'landscape'), 'item Bernoulli diterima');
  ok(!matchesRatio(null, 'portrait'), 'item null tidak crash');
}

console.log('\n-- selaras dengan aspectInfo() --');
{
  // aspectInfo memakai ambang yang sama untuk landscape/portrait/square
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1000, 1000], [1024, 900], [900, 1024]]) {
    const { ratio, orientation } = aspectInfo(w, h);
    ok(matchesRatio(ratio, orientation), `${w}x${h} (${orientation}, ${ratio.toFixed(3)}) konsisten`, `orientation=${orientation}`);
  }
  const tall = aspectInfo(1170, 2532);
  ok(tall.orientation === 'portrait' && matchesRatio(tall.ratio, 'tall'), '19.5:9 tetap portrait sekaligus tall');
}

console.log(`\nFilter rasio: ${pass} lulus, ${fail.length} gagal, dari ${pass + fail.length} case`);
if (fail.length) {
  console.log(`  gagal: ${fail.join(', ')}`);
  process.exit(1);
}
