# Hoshiva

Mesin pencari wallpaper modern. Backend Node/Express memproxyl semua
permintaan ke sumber gambar (Wallhaven + Safebooru), menyediakannya dengan
ukuran yang tepat untuk layarmu, dan mendukung upscale dengan gaya waifu2x.

<p align="center">
  <img src="public/assets/logo.png" alt="Hoshiva" width="420">
</p>

---

## Fitur

- **Pencarian multi-sumber** — Wallhaven (wallpaper-oriented) + Safebooru, dengan
  dukungan untuk sumber booru yang kompatibel DAPI. Hasil digabung round-robin supaya satu
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
  (dicek setelah crop), memakai gaya waifu2x. Bila binary `waifu2x-ncnn-vulkan`
  terpasang, ia dipakai otomatis.
- **Kategori otomatis** — setiap wallpaper yang masuk "diumati"; entitas
  (nama karakter/series) yang sering muncul dipromosikan menjadi kategori baru.
  Tag generik (rambut, warna pakaian, ekspresi, waktu/suasana seperti `day`
  atau `dawn`) tidak pernah dipromosikan. Disimpan permanen ke
  `data/taxonomy.json`.
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

### Variabel lingkungan

| Variabel | Default | Guna |
| --- | --- | --- |
| `PORT` | `4173` | port server |
| `HOST` | `127.0.0.1` | bind address (set `0.0.0.0` untuk diakses dari perangkat lain) |
| `FETCH_TIMEOUT` | `15000` | timeout fetch ke sumber, dalam ms |
| `MAX_OUTPUT_PX` | `12000` | batas sisi terpanjang hasil resize/upscale |
| `WAIFU2X_PATH` | — | path absolut executable `waifu2x-ncnn-vulkan` |

---

## waifu2x

Tanpa binary apa pun, Hoshiva tetap bisa upscale memakai `sharp` (median denoise →
Lanczos3 → unsharp), yang hasilnya cukup bagus untuk garis anime. Untuk memakai
engine waifu2x berbasis NCNN + Vulkan, gunakan **waifu2x-ncnn-vulkan** dari
[`nihui/waifu2x-ncnn-vulkan`](https://github.com/nihui/waifu2x-ncnn-vulkan/releases).

1. Unduh rilis yang sesuai dengan Windows/Linux/macOS dan GPU yang digunakan.
2. Ekstrak paketnya, lalu arahkan `WAIFU2X_PATH` ke executable
   `waifu2x-ncnn-vulkan` (di Windows biasanya `waifu2x-ncnn-vulkan.exe`).
3. Restart server.

Rilis tersebut menyediakan executable dan model yang diperlukan dalam paket
portable, tanpa perlu memasang CUDA atau runtime Caffe terpisah. Hoshiva
mendeteksi binary itu saat boot dan otomatis memakainya. Header `x-hoshiva-engine`
pada `/api/img` memberi tahu engine yang benar-benar dipakai:
`waifu2x-binary` atau `sharp-waifu2x`. Bila binary gagal, sistem otomatis
kembali ke `sharp` dan hanya menulis satu peringatan ke log.

## Sumber gambar

| Sumber | Jenis | Status di jaringan ini |
| --- | --- | --- |
| Wallhaven | Wallhaven API | ✅ hidup |
| Safebooru | DAPI (booru) | ✅ hidup |

Hoshiva dirancang multi-sources: sumber yang gagal akan dilewati dan ditampilkan
sebagai DOWN di panel status, sementara sumber yang hidup tetap melayani
permintaan.

### Menambah sumber baru

Buka `server/sources.js`, tambahkan entri ke `SOURCES`:

```js
{
  id: 'mybooru',
  label: 'My Booru',
  kind: 'booru',          // booru yang kompatibel DAPI
  base: 'https://mybooru.example',
  purity: 'safe',         // 'safe' | 'sfw' | 'nsfw'
  wallpaper: true,
}
```

Adapter `kind: 'booru'` otomatis menangani pagination DAPI (parameter `pid`),
tag berformat underscore, dan pemetaan `1girl`/`1boy` → `girl`/`boy`.

---

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

## Anggaran kategori

Kategori otomatis bertambah sendiri setiap kali ada wallpaper baru masuk, jadi
tanpa rem pun ia tumbuh tanpa batas. Empat rem berjalan bersamaan; semuanya
ada di `server/categories.js` pada blok `budgets`.

| Rem | Nilai | Yang dicegah |
| --- | --- | --- |
| Ambang promote | `PROMO_MIN_ENTITY` 5, `PROMO_MIN_PLAIN` 22 | entity dengan 5 hit, kata umum dengan 22 hit |
| Cap | `MAX_AUTO_CATS` 400 | pertumbuhan tanpa batas |
| Decay | `STALE_AFTER` 30 hari, `STALE_MIN_HITS` 12 | kategori lama yang tidak relevan lagi |
| Delay | `CAP_CHECK_MS` 5 menit, `STALE_CHECK_MS` 6 jam | penyapuan setiap kali ingest |

**Cap adalah filter kualitas, bukan kuota.** Saat sudah di 400, kategori baru
hanya boleh naik kalau hit-nya melampaui kategori otomatis terlemah yang ada.
Jadi cap tidak memangkas membuta tuli, dan kategori yang tidak pernah tersentuh
tidak tiba-tiba tergantikan.

**Decay** menyapu kategori yang sudah lebih tua dari 30 hari dan hit-nya di
bawah 12, maksimal 120 per sapuan. Tag yang tersingkir karena usang atau cap
menghitung ulang dari 0, supaya tidak langsung naik lagi di ingest berikutnya
lalu turun lagi beruntun. Tag yang tersingkir karena melanggar aturan tidak
direset, karena `canPromote` sudah menolaknya.

**Delay** menjaga agar sapuan tidak jalan di setiap request. Penjadwalan
dilakukan dari `ingest()` dan sekali saat boot.

### Tag dummy

Sumber booru mengirim banyak tag metadata yang bukan kategori: `Character Name`,
`Artist Name`, `Digital Media`. Semuanya disaring dengan pencocokan **persis**
lewat set `DUMMY_TAGS`, bukan regex.

Regex untuk kata seperti `character` atau `artist` sengaja tidak dipakai:
suffix `(character)`, `(series)`, `(artist)`, dan `(creature)` di Danbooru
adalah penanda legitimasi, bukan metadata. Memblokirnya secara wildcard ikut
mematikan entity asli, termasuk `Idolmaster Million Live! Theater Days` (869 hit).

`DUMMY_TAGS` juga dipakai `isUsefulTag`, bukan hanya `canPromote`, supaya
placeholder ini tidak muncul di panel trending.

### Kata umum

Tag generik seperti `standing`, `hair`, `sweater`, `apron`, atau `mask` tidak
pernah dipromosikan. Daftar lengkapnya ada di `GENERIC_ATTR`
(`server/categories.js`).

Kata waktu seperti `day` dan `days` ada di set terpisah `SCENE_TIME_EXACT`,
yang hanya menolak tag tersebut kalau seluruh tag persis sama. Jadi `day`
ditolak, tapi `Theater Days` tetap boleh.

### Dampak

| | Sebelum | Sesudah |
| --- | --- | --- |
| Kategori otomatis | 758 | 400 |
| Total kategori | 770 | 412 |
| Payload taksonomi | 69,3 KB | 41,9 KB |

Kontraksi 40% itu gratis: bukan karena kategori dibuang membuta tuli, tapi
karena 61% kategori sebelumnya adalah noise (439 dari 726 punya 12 hit atau
kurang, didominasi tag dummy).

---

## Logo

Logo tersedia dalam dua varian, dipilih lewat `data-theme` pada elemen `<html>`.
Markup-nya memakai dua `<img>` dengan kontras pertukaran, bukan `background-image`,
supaya tidak ada request tambahan dan tidak ada kedipan saat tema berganti.

| Slot | Tema terang | Tema gelap |
| --- | --- | --- |
| Header | `logo.png` (1232x352) | `logo-dark.png` (1713x488) |
| Footer | `logo-512.png` (512x146) | `logo-dark-512.png` (512x146) |

Perhatikan tinggi header berbeda antara varian: logo terang lebih rapat, logo
gelap lebih longgar. Keduanya sudah di-trim ke bounding box isinya, jadi tidak
perlu adjusting per tema di CSS.

### Kenapa logo gelap perlu lift luminansi

Varian gelap dibangun dari sumber berlatar solid (`logo terang.png`, kanvas
2000x2000). Script aslinya hanya membuang latar dengan flood-fill; semua warna
di dalam huruf ikut terbawa apa adanya. Padahal isi logo itu **cyan gelap**
`rgb(0,96,256)` yang hanya reads 3,9:1 di atas `rgb(8,8,15)`, dan di footer
yang opacity-nya dikurangi cyan itu efektif tinggal 2,2:1.

Gejalanya mudah terlewat: 24% piksel logo berwarna putih tetap terang, jadi
pengukuran kontras yang mengambil piksel putih terlihat bagus (8,59:1) padahal
59% logo, yaitu bagian cyan, lenyap di latar hampir hitam.

Perbaikannya menaikkan luminansi HSL piksel jenuh sampai ambang `MIN_L`,
dengan Hue dan Saturation tetap utuh, jadi brand cyan tidak berubah jadi abu-abu.
Piksel jenuh saja yang kena; kalau semua piksel dinaikkan, accent
`rgb(32,32,32)` ikut jadi abu-abu terang dan muncul bercak di sekeliling huruf.

### Dua syarat yang berlawanan arah

Menaikkan cyanaja tidak cukup, karena logo punya elemen putih tersendiri di
tengah wordmark (kolom ke-4Sekitar 97% putih di keempat baris), bukan sekadar
highlight tipis di dalam huruf. Jadi ada dua syarat yang harus terpenuhi
sekaligus:

- cyan harus terbaca di latar gelap (kontras eksternal)
- bentuk putih harus tetap terpisah dari cyan (kontras internal)

Arahnya berlawanan: lift terlalu besar membuat putih dan cyan berdekatan.

| MIN_L | cyan/latar | putih/cyan | cyan jadi |
| --- | --- | --- | --- |
| (tanpa lift) | 2,2:1 | 5,1:1 | `rgb(0,96,256)` |
| 0,58 | 4,96:1 | 3,98:1 | `rgb(52,126,243)` |
| 0,65 | 4,95:1 | 3,08:1 | `rgb(86,147,245)` |
| 0,72 | 8,17:1 | 2,40:1 | `rgb(128,160,256)` |

Jadi `0,65` dipilih: kontras internalnya masih di atas 3:1, sementara 92,6%
piksel huruf sudah di atas 3:1 terhadap latar. Di 0,72 bentuk putih akan
menyatu dengan cyan pada 30px.

Pengukuran dilakukan pada **ukuran render footer yang sebenarnya** (105x30,
hanya piksel inti `alpha>=128`, opacity 0,70), bukan pada file 512x146.
Downscaling 4,9x itu sendiri mengubah kontras, jadi angka pada file asli akan
terlalu optimistis.

### Opacity per tema

| | Header | Footer |
| --- | --- | --- |
| Tema terang | 1 | 0,85 + `grayscale(0.25)` |
| Tema gelap | 1 | 0,70 |

Nilai tidak simetris itu disengaja. Varian gelap sudah lebih terang setelah lift,
jadi tidak perlu opacity separuh seperti varian terang yang warnanya memang
gelap. Yang penting: di footer gelap, hanya 3,3% piksel huruf yang berada di
rentang lemah (1,5-3:1).

Sisa sekitar 3% piksel yang tetap di bawah 1,5:1 adalah accent `rgb(32,32,32)`.
Di sumber aslinya accent itu juga tidak terlihat di atas `rgb(25,25,25)`, jadi
bukan bagian dari desain yang dirasakan.

### Membuild ulang

Kedua perintah ini membaca berkas sumber dari folder `src/`, yang **di-ignore
git** supaya repo tetap ringan. Setiap orang menaruh berkas kerja sendiri di sana:

```
src/Logo Hoshiva.png     -> varian terang
src/logo terang.png      -> varian gelap
```

Sumber bisa ditimpa lewat argumen pertama atau env `HOSHIVA_LOGO_SRC`:

```bash
npm run logo                                   # dari src/
npm run logo:dark                              # dari src/, lift luminansi ikut diterapkan
node scripts/logo-theme.js path/ke/logo.png    # dari berkas lain
HOSHIVA_LOGO_SRC=path/ke/logo.png npm run logo:dark
```

Hasil build deterministik: berkas yang sama menghasilkan hash PNG yang sama,
sehingga `git diff` tidak bersporak karena encoding ulang.

Folder `src/` tidak perlu ikut ada untuk menjalankan aplikasinya. Yang dilayani
server hanya `public/`, jadi `src/` tidak pernah terekspos lewat HTTP.


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