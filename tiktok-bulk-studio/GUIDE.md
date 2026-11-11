# Panduan Live — Reels Bulk Studio v1.0

Panduan pemakaian langkah demi langkah untuk kedua mode: **TikTok Studio** (bulk uploader)
dan **Facebook** (scheduler reels). Panel ekstensi menyesuaikan diri dengan situs yang
sedang terbuka — tidak perlu diatur apa pun.

> ⚠️ **Aturan emas mode Facebook:** ekstensi **tidak pernah menekan "Terbitkan"**.
> Semua jadwal hanya disimpan (tombol baris berubah jadi **"Jadwal"**), lalu run berhenti.
> Verifikasi akhir dan penerbitan **selalu tanganmu sendiri**.

---

## 0. Siap sebelum mulai

| Item | Detail |
| --- | --- |
| Ekstensi | `chrome://extensions` → *Load unpacked* → folder `tiktok-bulk-studio`, **Developer mode** ON |
| Setelah update kode | Tekan **Reload** di kartu ekstensi → **F5** di tab situs |
| Tab | Harus tetap **terbuka, login, dan di depan** selama run (upload di background bisa macet) |
| CSV | Kolom `filename, caption, date, time` — sama untuk kedua situs |
| Format `date` | `YYYY-MM-DD`, `YYYY/MM/DD`, atau `MM/DD/YYYY` |
| Format `time` | `14:30`, `14.30`, `2:30 PM`, `9pm`, atau jam polos `9` |

Contoh CSV:

```csv
filename,caption,date,time
clip-01.mp4,"Morning routine #morning #routine",2026-11-12,09:00
clip-02.mp4,"Three things I learned this week #creator",2026-11-13,13:30
```

**Cek sehat cepat** — buka console (F12) di tab situs; harus terlihat:

- TikTok → `[ttbulk] content scripts loaded, panel v1.0.0`
- Facebook → `[fbbulk] content scripts loaded, panel v1.0.0 on business.facebook.com`

Panel tidak muncul? Klik tombol kecil **"Bulk"** di tepi kanan halaman, atau jalankan di console:

```js
document.getElementById('ttbulk-host').shadowRoot.querySelector('.launcher').click();
```

---

## 1. Mode TikTok Studio — bulk uploader

### Langkah

1. **Buka** <https://www.tiktok.com/tiktokstudio/upload> (sudah login). Panel muncul di kanan.
2. **Import CSV** → pilih file CSV-nya. Baris queue muncul di panel.
3. **Add videos** → pilih semua clip sekaligus, atau seret (drag) dari Explorer ke panel.
   File dicocokkan ke CSV lewat **nama dasar** (tanpa ekstensi, tidak peka huruf besar-kecil).
4. **Start**. Yang terjadi otomatis:
   - 2 file pertama masuk **bersamaan** (TikTok butuh ≥2 untuk membuka tabel bulk), lalu
     sisanya **satu per satu** — tabel besar crash kalau file datang berombo-rombongan.
   - Tiap baris diisi: **caption** (di-paste utuh, multi-baris aman) dan **jadwal**
     (lewat kalender + kolom jam TikTok — grid menit 5, jadi `09:07` jatuh ke `09:05`,
     nilai aslinya dicetak di log).
   - Tiap baris **diverifikasi**: teks caption di sel + sel jadwal `M/D/YYYY HH:MM`.
5. Run **berhenti sebelum mempublikasikan** (Review ON). Periksa tabel di TikTok,
   lalu tekan **Post now** di panel — atau `Post (N)` di tabel — kalau semua sudah benar.

### Yang perlu tahu

- **Maks 30 video per tabel** (limit TikTok). Lebih dari itu mengantre untuk batch berikutnya.
- Video tersimpan di IndexedDB halaman — batch **selamat dari reload** (fitur *Keep files*
  mengatur apakah salinan lokal dihapus setelah terkonfirmasi ter-post).
- Jika tabel crash (*"Something went wrong"*), run memuat ulang dan mencoba sekali; kalau
  berulang, tekan **Stop**, **Clear table**, lalu mulai lagi.
- **Clear queue** menghapus baris panel + video di IndexedDB (tidak bisa jalan mid-batch).

---

## 2. Mode Facebook — scheduler reels

### Langkah

1. **Buka composer bulk** Facebook (masukkan video-reelnya ke composer terlebih dulu,
   satu reel = satu baris):
   `https://business.facebook.com/latest/bulk_upload_composer?asset_id=...&business_id=...`
   Panel muncul di kanan; deskripsi baris masih boleh kosong — **run yang mengisinya dari CSV**.
2. **Import CSV** (kolom sama dengan TikTok). Pencocokan baris ↔ CSV berjalan lewat **caption**:
   baris composer yang deskripsinya sudah cocok dipakai duluan; urutan hanya dipakai bila
   semua deskripsi masih kosong. Kalau deskripsi ada tapi **tidak ada** caption yang cocok,
   run **berhenti (abort)** — bukan menebak.
3. **(Opsional) Acak** → mengisi jam kosong dengan acak **06:00–18:00**; baris yang
   bertanggal di batas akhir jendela otomatis pagi **06:00–10:00**.
4. **Start**. Per baris, otomatis:
   - Buka dropdown baris (6 cara; berhenti di cara pertama yang berhasil).
   - Klik tab **Jadwal** (`Terbitkan sekarang | Jadwal | Simpan sebagai Draf`).
   - Isi **tanggal** (`DD/MM/YYYY` — FB menampilkannya sebagai `12 November 2026`).
   - Isi **jam & menit**. Dua field ini hanya menerima ketikan *trusted* — kamu akan melihat
     banner kuning **"…started debugging this browser"** sesaat. Itu **ekstensinya sendiri**
     yang mengetik; banner hilang sendiri, tidak ada jendela debugger.
   - Klik **Perbarui** → panel tertutup → verifikasi tombol baris berubah **"Jadwal"** dan
     deskripsi tidak bergeser.
5. Run selesai dengan pesan **"silakan verifikasi manual"**. Periksa tiap baris di FB,
   lalu publikasikan dengan tanganmu — **ekstensi tidak pernah menyentuh Terbitkan**.

### Yang perlu tahu

- **Jendela FB: 20 menit – 29 hari** dari saat run. Baris di luar jendela di-**skip dengan
  alasan jelas** (bukan gagal) — jadwalkan di run hari lain.
- Baris yang sudah berlabel **"Jadwal"** otomatis dilewati — aman di-Retry setelah terputus.
- **Alt+D** = Diagnose tanpa klik (dropdown FB tetap terbuka). Diagnose juga membawa
  `lastPanelProbe` — potret isi panel terakhir yang tertangkap otomatis saat run.
- Error `ERR_BLOCKED_BY_CLIENT` di console = ad blocker memblok telemetri FB. Aman diabaikan.

---

## 3. Checklist verifikasi tampilan (setelah update ke v1.0)

Perubahan v1.0 **hanya konstanta versi** — markup panel (`SHELL`) dan CSS (`panel.css`)
tidak disentuh. Untuk memastikan tampilan sama persis, jalankan checklist ini:

1. **Log versi**: buka panel → baris pertama log harus `Panel ready (v1.0.0).`
   (Facebook: console juga menunjuk `panel v1.0.0`.)
2. **Posisi & bentuk**: panel tetap di kanan atas, lebar dan warna tidak berubah;
   launcher **"Bulk"** tetap di tepi kanan saat panel disembunyikan.
3. **Tombol utama utuh**: Import CSV · Add videos · Start · Stop · Clear queue · Acak
   (Facebook) · Review switch · log panel — semua terlihat seperti sebelumnya.
4. **Klik hidup**: klik **Diagnose** → log menulis *"Diagnostics copied to the clipboard"*;
   klik di dalam panel **tidak** membuat dropdown FB tertutup.
5. **Fungsi baru tanpa perubahan visual**: di Facebook, saat jam/menit diisi, muncul banner
   kuning debugger sesaat — ini perilaku baru v1.0 yang memang disengaja, bukan perubahan tampilan panel.

Kalau semua 5 lolos → tampilan v1.0 identik dengan 0.5.x, hanya lebih tangguh di dalam.

---

## 4. Masalah cepat (ringkasan)

| Gejala | Solusi |
| --- | --- |
| Panel tidak muncul | Reload ekstensi → F5; kalau masih, klik **"Bulk"** / one-liner console di atas |
| Baris tertulis Skipped | Baca alasannya di log (mis. jam sudah lewat, di luar jendela 29 hari) → perbaiki CSV → **Retry** |
| `Nilai "07" tidak masuk ke input` (FB) | Tekan **Diagnose** dan kirim JSON-nya (memuat `lastPanelProbe`) |
| `Ketik trusted (CDP) gagal` (FB) | Tutup DevTools yang menempel di tab; cek izin `debugger` di `chrome://extensions` |
| Caption tidak cocok (FB, run abort) | Deskripsi composer vs CSV tidak sepakat — kosongkan deskripsi (run yang mengisi) atau betulkan CSV |
| Tabel TikTok crash | Tunggu reload-otomatis; kalau berulang: Stop → Clear table → mulai lagi |
| Upload TikTok macet di persentase sama | Tab di background — biarkan tab Studio di depan sampai review |

Panduan teknis lengkap (arsitektur, selector terverifikasi, histori perubahan):
lihat **README.md** di folder yang sama.
