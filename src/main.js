// Notch Fokus Pelajar — logika frontend polos (tanpa framework).
// Semua data disimpan di localStorage. Tidak ada permintaan jaringan,
// tidak ada akun, tidak ada sinkronisasi cloud.
//
// Tauri dipakai bila tersedia (window.__TAURI__), dengan fallback web:
//   * Ukuran jendela: Tauri API bila ada, kalau tidak, CSS hover/.expanded.
//   * File picker: command Rust "pick_file" bila ada, kalau tidak,
//     <input type="file"> (hanya nama file yang bisa disimpan di web).
//   * Buka file: command Rust "open_path" bila ada dan path diketahui.

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  // ---------- Utilitas ----------
  function load(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* abaikan */ }
  }
  function formatSeconds(total) {
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  function showBanner(text) {
    var banner = $("banner");
    banner.textContent = text;
    banner.classList.remove("hidden");
    window.setTimeout(function () { banner.classList.add("hidden"); }, 8000);
  }
  function beep() {
    // Bunyi lembut lewat Web Audio: dua nada sinus pendek, bukan alarm keras.
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.35 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.35);
        osc.stop(ctx.currentTime + i * 0.35 + 0.35);
      });
    } catch (e) { /* audio tidak tersedia: abaikan, banner tetap tampil */ }
  }

  // ---------- Tauri (opsional, dengan fallback) ----------
  function tauriInvoke(name, args) {
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        return window.__TAURI__.core.invoke(name, args || {});
      }
    } catch (e) { /* jatuh ke fallback */ }
    return Promise.resolve(null);
  }
  function tauriWindow() {
    try {
      if (window.__TAURI__ && window.__TAURI__.window) {
        return window.__TAURI__.window.getCurrentWindow();
      }
    } catch (e) { /* bukan Tauri */ }
    return null;
  }
  // v0.2: tinggi jendela membesar disesuaikan per tab, supaya panel
  // tidak perlu di-scroll. Posisi jendela tidak diubah di sini, jadi
  // jendela yang sudah digeser pengguna tetap di tempatnya.
  // v0.3: mode Bar membuat jendela full-width 32px di atas layar,
  // diposisikan (0,0) dan tidak bisa digeser — seperti menu bar macOS.
  // Mode Notch kembali ke pil 440px yang bisa digeser.
  var pages = ["music", "focus", "focus-settings", "water", "water-today", "todo", "shelf", "status", "pengaturan"];
  var pageTitles = { music: "Musik", focus: "Pomodoro", "focus-settings": "Atur Timer", water: "Water Reminder", "water-today": "Air Hari Ini", todo: "To-do Tugas", shelf: "Shelf", status: "Status", pengaturan: "Pengaturan" };
  var currentPage = "music";
  // v0.17: ukuran panel terbuka TETAP — SATU-SATUNYA sumber angka ukuran
  // jendela. Diukur dari kode: slide Musik render ~288px (panel
  // scrollHeight 230 + header 56 + 2, diukur Chromium headless);
  // NOTCH_HEIGHT 320 memberi ruang aman ~30px untuk variasi font Windows
  // (Segoe UI) supaya tidak ada halaman yang terpotong. Jendela TIDAK
  // boleh di-resize saat pindah slide — konten yang menyesuaikan.
  var NOTCH_WIDTH = 440;
  var NOTCH_HEIGHT = 320;
  // v0.14: mode Bar dihapus total — hanya mode Notch. Bersihkan setelan lama.
  try { window.localStorage.removeItem("nfp_mode"); } catch (e) {}
  var musicPillActive = false, musicPillWidth = 0;
  function monitorLogicalWidth(callback) {
    var win = tauriWindow();
    try {
      if (win && win.currentMonitor) {
        var p = win.currentMonitor();
        if (p && p.then) {
          p.then(function (m) {
            callback(Math.round(m.size.width / (m.scaleFactor || 1)));
          }).catch(function () { callback((window.screen && window.screen.width) || 1920); });
          return;
        }
      }
    } catch (e) { /* jatuh ke fallback */ }
    callback((window.screen && window.screen.width) || 1920);
  }
  var lastWinWidth = 440;
  function setNotchSize(expanded) {
    var win = tauriWindow();
    var n = $("notch");
    var pill = !expanded && musicPillActive;
    if (pill) {
      document.body.classList.add("music-pill");
      document.body.classList.remove("notch-idle");
      if (n) { n.style.width = musicPillWidth + "px"; n.style.height = "32px"; }
    } else {
      document.body.classList.remove("music-pill");
      if (n) {
        n.style.width = "";
        /* v0.17: tinggi panel terbuka selalu NOTCH_HEIGHT — bukan
           mengikuti konten halaman aktif. */
        n.style.height = expanded ? (NOTCH_HEIGHT + "px") : "";
      }
    }
    if (win && win.setSize) {
      try {
        /* v0.17: ukuran jendela HARUS bilangan bulat — ukuran fraksional
           di DPI scaling (125%/150%) membulatkan jadi 1px tepi terang. */
        var w = Math.round(pill ? (musicPillWidth > 0 ? musicPillWidth : 320) : NOTCH_WIDTH);
        var h = Math.round(expanded ? NOTCH_HEIGHT : (pill ? 32 : 56));
        win.setSize(new window.__TAURI__.window.LogicalSize(w, h)).catch(function () { /* biarkan CSS yang bekerja */ });
        if (w !== lastWinWidth) {
          lastWinWidth = w;
          monitorLogicalWidth(function (sw) {
            try {
              if (win.setPosition) { win.setPosition(new window.__TAURI__.window.LogicalPosition(Math.round((sw - w) / 2), 0)).catch(function () {}); }
            } catch (e) {}
          });
        }
      } catch (e) { /* biarkan CSS yang bekerja */ }
    }
  }

  var notch = $("notch");
  notch.addEventListener("mouseenter", function () {
    notch.classList.add("expanded");
    setNotchSize(true);
  });
  notch.addEventListener("mouseleave", function () {
    notch.classList.remove("expanded");
    setNotchSize(false);
  });
  $("toggle-panel").addEventListener("click", function () {
    var expanded = notch.classList.toggle("expanded");
    setNotchSize(expanded);
  });
  // v0.14: klik pil musik membuka panel ke halaman Musik.
  var headerBar = notch.querySelector(".notch-bar");
  if (headerBar) {
    headerBar.addEventListener("click", function () {
      if (musicPillActive) {
        showPage("music");
        if (!notch.classList.contains("expanded")) {
          notch.classList.add("expanded");
          setNotchSize(true);
        }
      }
    });
  }

  // ---------- Halaman gaya Nusa: panah + titik, satu halaman per fitur ----------
  function showPage(page) {
    if (pages.indexOf(page) === -1) { return; }
    currentPage = page;
    document.querySelectorAll(".page").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-page") === page);
    });
    document.querySelectorAll(".page-dot").forEach(function (d) {
      d.classList.toggle("active", d.getAttribute("data-page-dot") === page);
    });
    var title = $("page-title");
    if (title) { title.textContent = pageTitles[page] || page; }
    if (notch.classList.contains("expanded")) { setNotchSize(true); }
  }
  function pageStep(dir) {
    var i = pages.indexOf(currentPage);
    var next = (i + dir + pages.length) % pages.length;
    showPage(pages[next]);
  }
  $("page-prev").addEventListener("click", function () { pageStep(-1); });
  $("page-next").addEventListener("click", function () { pageStep(1); });
  document.querySelectorAll(".page-dot").forEach(function (d) {
    d.addEventListener("click", function () { showPage(d.getAttribute("data-page-dot")); });
  });
  showPage("music");
  // Isi panel berubah (tambah/hapus tugas atau file Shelf) -> tinggi panel
  // dipas-kan ulang supaya tetap kecil dan seimbang.
  (function () {
    try {
      var panelEl = $("panel");
      var refitTimer = null;
      if (panelEl && window.MutationObserver) {
        var obs = new MutationObserver(function () {
          if (refitTimer) { clearTimeout(refitTimer); }
          refitTimer = setTimeout(function () {
            var n = $("notch");
            if (n && n.classList.contains("expanded")) { setNotchSize(true); }
          }, 120);
        });
        obs.observe(panelEl, { childList: true, subtree: true, characterData: true });
      }
    } catch (e) {}
  })();

  // ---------- v0.8: Dock bawah ala MacBook (bisa dimatikan) ----------
  var dockVisible = true;
  function setDockUI(v) {
    var b = $("btn-dock-toggle");
    if (b) { b.textContent = v ? "Dock: Aktif" : "Dock: Nonaktif"; }
  }
  function applyDock(v) {
    dockVisible = v;
    try { window.localStorage.setItem("nfp_dock", v ? "on" : "off"); } catch (e) {}
    setDockUI(v);
    tauriInvoke("set_dock_visible", { visible: v });
  }
  (function initDock() {
    try {
      var saved = window.localStorage.getItem("nfp_dock");
      dockVisible = saved !== "off";
    } catch (e) { dockVisible = true; }
    setDockUI(dockVisible);
    tauriInvoke("set_dock_visible", { visible: dockVisible });
  })();
  var dockToggleBtn = $("btn-dock-toggle");
  if (dockToggleBtn) {
    dockToggleBtn.addEventListener("click", function () { applyDock(!dockVisible); });
  }

  // ---------- v0.15: tema dock (Gelap default) + aplikasi Shelf di dock ----------
  var dockTheme = "dark";
  function setDockThemeUI(t) {
    var b = $("btn-dock-theme");
    if (b) { b.textContent = t === "light" ? "Tema Dock: Terang" : "Tema Dock: Gelap"; }
  }
  function applyDockTheme(t) {
    dockTheme = t === "light" ? "light" : "dark";
    try { window.localStorage.setItem("nfp_dock_theme", dockTheme); } catch (e) {}
    setDockThemeUI(dockTheme);
    try {
      if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
        window.__TAURI__.event.emit("nfp-dock-theme", { theme: dockTheme });
      }
    } catch (e) {}
  }
  (function initDockTheme() {
    try { dockTheme = window.localStorage.getItem("nfp_dock_theme") === "light" ? "light" : "dark"; } catch (e) {}
    setDockThemeUI(dockTheme);
  })();
  var dockThemeBtn = $("btn-dock-theme");
  if (dockThemeBtn) {
    dockThemeBtn.addEventListener("click", function () { applyDockTheme(dockTheme === "light" ? "dark" : "light"); });
  }

  // ---------- v0.17: aplikasi berjalan di dock (nyala/mati + pengecualian) ----------
  // Disimpan lokal; jendela dock membaca kunci ini tiap polling (2 detik)
  // — tidak perlu event antar-jendela.
  var runningOn = true;
  function runningSetUI() {
    var t = $("btn-running-toggle");
    if (t) { t.textContent = runningOn ? "Aplikasi Berjalan: Nyala" : "Aplikasi Berjalan: Mati"; }
  }
  (function initRunning() {
    try { runningOn = window.localStorage.getItem("nfp_running_apps") !== "off"; } catch (e) { runningOn = true; }
    runningSetUI();
    var input = $("running-block-input");
    if (input) {
      try { input.value = window.localStorage.getItem("nfp_running_apps_block") || ""; } catch (e) {}
      input.addEventListener("change", function () {
        try { window.localStorage.setItem("nfp_running_apps_block", input.value); } catch (e) {}
      });
    }
  })();
  var runningBtn = $("btn-running-toggle");
  if (runningBtn) {
    runningBtn.addEventListener("click", function () {
      runningOn = !runningOn;
      try { window.localStorage.setItem("nfp_running_apps", runningOn ? "on" : "off"); } catch (e) {}
      runningSetUI();
    });
  }

  // ---------- v0.16: maskot robot di bar atas ----------
  // Default NYALA, mungil dan kalem: idle melirik kiri-kanan + kedip,
  // tanpa suara/popup. Diketuk: mata marah + spin 360 + goyangan kecil.
  // Saat pil musik aktif, robot bersembunyi otomatis lewat aturan CSS
  // music-pill (semua anak header kecuali pil disembunyikan).
  var robotOn = true;
  var robotBtn = $("notch-robot");
  var robotTimers = [];
  function robotSetUI() {
    var t = $("btn-robot-toggle");
    if (t) { t.textContent = robotOn ? "Robot: Nyala" : "Robot: Mati"; }
    if (robotBtn) { robotBtn.style.display = robotOn ? "" : "none"; }
  }
  function robotClearTimers() {
    robotTimers.forEach(function (id) { try { clearTimeout(id); } catch (e) {} });
    robotTimers = [];
  }
  function robotIdleLoop() {
    if (!robotOn || !robotBtn) { return; }
    var glance = function () {
      if (!robotOn || !robotBtn) { return; }
      var dir = Math.random() < 0.5 ? "look-left" : "look-right";
      robotBtn.classList.remove("look-left", "look-right");
      robotBtn.classList.add(dir);
      robotTimers.push(setTimeout(function () {
        if (robotBtn) { robotBtn.classList.remove("look-left", "look-right"); }
        robotTimers.push(setTimeout(glance, 3500 + Math.random() * 4000));
      }, 900 + Math.random() * 500));
    };
    var blink = function () {
      if (!robotOn || !robotBtn) { return; }
      robotBtn.classList.add("blink");
      robotTimers.push(setTimeout(function () {
        if (robotBtn) { robotBtn.classList.remove("blink"); }
        robotTimers.push(setTimeout(blink, 2800 + Math.random() * 3500));
      }, 140));
    };
    robotTimers.push(setTimeout(glance, 2000));
    robotTimers.push(setTimeout(blink, 1500));
  }
  try { robotOn = window.localStorage.getItem("nfp_robot") !== "off"; } catch (e) { robotOn = true; }
  if (robotBtn) {
    robotBtn.addEventListener("click", function (ev) {
      try { ev.stopPropagation(); } catch (e) {}
      if (!robotOn) { return; }
      robotBtn.classList.remove("spin");
      void robotBtn.offsetWidth;
      robotBtn.classList.add("angry", "spin");
      robotTimers.push(setTimeout(function () {
        if (robotBtn) { robotBtn.classList.remove("angry", "spin"); }
      }, 750));
    });
  }
  var robotToggleBtn = $("btn-robot-toggle");
  if (robotToggleBtn) {
    robotToggleBtn.addEventListener("click", function () {
      robotOn = !robotOn;
      try { window.localStorage.setItem("nfp_robot", robotOn ? "on" : "off"); } catch (e) {}
      if (!robotOn) {
        robotClearTimers();
        if (robotBtn) { robotBtn.classList.remove("look-left", "look-right", "blink", "angry", "spin"); }
      }
      robotSetUI();
      if (robotOn) { robotIdleLoop(); }
    });
  }
  robotSetUI();
  if (robotOn) { robotIdleLoop(); }
  // Dipanggil saat Buka di Shelf: entri dock (cegah dobel per path),
  // dock dirender live lewat event; daftar juga disimpan lokal.
  function addAppToDock(path) {
    if (!path) { return; }
    try {
      var list = JSON.parse(window.localStorage.getItem("nfp_dock_apps") || "[]");
      if (!Array.isArray(list)) { list = []; }
      if (list.some(function (a) { return a && a.path === path; })) { return; }
      list.push({ path: path });
      window.localStorage.setItem("nfp_dock_apps", JSON.stringify(list));
    } catch (e) {}
    try {
      if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
        window.__TAURI__.event.emit("nfp-dock-app-added", { path: path });
      }
    } catch (e) {}
  }
  if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
    window.__TAURI__.event.listen("nfp-open-page", function (e) {
      var page = e && e.payload && e.payload.page;
      if (page) {
        showPage(page);
        notch.classList.add("expanded");
        setNotchSize(true);
      }
    });
    window.__TAURI__.event.listen("nfp-tray-dock-toggle", function () { applyDock(!dockVisible); });
    window.__TAURI__.event.listen("nfp-dock-hidden", function () {
      dockVisible = false;
      try { window.localStorage.setItem("nfp_dock", "off"); } catch (e) {}
      setDockUI(false);
    });
  }

  // ---------- v0.9: garis idle di tepi atas (mode Notch saja) ----------
  var idleTimer = null;
  // v0.10: saat idle, jendela ikut menyusut jadi 440x6 — tidak ada area
  // jendela kosong yang bisa tampil sebagai kotak putih.
  function goIdle() {
    if (notch.classList.contains("expanded")) { return; }
    if (musicPillActive) { return; }
    if (typeof currentLyricText !== "undefined" && currentLyricText) { return; }
    document.body.classList.add("notch-idle");
    var win = tauriWindow();
    if (win && win.setSize) {
      try { win.setSize(new window.__TAURI__.window.LogicalSize(440, 6)).catch(function () {}); } catch (e) {}
    }
  }
  function wakeIdle() {
    document.body.classList.remove("notch-idle");
    if (idleTimer) { clearTimeout(idleTimer); }
    idleTimer = setTimeout(goIdle, 4000);
    setNotchSize(false);
  }
  document.body.addEventListener("mouseenter", wakeIdle);
  document.body.addEventListener("mouseleave", function () {
    if (idleTimer) { clearTimeout(idleTimer); }
    idleTimer = setTimeout(goIdle, 3000);
  });
  idleTimer = setTimeout(goIdle, 4000);

  // ---------- v0.9: taskbar Windows bisa digantikan Dock ----------
  var taskbarHidden = false;
  function setTaskbarUI(v) {
    var b = $("btn-taskbar-toggle");
    if (b) { b.textContent = v ? "Taskbar Windows: Sembunyi" : "Taskbar Windows: Tampil"; }
  }
  (function initTaskbar() {
    try { taskbarHidden = window.localStorage.getItem("nfp_taskbar_hidden") === "on"; } catch (e) { taskbarHidden = false; }
    setTaskbarUI(taskbarHidden);
    tauriInvoke("set_taskbar_visible", { visible: !taskbarHidden });
  })();
  var taskbarBtn = $("btn-taskbar-toggle");
  if (taskbarBtn) {
    taskbarBtn.addEventListener("click", function () {
      taskbarHidden = !taskbarHidden;
      try { window.localStorage.setItem("nfp_taskbar_hidden", taskbarHidden ? "on" : "off"); } catch (e) {}
      setTaskbarUI(taskbarHidden);
      tauriInvoke("set_taskbar_visible", { visible: !taskbarHidden });
    });
  }

  // ---------- v0.12: level volume/kecerahan tampil di bar atas ----------
  // Menggantikan overlay samping: saat level berubah, isi tengah bar atas
  // sementara diganti indikator level (ikon + slider + persen) selama
  // 2,5 detik, lalu kembali seperti semula. Tanpa mengubah ukuran jendela
  // (kecuali dari garis idle 6px yang dibangunkan dulu ke bar 56px).
  // Satu pengatur isi tengah bar atas: 'normal' (jam + judul), 'level'
  // (indikator volume/kecerahan), atau 'lyrics' (satu baris lirik).
  // Level selalu menang atas lirik selama 2,5 detik tampilnya.
  function setBarCenter(mode) {
    if (document.body.classList.contains("music-pill")) { return; }
    var clock = $("notch-clock"); if (clock) { clock.style.display = mode === "normal" ? "" : "none"; }
    var title = notch.querySelector(".notch-title"); if (title) { title.style.display = mode === "normal" ? "" : "none"; }
    var timer = $("mini-timer"); if (timer) { timer.style.display = mode === "normal" ? "" : "none"; }
    var mini = $("level-mini"); if (mini) { mini.classList.toggle("on", mode === "level"); }
    var lyric = $("lyric-line"); if (lyric) { lyric.classList.toggle("on", mode === "lyrics"); }
    var charger = $("charger-mini"); if (charger) { charger.classList.toggle("on", mode === "charger"); }
  }
  // Tampilan sementara di tengah bar atas: level (2,5 detik) atau charger
  // (3 detik). Yang terakhir tampil menang; setelah habis, kembali ke
  // lirik (bila lagu ber-lirik sedang diputar) atau ke bar normal.
  var transientKind = null, transientWasIdle = false, transientTimer = null;
  function showTransient(kind, ms) {
    if (!transientKind) {
      transientWasIdle = document.body.classList.contains("notch-idle");
      if (transientWasIdle) {
        document.body.classList.remove("notch-idle");
        setNotchSize(false);
      }
    }
    transientKind = kind;
    setBarCenter(kind);
    if (transientTimer) { clearTimeout(transientTimer); }
    transientTimer = setTimeout(endTransient, ms);
  }
  function endTransient() {
    transientKind = null;
    transientTimer = null;
    if (musicPillActive && !notch.classList.contains("expanded")) {
      var pill = $("music-pill");
      if (pill) { pill.textContent = deriveMusicPillText(); }
      return;
    }
    if (typeof currentLyricText !== "undefined" && currentLyricText) { setBarCenter("lyrics"); }
    else { setBarCenter("normal"); }
    if (transientWasIdle) { goIdle(); }
  }
  function showLevel(kind, pct) {
    var mini = $("level-mini");
    if (!mini) { return; }
    $("level-icon").textContent = kind === "brightness" ? "☀" : "🔊";
    $("level-fill").style.width = pct + "%";
    $("level-pct").textContent = pct + "%";
    if (musicPillActive && !notch.classList.contains("expanded")) {
      var lpill = $("music-pill");
      if (lpill) { lpill.textContent = (kind === "brightness" ? "☀ " : "🔊 ") + pct + "%"; }
    }
    showTransient("level", 2500);
  }
  function showCharger(connected, pct) {
    var el = $("charger-mini");
    if (!el) { return; }
    el.textContent = connected ? ("⚡ Charger terhubung • " + pct + "%") : ("🔌 Charger dilepas • " + pct + "%");
    if (musicPillActive && !notch.classList.contains("expanded")) {
      var cpill = $("music-pill");
      if (cpill) { cpill.textContent = el.textContent; }
    }
    showTransient("charger", 3000);
  }

  // ---------- v0.12: polling level sistem (tampil di bar atas) ----------
  var lastVolume = null, volumeFailures = 0;
  // ---------- v0.14: pil musik minimal ----------
  // Saat lagu diputar, bar ciut jadi pil ringkas "ikon + baris lirik"
  // (atau "ikon + judul - artis" bila lagu tanpa lirik). Klik pil membuka
  // panel ke halaman Musik.
  function deriveMusicPillText() {
    var t = currentLyricText || currentMusicTitle || "";
    if (!currentLyricText && currentMusicTitle && currentMusicArtist) { t = currentMusicTitle + " - " + currentMusicArtist; }
    return t ? ("♫ " + t) : "";
  }
  function refreshMusicPill(info) {
    var should = !!(info && info.title && info.playing);
    var was = musicPillActive;
    musicPillActive = should;
    if (!should) {
      if (was) { setNotchSize(notch.classList.contains("expanded")); }
      return;
    }
    var oldW = musicPillWidth;
    var m = $("music-pill-measure");
    if (m) {
      m.textContent = deriveMusicPillText();
      var w = m.scrollWidth + 32;
      if (w < 260) { w = 260; }
      if (w > 560) { w = 560; }
      musicPillWidth = w;
    }
    if (!transientKind) {
      var pill = $("music-pill");
      if (pill) { pill.textContent = deriveMusicPillText(); }
    }
    // Ukuran jendela hanya diubah saat pil baru aktif atau lebarnya berubah,
    // supaya tidak ada setSize tiap detik dari interval media.
    if (!notch.classList.contains("expanded") && (!was || musicPillWidth !== oldW)) { setNotchSize(false); }
  }
  setInterval(function () {
    tauriInvoke("volume_level").then(function (v) {
      if (typeof v !== "number") { return; }
      volumeFailures = 0;
      if (lastVolume !== null && Math.abs(v - lastVolume) >= 2) {
        showLevel("volume", Math.round(v));
      }
      lastVolume = v;
    }).catch(function () {
      volumeFailures += 1;
      if (volumeFailures > 10) { lastVolume = null; }
    });
  }, 1000);

  // ---------- v0.10: info lagu dari pemutar aktif (GSMTC Windows) ----------
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }
  var currentMusicTitle = "", currentMusicArtist = "";
  // ---------- v0.13: satu baris lirik tersinkron di bar atas ----------
  // v0.14: lirik selalu tampil kalau ada. Synced diutamakan; kalau hanya
  // ada lirik polos, barisnya berjalan proporsional dengan posisi lagu.
  // Pencarian jatuh ke /api/search bila /api/get tidak menemukan.
  var lyricTrackKey = "", lyricLines = [], lyricPlainLines = [], currentLyricText = "", currentDurationSecs = 0;
  function applyLyricData(data, key) {
    if (key !== lyricTrackKey) { return; }
    var synced = (data && data.syncedLyrics) || "";
    var lines = [];
    synced.split(/\r?\n/).forEach(function (ln) {
      var m = ln.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (m) { lines.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: (m[3] || "").trim() }); }
    });
    lines.sort(function (a, b) { return a.t - b.t; });
    lyricLines = lines;
    if (!lines.length) {
      var plain = (data && data.plainLyrics) || "";
      lyricPlainLines = plain.split(/\r?\n/).map(function (t) { return t.trim(); }).filter(function (t) { return t.length > 0; });
    } else { lyricPlainLines = []; }
  }
  function fetchLyrics(title, artist) {
    var key = title + "\n" + artist;
    if (key === lyricTrackKey) { return; }
    lyricTrackKey = key; lyricLines = []; lyricPlainLines = []; currentLyricText = "";
    if (!title) { if (!transientKind) { setBarCenter("normal"); } return; }
    var url = "https://lrclib.net/api/get?artist_name=" + encodeURIComponent(artist || "") +
      "&track_name=" + encodeURIComponent(title);
    fetch(url).then(function (r) {
      if (!r.ok) { throw new Error("no lyrics"); }
      return r.json();
    }).then(function (data) {
      applyLyricData(data, key);
      if (!lyricLines.length && !lyricPlainLines.length) {
        return fetch("https://lrclib.net/api/search?artist_name=" + encodeURIComponent(artist || "") +
          "&track_name=" + encodeURIComponent(title)).then(function (r) {
          if (!r.ok) { throw new Error("no search"); }
          return r.json();
        }).then(function (list) {
          var arr = Array.isArray(list) ? list : [];
          var pick = null;
          for (var i = 0; i < arr.length; i++) { if (arr[i].syncedLyrics) { pick = arr[i]; break; } }
          if (!pick) { for (var j = 0; j < arr.length; j++) { if (arr[j].plainLyrics) { pick = arr[j]; break; } } }
          if (pick) { applyLyricData(pick, key); }
        });
      }
    }).catch(function () { /* tetap tanpa lirik: bar normal */ });
  }
  function updateLyricLine(pos) {
    if (lyricPlainLines.length) {
      var idx = currentDurationSecs > 0 ? Math.floor((pos || 0) / currentDurationSecs * lyricPlainLines.length) : 0;
      if (idx >= lyricPlainLines.length) { idx = lyricPlainLines.length - 1; }
      if (idx < 0) { idx = 0; }
      var ptext = lyricPlainLines[idx];
      if (ptext && ptext !== currentLyricText) {
        currentLyricText = ptext;
        $("lyric-line").textContent = ptext;
        if (!transientKind) { setBarCenter("lyrics"); }
      }
      return;
    }
    if (!lyricLines.length) {
      if (currentLyricText) {
        currentLyricText = "";
        if (!transientKind) { setBarCenter("normal"); }
      }
      return;
    }
    var text = "";
    for (var i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= (pos || 0)) {
        if (lyricLines[i].text) { text = lyricLines[i].text; }
      } else { break; }
    }
    // Sebelum baris pertama (intro): tampilkan baris pertama, jadi lirik
    // tidak pernah kosong selama lagu ber-lirik.
    if (!text) {
      for (var k = 0; k < lyricLines.length; k++) { if (lyricLines[k].text) { text = lyricLines[k].text; break; } }
    }
    if (text && text !== currentLyricText) {
      currentLyricText = text;
      $("lyric-line").textContent = text;
      if (!transientKind) { setBarCenter("lyrics"); }
    } else if (!text && currentLyricText) {
      currentLyricText = "";
      if (!transientKind) { setBarCenter("normal"); }
    }
  }
  setInterval(function () {
    tauriInvoke("volume_level").then(function (v) {
      if (typeof v !== "number") { return; }
      volumeFailures = 0;
      if (lastVolume !== null && Math.abs(v - lastVolume) >= 2) {
        showLevel("volume", Math.round(v));
      }
      lastVolume = v;
    }).catch(function () {
      volumeFailures += 1;
      if (volumeFailures > 10) { lastVolume = null; }
    });
  }, 1000);

  // ---------- v0.10: info lagu dari pemutar aktif (GSMTC Windows) ----------
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }
  var currentMusicTitle = "", currentMusicArtist = "";
  // ---------- v0.13: satu baris lirik tersinkron di bar atas ----------
  // Otomatis saat lagu diputar: lirik tersinkron (syncedLyrics lrclib)
  // diambil sekali per lagu, lalu baris yang sesuai posisi lagu tampil
  // di bar atas. Tanpa lirik tersinkron, bar tetap normal.
  var lyricTrackKey = "", lyricLines = [], currentLyricText = "";
  function fetchLyrics(title, artist) {
    var key = title + "\n" + artist;
    if (key === lyricTrackKey) { return; }
    lyricTrackKey = key; lyricLines = []; currentLyricText = "";
    if (!title) { if (!transientKind) { setBarCenter("normal"); } return; }
    var url = "https://lrclib.net/api/get?artist_name=" + encodeURIComponent(artist || "") +
      "&track_name=" + encodeURIComponent(title);
    fetch(url).then(function (r) {
      if (!r.ok) { throw new Error("no lyrics"); }
      return r.json();
    }).then(function (data) {
      var synced = (data && data.syncedLyrics) || "";
      var lines = [];
      synced.split(/\r?\n/).forEach(function (ln) {
        var m = ln.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        if (m) { lines.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: (m[3] || "").trim() }); }
      });
      lines.sort(function (a, b) { return a.t - b.t; });
      lyricLines = lines;
    }).catch(function () { lyricLines = []; });
  }
  function updateLyricLine(pos) {
    if (!lyricLines.length) {
      if (currentLyricText) {
        currentLyricText = "";
        if (!transientKind) { setBarCenter("normal"); }
      }
      return;
    }
    var text = "";
    for (var i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= (pos || 0)) {
        if (lyricLines[i].text) { text = lyricLines[i].text; }
      } else { break; }
    }
    if (text && text !== currentLyricText) {
      currentLyricText = text;
      $("lyric-line").textContent = text;
      if (!transientKind) { setBarCenter("lyrics"); }
    } else if (!text && currentLyricText) {
      currentLyricText = "";
      if (!transientKind) { setBarCenter("normal"); }
    }
  }
  setInterval(function () {
    tauriInvoke("media_info").then(function (info) {
      if (!info || !info.title) {
        currentMusicTitle = ""; currentMusicArtist = ""; currentDurationSecs = 0; refreshMusicPill(null);
        fetchLyrics("", "");
        $("music-track").textContent = "Tidak ada media";
        $("music-artist").textContent = "";
        $("music-elapsed").textContent = "00:00";
        $("music-remaining").textContent = "-00:00";
        $("music-fill").style.width = "0%";
        return;
      }
      currentMusicTitle = info.title; currentMusicArtist = info.artist || ""; currentDurationSecs = info.duration_secs || 0;
      fetchLyrics(info.title, info.artist || "");
      updateLyricLine(info.position_secs);
      $("music-track").textContent = info.title;
      $("music-artist").textContent = info.artist || "";
      $("music-elapsed").textContent = fmtTime(info.position_secs);
      var remain = Math.max(0, (info.duration_secs || 0) - (info.position_secs || 0));
      $("music-remaining").textContent = "-" + fmtTime(remain);
      var pct = info.duration_secs > 0 ? Math.min(100, Math.round(info.position_secs / info.duration_secs * 100)) : 0;
      $("music-fill").style.width = pct + "%";
      refreshMusicPill(info);
    }).catch(function () { refreshMusicPill(null); /* halaman musik biarkan tampilan terakhir */ });
  }, 1000);

  // ---------- v0.11: overlay kecerahan (polling WMI tiap 2 detik) ----------
  var lastBrightness = null, brightnessFailures = 0, brightnessDisabled = false;
  setInterval(function () {
    if (brightnessDisabled) { return; }
    tauriInvoke("brightness_level").then(function (v) {
      if (typeof v !== "number") { return; }
      brightnessFailures = 0;
      if (lastBrightness !== null && Math.abs(v - lastBrightness) >= 2) {
        showLevel("brightness", Math.round(v));
      }
      lastBrightness = v;
    }).catch(function () {
      brightnessFailures += 1;
      // Perangkat tanpa kecerahan WMI (mis. monitor eksternal): berhenti
      // polling supaya tidak membebani CPU dengan kueri yang selalu gagal.
      if (brightnessFailures >= 5) { brightnessDisabled = true; }
    });
  }, 2000);

  // ---------- Jam ----------
  function tickClock() {
    var now = new Date();
    var hhmm = String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");
    var clock = $("clock");
    if (clock) { clock.textContent = hhmm; }
    var barClock = $("bar-clock");
    if (barClock) { barClock.textContent = hhmm; }
    var notchClock = $("notch-clock");
    if (notchClock) { notchClock.textContent = hhmm; }
    var pageDate = $("page-date");
    if (pageDate) {
      var days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
      var months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
      pageDate.textContent = days[now.getDay()] + " " + now.getDate() + " " +
        months[now.getMonth()] + " " + now.getFullYear() + " " + hhmm;
    }
    updateClosedHeader();
  }
  function updateClosedHeader() {
    if (document.body.classList.contains("music-pill")) { return; }
    var nc = $("notch-clock");
    var mt = $("mini-timer");
    if (!nc || !mt) { return; }
    if (typeof running !== "undefined" && running) {
      nc.style.display = "none";
      mt.style.display = "";
    } else {
      nc.style.display = "";
      mt.style.display = "none";
    }
  }
  tickClock();
  window.setInterval(tickClock, 1000);

  // ---------- Pomodoro ----------
  var settings = load("nfp_settings", { focus: 25, break: 5, water: 60, rest: 90 });
  $("focus-minutes").value = settings.focus;
  $("break-minutes").value = settings.break;
  $("water-minutes").value = settings.water;
  $("rest-minutes").value = settings.rest;

  function persistSettings() {
    settings.focus = Math.max(1, parseInt($("focus-minutes").value, 10) || 25);
    settings.break = Math.max(1, parseInt($("break-minutes").value, 10) || 5);
    settings.water = Math.max(5, parseInt($("water-minutes").value, 10) || 60);
    settings.rest = Math.max(10, parseInt($("rest-minutes").value, 10) || 90);
    save("nfp_settings", settings);
    waterLeft = settings.water * 60;
    restLeft = settings.rest * 60;
  }
  ["focus-minutes", "break-minutes", "water-minutes", "rest-minutes"].forEach(function (id) {
    $(id).addEventListener("change", persistSettings);
  });

  var mode = "focus"; // "focus" | "break"
  var remaining = settings.focus * 60;
  var running = false;
  var sessions = 0;
  var timerId = null;

  function renderTimer() {
    $("timer-display").textContent = formatSeconds(remaining);
    $("mini-timer").textContent = formatSeconds(remaining) + " · " + (mode === "focus" ? "Fokus" : "Istirahat");
    if (typeof updateClosedHeader === "function") { updateClosedHeader(); }
    $("timer-mode").innerHTML = "Mode: " + (mode === "focus" ? "Fokus" : "Istirahat") +
      " · Sesi selesai: <span id=\"sessions\">" + sessions + "</span>";
    $("btn-switch").textContent = mode === "focus" ? "Ganti ke Istirahat" : "Ganti ke Fokus";
  }
  function stopTimer() {
    if (timerId) { window.clearInterval(timerId); timerId = null; }
    running = false;
  }
  // v0.4: notifikasi sistem Windows, di samping banner di aplikasi.
  // Di pratinjau web panggilan ini tidak melakukan apa-apa.
  function notify(title, body) {
    tauriInvoke("send_notification", { title: title, body: body });
  }
  function finishPeriod() {
    stopTimer();
    beep();
    if (mode === "focus") {
      sessions += 1;
      showBanner("Sesi fokus selesai! Waktunya istirahat " + settings.break + " menit.");
      notify("Notch Fokus Pelajar", "Sesi fokus selesai! Waktunya istirahat " + settings.break + " menit.");
      mode = "break";
      remaining = settings.break * 60;
    } else {
      showBanner("Istirahat selesai. Siap fokus lagi?");
      notify("Notch Fokus Pelajar", "Istirahat selesai. Siap fokus lagi?");
      mode = "focus";
      remaining = settings.focus * 60;
    }
    renderTimer();
  }
  $("btn-start").addEventListener("click", function () {
    if (running) { return; }
    running = true;
    timerId = window.setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) { finishPeriod(); return; }
      renderTimer();
    }, 1000);
  });
  $("btn-pause").addEventListener("click", stopTimer);
  $("btn-reset").addEventListener("click", function () {
    stopTimer();
    remaining = (mode === "focus" ? settings.focus : settings.break) * 60;
    renderTimer();
  });
  $("btn-switch").addEventListener("click", function () {
    stopTimer();
    mode = mode === "focus" ? "break" : "focus";
    remaining = (mode === "focus" ? settings.focus : settings.break) * 60;
    renderTimer();
  });
  renderTimer();

  // ---------- To-do ----------
  var todos = load("nfp_todos", []);
  function renderTodos() {
    var list = $("todo-list");
    list.innerHTML = "";
    if (todos.length === 0) {
      var empty = document.createElement("li");
      empty.textContent = "Belum ada tugas. Tambahkan satu di atas.";
      list.appendChild(empty);
      return;
    }
    todos.forEach(function (todo, index) {
      var li = document.createElement("li");
      if (todo.done) { li.className = "done"; }
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!todo.done;
      box.setAttribute("aria-label", "Tandai selesai: " + todo.text);
      box.addEventListener("change", function () {
        todos[index].done = box.checked;
        save("nfp_todos", todos);
        renderTodos();
      });
      var span = document.createElement("span");
      span.textContent = todo.text;
      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "Hapus";
      del.addEventListener("click", function () {
        todos.splice(index, 1);
        save("nfp_todos", todos);
        renderTodos();
      });
      li.appendChild(box);
      li.appendChild(span);
      li.appendChild(del);
      list.appendChild(li);
    });
  }
  function addTodo() {
    var text = $("todo-input").value.trim();
    if (!text) { return; }
    todos.push({ text: text, done: false });
    save("nfp_todos", todos);
    $("todo-input").value = "";
    renderTodos();
  }
  $("btn-add-todo").addEventListener("click", addTodo);
  $("todo-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { addTodo(); }
  });
  renderTodos();

  // ---------- Pengingat air & istirahat (dalam aplikasi) ----------
  var waterLeft = settings.water * 60;
  var restLeft = settings.rest * 60;
  window.setInterval(function () {
    if (waterLeft > 0) { waterLeft -= 1; }
    if (waterLeft === 0) {
      beep();
      showBanner("Waktunya minum air 💧 — klik “Sudah minum” untuk mengulang pengingat.");
      notify("Notch Fokus Pelajar", "Waktunya minum air 💧");
      waterLeft = settings.water * 60;
    }
    if (restLeft > 0) { restLeft -= 1; }
    if (restLeft === 0) {
      beep();
      showBanner("Waktunya istirahat sejenak 😌 — regangkan badan, jauhkan mata dari layar.");
      notify("Notch Fokus Pelajar", "Waktunya istirahat sejenak 😌");
      restLeft = settings.rest * 60;
    }
    $("water-countdown").textContent = formatSeconds(waterLeft);
    $("rest-countdown").textContent = formatSeconds(restLeft);
  }, 1000);
  function todayKey() {
    var n = new Date();
    return n.getFullYear() + "-" + (n.getMonth() + 1) + "-" + n.getDate();
  }
  function loadWaterLog() {
    try {
      var v = JSON.parse(window.localStorage.getItem("nfp_water_log") || "null");
      if (v && v.date === todayKey()) { return v; }
    } catch (e) {}
    return { date: todayKey(), totalMl: 0, byHour: {} };
  }
  function renderWaterToday() {
    var log = loadWaterLog();
    var litres = (log.totalMl / 1000).toFixed(1);
    var pct = Math.min(100, Math.round(log.totalMl / 2000 * 100));
    var el = $("water-today");
    if (el) { el.textContent = litres + " / 2.0 L · " + pct + "%"; }
    var chart = $("water-chart");
    if (chart) {
      var hours = Object.keys(log.byHour).sort(function (a, b) { return a - b; });
      if (!hours.length) {
        chart.textContent = "Belum ada gelas hari ini.";
      } else {
        chart.innerHTML = hours.map(function (h) {
          var ml = log.byHour[h];
          var bar = Math.max(4, Math.round(ml / 500 * 40));
          return "<div class=\"water-bar-row\"><span>" + h + ":00</span><span class=\"water-bar\" style=\"width:" + bar + "px\"></span><span>" + ml + " ml</span></div>";
        }).join("");
      }
    }
  }
  function addDrink(ml) {
    var log = loadWaterLog();
    log.totalMl += ml;
    var h = String(new Date().getHours());
    log.byHour[h] = (log.byHour[h] || 0) + ml;
    try { window.localStorage.setItem("nfp_water_log", JSON.stringify(log)); } catch (e) {}
    renderWaterToday();
  }
  renderWaterToday();
  $("btn-water-done").addEventListener("click", function () {
    waterLeft = settings.water * 60;
    addDrink(250);
    showBanner("Pengingat air diulang. Bagus, tetap terhidrasi! (+250 ml hari ini)");
  });
  $("btn-rest-done").addEventListener("click", function () {
    restLeft = settings.rest * 60;
    showBanner("Pengingat istirahat diulang.");
  });
  $("btn-test-notification").addEventListener("click", function () {
    notify("Notch Fokus Pelajar", "Notifikasi Windows berfungsi. Ini pesan uji.");
    showBanner("Notifikasi uji dikirim. Kalau toast Windows tidak muncul, cek setelan Notifikasi Windows.");
  });

  // ---------- File shelf ----------
  var shelf = load("nfp_shelf", []);
  function renderShelf() {
    var list = $("shelf-list");
    list.innerHTML = "";
    if (shelf.length === 0) {
      var empty = document.createElement("li");
      empty.textContent = "Shelf masih kosong. Seret file atau aplikasi ke sini, atau pakai tombol Tambah file…";
      list.appendChild(empty);
      return;
    }
    shelf.forEach(function (item, index) {
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.textContent = item.name + (item.path ? " — " + item.path : " (path tidak tersedia di pratinjau web)");
      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Buka";
      openBtn.addEventListener("click", function () {
        if (item.path) {
          addAppToDock(item.path);
          tauriInvoke("open_path", { path: item.path }).then(function (result) {
            if (result === null) {
              showBanner("Membuka file hanya didukung di aplikasi Tauri. Path: " + item.path);
            }
          });
        } else {
          showBanner("Path file ini tidak tersimpan (pratinjau web). Di aplikasi Tauri, tambah file lewat dialog pilih file agar path-nya tersimpan.");
        }
      });
      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "Hapus";
      del.addEventListener("click", function () {
        shelf.splice(index, 1);
        save("nfp_shelf", shelf);
        renderShelf();
      });
      li.appendChild(span);
      li.appendChild(openBtn);
      li.appendChild(del);
      list.appendChild(li);
    });
  }
  $("btn-add-file").addEventListener("click", function () {
    tauriInvoke("pick_file").then(function (path) {
      if (typeof path === "string" && path.length > 0) {
        var name = path.split(/[\\/]/).pop() || path;
        shelf.push({ name: name, path: path });
        save("nfp_shelf", shelf);
        renderShelf();
      } else {
        // Bukan Tauri, atau command tidak tersedia: pakai input file web.
        $("file-input-fallback").click();
      }
    });
  });
  $("file-input-fallback").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) {
      // Browser sengaja tidak memberi path asli; yang tersimpan hanya nama.
      shelf.push({ name: file.name, path: "" });
      save("nfp_shelf", shelf);
      renderShelf();
    }
    e.target.value = "";
  });
  renderShelf();

  // ---------- v0.14: Shelf bisa di-drop file & aplikasi ----------
  // Seret dari File Explorer ke kartu Shelf saat halaman Shelf terbuka:
  // path asli dari event drag-drop Tauri disimpan, jadi tombol Buka
  // benar-benar membuka file/aplikasi itu (lewat opener bawaan Tauri).
  function addShelfPath(path) {
    if (typeof path !== "string" || !path) { return; }
    if (shelf.some(function (it) { return it.path === path; })) { return; } // cegah dobel
    var name = path.split(/[\\/]/).pop() || path;
    shelf.push({ name: name, path: path });
    save("nfp_shelf", shelf);
    renderShelf();
  }
  var tauriDropSupported = false;
  try {
    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
      window.__TAURI__.event.listen("tauri://drag-drop", function (e) {
        var paths = e && e.payload && e.payload.paths;
        if (!paths || !paths.length) { return; }
        if (currentPage !== "shelf") { return; }
        if (!notch.classList.contains("expanded")) { return; }
        paths.forEach(addShelfPath);
        showBanner(paths.length === 1 ? "Ditambahkan ke Shelf." : (paths.length + " file ditambahkan ke Shelf."));
      }).then(function () { tauriDropSupported = true; }).catch(function () {});
    }
  } catch (e) { /* bukan Tauri: pakai fallback DOM di bawah */ }
  var shelfCard = $("shelf-card");
  if (shelfCard) {
    shelfCard.addEventListener("dragover", function (e) {
      if (currentPage !== "shelf") { return; }
      e.preventDefault();
      shelfCard.classList.add("drop-active");
    });
    shelfCard.addEventListener("dragleave", function () {
      shelfCard.classList.remove("drop-active");
    });
    shelfCard.addEventListener("drop", function (e) {
      e.preventDefault();
      shelfCard.classList.remove("drop-active");
      if (currentPage !== "shelf") { return; }
      if (tauriDropSupported) { return; } // event Tauri yang menambahkan (dengan path asli)
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) { return; }
      Array.prototype.forEach.call(files, function (file) {
        // Browser tidak memberi path asli; yang tersimpan hanya nama.
        shelf.push({ name: file.name, path: "" });
      });
      save("nfp_shelf", shelf);
      renderShelf();
    });
  }

  // ---------- Kontrol musik v0.4: tombol media sistem Windows ----------
  // Tombol ini mengirim media key ke Windows, sehingga pemutar yang
  // sedang aktif (Spotify, YouTube di browser, atau pemutar lain)
  // yang merespons — bukan ke satu aplikasi yang dipilih manual.
  document.querySelectorAll(".music-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var action = btn.getAttribute("data-music");
      if (action === "play-pause") { action = "play-pause"; }
      else if (action === "previous") { action = "previous"; }
      else if (action === "next") { action = "next"; }
      if (tauriWindow()) {
        tauriInvoke("media_key", { action: action });
        $("music-note").textContent = "Tombol media dikirim ke pemutar yang sedang aktif di Windows.";
      } else {
        $("music-note").textContent = "Di pratinjau web tombol media tidak bisa dikirim; di aplikasi Windows tombol ini mengontrol pemutar yang sedang aktif.";
      }
    });
  });

  // ---------- Status perangkat ----------
  function renderOnline() {
    var online = $("online-status");
    if (online) { online.textContent = window.navigator.onLine ? "Online" : "Offline"; }
    refreshWifi();
  }
  // v0.4: Wi-Fi diperiksa tiap 10 detik, bukan tiap detik, supaya
  // tidak membebani CPU — SSID dan sinyal tidak berubah secepat itu.
  function refreshWifi() {
    var el = $("wifi-status");
    if (!el) { return; }
    tauriInvoke("wifi_status").then(function (result) {
      var barWifi = $("bar-wifi");
      if (result && result.connected) {
        var sig = (result.signal_percent !== null && result.signal_percent !== undefined
          ? result.signal_percent + "%" : "—");
        el.textContent = (result.ssid || "Terhubung") + " (" + sig + ")";
        if (barWifi) { barWifi.textContent = "Wi-Fi " + (result.ssid || "") + " " + sig; }
      } else if (result) {
        el.textContent = "Tidak terhubung / tanpa Wi-Fi";
        if (barWifi) { barWifi.textContent = "Wi-Fi —"; }
      } else {
        el.textContent = "Hanya di aplikasi Windows.";
      }
    });
  }
  window.addEventListener("online", renderOnline);
  window.addEventListener("offline", renderOnline);
  renderOnline();
  window.setInterval(refreshWifi, 10000);

  if (window.navigator.getBattery) {
    window.navigator.getBattery().then(function (battery) {
      function renderBattery() {
        var pct = Math.round(battery.level * 100);
        $("battery-status").textContent = pct + "%" + (battery.charging ? " (mengisi daya)" : "");
        // v0.9: beri tahu saat charger dicolok/dilepas (bukan saat pertama baca).
        if (typeof window.__nfpPrevCharging === "boolean" && window.__nfpPrevCharging !== battery.charging) {
          showCharger(battery.charging, pct);
          tauriInvoke("send_notification", {
            title: "Pengisi daya",
            body: battery.charging ? ("Pengisi daya terhubung \u2014 baterai " + pct + "%") : ("Pengisi daya dilepas \u2014 baterai " + pct + "%")
          });
        }
        window.__nfpPrevCharging = battery.charging;
        var barBattery = $("bar-battery");
        if (barBattery) { barBattery.textContent = "Baterai " + pct + "%" + (battery.charging ? " ⚡" : ""); }
      }
      renderBattery();
      battery.addEventListener("levelchange", renderBattery);
      battery.addEventListener("chargingchange", renderBattery);
    }).catch(function () {
      $("battery-status").textContent = "Tidak tersedia di perangkat/browser ini.";
    });
  } else {
    $("battery-status").textContent = "Tidak tersedia di perangkat/browser ini.";
  }
})();
