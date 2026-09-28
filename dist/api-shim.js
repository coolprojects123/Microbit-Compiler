// Maps the old Electron preload's window.api surface onto Tauri v2's
// invoke/listen, so renderer.js (from the Electron build) works almost
// unchanged. Requires tauri.conf.json's app.withGlobalTauri: true.
(() => {
    const { invoke } = window.__TAURI__.core;
    const { listen } = window.__TAURI__.event;

    window.api = {
        selectTS: () => invoke("select_ts"),
        fileSize: (file) => invoke("file_size", { path: file }),
        startBuild: (file) => invoke("start_build", { filePath: file }),
        flashHex: (hex) => invoke("flash_hex", { hexPath: hex }),

        onApprovalRequest: (cb) => listen("approval-request", (e) => cb(e.payload)),
        respondApproval: (id, ok) => invoke("respond_approval", { id, ok }),

        onBuildLog: (cb) => listen("build-log", (e) => cb(e.payload)),
        onBuildComplete: (cb) => listen("build-complete", (e) => cb(e.payload)),
        onBuildProgress: (cb) => listen("build-progress", (e) => cb(e.payload)),

        listBuilds: () => invoke("list_builds"),
        listBuildFiles: (folder) => invoke("list_build_files", { folder }),
        readFile: (file) => invoke("read_file", { filePath: file }),
        deleteBuild: (folder) => invoke("delete_build", { folder }),
    };
})();
