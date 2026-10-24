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
  var pages = ["music", "focus", "water", "todo", "shelf", "status"];
  var pageTitles = { music: "Musik", focus: "Pomodoro", water: "Water Reminder", todo: "To-do Tugas", shelf: "Shelf", status: "Status" };
  var currentPage = "music";
  var pageHeights = { music: 380, focus: 420, water: 540, todo: 480, shelf: 420, status: 380 };
  var displayMode = load("nfp_mode", "notch"); // "notch" | "bar"
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
  function setNotchSize(expanded) {
    var win = tauriWindow();
    if (win && win.setSize) {
      try {
        if (displayMode === "bar") {
          monitorLogicalWidth(function (w) {
            try {
              var h = expanded ? (pageHeights[currentPage] || 540) : 32;
              win.setSize(new window.__TAURI__.window.LogicalSize(w, h)).catch(function () { /* biarkan CSS yang bekerja */ });
              if (win.setPosition) {
                win.setPosition(new window.__TAURI__.window.LogicalPosition(0, 0)).catch(function () {});
              }
            } catch (e) { /* biarkan CSS yang bekerja */ }
          });
        } else {
          var size = expanded
            ? new window.__TAURI__.window.LogicalSize(440, pageHeights[currentPage] || 540)
            : new window.__TAURI__.window.LogicalSize(440, 56);
          win.setSize(size).catch(function () { /* biarkan CSS yang bekerja */ });
        }
      } catch (e) { /* biarkan CSS yang bekerja */ }
    }
  }

  var notch = $("notch");
  function applyMode(mode, updateWindow) {
    displayMode = mode;
    save("nfp_mode", mode);
    notch.classList.toggle("bar-mode", mode === "bar");
    document.body.classList.toggle("bar-mode", mode === "bar");
    var header = notch.querySelector(".notch-bar");
    if (header) {
      if (mode === "bar") { header.removeAttribute("data-tauri-drag-region"); }
      else { header.setAttribute("data-tauri-drag-region", ""); }
    }
    var modeBtn = $("btn-mode");
    if (modeBtn) { modeBtn.textContent = mode === "bar" ? "Notch" : "Bar"; }
    if (updateWindow) {
      setNotchSize(notch.classList.contains("expanded"));
      if (mode === "notch") {
        // Kembali ke tengah atas setelah dari Bar mode.
        var win = tauriWindow();
        if (win && win.setPosition) {
          monitorLogicalWidth(function (w) {
            try {
              win.setPosition(new window.__TAURI__.window.LogicalPosition(Math.round((w - 440) / 2), 0)).catch(function () {});
            } catch (e) {}
          });
        }
      }
    }
  }
  applyMode(displayMode, true);
  notch.addEventListener("mouseenter", function () {
    // Bar mode tidak membesar saat hover, supaya bar atas tidak terbuka
    // tiap kali mouse menyentuh tepi atas layar — panel dibuka lewat ▾.
    if (displayMode === "bar") { return; }
    notch.classList.add("expanded");
    setNotchSize(true);
  });
  notch.addEventListener("mouseleave", function () {
    if (displayMode === "bar") { return; }
    notch.classList.remove("expanded");
    setNotchSize(false);
  });
  $("toggle-panel").addEventListener("click", function () {
    var expanded = notch.classList.toggle("expanded");
    setNotchSize(expanded);
  });
  $("btn-mode").addEventListener("click", function () {
    applyMode(displayMode === "bar" ? "notch" : "bar", true);
  });

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
  if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
    window.__TAURI__.event.listen("nfp-open-page", function (e) {
      var page = e && e.payload && e.payload.page;
      if (page) {
        showPage(page);
        notch.classList.add("expanded");
        setNotchSize(true);
      }
    });
    window.__TAURI__.event.listen("nfp-dock-hidden", function () {
      dockVisible = false;
      try { window.localStorage.setItem("nfp_dock", "off"); } catch (e) {}
      setDockUI(false);
    });
  }

  // ---------- v0.6/v0.7: menu bar ala MacBook ----------
  document.querySelectorAll(".bar-menu").forEach(function (btn) {
    btn.addEventListener("click", function () {
      showPage(btn.getAttribute("data-bar-page"));
      notch.classList.add("expanded");
      setNotchSize(true);
    });
  });
  var modePanelBtn = $("btn-mode-panel");
  if (modePanelBtn) {
    modePanelBtn.addEventListener("click", function () {
      var modeBtn = $("btn-mode");
      if (modeBtn) { modeBtn.click(); }
    });
  }

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
    var nc = $("notch-clock");
    var mt = $("mini-timer");
    if (!nc || !mt) { return; }
    if (document.body.classList.contains("bar-mode")) {
      nc.style.display = "";
      mt.style.display = "";
      return;
    }
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
      empty.textContent = "Shelf masih kosong. Tambahkan file yang sering kamu buka.";
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
