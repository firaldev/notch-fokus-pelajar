# rules.md — Notch Fokus Pelajar

Aturan koding proyek ini. Dibaca sebelum mengubah kode apa pun.

## 1. Stack & struktur folder

- **Tauri v2**, frontend HTML/CSS/JS polos di `src/`, tanpa bundler, tanpa framework.
  Frontend hanya memakai `window.__TAURI__`.
- Identifier: `id.notchfokuspelajar.app`, productName: `Notch Fokus Pelajar`.
- Struktur:
  - `src/index.html` — jendela notch (panel 6 halaman + pil musik + robot).
  - `src/dock.html` — jendela dock bawah.
  - `src/styles.css` — semua gaya notch.
  - `src/main.js` — semua logika notch.
  - `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` — versi & konfigurasi window.
  - `src-tauri/src/` — command Rust (mis. `open_path`, `set_dock_visible`).
  - `docs/` — landing GitHub Pages (hanya ada di repo git, bukan di folder source).

## 2. Alur kerja & rilis

- Edit di `~/workspace/notch-fokus-pelajar/` → salin file yang berubah ke klon git
  `~/workspace/notch-git-push/` → commit + push dari sana.
- Versi SELALU disinkronkan di 2 tempat: `Cargo.toml` DAN `tauri.conf.json`.
- Build hanya lewat GitHub Actions workflow **Build Windows** (Rust/cargo tidak ada
  di VM; satu run ~6–10 menit). Saat cek run, selalu filter
  `--workflow 'Build Windows'` karena `gh run list` bisa mengembalikan
  pages-build-deployment.
- Zip rilis hanya berisi installer `.exe` (target NSIS tunggal) — JANGAN sertakan .msi.
- Setiap rilis: verifikasi zip sendiri (`ls`, `sha256sum`, `unzip -l` cocok dengan
  artefak Actions), lalu update landing dengan commit `[skip ci]`.
- Jangan pernah mengklaim fitur sudah jalan di PC pengguna sebelum ia mengonfirmasi
  sendiri. Tulis "Belum teruji di PC" secara jujur di catatan rilis.

## 3. Konvensi penamaan

- File: huruf kecil, kata dipisah `-` bila perlu (`dock.html`, `main.js`).
- JavaScript: fungsi/variabel `camelCase`.
- Command Rust: `snake_case`.
- Key localStorage: prefix `nfp_` (mis. `nfp_robot`, `nfp_dock_theme`, `nfp_dock_apps`).
- Kelas CSS: `kebab-case`.
- Bahasa UI: Indonesia. Komentar kode boleh Indonesia.

## 4. Aturan styling / UI

- Notch 440px lebar; panel terbuka 440px; garis idle 440×6px; sudut membulat; hitam.
- TIDAK ADA scrollbar di mana pun (disembunyikan total).
- Panel: kartu selebar jendela penuh, tanpa radius/border samping.
- Pil musik: lebar dinamis ~260–560px, klik pil → halaman Musik; lirik selalu tampil.
- Dock: bawah-tengah, min-width 720px, tumbuh saat ikon bertambah; tema Gelap
  default (`#4A4A4F`, border `#626268`), tema Terang (putih `rgba(255,255,255,0.88)` +
  backdrop blur, border `#DCDDE2`, teks gelap).
- Robot: kecil putih membulat di header, default NYALA tapi kalem, tanpa suara/popup.
- Ikon menu: SVG, BUKAN emoji.
- Tinggi panel dinamis mengikuti konten; jendela pas ke pil saat tidak ada panel.
- Aplikasi tray-only: tidak ada entri taskbar, tidak ada titlebar.

## 5. Aturan transparansi jendela (anti garis putih)

- Window: `decorations: false`, `transparent: true`, `shadow: false`.
- CSS: `html, body { background: transparent; margin: 0; overflow: hidden; }`.
- Container root (notch, dock): `border: none; outline: none; box-shadow: none`.
- Tombol: `outline: none` termasuk state `:focus` dan `:focus-visible`; tidak ada
  efek hover/focus/selection yang memunculkan garis.
- Ukuran window HARUS sama persis dengan konten (bilangan bulat px). Hindari ukuran
  fraksional yang di DPI scaling (100%/125%/150%) bisa membulatkan jadi 1px tepi
  terang. Bila window di-resize lewat kode (mis. `fitDockWindow`), pastikan hasil
  akhirnya bilangan bulat dan sama dengan lebar konten.

## 6. Hal yang TIDAK BOLEH diubah

- Identifier dan productName (mengubahnya merusak auto-uninstall versi lama).
- Target bundle: NSIS saja. Jangan kembalikan `.msi` / `targets: "all"`.
- Mode Bar: SUDAH DIHAPUS TOTAL — jangan dihidupkan lagi.
- Tray-only: jangan memunculkan jendela di taskbar atau titlebar OS.
- Lokal tanpa akun, tanpa sinkronisasi cloud.
- Jangan menambah dependensi Rust baru bila tidak benar-benar perlu (risiko gagal build).
- Saat memperbaiki bug: ubah seminimal mungkin. Jangan mengubah desain, warna,
  atau fungsi lain di luar yang diminta.
- Musik: lirik via lrclib; musik WAJIB jalur yang sudah disepakati, bukan TTS.
