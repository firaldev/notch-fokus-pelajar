// Notch Fokus Pelajar — backend Tauri v2.
//
// Perintah kustom di sini hanya menjembatani dua hal yang tidak bisa
// dilakukan JavaScript polos dengan aman:
//   * pick_file  — dialog pilih file bawaan Windows (plugin-dialog)
//   * open_path  — buka file dengan aplikasi default sistem (plugin-opener)
// Semua data aplikasi (timer, to-do, shelf, pengingat) disimpan di
// localStorage di sisi frontend — tidak ada data yang dikirim ke server.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![pick_file, open_path])
        .setup(|app| {
            // Posisikan jendela di atas-tengah layar utama.
            // Kalau monitor tidak terbaca, biarkan posisi default Tauri.
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let monitor_size = monitor.size();
                    let window_size = window.inner_size().unwrap_or(monitor_size);
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
