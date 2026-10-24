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
  var currentTab = "focus";
  var tabHeights = { focus: 400, todo: 480, other: 540 };
  function setNotchSize(expanded) {
    var win = tauriWindow();
    if (win && win.setSize) {
      try {
        var size = expanded
          ? new window.__TAURI__.window.LogicalSize(440, tabHeights[currentTab] || 540)
          : new window.__TAURI__.window.LogicalSize(440, 64);
        win.setSize(size).catch(function () { /* biarkan CSS yang bekerja */ });
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

  // ---------- Tab panel ----------
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      currentTab = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.querySelectorAll(".tab-panel").forEach(function (panel) {
        panel.classList.toggle("active", panel.getAttribute("data-panel") === currentTab);
      });
      if (notch.classList.contains("expanded")) { setNotchSize(true); }
    });
  });

  // ---------- Jam ----------
  function tickClock() {
    var now = new Date();
    var clock = $("clock");
    if (clock) {
      clock.textContent = String(now.getHours()).padStart(2, "0") + ":" +
        String(now.getMinutes()).padStart(2, "0");
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
    $("timer-mode").innerHTML = "Mode: " + (mode === "focus" ? "Fokus" : "Istirahat") +
      " · Sesi selesai: <span id=\"sessions\">" + sessions + "</span>";
    $("btn-switch").textContent = mode === "focus" ? "Ganti ke Istirahat" : "Ganti ke Fokus";
  }
  function stopTimer() {
    if (timerId) { window.clearInterval(timerId); timerId = null; }
    running = false;
  }
  function finishPeriod() {
    stopTimer();
    beep();
    if (mode === "focus") {
      sessions += 1;
      showBanner("Sesi fokus selesai! Waktunya istirahat " + settings.break + " menit.");
      mode = "break";
      remaining = settings.break * 60;
    } else {
      showBanner("Istirahat selesai. Siap fokus lagi?");
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
      waterLeft = settings.water * 60;
    }
    if (restLeft > 0) { restLeft -= 1; }
    if (restLeft === 0) {
      beep();
      showBanner("Waktunya istirahat sejenak 😌 — regangkan badan, jauhkan mata dari layar.");
      restLeft = settings.rest * 60;
    }
    $("water-countdown").textContent = formatSeconds(waterLeft);
    $("rest-countdown").textContent = formatSeconds(restLeft);
  }, 1000);
  $("btn-water-done").addEventListener("click", function () {
    waterLeft = settings.water * 60;
    showBanner("Pengingat air diulang. Bagus, tetap terhidrasi!");
  });
  $("btn-rest-done").addEventListener("click", function () {
    restLeft = settings.rest * 60;
    showBanner("Pengingat istirahat diulang.");
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

  // ---------- Kontrol musik: placeholder yang jujur ----------
  document.querySelectorAll(".music-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      $("music-note").textContent = "Tombol ini belum terhubung ke pemutar musik. " +
        "Integrasi SMTC Windows adalah langkah berikutnya dan belum ada di prototipe ini.";
    });
  });

  // ---------- Status perangkat ----------
  function renderOnline() {
    var online = $("online-status");
    if (online) { online.textContent = window.navigator.onLine ? "Online" : "Offline"; }
  }
  window.addEventListener("online", renderOnline);
  window.addEventListener("offline", renderOnline);
  renderOnline();

  if (window.navigator.getBattery) {
    window.navigator.getBattery().then(function (battery) {
      function renderBattery() {
        var pct = Math.round(battery.level * 100);
        $("battery-status").textContent = pct + "%" + (battery.charging ? " (mengisi daya)" : "");
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
