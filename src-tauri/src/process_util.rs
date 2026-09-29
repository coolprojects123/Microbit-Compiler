use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Runs `cmd args...` in `cwd`, streaming combined stdout+stderr to `on_data`
/// (one call per line, no trailing newline — the caller adds its own).
/// `extra_path_dirs` are prepended to PATH, same purpose as `dirs` in
/// compiler.js's runAsync/withPath.
pub async fn run_async(
    cmd: &str,
    args: &[&str],
    cwd: &Path,
    extra_path_dirs: &[PathBuf],
    mut on_data: impl FnMut(&str),
) -> Result<(), String> {
    let mut command = Command::new(cmd);
    command
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if !extra_path_dirs.is_empty() {
        let existing = std::env::var_os("PATH").unwrap_or_default();
        let mut joined = std::env::join_paths(extra_path_dirs.iter()).map_err(|e| e.to_string())?;
        joined.push(if cfg!(windows) { ";" } else { ":" });
        joined.push(existing);
        command.env("PATH", joined);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not run \"{cmd}\". Is it installed and on PATH? ({e})"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let mut out_lines = BufReader::new(stdout).lines();
    let mut err_lines = BufReader::new(stderr).lines();

    // Drain both pipes to EOF first, then wait for the exit status, so the
    // tail of the output is never dropped and we never spin on a closed pipe.
    let mut out_done = false;
    let mut err_done = false;
    while !(out_done && err_done) {
        tokio::select! {
            line = out_lines.next_line(), if !out_done => {
                match line { Ok(Some(l)) => on_data(&l), _ => out_done = true }
            }
            line = err_lines.next_line(), if !err_done => {
                match line { Ok(Some(l)) => on_data(&l), _ => err_done = true }
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{cmd} exited with code {}", status.code().unwrap_or(-1)))
    }
}

/// Same as run_async, but for commands that are `.cmd`/`.bat` shims on Windows
/// (npx being the main one) — those can't be spawned directly there and need
/// `cmd /C`. On other platforms this is identical to run_async.
pub async fn run_async_shell_aware(
    cmd: &str,
    args: &[&str],
    cwd: &Path,
    extra_path_dirs: &[PathBuf],
    on_data: impl FnMut(&str),
) -> Result<(), String> {
    if cfg!(windows) {
        let quote = |s: &str| if s.contains(char::is_whitespace) { format!("\"{s}\"") } else { s.to_string() };
        let parts: Vec<String> = std::iter::once(cmd.to_string()).chain(args.iter().map(|a| quote(a))).collect();
        let joined = parts.join(" ");
        run_async("cmd", &["/C", &joined], cwd, extra_path_dirs, on_data).await
    } else {
        run_async(cmd, args, cwd, extra_path_dirs, on_data).await
    }
}

/// Runs a command and just reports whether it exited 0 — used for feature
/// checks like `python3 --version` or `python -c "import uflash"`.
pub async fn can_run(cmd: &str, args: &[&str], cwd: &Path) -> bool {
    run_async(cmd, args, cwd, &[], |_| {}).await.is_ok()
}

/// true if `cmd` resolves on PATH (optionally extended with `extra_path_dirs`).
/// Equivalent to compiler.js's onPath(), but uses the `which` crate instead of
/// shelling out to `where`/`which` — no extra process needed.
pub fn on_path(cmd: &str, extra_path_dirs: &[PathBuf]) -> bool {
    if which::which(cmd).is_ok() {
        return true;
    }
    extra_path_dirs.iter().any(|d| binary_in_dir(d, cmd))
}

fn exe_names(cmd: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![
            format!("{cmd}.exe"),
            format!("{cmd}.cmd"),
            format!("{cmd}.bat"),
        ]
    } else {
        vec![cmd.to_string()]
    }
}

pub fn binary_in_dir(dir: &Path, cmd: &str) -> bool {
    exe_names(cmd).iter().any(|name| dir.join(name).is_file())
}