/**
 * Test anggaran kategori otomatis: ambang, cap, decay, delay.
 *   node scripts/test-budget.js
 *
 * Terpisah dari test-taxonomy.js karena modul categories.js membaca FILE-nya
 * sekali di level modul, jadi tidak bisa di-load ulang dengan state berbeda
 * di proses yang sama. Test ini memakai cache-busting (?v=) untuk mendapat
 * instance modul yang benar-benar baru tiap skenario.
 *
 * Semua operasi menulis ke file taksonomi sementara, bukan data user.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshiva-budget-'));
const TMP = path.join(DIR, 'taxonomy.json');
// WAJIB di-set sebelum import: FILE dibaca sekali di level modul.
process.env.HOSHIVA_TAXONOMY_FILE = TMP;

const MOD = pathToFileURL(path.resolve(HERE, '../server/categories.js')).href;
const DAY = 86400000;

let pass = 0;
const fail = [];
const ok = (cond, name, extra = '') => {
  if (cond) pass++;
  else fail.push(name + (extra ? `  (${extra})` : ''));
};

const write = (raw) => fs.writeFileSync(TMP, JSON.stringify(raw), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Load modul dengan cache-busting supaya state benar-benar baru. */
async function freshLoad(raw) {
  write(raw);
  return import(MOD + '?v=' + Math.random());
}

const cat = (id, hits, lastSeen) => ({
  id,
  label: id.replace(/^auto:/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  emoji: '🏷️',
  auto: true,
  hits,
  lastSeen,
});

const items = (tag, n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `w-${i}-${tag}`,
    source: 'test',
    title: 'x',
    width: 1920,
    height: 1080,
    orientation: 'landscape',
    tags: [tag],
  }));

const autoCount = (m) => m.listCategories({ limit: 5000 }).filter((c) => c.auto).length;
const labelsOf = (m) => m.listCategories({ limit: 5000 }).map((c) => c.label);

/* ---------------- 1. ambang: 12 -> 22, entitas 3 -> 5 ---------------- */
{
  fs.rmSync(TMP, { force: true });
  const m = await freshLoad({ cats: {}, tagStats: {}, posts: {}, totalIngested: 0 });

  m.ingest(items('Lantern Study', 15));
  ok(!labelsOf(m).includes('Lantern Study'), 'tag biasa 15x belum promoted (ambang 22)');

  m.ingest(items('Kirby (game)', 4));
  ok(!labelsOf(m).includes('Kirby (game)'), 'entitas 4x belum promoted (ambang 5)');

  m.ingest(items('Kirby (game)', 1));
  ok(labelsOf(m).includes('Kirby (game)'), 'entitas 5x promoted');

  m.ingest(items('Lantern Study', 7));
  ok(labelsOf(m).includes('Lantern Study'), 'tag biasa 22x promoted');
}

/* ------------- 2. cap: pendatang baru hanya evict yang lebih lemah ------------- */
{
  const now = Date.now();
  const cats = {};
  for (let i = 0; i < 400; i++) cats[`auto:series${i}`] = cat(`auto:series${i}`, 100 + i, now);
  const m = await freshLoad({ cats, tagStats: {}, posts: {}, totalIngested: 0 });
  ok(autoCount(m) === 400, 'cap: 400 kategori lolos');

  // counter 50 < kategori terlemah (100) -> ditolak
  m.ingest(items('weakling series (weakling)', 60));
  ok(autoCount(m) === 400, 'cap: pendatang lemah tidak menambah jumlah');
  ok(!labelsOf(m).includes('Weakling series (weakling)'), 'cap: kategori lemah tidak masuk');

  // counter 320 > kategori terlemah (100) -> boleh evict
  m.ingest(items('strongseries (strongseries)', 320));
  ok(autoCount(m) === 400, 'cap: tetap 400 (evict 1, tambah 1)');
  ok(labelsOf(m).includes('Strongseries (strongseries)'), 'cap: kategori kuat masuk');
  ok(!labelsOf(m).includes('Series0'), 'cap: kategori terlemah ter-evict');
}

/* ---------------- 3. trimToCap: kelebihan dipangkas saat boot ---------------- */
{
  const now = Date.now();
  const cats = {};
  for (let i = 0; i < 460; i++) cats[`auto:batch${i}`] = cat(`auto:batch${i}`, 1000 - i, now);
  const m = await freshLoad({ cats, tagStats: {}, posts: {}, totalIngested: 0 });
  ok(autoCount(m) === 400, 'trim: 460 -> 400');
  ok(!labelsOf(m).includes('Batch459'), 'trim: yang terlemah dipangkas');
  ok(labelsOf(m).includes('Batch0'), 'trim: yang terkuat bertahan');
}

/* ---------------- 4. decay: basi + lemah dibuang, counter di-nol-kan ---------------- */
{
  const now = Date.now();
  const cats = {
    'auto:staleone': cat('auto:staleone', 3, now - 40 * DAY),
    'auto:staletwo': cat('auto:staletwo', 11, now - 31 * DAY),
    'auto:staletree': cat('auto:staletree', 12, now - 90 * DAY),
    'auto:freshone': cat('auto:freshone', 2, now - 1 * DAY),
    'auto:strongone': cat('auto:strongone', 500, now - 400 * DAY),
  };
  const m = await freshLoad({ cats, tagStats: {}, posts: {}, totalIngested: 0 });
  const labels = labelsOf(m);
  ok(!labels.includes('Staleone'), 'decay: staleone (3 hit, 40h) dibuang');
  ok(!labels.includes('Staletwo'), 'decay: staletwo (11 hit, 31h) dibuang');
  ok(!labels.includes('Staletree'), 'decay: staletree (12 hit, 90h) dibuang');
  ok(labels.includes('Freshone'), 'decay: freshone (2 hit tapi baru) bertahan');
  ok(labels.includes('Strongone'), 'decay: strongone (500 hit) walau basi, bertahan');

  // save() di-debounce 1200ms, tunggu dulu sebelum membaca file.
  await sleep(1600);
  const raw = JSON.parse(fs.readFileSync(TMP, 'utf8'));
  ok(raw.tagStats.staleone?.count === 0, 'decay: counter di-nol-kan (jeda, bukan dikembalikan utuh)');

  // Bukti perilaku: 3 kemunculan tidak boleh langsung promoted lagi.
  m.ingest(items('staleone', 3));
  ok(!labelsOf(m).includes('Staleone'), 'decay: 3 kemunculan tidak langsung promoted lagi');
}

/* ---------------- 5. delay: tidak mengulang pekerjaan sebelum interval ---------------- */
{
  const now = Date.now();
  const cats = {};
  for (let i = 0; i < 450; i++) cats[`auto:delay${i}`] = cat(`auto:delay${i}`, 100 + i, now);
  const m = await freshLoad({ cats, tagStats: {}, posts: {}, totalIngested: 0 });
  ok(autoCount(m) === 400, 'delay: boot memangkas ke 400');

  for (let k = 0; k < 5; k++) m.ingest(items('lantern study', 1));
  ok(autoCount(m) === 400, 'delay: 5 ingest beruntun tidak memicu cap lagi',
     `tambah ${autoCount(m) - 400}`);
}

/* ---------------- 6. DUMMY_TAGS & sufiks disambiguasi ---------------- */
{
  const m = await freshLoad({ cats: {}, tagStats: {}, posts: {}, totalIngested: 0 });
  for (const t of ['character name', 'artist name', 'digital media', 'series', 'book',
                   'copyright name', 'character doll', 'other focus']) {
    ok(m.canPromote(t) === false, `dummy ditolak: ${t}`);
  }
  for (const t of ['devilman (character)', 'fate (series)', 'pokemon (creature)',
                   'eo (artist)', 'aikatsu! (series)', 'project diva (series)']) {
    ok(m.canPromote(t) === true, `entitas dengan sufiks diterima: ${t}`);
  }
  for (const t of ['standing', 'sitting', 'teeth', 'square', 'tall', 'sleeveless',
                   'open clothes', 'sweater', 'humanoid', 'skeleton', 'skull']) {
    ok(m.canPromote(t) === false, `atribut ditolak: ${t}`);
  }
  // Regression: '|' yang hilang di salah satu baris GENERIC_ATTR pernah
  // menyatukan "brunette" + "standing" jadi "brunettestanding", sehingga
  // keduanya tidak lagi terdeteksi.
  ok(m.canPromote('brunette') === false, 'regression: brunette masih ditolak');
  ok(m.canPromote('long hair') === false, 'regression: long hair masih ditolak');
  // Regression: 'days' di SCENE_TIME pernah membuang entitas 869 hit.
  ok(m.canPromote('idolmaster million live! theater days') === true,
     'regression: "...theater days" tetap diterima');
  ok(m.canPromote('days') === false, 'regression: tag "days" utuh tetap ditolak');
}

for (const f of fail) console.log('  GAGAL  ' + f);
console.log(`\n  Rem kategori: ${pass} lulus, ${fail.length} gagal`);
fs.rmSync(DIR, { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);