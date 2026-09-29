#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod compiler;
mod flash;
mod process_util;
mod state;
mod tools;

use state::AppState;
use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Same folder role as Electron's app.getPath("userData") in the old main.js
            let base = app.path().app_data_dir().expect("no app data dir");
            let engine = base.join("buildengine");
            app.manage(AppState::new(engine));

            // Silent update check a few seconds after launch; the UI decides
            // what to do with the "update-available" event.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                if let Ok(Some(info)) = commands::check_update(handle.clone()).await {
                    let _ = handle.emit("update-available", info);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Window closed while a question is open -> treat as "Cancel",
            // same as the old main.js's win.on("closed", ...) handler.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                state.cancel_all_approvals();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::select_ts,
            commands::file_size,
            commands::respond_approval,
            commands::start_build,
            commands::flash_hex,
            commands::list_builds,
            commands::list_build_files,
            commands::read_file,
            commands::delete_build,
            commands::check_update,
            commands::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}