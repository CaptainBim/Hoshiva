# 🚀 Panduan Deployment Hoshiva ke Railway.app

## ⚡ Quick Deploy (Paling Mudah)

### 1. Daftar di Railway.app
- Buka https://railway.app
- Login dengan GitHub account Anda
- Authorize Railway untuk akses repository

### 2. Buat Project Baru
- Klik "+ New Project"
- Pilih "Deploy from GitHub repo"
- Cari dan pilih `CaptainBim/Hoshiva`
- Pilih branch: **`deployment`** atau **`main`**

### 3. Konfigurasi Environment
Railway akan otomatis detect Node.js project. Pastikan environment variables sudah ada:

```
HOST=0.0.0.0
PORT=3000
FETCH_TIMEOUT=15000
MAX_OUTPUT_PX=12000
HOSHIVA_CACHE_DIR=data/cache
HOSHIVA_TAXONOMY_FILE=data/taxonomy.json
```

### 4. Deploy
- Railway otomatis deploy saat push ke branch
- Tunggu hingga status menjadi "✓ Deployed" (biasanya 2-3 menit)

### 5. Dapatkan URL
- Klik "View Logs" → lihat URL deployment
- Format: `https://your-project-xxxx.railway.app`

---

## 📋 Checklist Pre-Deployment

- [x] Node.js 18+ requirement sudah di `package.json`
- [x] `npm start` script tersedia
- [x] `Procfile` sudah ada
- [x] `railway.json` sudah dikonfigurasi
- [x] `.env.example` tersedia
- [x] `.gitignore` sudah update

---

## 🔗 URL Deployment

Setelah deploy berhasil, URL Anda akan seperti:
```
https://hoshiva-production-<random-id>.railway.app
```

Gunakan URL ini untuk:
- Website: `https://your-url/`
- API Search: `https://your-url/api/search?q=anime`
- Healthcheck: `https://your-url/api/health`
- Config: `https://your-url/api/config`

---

## 📸 Fitur yang Siap

✓ Wallpaper search dari Wallhaven + Safebooru  
✓ Image resize & crop  
✓ Automatic upscale (Sharp fallback)  
✓ Dark/light theme  
✓ Responsive layout  
✓ SSRF protection  
✓ Multi-source support  

---

## ⚙️ Konfigurasi Advanced

### Menambah waifu2x (Optional)
Jika ingin upscale lebih bagus dengan waifu2x:
1. Download binary dari: https://github.com/nihui/waifu2x-ncnn-vulkan/releases
2. Upload ke Railway storage
3. Set env: `WAIFU2X_PATH=/path/to/binary`

### Custom Domain
1. Di Railway Project Settings → Domains
2. Tambah custom domain Anda
3. Update DNS records sesuai instruksi Railway

### Persistent Storage
Jika cache & taxonomy perlu tersimpan:
1. Railway Settings → Add Volume
2. Mount ke `/app/data`
3. Pilih size sesuai kebutuhan

---

## 🐛 Troubleshooting

### Build gagal?
- Pastikan Node.js 18+ di `package.json`
- Pastikan semua dependencies tersedia
- Cek logs di Railway dashboard

### Port error?
- Railway otomatis assign PORT
- Pastikan `HOST=0.0.0.0` di env variables

### Cache/Taxonomy tidak tersimpan?
- Railway menggunakan ephemeral filesystem
- Data hilang saat restart/redeploy
- Solusi: gunakan Railway Volumes untuk persistent storage

---

## 📞 Support

- Railway Docs: https://docs.railway.app
- Hoshiva GitHub: https://github.com/CaptainBim/Hoshiva
- Issues: https://github.com/CaptainBim/Hoshiva/issues

---

**Deploy sekarang di Railway:** https://railway.app

Selamat deploy! 🚀
