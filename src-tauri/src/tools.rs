use crate::process_util::{binary_in_dir, can_run, on_path, run_async};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    Win,
    LinuxX64,
    LinuxArm64,
}

pub fn current_platform() -> Option<Platform> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", _) => Some(Platform::Win),
        ("linux", "x86_64") => Some(Platform::LinuxX64),
        ("linux", "aarch64") => Some(Platform::LinuxArm64),
        _ => None, // macOS, other archs: nothing auto-installs yet
    }
}

pub enum InstallKind {
    /// Downloaded with reqwest and extracted into the tool's folder.
    Archive { url: &'static str, strip: u32, bins: &'static [&'static str] },
    /// Installed with pip into the app's own Python venv (used on Linux for
    /// tools that ship proper wheels, e.g. cmake/ninja, instead of pinning a
    /// prebuilt archive per distro).
    Pip { package: &'static str },
}

pub struct ToolDef {
    pub name: &'static str,
    pub label: &'static str,
    pub root: &'static str, // subfolder of the engine dir, matches compiler.js's ROOTS grouping
    pub size_mb: u32,
    pub check: &'static str,
    pub hint: &'static str, // shown when this platform has no install path
    pub per: &'static [(Platform, InstallKind)],
}

// Versions are pinned directly in each URL below (Rust string consts can't be
// spliced into &'static str literals without a build macro). To bump one,
// grep for the version string across this file's Archive urls and update
// every occurrence together — e.g. all three "v24.19.0" lines for Node.

pub fn download_table() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "node", label: "Node.js 24 (for MakeCode/pxt)", root: "Makecode", size_mb: 35,
            check: "npx",
            hint: "Node.js is required. Install it and make sure \"npx\" is on PATH.",
            per: &[
                (Platform::Win, InstallKind::Archive {
                    url: "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip",
                    strip: 1, bins: &["."],
                }),
                (Platform::LinuxX64, InstallKind::Archive {
                    url: "https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz",
                    strip: 1, bins: &["bin"],
                }),
                (Platform::LinuxArm64, InstallKind::Archive {
                    url: "https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-arm64.tar.xz",
                    strip: 1, bins: &["bin"],
                }),
            ],
        },
        ToolDef {
            name: "ninja", label: "Ninja build tool", root: "C++", size_mb: 1,
            check: "ninja",
            hint: "Ninja is required for C++ builds. Install it with your package manager.",
            per: &[
                (Platform::Win, InstallKind::Archive {
                    url: "https://github.com/ninja-build/ninja/releases/download/v1.13.1/ninja-win.zip",
                    strip: 0, bins: &["."],
                }),
                (Platform::LinuxX64, InstallKind::Pip { package: "ninja" }),
                (Platform::LinuxArm64, InstallKind::Pip { package: "ninja" }),
            ],
        },
        ToolDef {
            name: "cmake", label: "CMake", root: "C++", size_mb: 40,
            check: "cmake",
            hint: "CMake is required for C++ builds. Install it with your package manager.",
            per: &[
                (Platform::Win, InstallKind::Archive {
                    url: "https://github.com/Kitware/CMake/releases/download/v4.4.3/cmake-4.4.3-windows-x86_64.zip",
                    strip: 1, bins: &["bin"],
                }),
                (Platform::LinuxX64, InstallKind::Archive {
                    url: "https://github.com/Kitware/CMake/releases/download/v4.4.3/cmake-4.4.3-linux-x86_64.tar.gz",
                    strip: 1, bins: &["bin"],
                }),
                (Platform::LinuxArm64, InstallKind::Archive {
                    url: "https://github.com/Kitware/CMake/releases/download/v4.4.3/cmake-4.4.3-linux-aarch64.tar.gz",
                    strip: 1, bins: &["bin"],
                }),
            ],
        },
        ToolDef {
            name: "git", label: "Git", root: "C++", size_mb: 55,
            check: "git",
            hint: "Git is required for C++ builds. Install it with your package manager (e.g. sudo apt install git) and restart the app.",
            per: &[
                (Platform::Win, InstallKind::Archive {
                    url: "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/MinGit-2.47.1-64-bit.zip",
                    strip: 0, bins: &["cmd"],
                }),
                // No portable Linux build worth pinning; system git via apt/dnf is the norm.
            ],
        },
        ToolDef {
            name: "armgcc", label: "Arm GNU Toolchain (arm-none-eabi-gcc)", root: "C++", size_mb: 150,
            check: "arm-none-eabi-gcc",
            hint: "The Arm GNU Toolchain is required for C++ builds. Install it with your package manager.",
            per: &[
                (Platform::Win, InstallKind::Archive {
                    url: "https://developer.arm.com/-/media/Files/downloads/gnu/13.3.rel1/binrel/arm-gnu-toolchain-13.3.rel1-mingw-w64-i686-arm-none-eabi.zip",
                    strip: 1, bins: &["bin"],
                }),
                (Platform::LinuxX64, InstallKind::Archive {
                    url: "https://developer.arm.com/-/media/Files/downloads/gnu/13.3.rel1/binrel/arm-gnu-toolchain-13.3.rel1-x86_64-arm-none-eabi.tar.xz",
                    strip: 1, bins: &["bin"],
                }),
                (Platform::LinuxArm64, InstallKind::Archive {
                    url: "https://developer.arm.com/-/media/Files/downloads/gnu/13.3.rel1/binrel/arm-gnu-toolchain-13.3.rel1-aarch64-arm-none-eabi.tar.xz",
                    strip: 1, bins: &["bin"],
                }),
            ],
        },
    ]
}

/// Default install folders to check on Windows when a tool isn't on PATH
/// (installed manually by the user, e.g. the regular CMake/Git installers).
fn known_dirs(name: &str) -> Vec<PathBuf> {
    if !cfg!(windows) {
        return vec![];
    }
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    match name {
        "node" => vec![
            PathBuf::from(&pf).join("nodejs"),
            PathBuf::from(&local).join("Programs").join("nodejs"),
        ],
        "cmake" => vec![
            PathBuf::from(&pf).join("CMake").join("bin"),
            PathBuf::from(&local).join("Programs").join("CMake").join("bin"),
        ],
        "git" => vec![
            PathBuf::from(&pf).join("Git").join("cmd"),
            PathBuf::from(&local).join("Programs").join("Git").join("cmd"),
        ],
        "armgcc" => {
            let mut out = vec![];
            for base in [&pf, &pf86] {
                let base = Path::new(base);
                let Ok(entries) = std::fs::read_dir(base) else { continue };
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    if !name.starts_with("Arm GNU Toolchain") {
                        continue;
                    }
                    if let Ok(versions) = std::fs::read_dir(entry.path()) {
                        for v in versions.flatten() {
                            out.push(v.path().join("bin"));
                        }
                    }
                }
            }
            out
        }
        _ => vec![],
    }
}

#[derive(Serialize, Clone)]
pub struct ApprovalRequest {
    pub id: u32,
    pub name: String,
    #[serde(rename = "sizeMB")]
    pub size_mb: u32,
    pub via: Option<&'static str>, // "pip" or None (download)
}

/// Emits "approval-request" to the frontend and awaits the matching
/// "approval-response". Mirrors compiler.js's askApproval() using the
/// renderer's modal instead of an Electron dialog fallback.
pub async fn ask_approval(
    app: &AppHandle,
    state: &AppState,
    name: &str,
    size_mb: u32,
    via: Option<&'static str>,
) -> Result<bool, String> {
    let (id, rx) = state.register_approval();
    app.emit(
        "approval-request",
        ApprovalRequest { id, name: name.to_string(), size_mb, via },
    )
    .map_err(|e| e.to_string())?;
    Ok(rx.await.unwrap_or(false))
}

pub fn venv_dir(engine: &Path) -> PathBuf {
    engine.join("venv")
}
pub fn venv_bin(engine: &Path) -> PathBuf {
    venv_dir(engine).join(if cfg!(windows) { "Scripts" } else { "bin" })
}
fn venv_python(engine: &Path) -> PathBuf {
    venv_bin(engine).join(if cfg!(windows) { "python.exe" } else { "python" })
}

/// Windows: `python`. Linux: `python3` first (most distros have no plain
/// `python`). Actually runs a snippet rather than trusting `--version`, which
/// also rejects the Microsoft Store "python" stub and Python 2.
pub async fn ensure_python(engine: &Path) -> Result<String, String> {
    let check_args = ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)"];
    let candidates: &[&str] = if cfg!(windows) { &["python"] } else { &["python3", "python"] };
    for cmd in candidates {
        if can_run(cmd, &check_args, engine).await {
            return Ok(cmd.to_string());
        }
    }
    Err(if cfg!(windows) {
        "Python is required. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH') and restart the app.".into()
    } else {
        "Python 3 is required. Install it with your package manager (e.g. sudo apt install python3 python3-venv) and restart the app.".into()
    })
}

/// Creates buildengine/venv the first time it's needed (for uflash on Windows-optional,
/// and for cmake/ninja/uflash on Linux, since pip refuses to touch the system Python there).
pub async fn ensure_venv(engine: &Path, mut log: impl FnMut(&str)) -> Result<PathBuf, String> {
    let py_path = venv_python(engine);
    if py_path.is_file() {
        return Ok(py_path);
    }
    let py = ensure_python(engine).await?;
    log("📦 Creating a Python environment for the app...\n");
    run_async(&py, &["-m", "venv", venv_dir(engine).to_str().unwrap()], engine, &[], |l| log(&format!("{l}\n")))
        .await
        .map_err(|e| {
            let _ = std::fs::remove_dir_all(venv_dir(engine));
            format!("Could not create a Python virtual environment. On Debian/Ubuntu, install it with: sudo apt install python3-venv ({e})")
        })?;
    Ok(py_path)
}

/// Returns the python command that has uflash importable (system python on
/// Windows, the venv's python on Linux after installing it there).
pub async fn ensure_uflash(
    app: &AppHandle,
    state: &AppState,
    engine: &Path,
    mut log: impl FnMut(&str),
) -> Result<String, String> {
    let py = ensure_python(engine).await?;
    let has_uflash = ["-c", "import uflash"];
    if can_run(&py, &has_uflash, engine).await {
        return Ok(py);
    }
    let vpy = venv_python(engine);
    if !cfg!(windows) && vpy.is_file() && can_run(vpy.to_str().unwrap(), &has_uflash, engine).await {
        return Ok(vpy.to_string_lossy().to_string());
    }

    let ok = ask_approval(app, state, "uflash (Python package for MicroPython builds)", 1, Some("pip")).await?;
    if !ok {
        return Err("uflash is required, but the install was declined.".into());
    }

    log("⬇️  Installing uflash with pip...\n");
    let target = if cfg!(windows) {
        py
    } else {
        ensure_venv(engine, &mut log).await?.to_string_lossy().to_string()
    };
    run_async(&target, &["-m", "pip", "install", "uflash"], engine, &[], |l| log(&format!("{l}\n")))
        .await?;
    Ok(target)
}

/// The Rust equivalent of compiler.js's ensureTool(): checks PATH, then known
/// install dirs (Windows), then a previous download/pip-install by this app,
/// then asks approval and installs. Returns extra PATH dirs to use for the build.
pub async fn ensure_tool(
    app: &AppHandle,
    state: &AppState,
    name: &str,
    mut log: impl FnMut(&str),
) -> Result<Vec<PathBuf>, String> {
    let table = download_table();
    let def = table.iter().find(|t| t.name == name).expect("unknown tool");
    let platform = current_platform();
    let pick = platform.and_then(|p| def.per.iter().find(|(pl, _)| *pl == p).map(|(_, k)| k));

    let dir = state.engine.join(def.root).join("tools").join(name);
    let bins: Vec<PathBuf> = match pick {
        Some(InstallKind::Archive { bins, .. }) => bins.iter().map(|b| dir.join(b)).collect(),
        _ => vec![],
    };

    // 1. already on PATH
    if on_path(def.check, &[]) {
        return Ok(vec![]);
    }
    // 2. known install dir (Windows only)
    for d in known_dirs(name) {
        if binary_in_dir(&d, def.check) {
            return Ok(vec![d]);
        }
    }
    // 3. installed earlier by this app
    if matches!(pick, Some(InstallKind::Pip { .. })) {
        let vbin = venv_bin(&state.engine);
        if binary_in_dir(&vbin, def.check) {
            return Ok(vec![vbin]);
        }
    }
    if dir.join(".installed").exists() {
        return Ok(bins);
    }
    // 4. nothing to auto-install on this platform
    let Some(pick) = pick else {
        return Err(def.hint.to_string());
    };

    // 5. install, after approval
    match pick {
        InstallKind::Pip { package } => {
            let ok = ask_approval(app, state, def.label, def.size_mb, Some("pip")).await?;
            if !ok {
                return Err(format!("{} is required, but the install was declined.", def.label));
            }
            let vpy = ensure_venv(&state.engine, &mut log).await?;
            log(&format!("⬇️  Installing {} with pip...\n", def.label));
            run_async(vpy.to_str().unwrap(), &["-m", "pip", "install", package], &state.engine, &[], |l| {
                log(&format!("{l}\n"))
            })
            .await?;
            Ok(vec![venv_bin(&state.engine)])
        }
        InstallKind::Archive { url, strip, .. } => {
            let ok = ask_approval(app, state, def.label, def.size_mb, None).await?;
            if !ok {
                return Err(format!("{} is required, but the download was declined.", def.label));
            }
            std::fs::remove_dir_all(&dir).ok();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

            log(&format!("⬇️  Downloading {} (~{} MB)...\n", def.label, def.size_mb));
            let archive_path = dir.join(archive_file_name(url));
            download_file(url, &archive_path).await?;

            log(&format!("📦 Extracting {}...\n", def.label));
            extract_archive(&archive_path, &dir, *strip)?;
            std::fs::remove_file(&archive_path).ok();

            std::fs::write(dir.join(".installed"), chrono::Utc::now().to_rfc3339()).ok();
            Ok(bins)
        }
    }
}

fn archive_file_name(url: &str) -> &'static str {
    if url.ends_with(".zip") {
        "download.zip"
    } else if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
        "download.tar.gz"
    } else {
        "download.tar.xz"
    }
}

async fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    use futures_util::StreamExt;
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {} for {url}", resp.status()));
    }
    let mut file = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// strip == number of leading path components to drop, matching tar's
/// --strip-components (used for archives whose contents sit in one top folder).
fn extract_archive(archive: &Path, dest: &Path, strip: u32) -> Result<(), String> {
    let name = archive.to_string_lossy();
    if name.ends_with(".zip") {
        extract_zip(archive, dest, strip)
    } else if name.ends_with(".tar.gz") {
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        extract_tar(flate2::read::GzDecoder::new(file), dest, strip)
    } else {
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        extract_tar(xz2::read::XzDecoder::new(file), dest, strip)
    }
}

fn extract_zip(archive: &Path, dest: &Path, strip: u32) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(path) = entry.enclosed_name() else { continue };
        let stripped: PathBuf = path.components().skip(strip as usize).collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }
        let out_path = dest.join(stripped);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = entry.unix_mode() {
                    std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode)).ok();
                }
            }
        }
    }
    Ok(())
}

/// Shared by .tar.gz (flate2) and .tar.xz (xz2) — both just hand us a
/// decompressing Read that tar::Archive can walk.
fn extract_tar(decompressed: impl std::io::Read, dest: &Path, strip: u32) -> Result<(), String> {
    let mut tar = tar::Archive::new(decompressed);
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let stripped: PathBuf = path.components().skip(strip as usize).collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }
        let out_path = dest.join(&stripped);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        entry.unpack(&out_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}