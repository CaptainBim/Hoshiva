/**
 * Menjalankan seluruh test yang tidak butuh server.
 *   npm test
 *
 * Test API (`npm run test:api`) terpisah karena membutuhkan server hidup.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const suites = [
  ['Guard SSRF', 'test-ssrf.js'],
  ['Taksonomi kategori', 'test-taxonomy.js'],
  ['Rem kategori', 'test-budget.js'],
  ['Pipeline gambar', 'test-image.js'],
  ['Cache', 'test-cache.js'],
  ['Filter rasio', 'test-ratio.js'],
];

let failed = 0;
for (const [name, file] of suites) {
  console.log(`\n${'#'.repeat(64)}\n# ${name}\n${'#'.repeat(64)}`);
  const r = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(`\n${'='.repeat(64)}`);
if (failed) {
  console.log(`  ${failed} dari ${suites.length} suite gagal\n`);
  process.exit(1);
}
console.log(`  Semua ${suites.length} suite lulus\n`);