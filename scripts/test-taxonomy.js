/**
 * Test aturan taksonomi (kategori otomatis) — tanpa butuh server.
 *   node scripts/test-taxonomy.js
 *
 * Fokus: hanya entitas (nama karakter/series) boleh jadi kategori otomatis.
 * Atribut generik & tag noise harus ditolak, dan tidak boleh ada label duplikat.
 *
 * Ingest sintetis ditulis ke file sementara lewat HOSHIVA_TAXONOMY_FILE supaya
 * taksonomi yang sedang dipakai user tidak tersentuh.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoshiva-tax-')), 'taxonomy.json');
process.env.HOSHIVA_TAXONOMY_FILE = TMP;

const { isUsefulTag, canPromote, ingest, stats, listCategories } = await import('../server/categories.js');
const { SEED_CATEGORIES } = await import('../server/config.js');

// Tag yang TIDAK boleh menjadi kategori otomatis.
const REJECT = [
  'outdoors', 'women outdoors', 'indoors', 'absurdres', 'highres', 'lowres', 'wallpaper',
  'long hair', 'blue hair', 'black hair', 'redhead', 'blonde', 'medium hair', 'ahoge',
  'bangs', 'double-parted bangs', 'twintails', 'ponytail', 'hairband', 'ponytail',
  '1girl', '2boys', 'girl', 'boy', 'solo', 'female focus', 'male focus', 'breasts', 'breast', 'cleavage', 'topless',
  'looking at viewer', 'looking back', 'smile', 'closed mouth', 'open mouth', 'blush',
  'detached sleeves', 'bare shoulders', 'shoulders', 'collar', 'buttons', 'ribbon',
  'horn', 'horns', 'weapon', 'holding', 'hand', 'arms', 'thighhighs', 'stockings',
  'face', 'chest', 'upper body', 'cropped', 'multiple views', 'model',
  'background', 'simple background', 'original', 'photo', 'cosplay', 'people',
  'commentary', 'english commentary', 'translated', 'japanese text', 'text',
  'signature', 'watermark', 'official art', 'scan', 'scanlation', 'tagme', 'rating',
  'safe', 'questionable', 'sensitive', 'pixelated', 'jpeg artifacts', 'shading',
  // Tag placeholder Danbooru (DUMMY_TAGS). Ini menandai "field mana yang tidak
  // diisi", bukan isi gambar, tapi menempel ke ribuan post. dipindahkan ke
  // REJECT pada revisi cap/decay: sebelumnya "character name" ada di ACCEPT
  // dan ikut menduduki peringkat teratas daftar kategori (958 hit).
  'character name', 'artist name', 'copyright name', 'series', 'book',
  'digital media', 'traditional media', 'character doll', 'other focus',
  // Atribut generik yang bocor karena \b tidak menangkap bentuk turunan:
  // "sleeves" tidak match "sleeveless", "cloth" tidak match "clothes".
  'standing', 'sitting', 'squatting', 'kneeling', 'leaning', 'posing', 'from side',
  'sleeveless', 'clothes', 'clothing', 'outfit', 'sweater', 'apron', 'scarf',
  'belt', 'bag', 'bags', 'glasses', 'eyewear', 'helmet', 'mask', 'crown', 'veil',
  'cape', 'robe', 'sandals', 'tall', 'square', 'rectangle', 'circular',
  'teeth', 'tooth', 'fang', 'fangs', 'tongue', 'mane', 'skull', 'skeleton', 'humanoid',
];

/**
 * Tag yang masih berguna (mengisi seed kategori & trending) TAPI tidak boleh
 * dipromosikan jadi kategori baru — karena sudah tercakup kategori seed, atau
 * karena cuma suasana/waktu yang bukan identitas (filter SCENE_TIME).
 */
const NO_PROMOTE = [
  'landscape', 'scenery', 'panorama', 'cityscape', 'night', 'sakura', 'cherry blossom',
  'cloud', 'clouds', 'blue sky', 'sunset', 'sunrise', 'cyberpunk', 'anime', 'flowers',
  'nature', 'beach', 'starry sky', 'stars', 'magic', 'dragon', 'sunflowers',
  // Waktu & suasana: berguna untuk trending, tapi "Day"/"Night Sky" bukan
  // kategori yang pernah muncul di sidebar kategori lain.
  'day', 'days', 'dawn', 'morning', 'evening', 'midnight', 'night sky', 'golden hour',
];

// Tag yang WAJIB boleh jadi kategori otomatis (entitas / tema).
const ACCEPT = [
  'project sekai', 'bang dream!', 'initial d', 'hololive', 'touhou', 'genshin impact',
  'blue archive', 'azur lane', 'arknights', 'kantai collection', 'love live', 'k on',
  'vocaloid', 'hatsune miku', 'kagamine rin', 'monogatari', 'puella magi madoka magica',
  'shingeki no kyojin', 'danganronpa', 'naruto', 'one piece', 'fate grand order',
  'ganyu (genshin impact)', 'irys (hololive)', 'masking (bang dream!)', 'blame!',
  'mae ve', 'neo (d4dj)', 'sophia (d4dj)', 'science fiction', 'cyber city',
  'sky', 'sun', 'water', 'flower', 'rain', 'snow', 'night sky', 'city lights',
  'women', 'idolmaster million live! theater', 'pumpkin',
  // Sufiks disambiguasi Danbooru. Kata-kata yang sama dalam bentuk "(...)"
  // justru PENANDA tag sah, jadi harus tetap diterima. Ini regression untuk
  // percobaan memblokir "character"/"series"/"artist" sebagai regex ? cara itu
  // membuang Devilman (character), Fate (series), Pokemon (creature),
  // Project Diva (series), Aikatsu! (series), dan Eo (artist).
  'devilman (character)', 'fate (series)', 'pokemon (creature)', 'aikatsu! (series)',
  'project diva (series)', 'eo (artist)', 'hello kitty (character)',
  // "days" adalah bagian dari nama series, bukan penanda waktu.memblokir
  // "days" sebagai substring di SCENE_TIME pernah membuang entitas 869 hit ini.
  'idolmaster million live! theater days',
];

let pass = 0;
const fail = [];

for (const t of REJECT) {
  if (isUsefulTag(t)) fail.push(`HARUS DITOLAK  ${t}`);
  else pass++;
}
for (const t of ACCEPT) {
  if (!isUsefulTag(t)) fail.push(`HARUS DITERIMA ${t}`);
  else pass++;
}

// Tag seed boleh "berguna" tapi tidak boleh jadi kategori otomatis (duplikat).
for (const t of NO_PROMOTE) {
  if (!isUsefulTag(t)) fail.push(`SEED TIDAK BERGUNA ${t}`);
  else if (canPromote(t)) fail.push(`HARUS TIDAK DI-PROMOTE ${t}`);
  else pass++;
}

// Label kategori seed harus unik (kalau tidak, sidebar menampilkan duplikat).
const labels = SEED_CATEGORIES.map((c) => c.label.toLowerCase());
for (const l of labels) {
  if (labels.filter((x) => x === l).length > 1) fail.push(`DUPLIKAT seed "${l}"`);
}

// Ingest sintetis: pastikan taksonomi tetap deterministik & tidak menghasilkan duplikat.
const sample = (title, tags, w = 1920, h = 1080) => ({
  source: 'test', id: `${title}-${tags.length}-${w}`, title, tags,
  width: w, height: h, orientation: w >= h ? 'landscape' : 'portrait', category: 'general',
});
for (let i = 0; i < 60; i++) {
  ingest([
    sample('Project Sekai', ['project sekai', 'outdoors', 'absurdres', 'blue hair', '1girl', 'sky']),
    sample('Bang Dream!', ['bang dream!', 'looking at viewer', 'outdoors', 'bangs', 'long hair']),
    sample('Hatsune Miku', ['hatsune miku', 'vocaloid', 'highres', '1girl', 'detached sleeves']),
  ]);
}

const s = stats();

// Tidak boleh ada label duplikat setelah ingest ? termasuk antara kategori auto.
const cats = listCategories({ includeAuto: true, minHits: 0, limit: 500 });
const seen = new Map();
for (const c of cats) seen.set(c.label.toLowerCase(), (seen.get(c.label.toLowerCase()) || 0) + 1);
for (const [l, n] of seen) if (n > 1) fail.push(`DUPLIKAT label "${l}" (${n}x)`);

// Kategori auto yang terbentuk dari sampel harus semuanya entitas.
for (const c of cats.filter((x) => x.auto)) {
  if (REJECT.includes(c.label.toLowerCase())) fail.push(`KATEGORI AUTO "${c.label}" seharusnya ditolak`);
  if (NO_PROMOTE.includes(c.label.toLowerCase())) fail.push(`DUPLIKAT SEED "${c.label}" muncul sebagai auto`);
}

console.log(`\n  Auto kategori terbentuk: ${cats.filter((c) => c.auto).map((c) => c.label).join(', ') || '(tidak ada)'}`);

/* ------------------------------------------------------------------ *
 * Anggaran: 4 rem yang menjaga kategori auto tetap ringan.
 * Diuji terpisah karena butuh state modul yang sudah terisi, sedangkan
 * modul di atas hanya bisa di-load sekali per proses (FILE dibaca di
 * level modul). Jalankan: node scripts/test-budget.js
 * ------------------------------------------------------------------ */
for (const f of fail) console.log('  ' + f);
console.log(`\n  Taksonomi: ${pass} lulus, ${fail.length} gagal, dari ${REJECT.length + ACCEPT.length + NO_PROMOTE.length} tag`);
console.log(`  Setelah ingest sintetis: ${s.totalCategories} kategori (${s.autoCategories} auto) dari ${s.totalIngested} wallpaper`);
console.log(`  Rem kategori (cap/decay/delay): diuji terpisah di scripts/test-budget.js`);

fs.rmSync(path.dirname(TMP), { recursive: true, force: true });
process.exit(fail.length ? 1 : 0);