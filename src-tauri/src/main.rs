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
    unsafe {
        winapi::um::winuser::keybd_event(vk, 0, 0, 0);
        winapi::um::winuser::keybd_event(
            vk,
            0,
            winapi::um::winuser::KEYEVENTF_KEYUP,
            0,
        );
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            pick_file,
            open_path,
            media_key,
            wifi_status,
            send_notification,
            set_dock_visible
        ])
        .setup(|app| {
            // Posisikan jendela di atas-tengah layar utama.
            // Kalau monitor tidak terbaca, biarkan posisi default Tauri.
            // Posisikan Dock di bawah-tengah layar (di atas taskbar, perkiraan 48px).
            if let Some(dock) = app.get_webview_window("dock") {
                if let Ok(Some(monitor)) = dock.primary_monitor() {
                    let ms = monitor.size();
                    let dw: u32 = 560;
                    let dh: u32 = 76;
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
