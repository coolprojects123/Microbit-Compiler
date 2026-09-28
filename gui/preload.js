const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    selectTS: () => ipcRenderer.invoke("select-ts"),
    fileSize: (file) => ipcRenderer.invoke("file-size", file),
    startBuild: (file) => ipcRenderer.invoke("start-build", file),
    flashHex: (hex) => ipcRenderer.invoke("flash-hex", hex),

    onApprovalRequest: (cb) => ipcRenderer.on("approval-request", (_, req) => cb(req)),
    respondApproval: (id, ok) => ipcRenderer.send("approval-response", id, ok),

    onBuildLog: (cb) => ipcRenderer.on("build-log", (_, msg) => cb(msg)),
    onBuildComplete: (cb) => ipcRenderer.on("build-complete", (_, res) => cb(res)),
    onBuildProgress: (cb) => ipcRenderer.on("build-progress", (_, pct) => cb(pct)),

    listBuilds: () => ipcRenderer.invoke("list-builds"),
    listBuildFiles: (folder) => ipcRenderer.invoke("list-build-files", folder),
    readFile: (file) => ipcRenderer.invoke("read-file", file),
    deleteBuild: (folder) => ipcRenderer.invoke("delete-build", folder),
});