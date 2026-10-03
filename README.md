# Hoshiva

Mesin pencari wallpaper anime modern. Backend Node/Express memproxyl semua
permintaan ke sumber gambar booru (DAPI Gelbooru + Wallhaven), menyediakannya
dengan ukuran yang tepat untuk layarmu, dan melakukan upscale opsional dengan
gaya waifu2x.

![Hoshiva](public/assets/logo.png)

---

## Fitur

- **Pencarian multi-sumber** — Wallhaven (wallpaper-oriented) + Safebooru, dan
  booru lain yang kompatibel DAPI. Hasil digabung round-robin supaya satu
  sumber yang down tidak mengosongikan halaman. Sumber yang tidak terjangkau
  disembunyikan dari pilihan; kalau tak satu pun hidup, hanya **Otomatis** yang
  tersisa.
- **Panel filter berupa drawer** — disembunyikan secara bawaan dan meluncur
  keluar dari kanan, jadi tidak menutupi setengah layar. Isinya: rasio,
  kategori (semua kategori ditampilkan, tanpa tombol "tampilkan lagi"), tag
  populer, dan urutan. Panel ukuran/upscale tidak ada di sini — pengaturannya
  ada di lightbox.
- **Detail in-modal (lightbox)** — klik kartu untuk melihat judul, dimensi,
  sumber, tag, gambar serupa, plus pengaturan ukuran, crop, dan upscale.
- **Preset ukuran wallpaper** — 12 preset (FHD, QHD, 4K, 5K, ultrawide 21:9 &
  32:9, square, ponsel, iPad, "Layar Saya", "Asli (Full Res)"), plus kolom
  lebar × tinggi manual.
- **Default = layar Anda** — preset "Layar Saya" memakai
  `screen.width × height × devicePixelRatio` dari browser, jadi unduhan langsung
  pas dengan layar tanpa perlu menebak.
- **Crop manual** — seret kotak (atau sudutnya) di atas gambar untuk memotong
  bagian yang diinginkan. Dibatasi server: minimal 15% per sisi **dan** minimal
  320px, jadi crop 100×100 dari wallpaper besar memang dicegah. Crop disimpan
  per wallpaper di `localStorage` dan ikut terbawa ke unduhan.
- **Upscale satu tombol** — tidak ada lagi pilihan mode. Tombol **Upscale
  otomatis** menaikkan gambar hanya kalau target lebih besar dari sumber
  (dicek setelah crop), memakai gaya waifu2x. Bila binary `waifu2x-ncnn`
  terpasang, ia dipakai otomatis.
- **Kategori otomatis** — setiap wallpaper yang masuk "diumati"; entitas
  (nama karakter/series) yang sering muncul dipromosikan menjadi kategori baru.
  Tag generik (rambut, warna pakaian, ekspresi, waktu/suasana seperti `day`
  atau `dawn`) tidak pernah dipromosikan. Disimpan permanen ke
  `data/taxonomy.json`.
  Jumlahnya dijaga empat rem supaya tidak membengkak — lihat
  [Anggaran kategori](#anggaran-kategori).
- **Filter orientasi yang benar** — Landscape / Portrait / Square / Tall /
  Ultrawide. Sumber tidak selalu dipercaya: Wallhaven hanya menerima daftar
  `ratios` miliknya sendiri dan booru mengandalkan tag yang sering kosong, jadi
  server menyaring ulang hasil akhir berdasarkan rasio sebenarnya (lihat
  `RATIO_RANGE` di `server/sources.js`).
- **Tema gelap/terang** (setiap tema punya logo sendiri), layout responsif,
  tanpa build step.

---

## Menjalankan

```bash
npm install
npm start
```

Buka <http://127.0.0.1:4173>.

Butuh **Node.js 18+** (diuji di Node 24). Sharp punya prebuilt binary untuk
Windows/macOS/Linux sehingga tidak perlu compiler.

### Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm start` | jalankan server produksi |
| `npm run dev` | jalankan dengan `--watch`, auto-reload |
| `npm test` | test unit (tanpa server): SSRF, taksonomi, pipeline gambar, cache, filter rasio |
| `npm run test:api` | test endpoint — **server harus sudah jalan** |
| `npm run test:ssrf` | hanya test guard SSRF |
| `npm run test:taxonomy` | hanya test aturan kategori otomatis |
| `npm run test:budget` | hanya test rem kategori: ambang, cap, decay, delay |
| `npm run test:image` | hanya test pipeline resize/upscale |
| `npm run test:cache` | hanya test cache memori + disk |
| `npm run test:ratio` | hanya test filter orientasi/rasio |
| `npm run logo` | buat ulang logo terang dari sumber (lihat bagian Logo) |
| `npm run logo:dark` | buat ulang logo tema gelap dari sumber |

### Variabel lingkungan

| Variabel | Default | Guna |
| --- | --- | --- |
| `PORT` | `4173` | port server |
| `HOST` | `127.0.0.1` | bind address (set `0.0.0.0` untuk diakses dari perangkat lain) |
| `FETCH_TIMEOUT` | `15000` | timeout fetch ke sumber, dalam ms |
| `MAX_OUTPUT_PX` | `12000` | batas sisi terpanjang hasil resize/upscale |
| `WAIFU2X_PATH` | — | path absolut binary `waifu2x-ncnn` |

---

## waifu2x asli (opsional)

Tanpa binary apa pun, Hoshiva tetap bisa upscale memakai `sharp`
(median denoise → Lanczos3 → unsharp), yang hasilnya cukup bagus untuk garis
anime. Untuk hasil waifu2x yang asli:

1. Unduh **waifu2x-ncnn** (rilis Windows/Linux di
   [`nagadomi6/waifu2x-ncnn`](https://github.com/nagadomi6/waifu2x-ncnn/releases)).
2. Ekstrak, lalu taruh binary-nya di `D:\web\hoshiva\tools\waifu2x-ncnn.exe`
   (atau set `WAIFU2X_PATH` ke path lengkap).
3. Restart server.

Hoshiva mendeteksi binary itu saat boot dan otomatis memakainya. Header
`x-hoshiva-engine` pada `/api/img` memberi tahu yang benar-benar dipakai:
`waifu2x-binary` atau `sharp-waifu2x`. Kalau binary gagal, sistem otomatis
kembali ke `sharp` dan hanya menulis satu peringatan ke log.

---

## Sumber gambar

| Sumber | Jenis | Status di jaringan ini |
| --- | --- | --- |
| Wallhaven | Wallhaven API | ✅ hidup |
| Safebooru | DAPI (booru) | ✅ hidup |
| Gelbooru | DAPI (booru) | ❌ tidak terjangkau |
| Konachan / Rule34 / Xbooru | DAPI (booru) | ❌ tidak terjangkau |

Hoshiva dirancang multi-sources: sumber yang gagal akan dilewati dan ditampilkan
sebagai DOWN di panel status, sementara sumber yang hidup tetap melayani
permintaan. Di jaringan tempat proyek ini dibuat, hanya Wallhaven dan Safebooru
yang terjangkau — di jaringan lain (tanpa pemblokiran) Gelbooru & teman
otomatis ikut menyumbang.

### Menambah sumber baru

Buka `server/sources.js`, tambahkan entri ke `SOURCES`:

```js
{
  id: 'mybooru',
  label: 'My Booru',
  kind: 'booru',          // 'booru' (DAPI Gelbooru) atau 'wallhaven'
  base: 'https://mybooru.example',
  purity: 'safe',         // 'safe' | 'sfw' | 'nsfw'
  wallpaper: true,
}
```

Adapter `kind: 'booru'` otomatis menangani pagination DAPI (parameter `pid`),
tag berformat underscore, dan pemetaan `1girl`/`1boy` → `girl`/`boy`.

---

## Logo

Logo memakai dua varian yang dipilih lewat `html[data-theme]`. Keduanya di-build
dengan langkah yang sama: flood-fill BFS dari 4 sudut (hanya latar yang terhubung
ke tepi yang dibuang, jadi bagian dalam huruf tidak ikut berlubang) → un-
premultiply tepi agar tidak bergaris gelap → trim ke bounding box isi.

| Perintah | Sumber | Keluaran |
| --- | --- | --- |
| `npm run logo` | `Downloads/Logo Hoshiva.png` (latar putih) | `logo.png`, `logo-512.png`, `public/favicon.png` |
| `npm run logo:dark` | `Downloads/logo terang.png` (2000×2000, latar `rgb(25,25,25)`) | `logo-dark.png`, `logo-dark-512.png` |

Sumber file di-hardcode di bagian atas masing-masing script
(`scripts/make-logo.js` dan `scripts/logo-theme.js`); edit `SRC` bila file Anda
berada di tempat lain, atau lempar path sebagai argumen pertama:

```bash
node scripts/logo-theme.js "D:/gambar/logo baru.png"
```

Skrip `logo-theme.js` juga otomatis memangkas kanvas 2000×2000 menjadi wordmark
lebar (hasilnya sekitar 3.5:1, sama rasio dengan logo terang) lewat `.trim()`,
sehingga tinggi header tidak berubah saat tema diganti.

> Logo gelap punya tekstur scanline di dalam hurufnya, jadi saat di-downscale ke
> 42px tekstur itu berubah jadi moiré. Karena itu tinggi logo di header tetap
> 42px — bukan dinaikkan untuk menghindari artefak.

Logo dipakai di dua tempat, dan keduanya memakai pasangan varian yang sama:

| Tempat | Tema terang | Tema gelap | Tinggi |
| --- | --- | --- | --- |
| header (`.brand__logo`) | `logo.png` | `logo-dark.png` | 42px |
| footer (`.foot__logo`) | `logo-512.png` | `logo-dark-512.png` | 30px |

Varian yang tidak aktif memakai `display: none`, bukan disembunyikan dengan
opacity, supaya tidak ikut memengaruhi layout.

`opacity` logo footer **wajib berbeda per tema**, dan itu bukan soal selera —
kedua logo punya polaritas terbalik, jadi satu nilai tidak bisa melayani keduanya:

| Tema | Background | Stroke logo | `opacity` | Kontras | WCAG AA |
| --- | --- | --- | --- | --- | --- |
| terang | `rgb(247,245,251)` | `L≈0.01` (hitam) | `.85` | 4.94:1 | lolos |
| gelap | `rgb(8,8,15)` | `L=1.0` (putih) | `.4` | 8.59:1 | lolos |

Nilai lama `.55` untuk keduanya menghasilkan kontras 2.07:1 di tema terang —
gagal AA, logonya praktis tak terbaca. `grayscale()` hanya dipasang pada varian
terang; varian gelap sudah putih sehingga filter itu hanya membuat putihnya keruh.

> `favicon.png` dan `apple-touch-icon` tetap memakai varian terang. Keduanya tidak
> bisa Berganti lewat CSS, dan tab browser jarang obeyed `data-theme`.

---

## Anggaran kategori

Kategori otomatis bertambah setiap wallpaper yang masuk, jadi tanpa rem ukurannya
tumbuh linear. Pada data sekarang rasionya **0,0908 kategori per ingest**:

| Total ingest | Kategori | Payload `/api/categories` |
| --- | --- | --- |
| 8.638 (sekarang) | 412 | 42 KB |
| 50.000 | ~4.500 | ~470 KB |
| 200.000 | ~18.000 | ~1,8 MB |

Sebagian besar itu sampah: sebelum rem ini dipasang, **61% kategori punya
≤12 hit** dan peringkat teratasnya adalah tag placeholder Danbooru —
`Character Name` (958 hit), `Artist Name` (174), `Digital Media` (172). Semuanya
menduduki posisi teratas padahal tidak pernah berguna difilter.

Empat rem di `server/categories.js` (bagian `budgets`):

| Rem | Nilai | Fungsi |
| --- | --- | --- |
| Ambang promote | `PROMO_MIN_ENTITY` 5, `PROMO_MIN_PLAIN` 22 |—was 3 dan 12. Tag biasa harus lebih sering muncul sebelum jadi kategori |
| Plafon keras | `MAX_AUTO_CATS` 400 | Tidak bisa dilewati, dipangkas saat boot dan tiap 5 menit |
| Meluruh | `STALE_AFTER` 30 hari, `STALE_MIN_HITS` 12 | Kategori lama yang tak pernah dipakai dibuang; harus bukti baru dari nol |
| Penundaan | `CAP_CHECK_MS` 5 menit, `STALE_CHECK_MS` 6 jam | Cap & sweep tidak jalan tiap ingest, tapi terjadwal |

Dua detail yang mudah salah dan sudah enshrined sebagai regression test:

- **Cap adalah penyaring kualitas, bukan kuota.** Saat sudah di 400, kategori baru
  hanya boleh masuk kalau lebih kuat daripada kategori auto yang terlemah.
  Kalau tidak, ia masuk lalu langsung menyingkirkan yang lain di sweep berikutnya.
- **Kategori yang dibuang karena basi atau bursting kehilangan counternya**
  (di-nol-kan), sedangkan yang dibuang karena melanggar aturan tetap menyimpan
  counter. Kalau counter basi dikembalikan utuh, tag itu langsung melewati ambang
  lagi di ingest berikutnya dan masuk siklus promote-demote-promote.

### Placeholder vs sufiks disambiguasi

`DUMMY_TAGS` (placeholder) sengaja dicocokkan **persis**, bukan dengan regex:

| Ditolak | Ditambah |
| --- | --- |
| `character name`, `artist name`, `series`, `digital media`, `book` | `devilman (character)`, `fate (series)`, `pokemon (creature)`, `eo (artist)` |

Kata `character`, `series`, `artist` yang sama dalam bentuk `(...)` justru
**penanda** tag sah — Danbooru memakainya untuk membedakan nama yang sama.
Memblokirnya sebagai regex pernah membuang 8 entitas sah termasuk
`Idolmaster Million Live! Theater Days` (869 hit).

---

## Struktur

```
server/
  index.js       Express app, semua route, penggabungan multi-sumber
  config.js      preset ukuran, mode upscale, sort, env
  sources.js     adapter Wallhaven + DAPI booru, scrape tag, pelonggaran query
  image.js       proxy + crop + resize + upscale, guard SSRF, deteksi waifu2x
  categories.js  taksonomi otomatis (promosi kategori dari entitas)
  cache.js       cache 2-lapis (memori LRU + disk TTL) dengan serialisasi Buffer-safe
public/
  index.html     markup (drawer filter + lightbox ukuran/crop/upscale)
  css/style.css  tema gelap/terang, drawer, cropper, responsif
  js/app.js      state, pencarian, grid, drawer, lightbox, modul crop
  js/api.js      klien API
  js/ui.js       helper DOM, toast, ukuran layar, skor wallpaper
scripts/
  make-logo.js   pipeline logo tema terang
  logo-theme.js  pipeline logo tema gelap
  test*.js       test suite
data/
  taxonomy.json  state taksonomi (dibuat otomatis)
  cache/         cache disk (dibuat otomatis, aman dihapus)
```

## API

Semua response JSON kecuali `/api/img`.

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/health` | status server + statistik |
| `GET /api/config` | preset, mode upscale, sort, rasio, sumber, status waifu2x, `crop.minFrac` / `crop.minPx` |
| `GET /api/search` | `q`, `tags`, `limit`, `sort`, `source`, `purity`, `minWidth`, `minHeight`, `ratio`, `includeGeneral`, `page`, `ttl` |
| `GET /api/post/:source/:id` | detail satu post (judul, tag, URL) |
| `GET /api/categories` | kategori + trending. `limit` default 500 (UI menampilkan semuanya) |
| `GET /api/categories/fresh` | wallpaper yang baru masuk |
| `GET /api/sources/status` | uptime tiap sumber |
| `GET /api/img` | proxy + crop + resize + upscale |
| `GET /api/img/meta` | metadata gambar (dimensi, format, ukuran) |

Parameter `/api/img`:

| Parameter | Nilai | Keterangan |
| --- | --- | --- |
| `url` | — | wajib, URL gambar sumber |
| `w`, `h` | px | ukuran target; `0` = pakai sisi gambar |
| `mode` | `contain`, `cover`, `width`, `height`, `raw` | cara memotong agar pas ukuran |
| `cx`, `cy`, `cw`, `ch` | fraksi 0..1 | crop manual, **harus keempatnya** sekaligus |
| `upscale` | `none`, `auto`, `waifu2x`, `anime` | `auto` hanya menaikkan bila target > sumber (setelah crop) |
| `scale` | 1..4 | faktor untuk `upscale=waifu2x`/`anime` |
| `fm` | `jpg`, `png`, `webp` | format keluaran |
| `quality` | 1..100 | kualitas JPEG/WebP (default 92) |
| `download` | `1` | kirim `content-disposition: attachment` |
| `ttl` | detik | TTL cache (default 3600) |

Crop memakai fraksi, bukan piksel, supaya koordinat tetap sah saat gambar
di-zoom atau DPI berubah. Batas: minimal 15% per sisi **dan** 320px (yang lebih
besar menang), dan area tidak boleh keluar gambar. Pelanggaran → `400` dengan
pesan `Crop tidak valid: …`, bukan `500`.

Contoh:

```
GET /api/search?q=sakura&limit=24&sort=fit
GET /api/img?url=<src>&w=3840&h=2160&mode=contain&upscale=auto
GET /api/img?url=<src>&cx=0.1&cy=0.1&cw=0.8&ch=0.8&w=1920&h=1080&mode=cover&download=1
```

---

## Keamanan

- **Guard SSRF** pada `/api/img` dan `/api/img/meta`: hanya `http`/`https`,
  dan host jaringan privat/loopback/link-local/CGNAT ditolak — termasuk bentuk
  singkat (`127.1`), desimal (`2130706433`), oktal, dan heksadesimal. Alamat
  IPv4-mapped IPv6 juga ditolak.
- **Redirect divalidasi per hop**, jadi host publik tidak bisa mengarahkan
  server ke jaringan internal.
- Request divalidasi sebelum di-*render*; penolakan menghasilkan `400`, bukan
  `500`.

---

## Test

```bash
npm test          # unit: SSRF, taksonomi, pipeline gambar, cache, filter rasio
npm start         # terminal lain
npm run test:api  # endpoint (butuh server hidup)
```

Test unit tidak butuh jaringan maupun server, dan tidak menyentuh data asli
(cache dan taksonomi ditulis ke direktori sementara).

Filter rasio diuji dua lapis: aturan batasnya di `scripts/test-ratio.js`
(offline, menguji `matchesRatio`), lalu dari sisi API untuk memastikan hasil
yang benar-benar sampai ke klien sudah tersaring.

---

## Lisensi

MIT