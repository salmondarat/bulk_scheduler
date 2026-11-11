# 📋 Panduan Penjadwalan Reels Facebook — Bulk Upload Composer

> **Tujuan dokumen:** Rangkuman lengkap prosedur, status, dan pelajaran (pitfalls) penjadwalan 50 reels di Facebook Business Suite, agar batch/ronde berikutnya tidak perlu mencoba-coba dari nol.

- **Halaman:** `https://business.facebook.com/latest/bulk_upload_composer?asset_id=105515515810209&business_id=202147452277929&ir_qe_exposed=1`
- **Target:** 50 reels (video `01.mp4` – `50.mp4`), 1 video per hari berurutan mulai **11 Nov 2026**, jam acak **06:00–18:00 WIB**.
- **Batasan user:** ❌ **JANGAN PERNAH menekan tombol "Terbitkan" / "Terbitkan sekarang"** — user melakukan verifikasi manual sendiri. Hanya boleh: dropdown Opsi penjadwalan → tab **Jadwal** → isi tanggal/jam → **Perbarui**.
- **Timezone:** Asia/Jakarta (WIB, UTC+7).

---

## 1. Aturan Limit Penjadwalan Facebook (PENTING)

> FB hanya mengizinkan penjadwalan **"20 menit hingga 29 hari sejak saat dibuat"**.

- **Batas dihitung dari SAAT EKSEKUSI**, bukan sekadar `now + 29 hari` pada level tanggal. Jam ikut berperan.
- Contoh nyata: eksekusi 10 Nov pukul ~15:08 → batas = 9 Des pukul ~15:08. Jadwal 9 Des **15:18** (= tanggal ke-29, jam melewati waktu eksekusi) → **DITOLAK FB**. Baris 27 (8 Des) lolos karena masih aman; baris 28 (9 Des) adalah tanggal batas kritis.
- **Amalan aman:** untuk tanggal yang jatuh tepat di batas akhir jendela, gunakan **jam pagi (06:00–10:00)** agar ada margin ≥20 menit dan tidak melewati 29 hari.

**Konsekuensi praktis:**
1. Baris 0–27 (tanggal 11 Nov–8 Des) aman dijadwalkan kapan pun sepanjang sesi.
2. Baris 28 (9 Des 2026) **wajib jam pagi** dan sebaiknya dijadwalkan lebih awal di sesi.
3. Baris 29–49 (10 Des–30 Des) **belum terjangkau** jendela 29 hari dari 10 Nov — jendela bergeser **±1 hari tambahan per hari kalender**.

---

## 2. Status Saat Ini (per 10 Nov 2026)

### 2.1 Kolom Deskripsi
✅ **50 kolom Deskripsi sudah terisi dan terverifikasi**, dengan tag `data-ocfill="0..49"` pada `div[contenteditable="true"]` tiap baris.
- Sumber caption: `C:\Users\salmonisme\Documents\Default Project\fb-reels-captions-digest.txt` — digest 50 caption format `NAME / SCHED / TAGS / CAP / END`.
- Mapping urutan video dari file `.post.json` di `E:\Social Media\reels\2026\ready-watermarking\output\posts` (60 file; 50 dipakai; mapping berdasarkan `media[0].name`).

### 2.2 Jadwal — Baris yang BERHASIL tersimpan (0–27)
Setiap baris terverifikasi: tombol bertuliskan **"Jadwal"**, panel tertutup (0 input tanggal terbuka), Deskripsi utuh.

| Baris | Video | Tanggal | Jam (WIB) |
|---:|---|---|---|
| 0 | 01.mp4 | 11 Nov 2026 | 15:08 |
| 1 | 02.mp4 | 12 Nov 2026 | 15:48 |
| 2 | 03.mp4 | 13 Nov 2026 | 10:13 |
| 3 | 04.mp4 | 14 Nov 2026 | 17:51 |
| 4 | 05.mp4 | 15 Nov 2026 | 10:10 |
| 5 | 06.mp4 | 16 Nov 2026 | 13:16 |
| 6 | 07.mp4 | 17 Nov 2026 | 13:15 |
| 7 | 08.mp4 | 18 Nov 2026 | 08:27 |
| 8 | 09.mp4 | 19 Nov 2026 | 17:29 |
| 9 | 10.mp4 | 20 Nov 2026 | 11:05 |
| 10 | 11.mp4 | 21 Nov 2026 | 14:28 |
| 11 | 12.mp4 | 22 Nov 2026 | 09:26 |
| 12 | 13.mp4 | 23 Nov 2026 | 07:19 |
| 13 | 14.mp4 | 24 Nov 2026 | 10:31 |
| 14 | 15.mp4 | 25 Nov 2026 | 07:31 |
| 15 | 16.mp4 | 26 Nov 2026 | 14:06 |
| 16 | 17.mp4 | 27 Nov 2026 | 15:07 |
| 17 | 18.mp4 | 28 Nov 2026 | 14:19 |
| 18 | 19.mp4 | 29 Nov 2026 | 08:51 |
| 19 | 20.mp4 | 30 Nov 2026 | 17:25 |
| 20 | 21.mp4 | 1 Des 2026 | 12:21 |
| 21 | 22.mp4 | 2 Des 2026 | 17:55 |
| 22 | 23.mp4 | 3 Des 2026 | 14:07 |
| 23 | 24.mp4 | 4 Des 2026 | 17:07 |
| 24 | 25.mp4 | 5 Des 2026 | 12:09 |
| 25 | 26.mp4 | 6 Des 2026 | 12:22 |
| 26 | 27.mp4 | 7 Des 2026 | 13:44 |
| 27 | 28.mp4 | 8 Des 2026 | 09:08 |

### 2.3 Baris 28 (29.mp4, target 9 Des 2026) — ⚠️ PERLU VERIFIKASI
- FB **menolak** jadwal 9 Des **15:18** (melewati batas 29 hari dari saat itu).
- Beberapa percobaan menghasilkan **prefill anomali "10 Desember 2026"**, lalu label tombol fluktuatif antara "Terbitkan sekarang" ↔ "Jadwal".
- **Status terakhir:** label tombol **"Jadwal"** dan panel tertutup (ditutup dengan Esc pada akhir sesi).
- **✋ TINDAKAN WAJIB di sesi berikutnya:**
  1. Buka panel jadwal row 28 (dropdown → tab Jadwal).
  2. Baca tanggal/jam yang tersimpan.
  3. Jika tertulis "10 Desember 2026" atau nilai salah → isi ulang `09/12/2026` + **jam pagi acak yang masih lolos limit (mis. 07:xx–09:xx)** → klik **Perbarui** → verifikasi (tombol "Jadwal", panel tertutup).

### 2.4 Baris 29–49 (video 30–50, 10 Des – 30 Des 2026) — 🔒 TERBLOKIR
- Belum bisa dijadwalkan: tanggal target **di luar jendela 29 hari** dari eksekusi 10 Nov.
- Jendela akan terbuka bertahap (**±1 tanggal tambahan per hari**); hitung ulang awal sesi berikutnya.
- **Tunggu instruksi/konfirmasi user** sebelum memulai ronde berikutnya.

### 2.5 Kondisi halaman saat sesi ditutup
- Panel row 28 ditutup dengan **Esc** — halaman aman: **0 input jadwal terbuka**, tidak ada perubahan pending yang tersimpan tanpa disadari.

---

## 3. Persetujuan & Keamanan (Approval Token)

Setiap aksi **write** (mengetik, mengklik) melewati mekanisme **approval per token**:

1. Langkah write pertama akan memunculkan **exception dengan output `APPROVAL:<token>`** — tangkap token-nya, ini normal.
2. **Redeem** token via `browser_run({ approvalToken: token })`. Setelah redeem, **chain lengkap dari awal bisa jalan**.
3. Konfirmasi ke user (question tool) **per batch/ronde (5–8 baris)** sebelum mulai eksekusi.
4. ❌ **Tab "Terbitkan sekarang" tidak pernah disentuh sama sekali** — hanya tab "Jadwal" yang digunakan.

---

## 4. Anatomi Panel Scheduler

Ketika dropdown baris diklik, muncul panel berisi:

- **Tab:** `Terbitkan sekarang | Jadwal | Simpan sebagai Draf` → klik tab **Jadwal**.
- **Input tanggal:** visible; teks bisa berbentuk `D Month YYYY` (lengkap) atau `D/M/YYYY`.
- **2 spinbutton tersembunyi** (opacity 0): `input[aria-label="jam"]` dan `input[aria-label="menit"]`.
- **Tombol "Perbarui"**: id DOM `#js_xxx` **tidak stabil antar render** — cari ulang berdasarkan teks dan y-band.

**Krusial:** 🔁 koordinat klik berubah saat layout shift — selalu **recompute koordinat SEGERA sebelum tiap klik** (jangan pakai koordinat cache). Klik area **LABEL**, bukan svg (svg → error `element.click is not a function`); untuk membuka dropdown klik `cx = x + (width - 42) / 2`.

---

## 5. Rutinitas Final per Baris (Terbukti Stabil)

Ikuti langkah ini **persis dan berurutan** untuk tiap baris:

1. **ScrollIntoView** baris target via `data-ocfill="<row>"`.
2. **Buka dropdown**: legacy.click pada area **LABEL** (`cx = x + (width - 42) / 2`).
3. **Klik tab "Jadwal"** di panel.
4. **Isi tanggal**:
   - Mouse CDP ke **pusat input tanggal** untuk fokus;
   - `forms.press "Control+A"` (pilih semua);
   - `forms.type "DD/MM/YYYY"` → contoh `09/12/2026`;
   - 🚫 **JANGAN pakai `forms.fill replace`** (merusak value);
   - ℹ️ FB normalisasi menghapus leading zero (`01/12/2026` → `1 Desember 2026`) — regex deteksi harus `[0-9]{1,2}`.
5. **Isi JAM**:
   - Hanya `el.focus()` **programatik** ke `input[aria-label="jam"]`;
   - CDP `Input.dispatchKeyEvent` **keyDown + keyUp per digit**: `code: "Digit<k>"`, `key: "<k>"`, `text: "<k>"`, `windowsVirtualKeyCode: 48+k`;
   - 🚫 `keyChar` type → error -32602; 🚫 `Input.insertText` → GAGAL/masuk input salah.
6. **Isi MENIT**:
   - Klik CDP ke **tile label menit** di offset `(cx+10, cy+10)`;
   - Lanjutkan digit per digit via `Input.dispatchKeyEvent` sama seperti jam.
7. **Klik tombol "Perbarui"**:
   - Cari ulang tombol berdasarkan **teks** dan **y band `yTop..yTop+420`**;
   - legacy.click → jika koordinat tidak efektif (pernah terjadi di panel row 28) → fallback **klik sintetis DOM evaluate** (`mousedown` → `mouseup` → `click` pada tombol).
8. **Verifikasi**:
   - Tombol baris bertuliskan **"Jadwal"**;
   - Panel tertutup: **0 input tanggal terbuka**;
   - Deskripsi (row yang sama) **utuh** (capLen tidak berubah).

### Membatalkan panel tanpa menyimpan
- Tekan **Esc** (keyDown + keyUp, `windowsVirtualKeyCode: 27`) — trusted untuk menutup panel dan membuang pending.
- Klik **di luar row** juga menutup panel dan membuang pending, tapi **Esc lebih aman dan konsisten**.

---

## 6. Catatan Toolkit CDP

- Semua interaksi CDP lewat `browser_run` dengan steps `diagnostics.cdp`:
  - `Runtime.evaluate` → evaluasi DOM (querySelector, focus, sintetis click);
  - `Input.dispatchMouseEvent` → klik koordinat;
  - `Input.dispatchKeyEvent` → ketik digit.
- ⚠️ Respons CDP adalah **string JSON** → selalu `JSON.parse()` dulu; shape-nya bervariasi (`result.result.value` / `result.value` / objek) — gunakan helper `getVal` yang toleran.
- Untuk debugging multi-step: `returnMode: "all"`.
- ⚠️ React re-render menghapus tag `data-ocdt` → **tag ulang setiap langkah**.

---

## 7. Tabel Pitfall (Pelajaran Penting)

| # | Masalah / Pitfall | Solusi / Amalan |
|---:|---|---|
| 1 | FB limit "20 menit – 29 hari" dihitung dari **saat eksekusi** (jam ikut berperan) | Untuk tanggal batas akhir, pakai jam pagi (06:00–10:00) |
| 2 | `forms.fill replace` merusak value input tanggal | Mouse CDP + `Control+A` + `forms.type "DD/MM/YYYY"` |
| 3 | `keyChar` pada `Input.dispatchKeyEvent` → error -32602 | Pakai `code/key/text/Digit<k>` + `windowsVirtualKeyCode: 48+k` |
| 4 | `Input.insertText` → teks masuk input salah | Hanya `el.focus()` + keyDown/keyUp per digit |
| 5 | Legacy click pada elemen opacity 0 GAGAL | Legacy click pada area LABEL non-svg; input jam/menit diisi via CDP keyboard |
| 6 | Klik svg → `element.click is not a function` | Klik area LABEL, hindari svg |
| 7 | React re-render menghapus tag `data-ocdt` | Tag ulang setiap langkah, jangan cache |
| 8 | Koordinat klik berubah saat layout bergeser | Recompute koordinat segera sebelum tiap klik |
| 9 | Id `#js_xxx` tombol "Perbarui" tidak stabil | Cari ulang via teks + y-band; fallback klik sintetis DOM |
| 10 | Respons CDP berupa string JSON, shape bervariasi | `JSON.parse` dulu; helper `getVal` toleran; `returnMode:"all"` untuk debug |
| 11 | Step write memicu exception `APPROVAL:<token>` | Redeem via `browser_run({ approvalToken: token })`, chain lanjut |
| 12 | Prefill anomali "10 Desember 2026" di row 28 | Verifikasi ulang panel row 28; isi ulang `09/12/2026` → Perbarui |
| 13 | Label tombol fluktuatif ("Terbitkan sekarang" ↔ "Jadwal") | Anggap valid hanya bila label **"Jadwal"** + panel tertutup; re-verify jika ragu |
| 14 | Klik di luar row membuang pending | Tutup panel dengan **Esc vkc 27** bila ingin cancel |
| 15 | Jadwal tanggal batas + jam sore ditolak FB | Baris dengan tanggal batas akhir selalu dijadwalkan pakai jam pagi |

---

## 8. Next Step (Agenda Sesi Berikutnya)

1. ✅ **Verifikasi row 28** (29.mp4, target 9 Des 2026): buka panel → tab Jadwal → baca nilai tersimpan. Jika "10 Desember 2026" atau salah → isi ulang `09/12/2026` + jam pagi acak → **Perbarui** → verifikasi.
2. 📤 **Laporkan daftar jadwal lengkap** ke user (tabel di bagian 2.2).
3. ❓ **Tanyakan persetujuan untuk ronde berikutnya**:
   - lanjut mulai baris 29 (video 30.mp4, 10 Des 2026) bila jendela 29 hari sudah menjangkau (cek tanggal eksekusi saat itu);
   - strategi: **5–8 baris per ronde**, tiap ronde minta approval user dulu;
   - atau tunggu dulu hingga jendela bergeser (±1 tanggal baru per hari).
4. ⚠️ **Ingatkan user sekali lagi: jangan tekan Terbitkan** — user akan verifikasi manual di akhir.

---

## 9. Referensi Sumber Data

- Caption digest: `C:\Users\salmonisme\Documents\Default Project\fb-reels-captions-digest.txt`
- Sumber `.post.json`: `E:\Social Media\reels\2026\ready-watermarking\output\posts`
- Panduan ini: `C:\Users\salmonisme\Documents\Default Project\fb-reels-scheduling-guide.md`

---

*Terakhir diperbarui: 10 Nov 2026 — Baris 0–27 sukses tersimpan; row 28 perlu verifikasi/perbaikan; row 29–49 menunggu jendela 29 hari bergeser atau ronde berikutnya.*