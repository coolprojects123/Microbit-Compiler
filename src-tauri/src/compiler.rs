use crate::process_util::{run_async, run_async_shell_aware};
use crate::state::AppState;
use crate::tools::{ensure_tool, ensure_uflash, ensure_python};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const CODAL_REPO: &str = "https://github.com/lancaster-university/microbit-v2-samples";

#[derive(Serialize, Clone)]
pub struct BuildResult {
    pub folder: String,
    pub hex: String,
}

fn root_name(ext: &str) -> Result<&'static str, String> {
    match ext {
        ".ts" => Ok("Makecode"),
        ".py" => Ok("MPython"),
        ".cpp" | ".c" => Ok("C++"),
        _ => Err(format!("Unsupported file type: {ext}")),
    }
}

fn ensure_root(state: &AppState, ext: &str) -> Result<PathBuf, String> {
    let dir = state.engine.join(root_name(ext)?);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn get_builds_dir(state: &AppState) -> PathBuf {
    let dir = state.engine.join("Builds");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// One flat Builds folder for every type, so the history list can just read it.
fn make_out_dir(state: &AppState, src_file: &Path) -> Result<PathBuf, String> {
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S-%3fZ").to_string();
    let name = src_file.file_stem().and_then(|s| s.to_str()).unwrap_or("build");
    let dir = get_builds_dir(state).join(format!("{stamp}_{name}"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

async fn build_ts(
    app: &AppHandle,
    state: &AppState,
    ts_file: &Path,
    mut log: impl FnMut(&str) + Send,
) -> Result<BuildResult, String> {
    let root = ensure_root(state, ".ts")?;
    let build_folder = make_out_dir(state, ts_file)?;
    let dirs = ensure_tool(app, state, "node", &mut log).await?;

    log("🔨 Building TypeScript...\n");
    std::fs::copy(ts_file, root.join("main.ts")).map_err(|e| e.to_string())?;
    let pxt_json = serde_json::json!({
        "name": "build",
        "dependencies": { "core": "*", "radio": "*", "microphone": "*" },
        "files": ["main.ts"],
    });
    std::fs::write(root.join("pxt.json"), serde_json::to_string_pretty(&pxt_json).unwrap())
        .map_err(|e| e.to_string())?;

    if !root.join("pxt_modules").exists() {
        run_async_shell_aware("npx", &["pxt", "target", "microbit"], &root, &dirs, |l| log(&format!("{l}\n"))).await?;
    }
    run_async_shell_aware("npx", &["pxt", "install"], &root, &dirs, |l| log(&format!("{l}\n"))).await?;
    run_async_shell_aware("npx", &["pxt", "build", "--hw", "v2"], &root, &dirs, |l| log(&format!("{l}\n"))).await?;

    let stem = ts_file.file_stem().and_then(|s| s.to_str()).unwrap_or("build");
    let dest = build_folder.join(format!("{stem}-v2.hex"));
    std::fs::copy(root.join("built").join("mbcodal-binary.hex"), &dest).map_err(|e| e.to_string())?;

    Ok(BuildResult { folder: build_folder.to_string_lossy().to_string(), hex: dest.to_string_lossy().to_string() })
}

async fn build_python(
    app: &AppHandle,
    state: &AppState,
    py_file: &Path,
    mut log: impl FnMut(&str) + Send,
) -> Result<BuildResult, String> {
    let root = ensure_root(state, ".py")?;
    let build_folder = make_out_dir(state, py_file)?;
    let py = ensure_uflash(app, state, &state.engine, &mut log).await?;

    log("🔨 Building MicroPython...\n");
    run_async(
        &py,
        &[
            "-c", "import sys, uflash; uflash.py2hex(sys.argv[1:])",
            py_file.to_str().ok_or("invalid path")?,
            "-o", build_folder.to_str().ok_or("invalid path")?,
        ],
        &root,
        &[],
        |l| log(&format!("{l}\n")),
    )
    .await?;

    let stem = py_file.file_stem().and_then(|s| s.to_str()).unwrap_or("build");
    let out_hex = build_folder.join(format!("{stem}.hex"));
    if !out_hex.is_file() {
        return Err(format!("py2hex finished but {} was not created.", out_hex.display()));
    }
    Ok(BuildResult { folder: build_folder.to_string_lossy().to_string(), hex: out_hex.to_string_lossy().to_string() })
}

async fn build_cpp(
    app: &AppHandle,
    state: &AppState,
    src: &Path,
    mut log: impl FnMut(&str) + Send,
) -> Result<BuildResult, String> {
    let ext = src.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let root = ensure_root(state, &ext)?;
    let build_folder = make_out_dir(state, src)?;

    // installers first, so we fail early before the big toolchain download
    let mut dirs = vec![];
    dirs.extend(ensure_tool(app, state, "cmake", &mut log).await?);
    dirs.extend(ensure_tool(app, state, "git", &mut log).await?);
    dirs.extend(ensure_tool(app, state, "ninja", &mut log).await?);
    dirs.extend(ensure_tool(app, state, "armgcc", &mut log).await?);
    let py = ensure_python(&state.engine).await?;

    let project = std::env::var("MB_CODAL_DIR").map(PathBuf::from).unwrap_or_else(|_| root.join("microbit-v2-samples"));

    log("🔨 Building C++ (CODAL)...\n");

    if !project.join("build.py").exists() {
        log("Cloning microbit-v2-samples (first run)...\n");
        std::fs::remove_dir_all(&project).ok(); // clear any partial clone
        run_async("git", &["clone", CODAL_REPO, project.to_str().ok_or("invalid path")?], &root, &dirs, |l| {
            log(&format!("{l}\n"))
        })
        .await?;
    }

    std::fs::copy(src, project.join("source").join("main.cpp")).map_err(|e| e.to_string())?;
    run_async(&py, &["build.py"], &project, &dirs, |l| log(&format!("{l}\n"))).await?;

    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("build");
    let dest = build_folder.join(format!("{stem}.hex"));
    std::fs::copy(project.join("MICROBIT.hex"), &dest).map_err(|e| e.to_string())?;

    Ok(BuildResult { folder: build_folder.to_string_lossy().to_string(), hex: dest.to_string_lossy().to_string() })
}

/// Dispatches by extension. Builds are serialized one-at-a-time by the caller
/// (see commands.rs's build_lock), since each root has shared working files —
/// same reasoning as the `chain` promise queue in compiler.js.
pub async fn build(
    app: &AppHandle,
    state: &AppState,
    file: &Path,
    log: impl FnMut(&str) + Send,
) -> Result<BuildResult, String> {
    let ext = file.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
    match ext.as_str() {
        ".ts" => build_ts(app, state, file, log).await,
        ".py" => build_python(app, state, file, log).await,
        ".cpp" | ".c" => build_cpp(app, state, file, log).await,
        other => Err(format!("Unsupported file type: {other}")),
    }
}
