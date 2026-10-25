// Notch Fokus Pelajar — backend Tauri v2.
//
// Perintah kustom di sini menjembatani hal-hal yang tidak bisa
// dilakukan JavaScript polos dengan aman:
//   * pick_file  — dialog pilih file bawaan Windows (plugin-dialog)
//   * open_path  — buka file dengan aplikasi default sistem (plugin-opener)
//   * media_key  — tombol media sistem Windows (play/pause, next, prev)
//   * wifi_status — SSID + kualitas sinyal Wi-Fi yang sedang terhubung
//   * send_notification — notifikasi toast sistem Windows
// Semua data aplikasi (timer, to-do, shelf, pengingat) disimpan di
// localStorage di sisi frontend — tidak ada data yang dikirim ke server.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Option<String> {
    // blocking_pick_file didokumentasikan untuk dipakai di dalam command
    // async (bukan di thread utama). Mengembalikan None bila dialog ditutup.
    app.dialog()
        .file()
        .blocking_pick_file()
        .map(|file_path| file_path.to_string())
}

#[tauri::command]
async fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn set_dock_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(dock) = app.get_webview_window("dock") {
        if visible {
            dock.show().map_err(|e| e.to_string())?;
        } else {
            dock.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn set_taskbar_visible(visible: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use winapi::um::winuser::{FindWindowW, ShowWindow, SW_HIDE, SW_SHOW};
        use std::ffi::OsStr;
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;
        let name: Vec<u16> = OsStr::new("Shell_TrayWnd").encode_wide().chain(once(0)).collect();
        let hwnd = FindWindowW(name.as_ptr(), std::ptr::null());
        if !hwnd.is_null() {
            ShowWindow(hwnd, if visible { SW_SHOW } else { SW_HIDE });
        }
    }
    Ok(())
}

#[tauri::command]
fn show_overlay(app: tauri::AppHandle, kind: String, value: f64) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    if let Some(overlay) = app.get_webview_window("overlay") {
        if let Ok(Some(monitor)) = overlay.primary_monitor() {
            let ms = monitor.size();
            let y = ms.height.saturating_sub(240) / 2;
            let _ = overlay.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition { x: 24, y: y as i32 },
            ));
        }
        let _ = overlay.show();
        let _ = app.emit("nfp-overlay", serde_json::json!({ "kind": kind, "value": value }));
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct MediaInfo {
    title: String,
    artist: String,
    position_secs: i64,
    duration_secs: i64,
    playing: bool,
}

#[tauri::command]
async fn media_info() -> Result<MediaInfo, String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    // windows 0.58: IAsyncOperation BUKAN future (tidak bisa .await).
    // Pakai .get() yang menunggu sampai selesai (panggilan lokal, cepat).
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
    let props = session
        .TryGetMediaPropertiesAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let timeline = session.GetTimelineProperties().map_err(|e| e.to_string())?;
    let playback = session.GetPlaybackInfo().map_err(|e| e.to_string())?;
    let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
    let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
    let position = timeline.Position().map(|t| t.Duration / 10_000_000).unwrap_or(0);
    let duration = timeline.EndTime().map(|t| t.Duration / 10_000_000).unwrap_or(0);
    let playing = playback
        .PlaybackStatus()
        .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);
    if title.is_empty() {
        return Err("tidak ada media".to_string());
    }
    Ok(MediaInfo { title, artist, position_secs: position, duration_secs: duration, playing })
}

#[tauri::command]
fn brightness_level() -> Result<f32, String> {
    #[cfg(target_os = "windows")]
    {
        #[allow(non_snake_case)]
        #[derive(serde::Deserialize)]
        struct MonitorBrightness {
            CurrentBrightness: u8,
        }
        let con = wmi::WMIConnection::with_namespace_path("ROOT\\WMI")
            .map_err(|e| format!("{:?}", e))?;
        let results: Vec<MonitorBrightness> = con
            .raw_query("SELECT CurrentBrightness FROM WmiMonitorBrightness")
            .map_err(|e| format!("{:?}", e))?;
        let first = results.into_iter().next().ok_or("tidak ada monitor WMI")?;
        Ok(first.CurrentBrightness as f32)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("kecerahan hanya tersedia di Windows".to_string())
    }
}

#[tauri::command]
fn volume_level() -> Result<f32, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use winapi::um::mmdeviceapi::{eConsole, eRender, CLSID_MMDeviceEnumerator, IMMDevice, IMMDeviceEnumerator};
        use winapi::um::endpointvolume::IAudioEndpointVolume;
        use winapi::um::combaseapi::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL};
        use winapi::um::objbase::COINIT_APARTMENTTHREADED;
        use winapi::Interface;
        use std::ptr::null_mut;
        // Sengaja tanpa CoUninitialize: COM mungkin sudah diinisialisasi Tauri,
        // dan CoUninitialize yang tidak berpasangan bisa mematikan COM-nya.
        let _ = CoInitializeEx(null_mut(), COINIT_APARTMENTTHREADED);
        let mut enumerator: *mut IMMDeviceEnumerator = null_mut();
        let hr = CoCreateInstance(
            &CLSID_MMDeviceEnumerator,
            null_mut(),
            CLSCTX_ALL,
            &IMMDeviceEnumerator::uuidof(),
            &mut enumerator as *mut *mut IMMDeviceEnumerator as *mut *mut winapi::ctypes::c_void,
        );
        if hr != 0 || enumerator.is_null() {
            return Err(format!("enumerator gagal: {:#x}", hr as u32));
        }
        let mut device: *mut IMMDevice = null_mut();
        let hr = (*enumerator).GetDefaultAudioEndpoint(eRender, eConsole, &mut device);
        (*enumerator).Release();
        if hr != 0 || device.is_null() {
            return Err(format!("perangkat audio gagal: {:#x}", hr as u32));
        }
        let mut vol: *mut IAudioEndpointVolume = null_mut();
        let hr = (*device).Activate(
            &IAudioEndpointVolume::uuidof(),
            CLSCTX_ALL,
            null_mut(),
            &mut vol as *mut *mut IAudioEndpointVolume as *mut *mut winapi::ctypes::c_void,
        );
        (*device).Release();
        if hr != 0 || vol.is_null() {
            return Err(format!("endpoint volume gagal: {:#x}", hr as u32));
        }
        let mut level: f32 = 0.0;
        let hr = (*vol).GetMasterVolumeLevelScalar(&mut level);
        (*vol).Release();
        if hr != 0 {
            return Err(format!("baca volume gagal: {:#x}", hr as u32));
        }
        Ok(level * 100.0)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("volume hanya tersedia di Windows".to_string())
    }
}

#[tauri::command]
async fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|err| err.to_string())
}

#[derive(Serialize)]
struct WifiStatus {
    connected: bool,
    ssid: Option<String>,
    signal_percent: Option<u8>,
}

// ---------- Tombol media Windows (media key) ----------
#[cfg(target_os = "windows")]
fn media_key_impl(action: &str) -> Result<(), String> {
    // Kode tombol media virtual Windows (BYTE):
    // play/pause 0xB3, next 0xB0, previous 0xB1.
    // Mengirim key down lalu key up lewat keybd_event, sehingga
    // Windows meneruskannya ke pemutar yang sedang aktif — Spotify,
    // YouTube di browser, atau pemutar lain — tanpa perlu tahu
    // aplikasi mana yang sedang memutar.
    let vk: u8 = match action {
        "play-pause" => 0xB3,
        "next" => 0xB0,
        "previous" => 0xB1,
        _ => return Err(format!("Aksi media tidak dikenal: {}", action)),
    };
    // v0.9 perbaikan: tombol media adalah extended key — tanpa flag
    // KEYEVENTF_EXTENDEDKEY, Windows tidak meneruskannya ke SMTC sehingga
    // pemutar seperti Spotify di browser tidak merespons sama sekali.
    unsafe {
        use winapi::um::winuser::{keybd_event, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP};
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0);
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn media_key_impl(_action: &str) -> Result<(), String> {
    Err("Tombol media hanya didukung di Windows.".to_string())
}

#[tauri::command]
async fn media_key(action: String) -> Result<(), String> {
    media_key_impl(&action)
}

// ---------- Status Wi-Fi Windows (WLAN API) ----------
#[cfg(target_os = "windows")]
fn wifi_status_impl() -> WifiStatus {
    use winapi::shared::minwindef::{DWORD, LPVOID};
    use winapi::shared::winerror::ERROR_SUCCESS;
    use winapi::um::wlanapi::{
        WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle,
        WlanQueryInterface, wlan_intf_opcode_current_connection,
        WLAN_CONNECTION_ATTRIBUTES,
    };
    use winapi::um::winnt::HANDLE;

    unsafe {
        let mut negotiated: DWORD = 0;
        let mut handle: HANDLE = std::ptr::null_mut();
        let result = WlanOpenHandle(2, std::ptr::null_mut(), &mut negotiated, &mut handle);
        if result != ERROR_SUCCESS || handle.is_null() {
            return WifiStatus { connected: false, ssid: None, signal_percent: None };
        }
        let cleanup = |h: HANDLE| {
            WlanCloseHandle(h, std::ptr::null_mut());
        };
        let mut list_ptr = std::ptr::null_mut();
        let result = WlanEnumInterfaces(handle, std::ptr::null_mut(), &mut list_ptr);
        if result != ERROR_SUCCESS || list_ptr.is_null() {
            cleanup(handle);
            return WifiStatus { connected: false, ssid: None, signal_percent: None };
        }
        // Hanya antarmuka pertama yang diperiksa (umumnya satu adaptor Wi-Fi).
        let list = &*list_ptr;
        if list.dwNumberOfItems == 0 {
            WlanFreeMemory(list_ptr as LPVOID);
            cleanup(handle);
            return WifiStatus { connected: false, ssid: None, signal_percent: None };
        }
        let info = &list.InterfaceInfo[0];
        let is_connected =
            info.isState == winapi::um::wlanapi::wlan_interface_state_connected;
        if !is_connected {
            WlanFreeMemory(list_ptr as LPVOID);
            cleanup(handle);
            return WifiStatus { connected: false, ssid: None, signal_percent: None };
        }
        let guid = info.InterfaceGuid;
        WlanFreeMemory(list_ptr as LPVOID);

        let mut data_size: DWORD = 0;
        let mut data_ptr: LPVOID = std::ptr::null_mut();
        let mut opcode_type = std::mem::zeroed();
        let result = WlanQueryInterface(
            handle,
            &guid,
            wlan_intf_opcode_current_connection,
            std::ptr::null_mut(),
            &mut data_size,
            &mut data_ptr,
            &mut opcode_type,
        );
        if result != ERROR_SUCCESS || data_ptr.is_null() {
            cleanup(handle);
            return WifiStatus { connected: false, ssid: None, signal_percent: None };
        }
        let attrs = &*(data_ptr as *const WLAN_CONNECTION_ATTRIBUTES);
        let assoc = &attrs.wlanAssociationAttributes;
        let ssid_len = assoc.dot11Ssid.uSSIDLength as usize;
        let ssid_len = ssid_len.min(32);
        let ssid = String::from_utf8_lossy(&assoc.dot11Ssid.ucSSID[..ssid_len]).into_owned();
        let signal = assoc.wlanSignalQuality.min(100) as u8;
        WlanFreeMemory(data_ptr);
        cleanup(handle);
        WifiStatus {
            connected: true,
            ssid: Some(ssid),
            signal_percent: Some(signal),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn wifi_status_impl() -> WifiStatus {
    WifiStatus { connected: false, ssid: None, signal_percent: None }
}

#[tauri::command]
async fn wifi_status() -> WifiStatus {
    wifi_status_impl()
}

// ---------- Daftar jendela aplikasi (untuk dock: aplikasi berjalan) ----------
// v0.17: EnumWindows + aturan taskbar Windows (terlihat, ada taskbar
// entry, bukan jendela aplikasi ini sendiri). Satu ikon per executable
// (jendela teratas menang). Ikon asli exe via SHGetFileInfoW + GetDIBits
// → RGBA base64 mentah (tanpa crate baru); gagal → inisial di frontend.
// Polling ringan dari dock tiap 2 detik; ikon di-cache per executable.
#[derive(serde::Serialize, Clone)]
struct WindowInfo {
    hwnd: i64,
    title: String,
    exe: String,
    exe_name: String,
    icon_b64: String,
    icon_size: u32,
    foreground: bool,
}

#[cfg(target_os = "windows")]
struct RawWin {
    hwnd: winapi::shared::windef::HWND,
    title: String,
    pid: winapi::shared::minwindef::DWORD,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_proc(
    hwnd: winapi::shared::windef::HWND,
    lparam: winapi::shared::minwindef::LPARAM,
) -> winapi::shared::minwindef::BOOL {
    use winapi::um::winuser::{GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};
    let list = &mut *(lparam as *mut Vec<RawWin>);
    if IsWindowVisible(hwnd) == 0 {
        return 1;
    }
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return 1;
    }
    let mut buf: Vec<u16> = vec![0; (len + 1) as usize];
    let got = GetWindowTextW(hwnd, buf.as_mut_ptr(), len + 1);
    if got <= 0 {
        return 1;
    }
    let title = String::from_utf16_lossy(&buf[..got as usize]);
    let mut pid: winapi::shared::minwindef::DWORD = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    list.push(RawWin { hwnd, title, pid });
    1
}

#[cfg(target_os = "windows")]
fn icon_cache() -> &'static std::sync::Mutex<
    std::collections::HashMap<String, (String, u32)>,
> {
    static CACHE: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, (String, u32)>>,
    > = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[cfg(target_os = "windows")]
fn b64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(target_os = "windows")]
unsafe fn exe_icon_raw(exe: &str) -> Option<(String, u32)> {
    use std::ffi::OsStr;
    use std::os::raw::c_int;
    use std::os::windows::ffi::OsStrExt;
    use winapi::shared::minwindef::{DWORD, LPVOID, UINT};
    use winapi::um::shellapi::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON};
    use winapi::um::wingdi::{
        DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS,
    };
    use winapi::um::winuser::{DestroyIcon, GetDC, GetIconInfo, ReleaseDC, ICONINFO};
    let wide: Vec<u16> = OsStr::new(exe)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut shfi: SHFILEINFOW = std::mem::zeroed();
    let ok = SHGetFileInfoW(
        wide.as_ptr(),
        0,
        &mut shfi,
        std::mem::size_of::<SHFILEINFOW>() as UINT,
        SHGFI_ICON | SHGFI_SMALLICON,
    );
    if ok == 0 || shfi.hIcon.is_null() {
        return None;
    }
    let hicon = shfi.hIcon;
    let mut info: ICONINFO = std::mem::zeroed();
    let result = if GetIconInfo(hicon, &mut info) == 0 || info.hbmColor.is_null() {
        if !info.hbmMask.is_null() {
            DeleteObject(info.hbmMask as _);
        }
        None
    } else {
        let mut bmp: BITMAP = std::mem::zeroed();
        let mut out = None;
        if GetObjectW(
            info.hbmColor as _,
            std::mem::size_of::<BITMAP>() as c_int,
            &mut bmp as *mut _ as LPVOID,
        ) != 0
            && bmp.bmWidth > 0
            && bmp.bmHeight > 0
            && bmp.bmWidth <= 256
            && bmp.bmHeight <= 256
        {
            let w = bmp.bmWidth;
            let h = bmp.bmHeight;
            let hdc = GetDC(std::ptr::null_mut());
            if !hdc.is_null() {
                let mut pixels: Vec<u8> = vec![0; (w * h * 4) as usize];
                let mut bmi: BITMAPINFO = std::mem::zeroed();
                bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as DWORD;
                bmi.bmiHeader.biWidth = w;
                bmi.bmiHeader.biHeight = -h; // top-down, tanpa flip
                bmi.bmiHeader.biPlanes = 1;
                bmi.bmiHeader.biBitCount = 32;
                bmi.bmiHeader.biCompression = BI_RGB;
                let lines = GetDIBits(
                    hdc,
                    info.hbmColor,
                    0,
                    h as UINT,
                    pixels.as_mut_ptr() as LPVOID,
                    &mut bmi,
                    DIB_RGB_COLORS,
                );
                ReleaseDC(std::ptr::null_mut(), hdc);
                if lines != 0 {
                    // BGRA -> RGBA; ikon tanpa kanal alpha (semua a=0)
                    // dianggap opak.
                    let mut all_zero_alpha = true;
                    for px in pixels.chunks_exact(4) {
                        if px[3] != 0 {
                            all_zero_alpha = false;
                            break;
                        }
                    }
                    for px in pixels.chunks_exact_mut(4) {
                        let b = px[0];
                        px[0] = px[2];
                        px[2] = b;
                        if all_zero_alpha {
                            px[3] = 255;
                        }
                    }
                    out = Some((b64_encode(&pixels), w as u32));
                }
            }
        }
        DeleteObject(info.hbmColor as _);
        if !info.hbmMask.is_null() {
            DeleteObject(info.hbmMask as _);
        }
        out
    };
    DestroyIcon(hicon);
    result
}

#[cfg(target_os = "windows")]
unsafe fn window_exe(pid: winapi::shared::minwindef::DWORD) -> Option<String> {
    use winapi::shared::minwindef::{DWORD, MAX_PATH};
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::psapi::GetModuleFileNameExW;
    use winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION;
    let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if h.is_null() {
        return None;
    }
    let mut buf: Vec<u16> = vec![0; MAX_PATH];
    let len = GetModuleFileNameExW(h, std::ptr::null_mut(), buf.as_mut_ptr(), MAX_PATH as DWORD);
    CloseHandle(h);
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

#[cfg(target_os = "windows")]
fn list_windows_impl() -> Vec<WindowInfo> {
    use std::collections::HashMap;
    use winapi::shared::minwindef::LPARAM;
    use winapi::um::processthreadsapi::GetCurrentProcessId;
    use winapi::um::winuser::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongW, GW_OWNER, GWL_EXSTYLE,
        WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };
    unsafe {
        let mut raw: Vec<RawWin> = Vec::new();
        EnumWindows(Some(enum_windows_proc), &mut raw as *mut _ as LPARAM);
        let fg = GetForegroundWindow();
        let own = GetCurrentProcessId();
        let mut by_exe: HashMap<String, WindowInfo> = HashMap::new();
        for w in raw {
            if w.pid == own {
                continue;
            }
            // Aturan taskbar: terlihat + (APPWINDOW, atau tanpa owner dan
            // bukan TOOLWINDOW). Menyingkirkan dialog, tooltip, dan
            // jendela pembantu tak terlihat di taskbar.
            let exstyle = GetWindowLongW(w.hwnd, GWL_EXSTYLE) as u32;
            let owner = GetWindow(w.hwnd, GW_OWNER);
            let in_taskbar = (exstyle & WS_EX_APPWINDOW) != 0
                || ((exstyle & WS_EX_TOOLWINDOW) == 0 && owner.is_null());
            if !in_taskbar {
                continue;
            }
            let exe = match window_exe(w.pid) {
                Some(e) => e,
                None => continue,
            };
            let exe_name = exe.rsplit('\\').next().unwrap_or("").to_string();
            if exe_name.is_empty() {
                continue;
            }
            let key = exe.to_lowercase();
            if by_exe.contains_key(&key) {
                continue;
            }
            let cached = icon_cache()
                .lock()
                .ok()
                .and_then(|c| c.get(&key).cloned());
            let (icon_b64, icon_size) = match cached {
                Some(v) => v,
                None => {
                    let v = exe_icon_raw(&exe).unwrap_or(("".to_string(), 0));
                    if let Ok(mut c) = icon_cache().lock() {
                        c.insert(key.clone(), v.clone());
                    }
                    v
                }
            };
            by_exe.insert(
                key,
                WindowInfo {
                    hwnd: w.hwnd as usize as i64,
                    title: w.title,
                    exe,
                    exe_name,
                    icon_b64,
                    icon_size,
                    foreground: w.hwnd == fg,
                },
            );
        }
        let mut out: Vec<WindowInfo> = by_exe.into_values().collect();
        out.sort_by(|a, b| a.exe_name.cmp(&b.exe_name));
        out
    }
}

#[tauri::command]
fn list_windows() -> Vec<WindowInfo> {
    #[cfg(target_os = "windows")]
    {
        list_windows_impl()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

#[tauri::command]
fn focus_window(hwnd: i64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winapi::shared::windef::HWND;
        use winapi::um::winuser::{IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};
        unsafe {
            let h = hwnd as usize as HWND;
            if IsIconic(h) != 0 {
                ShowWindow(h, SW_RESTORE);
            }
            if SetForegroundWindow(h) == 0 {
                return Err("gagal memunculkan jendela".to_string());
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = hwnd;
        Err("hanya Windows".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let _ = set_taskbar_visible(true);
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_file,
            open_path,
            media_key,
            wifi_status,
            send_notification,
            set_dock_visible,
            set_taskbar_visible,
            show_overlay,
            volume_level,
            media_info,
            brightness_level,
            list_windows,
            focus_window
        ])
        .setup(|app| {
            use tauri::{Emitter, Manager};
            // Paksa semua jendela tidak muncul di taskbar (konfigurasi saja
            // ternyata tidak cukup di PC pengguna — ikon aplikasi tetap
            // tampil sebagai tombol taskbar). Aplikasi hanya hidup di tray.
            for label in ["main", "dock", "overlay"] {
                if let Some(w) = app.get_webview_window(label) {
                    let _ = w.set_skip_taskbar(true);
                }
            }
            // Ikon tray di pojok kanan bawah, gaya Nusa: klik kiri
            // menampilkan/menyembunyikan notch, klik kanan membuka menu.
            if let Some(icon) = app.default_window_icon().cloned() {
                use tauri::{
                    menu::MenuBuilder,
                    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
                };
                let menu = MenuBuilder::new(app)
                    .text("toggle_notch", "Tampilkan/Sembunyikan Notch")
                    .text("toggle_dock", "Aktifkan/Nonaktifkan Dock")
                    .separator()
                    .text("quit", "Keluar")
                    .build();
                if let Ok(menu) = menu {
                    let _ = TrayIconBuilder::with_id("tray")
                        .icon(icon)
                        .menu(&menu)
                        .show_menu_on_left_click(false)
                        .on_menu_event(|app, event| match event.id().as_ref() {
                            "quit" => {
                                let _ = set_taskbar_visible(true);
                                app.exit(0);
                            }
                            "toggle_dock" => {
                                let _ = app.emit("nfp-tray-dock-toggle", ());
                            }
                            "toggle_notch" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    if w.is_visible().unwrap_or(true) {
                                        let _ = w.hide();
                                    } else {
                                        let _ = w.show();
                                    }
                                }
                            }
                            _ => {}
                        })
                        .on_tray_icon_event(|tray, event| {
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                ..
                            } = event
                            {
                                let app = tray.app_handle();
                                if let Some(w) = app.get_webview_window("main") {
                                    if w.is_visible().unwrap_or(true) {
                                        let _ = w.hide();
                                    } else {
                                        let _ = w.show();
                                    }
                                }
                            }
                        })
                        .build(app);
                }
            }
            // Posisikan jendela di atas-tengah layar utama.
            // Kalau monitor tidak terbaca, biarkan posisi default Tauri.
            // Posisikan Dock di bawah-tengah layar (di atas taskbar, perkiraan 48px).
            if let Some(dock) = app.get_webview_window("dock") {
                if let Ok(Some(monitor)) = dock.primary_monitor() {
                    let ms = monitor.size();
                    let dw: u32 = 720;
                    let dh: u32 = 86;
                    let x = ms.width.saturating_sub(dw) / 2;
                    let y = ms.height.saturating_sub(dh + 48);
                    let _ = dock.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition { x: x as i32, y: y as i32 },
                    ));
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let monitor_size = monitor.size();
                    let window_size = window.inner_size().unwrap_or(*monitor_size);
                    let x = monitor_size.width.saturating_sub(window_size.width) / 2;
                    let _ = window.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition { x: x as i32, y: 0 },
                    ));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notch Fokus Pelajar");
}
