# Hoshiva

Mesin pencari wallpaper. Backend Node/Express mengagregasi Wallhaven dan beberapa
booru, lalu menyajikan hasilnya dalam ukuran yang tepat untuk layar Anda — lengkap
dengan crop manual dan upscale.

<p align="center">
  <img src="public/assets/logo-dark.png" alt="Hoshiva" width="420">
</p>

---

## Fitur

- **Pencarian multi-sumber** — Wallhaven dan Safebooru digabung round-robin,
  jadi satu sumber yang sedang down tidak mengosongkan halaman. Sumber yang
  tidak terjangkau disembunyikan dari pilihan.
- **Detail in-modal** — judul, dimensi, tag, gambar serupa, dan seluruh
  pengaturan ukuran, crop, serta upscale dalam satu tampilan.
- **11 preset ukuran** — Layar Saya, Full HD, QHD, 4K, ultrawide 21:9 dan 32:9,
  square, dua ponsel, iPad, dan Asli. Lebar × tinggi bisa diisi sendiri.
- **Default mengikuti layar Anda** — preset "Layar Saya" membaca
  `screen.width × height × devicePixelRatio`, jadi hasilnya langsung pas tanpa
  perlu menebak.
- **Crop yang menentukan framing** — memilih ukuran membuka kotak crop dengan
  rasio yang sudah disesuaikan. Framing ditentukan Anda, bukan ditebak
  otomatis. Lihat [Crop](#crop).
- **Upscale sesuai kebutuhan** — gambar dinaikkan hanya kalau target lebih besar
  dari sumber, memakai gaya waifu2x. Tanpa binary, `sharp` sudah cukup.
- **Kategori otomatis** — nama karakter dan series yang sering muncul
  dipromosikan menjadi kategori, sementara tag generik seperti `hair` atau
  `sweater` tidak pernah ikut naik.
- **Filter orientasi tepercaya** — hasil akhir disaring ulang berdasarkan rasio
  sebenarnya, bukan sekadar klaim sumber.
- **Tema gelap dan terang**, layout responsif, tanpa build step.

---

## Menjalankan

Butuh **Node.js 18+**. `sharp` menyediakan prebuilt binary untuk
Windows/macOS/Linux, jadi compiler tidak diperlukan.

```bash
npm install
npm start
```

Buka <http://127.0.0.1:4173>.

### Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm start` | jalankan server |
| `npm run dev` | jalankan dengan `--watch` |
| `npm test` | test unit — tanpa jaringan dan tanpa server |
| `npm run test:api` | test endpoint — server harus sudah jalan |

Test unit dapat dijalankan per bagian: `test:ssrf`, `test:taxonomy`,
`test:budget`, `test:image`, `test:cache`, `test:ratio`.

### Variabel lingkungan

Semua opsional; nilai bawaan sudah cocok untuk pengembangan lokal.

| Variabel | Default | Guna |
| --- | --- | --- |
| `PORT` | `4173` | port server |
| `HOST` | loopback lokal, `0.0.0.0` di PaaS | bind address |
| `FETCH_TIMEOUT` | `15000` | timeout ke sumber, dalam ms |
| `MAX_OUTPUT_PX` | `12000` | batas sisi terpanjang hasil resize/upscale |
| `WAIFU2X_PATH` | — | path absolut executable `waifu2x-ncnn-vulkan` |
| `HOSHIVA_CACHE_DIR` | `data/cache` | lokasi cache disk |
| `HOSHIVA_TAXONOMY_FILE` | `data/taxonomy.json` | lokasi file taksonomi |

Folder `data/` dibuat otomatis saat boot.

---

## Crop

`mode=cover` harus membuang sebagian gambar. Hoshiva memotong **dari tengah**
sebagai default, lalu menyerahkan sisanya ke Anda.

Memilih ukuran atau mengisi lebar × tinggi membuka kotak crop dengan rasio yang
sudah disesuaikan ke ukuran itu, sebesar mungkin di dalam gambar. Kotaknya bisa
diseret, dan memindah ke ukuran lain akan menyesuaikan kotak itu lagi — bukan
menghapus posisi yang sudah dipoles. Unduhan hasilnya tetap persis sebesar
ukuran yang dipilih.

Crop memakai fraksi 0..1, bukan piksel, supaya posisinya tetap sah saat gambar
di-zoom atau DPI berubah. Server menerima crop minimal 15% per sisi dan minimal
320px; pelanggaran ditolak dengan `400`, bukan `500`.

Untuk pemanggilan API langsung, `pos` dan `pan` tersedia sebagai parameter.
Lihat [API](#api).

### Upscale

Upscale berjalan otomatis dan hanya bila perlu: target lebih besar dari sumber,
dicek **setelah** crop. Kalau target lebih kecil, gambar hanya dikecilkan —
menajamkan gambar yang diperkecil tidak menambah apa pun.

Tanpa binary tambahan, `sharp` menjalankan denoise median → Lanczos3 → unsharp,
yang hasilnya cukup bagus untuk garis anime. Untuk engine NCNN + Vulkan,
pasang [`waifu2x-ncnn-vulkan`](https://github.com/nihui/waifu2x-ncnn-vulkan/releases)
lalu arahkan `WAIFU2X_PATH` ke executable-nya. Server mendeteksinya saat boot dan
memakainya otomatis, dengan fallback ke `sharp` bila gagal.

---

## API

Semua response JSON kecuali `/api/img`.

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/health` | status server + statistik |
| `GET /api/config` | preset, mode upscale, sort, rasio, sumber |
| `GET /api/search` | `q`, `tags`, `limit`, `sort`, `source`, `purity`, `ratio`, `page`, `ttl`, … |
| `GET /api/post/:source/:id` | detail satu post |
| `GET /api/categories` | kategori + trending |
| `GET /api/categories/fresh` | wallpaper yang baru masuk |
| `GET /api/sources/status` | uptime tiap sumber |
| `GET /api/img` | proxy + crop + resize + upscale |
| `GET /api/img/meta` | metadata gambar |

Parameter `/api/img`:

| Parameter | Nilai | Keterangan |
| --- | --- | --- |
| `url` | — | wajib, URL gambar sumber |
| `w`, `h` | px | ukuran target; `0` = pakai sisi gambar |
| `mode` | `contain`, `cover`, `width`, `height`, `raw` | cara memotong agar pas ukuran |
| `pos` | `centre`, `attention`, `entropy`, `top`, `bottom`, `left`, `right` | posisi crop untuk `cover`, default `centre` |
| `pan` | 0..100 | geser crop, `50` = tengah. Mengalahkan `pos` |
| `cx`, `cy`, `cw`, `ch` | fraksi 0..1 | crop manual, keempatnya wajib |
| `upscale` | `none`, `auto`, `waifu2x`, `anime` | `auto` hanya naikkan bila target > sumber |
| `scale` | 1..4 | faktor untuk `waifu2x`/`anime` |
| `fm` | `jpg`, `png`, `webp` | format keluaran |
| `quality` | 1..100 | kualitas JPEG/WebP, default 92 |
| `download` | `1` | kirim sebagai attachment |
| `ttl` | detik | TTL cache, default 3600 |

Contoh:

```text
GET /api/search?q=sakura&limit=24&sort=fit
GET /api/img?url=<src>&w=3840&h=2160&mode=contain&upscale=auto
GET /api/img?url=<src>&cx=0.1&cy=0.1&cw=0.8&ch=0.8&w=1920&h=1080&mode=cover&download=1
```

Nilai di luar rentang diabaikan atau dijepit, bukan diteruskan ke `sharp`.

---

## Sumber gambar

| Sumber | Jenis | Tag wallpaper |
| --- | --- | --- |
| Wallhaven | Wallhaven API | bawaan (SFW) |
| Safebooru | DAPI (booru) | `wallpaper`, `wallpaper_hd` |

Sumber yang gagal dilewati dan ditandai DOWN di panel status, sementara yang lain
tetap melayani permintaan. Status dihitung saat boot dan saat
`/api/sources/status` dipanggil. Urutan prioritas mengikuti tabel di atas.

Menambah sumber baru: tambahkan entri ke `BOORU_SOURCES` atau `WALLHAVEN` di
`server/sources.js`. Adapter `kind: 'booru'` sudah menangani pagination DAPI,
tag berformat underscore, dan pemetaan `1girl`/`1boy` → `girl`/`boy`.

> Empat booru lain — Gelbooru, Konachan, Xbooru, dan Rule34 — sengaja tidak
> disertakan. Sertifikat TLS keempatnya kedaluwarsa dan domainnya kini
> dialihkan ke halaman pihak ketiga, jadi tidak lagi bisa dipakai.

---

## Deploy

Tidak ada langkah kompilasi — `npm install` lalu `npm start`. `railway.json`
sudah disertakan untuk Railway, dan struktur yang sama berlaku untuk platform
PaaS lain.

### Bind address

Platform PaaS umumnya menyuntik `PORT` tapi tidak menyetel `HOST`, lalu
menghampiri container lewat `eth0`. Server yang hanya bind ke `127.0.0.1` tidak
akan terlihat, dan healthcheck akan gagal terus.

Karena itu `HOST` memakai default platform: loopback di lokal, `0.0.0.0` di
Railway/Render/Fly.io/Heroku, dan nilai yang Anda set manual jika dipaksa. Untuk
platform lain, set `HOST=0.0.0.0` secara eksplisit. Banner boot
(`platform: Railway | bind: 0.0.0.0:8080`) memudahkan verifikasi dari log.

Default lokal sengaja tetap loopback, karena `/api/img` memproxy URL arbitrer.

### Filesystem

`data/` adalah state runtime dan tidak ikut ter-*commit*, jadi setiap deploy
mulai dengan cache dan taksonomi kosong. Tidak merusak apa pun: request pertama
permintaan pertama hanya lebih lambat, dan `/api/health` melaporkan `totalCategories: 0` sampai
wallpaper mulai ter-ingest.

Untuk mempertahankan kategori, pasang volume dan arahkan ke `/app/data`.
Volume bersifat per-project sehingga harus dibuat lewat dashboard.

---

## Keamanan

`/api/img` dan `/api/img/meta` memproxy URL arbitrer, jadi keduanya dijaga:

- Hanya `http` dan `https` yang diterima. Host jaringan privat, loopback,
  link-local, dan CGNAT ditolak — termasuk bentuk singkat (`127.1`), desimal
  (`2130706433`), oktal, dan heksadesimal, serta IPv4-mapped IPv6.
- Redirect divalidasi per hop, jadi host publik tidak bisa mengarahkan server
  ke jaringan internal.
- Request divalidasi sebelum diproses; penolakan menghasilkan `400`.

Untuk instance publik, tambahkan pembatas laju per-IP di depan aplikasi dan
pastikan pemakaian Anda sesuai ketentuan masing-masing sumber.

---

## Test

```bash
npm test          # unit — tanpa jaringan, tanpa server
npm start         # terminal lain
npm run test:api  # endpoint
```

Test unit tidak menyentuh data asli: cache dan taksonomi ditulis ke direktori
sementara.

---

## Lisensi

MIT