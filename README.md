# Micro:bit Compiler — Tauri version (scaffold)

Rust rewrite of `compiler.js`/`flash.js`/`main.js`, reusing the existing
`index.html`/`renderer.js` UI almost unchanged.

## Layout

```
tauri/
  package.json              # just wires the tauri CLI
  dist/                     # the frontend (Tauri's "frontendDist")
    index.html               # same file as the Electron build
    renderer.js               # same file as the Electron build
    api-shim.js               # NEW — maps window.api.* onto Tauri invoke/listen
    vendor/                  # put xterm.js/xterm.css/addon-fit.js here (see README.txt)
  src-tauri/
    Cargo.toml
    build.rs
    tauri.conf.json           # window, bundle targets, CSP
    capabilities/default.json # permissions exposed to the webview
    src/
      main.rs                 # entry point, registers commands
      state.rs                # AppState: engine dir + pending approvals
      process_util.rs         # run_async / on_path — Rust port of the child-process helpers
      tools.rs                 # DOWNLOADS table + ensure_tool/ensure_python/ensure_uflash
      compiler.rs               # buildTS/buildPython/buildCpp, ported from compiler.js
      flash.rs                  # USB mass-storage detection + copy, ported from flash.js
      commands.rs                # #[tauri::command]s, ported from main.js's ipcMain handlers
```

## Why the frontend barely changed

`api-shim.js` implements the same `window.api` object the old `preload.js`
exposed, but backed by `invoke()`/`listen()` instead of `ipcRenderer`. So
`renderer.js` is copied over as-is. `tauri.conf.json` sets
`app.withGlobalTauri: true` so `window.__TAURI__` exists without a bundler.

## What changed functionally vs. the Electron version

- **No `curl`/`tar` dependency for downloads.** `tools.rs` uses `reqwest` to
  download and the `zip`/`tar`+`xz2` crates to extract, in-process. Linux no
  longer needs `curl` installed for this (the deb/rpm `depends` list you have
  can drop `curl` once you're fully on Tauri, though `xz-utils`/`xz` are
  still worth keeping for other tooling).
- **Approvals** go through a Tauri event (`approval-request`) and an
  `oneshot` channel per id, same shape as before (`{ id, name, sizeMB, via }`)
  so the existing approval modal in `renderer.js`/`index.html` needs no changes.
- **Path safety**: `flash_hex`/`read_file`/`list_build_files`/`delete_build`
  all still reject paths outside the builds folder (`assert_in_builds`,
  same idea as `main.js`'s `assertInBuilds`).
- **Builds are still serialized** one at a time, now via a `tokio::sync::Mutex`
  in `AppState` instead of a promise chain.

## Before this runs

1. **`npx` on Windows** is a `.cmd` shim and can't be spawned directly by
   `tokio::process::Command`. `run_async_shell_aware` wraps it via `cmd /C`
   — double-check the quoting once you can actually test on Windows.
2. **Dialog plugin API**: `commands::select_ts` uses
   `tauri_plugin_dialog`'s async `pick_file` callback and `FilePath::into_path()`.
   I wrote this from memory of the v2 API shape; check it against the
   installed `tauri-plugin-dialog` version's docs if it doesn't compile.
3. **`tauri::WindowEvent::Destroyed`** — used in `main.rs` to cancel pending
   approvals when the window closes. Confirm this variant name against your
   Tauri version (`CloseRequested` fires earlier and is cancelable; `Destroyed`
   should be the final one, but verify).
4. **Icons**: `tauri.conf.json` points at `icons/32x32.png`, `128x128.png`,
   `128x128@2x.png`, `icon.icns`, `icon.ico`. Only a 512px PNG and a Windows
   `.ico` exist so far (from `assets/icon.svg` earlier). Run
   `npx tauri icon assets/icon.png` to generate the full set, including the
   macOS `.icns` you don't have yet.
5. **`vendor/`** needs `xterm.js`, `xterm.css`, `addon-fit.js` copied in —
   same files the Electron build already uses.
6. **Bundle targets**: `tauri.conf.json` lists `nsis, deb, rpm, appimage`.
   Tauri's bundler doesn't produce a bare `.tar.gz` the way electron-builder
   did; `appimage` is the closest portable-Linux equivalent. Drop whichever
   targets you don't need.

## Not ported (same gaps as compiler.js)

- **macOS**: `current_platform()` returns `None` there, so every tool falls
  through to "install it yourself" — same behavior as before, just carried
  over rather than solved.
- **Git on Linux**: still expects a system install (`sudo apt install git`),
  same as the Node version.

## Build

```bash
npm install
npm run dev      # tauri dev — needs the Rust toolchain + platform build deps
npm run build     # tauri build — produces the installers from tauri.conf.json's targets
```

Windows and Linux still need building on their own OS (or WSL for Linux),
same as with electron-builder.
