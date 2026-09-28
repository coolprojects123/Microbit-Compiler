const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// 1. Path to compiler.js 
// NOTE: For production, ensure 'compiler.js' is in your 'extraResources'
const compilerPath = app.isPackaged 
    ? path.join(process.resourcesPath, "compiler.js") 
    : path.join(__dirname, "../compiler.js");

const compiler = require(compilerPath);
const { build } = compiler;
const { flash } = require("../flash.js");

// Builds live inside buildengine (see compiler.js), so the list always matches the output
const getBuildsDir = () => compiler.getBuildsDir();

// Approvals are shown as an HTML modal in the renderer
let mainWindow = null;
let approvalId = 0;
const pendingApprovals = new Map();

// Asked before any tool is installed (winget) or downloaded (zip)
function approveInstall(info) {
    return new Promise(resolve => {
        if (!mainWindow || mainWindow.isDestroyed()) return resolve(false);
        const id = ++approvalId;
        pendingApprovals.set(id, resolve);
        mainWindow.webContents.send("approval-request", { id, ...info });
    });
}

ipcMain.on("approval-response", (_, id, ok) => {
    const resolve = pendingApprovals.get(id);
    if (resolve) {
        pendingApprovals.delete(id);
        resolve(!!ok);
    }
});

function createWindow() {
    const win = mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile("./gui/index.html");

    // window closed while a question is open -> treat as "Cancel"
    win.on("closed", () => {
        mainWindow = null;
        for (const resolve of pendingApprovals.values()) resolve(false);
        pendingApprovals.clear();
    });
}

app.whenReady().then(() => {
    compiler.init(app.getPath("userData"), { approve: approveInstall });
    createWindow();
});

// IPC: Select File
ipcMain.handle("select-ts", async () => {
    const result = await dialog.showOpenDialog({
        filters: [{ name: "Source Files", extensions: ["ts", "py", "cpp", "c"] }],
        properties: ["openFile"]
    });
    return result.canceled ? null : result.filePaths[0];
});

// IPC: File size (the renderer has no fs access)
ipcMain.handle("file-size", async (_, filePath) => fs.statSync(filePath).size);

// IPC: Build Process
ipcMain.handle("start-build", async (event, filePath) => {
    const start = Date.now();
    const buildsDir = getBuildsDir(); // Path to writable userData

    try {
        const result = await build(
            filePath,
            msg => {
                event.sender.send("build-log", msg);
                if (msg.includes("Compiling")) event.sender.send("build-progress", 20);
                if (msg.includes("Generating")) event.sender.send("build-progress", 40);
                if (msg.includes("Linking")) event.sender.send("build-progress", 60);
                if (msg.toLowerCase().includes("hex")) event.sender.send("build-progress", 80);
            }
        );

        const duration = ((Date.now() - start) / 1000).toFixed(1);
        event.sender.send("build-progress", 100);

        event.sender.send("build-complete", {
            success: true,
            hex: result.hex,
            folder: result.folder,
            duration
        });
    } catch (err) {
        event.sender.send("build-complete", { success: false, error: err.message });
    }
});

// IPC: Flash Process
ipcMain.handle("flash-hex", async (_, hexPath) => {
    try {
        const message = flash(hexPath);
        return { ok: true, message: message };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// IPC: Build Management
ipcMain.handle("list-builds", async () => {
    const buildsDir = getBuildsDir();
    return fs.readdirSync(buildsDir)
        .filter(f => fs.statSync(path.join(buildsDir, f)).isDirectory())
        .sort()
        .reverse()
        .map(f => ({ name: f, path: path.join(buildsDir, f) }));
});

ipcMain.handle("list-build-files", async (_, folder) => {
    return fs.readdirSync(folder).map(f => ({
        name: f,
        path: path.join(folder, f)
    }));
});

ipcMain.handle("read-file", async (_, filePath) => {
    return fs.readFileSync(filePath, "utf8");
});

ipcMain.handle("delete-build", async (_, folder) => {
    fs.rmSync(folder, { recursive: true, force: true });
    return true;
});