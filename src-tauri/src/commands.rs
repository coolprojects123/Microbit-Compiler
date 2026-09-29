use crate::compiler::{self, get_builds_dir};
use crate::flash;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

/// The renderer may only read, list, delete, or flash files inside the builds
/// folder — mirrors assertInBuilds() in the old main.js. Prevents a
/// compromised page from touching arbitrary paths on disk.
fn assert_in_builds(state: &AppState, p: &str) -> Result<PathBuf, String> {
    let builds_dir = get_builds_dir(state);
    let target = Path::new(p);
    let canon_builds = builds_dir.canonicalize().map_err(|e| e.to_string())?;
    let canon_target = target.canonicalize().map_err(|_| "Path is outside the builds folder.".to_string())?;
    if canon_target == canon_builds || !canon_target.starts_with(&canon_builds) {
        return Err("Path is outside the builds folder.".to_string());
    }
    Ok(canon_target)
}

#[tauri::command]
pub async fn select_ts(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Source Files", &["ts", "py", "cpp", "c"])
        .pick_file(move |f| {
            let _ = tx.send(f);
        });
    rx.await.ok().flatten().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path).map(|m| m.len()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn respond_approval(state: State<'_, AppState>, id: u32, ok: bool) -> Result<(), String> {
    state.resolve_approval(id, ok);
    Ok(())
}

#[derive(Serialize, Clone)]
struct BuildCompletePayload {
    success: bool,
    hex: Option<String>,
    folder: Option<String>,
    duration: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn start_build(app: AppHandle, state: State<'_, AppState>, file_path: String) -> Result<(), String> {
    let _permit = state.build_lock.lock().await; // one build at a time
    let start = std::time::Instant::now();
    let app_for_log = app.clone();

    let log = move |msg: &str| {
        let _ = app_for_log.emit("build-log", msg);
        if msg.contains("Compiling") { let _ = app_for_log.emit("build-progress", 20); }
        if msg.contains("Generating") { let _ = app_for_log.emit("build-progress", 40); }
        if msg.contains("Linking") { let _ = app_for_log.emit("build-progress", 60); }
        if msg.to_lowercase().contains("hex") { let _ = app_for_log.emit("build-progress", 80); }
    };

    let result = compiler::build(&app, &state, Path::new(&file_path), log).await;
    let duration = format!("{:.1}", start.elapsed().as_secs_f64());
    let _ = app.emit("build-progress", 100);

    match result {
        Ok(r) => {
            let _ = app.emit(
                "build-complete",
                BuildCompletePayload { success: true, hex: Some(r.hex), folder: Some(r.folder), duration: Some(duration), error: None },
            );
        }
        Err(e) => {
            let _ = app.emit(
                "build-complete",
                BuildCompletePayload { success: false, hex: None, folder: None, duration: None, error: Some(e) },
            );
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct FlashResponse {
    ok: bool,
    message: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub fn flash_hex(state: State<'_, AppState>, hex_path: String) -> FlashResponse {
    match assert_in_builds(&state, &hex_path) {
        Ok(p) => match flash::flash(&p) {
            Ok(message) => FlashResponse { ok: true, message: Some(message), error: None },
            Err(error) => FlashResponse { ok: false, message: None, error: Some(error) },
        },
        Err(error) => FlashResponse { ok: false, message: None, error: Some(error) },
    }
}

#[derive(Serialize)]
pub struct BuildEntry {
    name: String,
    path: String,
}

#[tauri::command]
pub fn list_builds(state: State<'_, AppState>) -> Result<Vec<BuildEntry>, String> {
    let dir = get_builds_dir(&state);
    let mut entries: Vec<BuildEntry> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| BuildEntry { name: e.file_name().to_string_lossy().to_string(), path: e.path().to_string_lossy().to_string() })
        .collect();
    entries.sort_by(|a, b| b.name.cmp(&a.name)); // newest first, same as .sort().reverse()
    Ok(entries)
}

#[derive(Serialize)]
pub struct FileEntry {
    name: String,
    path: String,
}

#[tauri::command]
pub fn list_build_files(state: State<'_, AppState>, folder: String) -> Result<Vec<FileEntry>, String> {
    let dir = assert_in_builds(&state, &folder)?;
    std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| Ok(FileEntry { name: e.file_name().to_string_lossy().to_string(), path: e.path().to_string_lossy().to_string() }))
        .collect()
}

#[tauri::command]
pub fn read_file(state: State<'_, AppState>, file_path: String) -> Result<String, String> {
    let p = assert_in_builds(&state, &file_path)?;
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_build(state: State<'_, AppState>, folder: String) -> Result<bool, String> {
    let p = assert_in_builds(&state, &folder)?;
    std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

/// Returns Some(info) when a newer release is published, None when up to date.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    // On Linux only AppImage installs can replace themselves; .deb/.rpm users
    // update through their package manager, so don't offer them an update
    // that can't be installed.
    if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        return Ok(None);
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    }))
}

/// Downloads and installs the pending update, emitting "update-progress"
/// ([downloaded, total]) and "update-installed", then restarts the app.
#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Never replace the app mid-build; holding the lock also blocks new builds.
    let _guard = state
        .build_lock
        .try_lock()
        .map_err(|_| "A build is running. Try again when it finishes.".to_string())?;

    let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let done_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", (downloaded, total));
            },
            move || {
                let _ = done_app.emit("update-installed", ());
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // On Windows the installer takes over and the app exits before this point.
    app.restart()
}