# Hoshiva

Mesin pencari wallpaper modern. Backend Node/Express memproxyl semua
permintaan ke sumber gambar (Wallhaven + Safebooru), menyediakannya dengan
ukuran yang tepat untuk layarmu, dan mendukung upscale dengan gaya waifu2x.

![Hoshiva](logo-terang.png)

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