// ===== DOM ELEMENTS =====
const selectBtn = document.getElementById("select");
const toolbarBuildBtn = document.getElementById("toolbar-build");
const toolbarFlashBtn = document.getElementById("toolbar-flash");

const statusBox = document.getElementById("status");
const fileDisplay = document.getElementById("file-name-display");
const fileSize = document.getElementById("file-size");
const progressBar = document.getElementById("progress-bar");
const buildMeta = document.getElementById("build-meta");

const buildHistory = document.getElementById("build-history");
const buildViewer = document.getElementById("build-viewer");

const consoleClearBtn = document.getElementById("console-clear");
const consoleToggleBtn = document.getElementById("console-toggle");

// ===== STATE =====
let selectedFile = null;
let currentBuildFolder = null;
let lastHexPath = null;
let consoleCollapsed = false;

// ===== UTILITIES =====
// ---- xterm console ----
const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.3,
    scrollback: 5000,
    convertEol: true,          // tool output uses \n
    disableStdin: true,        // read-only console
    cursorInactiveStyle: "none",
    theme: {
        background: "#0a0c13",
        foreground: "#d6dbf0",
        cursor: "#0a0c13",
        selectionBackground: "rgba(76, 175, 239, 0.35)",
        red: "#ff5c5c",
        green: "#6dd47e",
        yellow: "#ffa500",
        blue: "#4cafef",
        brightBlack: "#7a7f9e",
        white: "#d6dbf0"
    }
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(statusBox);
term.write("\x1b[?25l"); // hide cursor

function fitTerminal() {
    if (statusBox.clientWidth > 0 && statusBox.clientHeight > 0) fitAddon.fit();
}
new ResizeObserver(fitTerminal).observe(statusBox);

// ANSI colour helpers
const c = {
    red: t => `\x1b[31m${t}\x1b[0m`,
    green: t => `\x1b[32m${t}\x1b[0m`,
    yellow: t => `\x1b[33m${t}\x1b[0m`
};

// Raw tool output (chunks, may or may not end in a newline)
let atLineStart = true;
function writeRaw(text) {
    text = String(text);
    if (!text) return;
    term.write(text);
    atLineStart = /[\r\n]$/.test(text);
}

// Our own status lines
function log(text) {
    writeRaw((atLineStart ? "" : "\n") + text + "\n");
}

// Build folders are named like 2026-09-28T12-34-56-789Z_name
function parseBuildTime(name) {
    const m = name.match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/);
    return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

function setProgress(pct) {
    progressBar.style.width = pct + "%";
}

function setMeta(text, state) {
    buildMeta.textContent = text;
    buildMeta.dataset.state = state;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function switchView(viewName) {
    document.querySelectorAll("[data-view]").forEach(btn => btn.classList.remove("active"));
    const btn = document.querySelector(`[data-view="${viewName}"]`);
    if (btn) btn.classList.add("active");

    document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
    const view = document.getElementById(viewName + "-view");
    if (view) view.classList.add("active");
}

// ===== SIDEBAR NAVIGATION =====
document.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("[data-view]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
        const viewId = btn.dataset.view + "-view";
        document.getElementById(viewId).classList.add("active");
    });
});

// ===== FILE SELECTION =====
selectBtn.onclick = async () => {
    const file = await window.api.selectTS();
    if (!file) return;

    selectedFile = file;
    const fileName = file.split(/[\\/]/).pop();
    fileDisplay.textContent = fileName;

    try {
        fileSize.textContent = formatFileSize(await window.api.fileSize(file));
    } catch {
        fileSize.textContent = "";
    }

    log(`${c.green(`✔ Loaded:`)} ${fileName}`);
    switchView("editor");
};

// ===== BUILD (TOOLBAR BUTTON) =====
toolbarBuildBtn.onclick = () => {
    if (!selectedFile) {
        log(`${c.red(`❌ No file selected.`)}`);
        return;
    }

    setMeta("Building...", "busy");
    setProgress(0);

    log(`${c.yellow(`🔨 Starting build...`)}`);
    window.api.startBuild(selectedFile);
};

// ===== FLASH (TOOLBAR BUTTON) =====
toolbarFlashBtn.onclick = async () => {
    if (!lastHexPath && !currentBuildFolder) {
        log(`${c.red(`❌ No build available to flash.`)}`);
        return;
    }

    let hexPath = lastHexPath;

    if (!hexPath && currentBuildFolder) {
        const files = await window.api.listBuildFiles(currentBuildFolder);
        const hex = files.find(f => f.name.endsWith(".hex"));
        if (!hex) {
            log(`${c.red(`❌ No HEX file in this build.`)}`);
            return;
        }
        hexPath = hex.path;
    }

    log(`📤 Flashing: ${hexPath}`);
    const res = await window.api.flashHex(hexPath);

    if (res.ok) {
        log(`${c.green(`✔ ${res.message}`)}`);
    } else {
        log(`${c.red(`❌ ${res.error}`)}`);
    }
};

// ===== CONSOLE ACTIONS =====
consoleClearBtn.onclick = () => {
    term.reset();
    term.write("\x1b[?25l");
    atLineStart = true;
    log(`${c.green(`✔ Console cleared`)}`);
};

if (consoleToggleBtn) consoleToggleBtn.onclick = () => {
    consoleCollapsed = !consoleCollapsed;

    if (consoleCollapsed) {
        statusBox.style.flex = "0 0 60px";
        consoleToggleBtn.textContent = "▲ Expand";
    } else {
        statusBox.style.flex = "1";
        consoleToggleBtn.textContent = "▼ Collapse";
    }
};

// ===== IPC LISTENERS =====
window.api.onBuildLog((msg) => {
    writeRaw(msg);
});

window.api.onBuildProgress((pct) => {
    setProgress(pct);
    setMeta(`Building ${pct}%`, "busy");
});

window.api.onBuildComplete((res) => {
    if (!res.success) {
        log(`${c.red(`❌ ${res.error}`)}`);
        setProgress(0);
        setMeta("Build failed", "error");
        return;
    }

    currentBuildFolder = res.folder;
    lastHexPath = res.hex || null;

    const buildName = res.folder.split(/[\\/]/).pop();
    log(`${c.green(`✔ Build complete`)} (took ${res.duration}s)`);
    log(`${c.green(`✔ Output folder:`)} ${res.folder}`);

    setMeta(`✔ ${buildName} • ${res.duration}s`, "ok");
    setProgress(100);

    switchView("editor");
    refreshBuildHistory();
    openBuild(res.folder);
});

// ===== APPROVAL MODAL =====
const approvalModal = document.getElementById("approval-modal");
const approvalTitle = document.getElementById("approval-title");
const approvalMessage = document.getElementById("approval-message");
const approvalDetail = document.getElementById("approval-detail");
const approvalConfirm = document.getElementById("approval-confirm");
const approvalCancel = document.getElementById("approval-cancel");

const approvalQueue = [];
let activeApproval = null;

function showNextApproval() {
    if (activeApproval || approvalQueue.length === 0) return;
    activeApproval = approvalQueue.shift();
    const { name, sizeMB, via } = activeApproval;
    const isPip = via === "pip";

    approvalTitle.textContent = isPip ? "Install required package?" : "Download required tool?";
    approvalMessage.textContent = `${name} is needed to build this file.`;
    approvalDetail.textContent = isPip
        ? `It will be installed with pip into your Python (about ${sizeMB} MB).`
        : `About ${sizeMB} MB will be downloaded and kept in the app's data folder. No admin rights needed.`;
    approvalConfirm.textContent = isPip ? "Install" : "Download";

    approvalModal.classList.add("open");
    approvalConfirm.focus();
}

function answerApproval(ok) {
    if (!activeApproval) return;
    const { id, name } = activeApproval;
    activeApproval = null;
    approvalModal.classList.remove("open");

    window.api.respondApproval(id, ok);
    log(ok
        ? `${c.green(`✔ Approved:`)} ${name}`
        : `${c.yellow(`Declined:`)} ${name}`);
    showNextApproval();
}

approvalConfirm.onclick = () => answerApproval(true);
approvalCancel.onclick = () => answerApproval(false);
document.addEventListener("keydown", e => {
    if (e.key === "Escape" && activeApproval) answerApproval(false);
});

window.api.onApprovalRequest(req => {
    approvalQueue.push(req);
    showNextApproval();
});

// ===== BUILD HISTORY =====
async function refreshBuildHistory() {
    const builds = await window.api.listBuilds();
    buildHistory.innerHTML = "";

    if (builds.length === 0) {
        buildHistory.innerHTML = `
            <div class="empty-state" style="padding: 20px; height: auto;">
                <div class="material-icons">history</div>
                <div class="empty-state-text">No builds yet</div>
            </div>`;
        return;
    }

    builds.forEach(b => {
        const div = document.createElement("div");
        div.className = "build-item";

        const icon = document.createElement("div");
        icon.className = "build-item-icon";
        icon.innerHTML = '<span class="material-icons">inventory_2</span>';

        const content = document.createElement("div");
        content.className = "build-item-content";

        const name = document.createElement("div");
        name.className = "build-item-name";
        name.textContent = b.name;

        const time = document.createElement("div");
        time.className = "build-item-time";
        const when = parseBuildTime(b.name);
        time.textContent = when ? when.toLocaleString() : "";

        content.appendChild(name);
        content.appendChild(time);
        div.appendChild(icon);
        div.appendChild(content);

        div.onclick = () => {
            buildHistory.querySelectorAll(".build-item").forEach(x => x.classList.remove("selected"));
            div.classList.add("selected");
            openBuild(b.path);
        };
        buildHistory.appendChild(div);
    });
}

// ===== OPEN BUILD VIEWER =====
async function openBuild(folder) {
    currentBuildFolder = folder;
    const files = await window.api.listBuildFiles(folder);

    buildViewer.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "build-viewer-header";

    const title = document.createElement("div");
    title.className = "build-viewer-title";
    title.textContent = folder.split(/[\\/]/).pop();

    const actions = document.createElement("div");
    actions.className = "build-viewer-actions";

    // Flash button
    const flashBtn2 = document.createElement("button");
    flashBtn2.className = "btn small";
    flashBtn2.innerHTML = '<span class="material-icons">bolt</span>Flash';
    flashBtn2.style.fontSize = "11px";
    flashBtn2.style.padding = "4px 8px";

    flashBtn2.onclick = async () => {
        const files = await window.api.listBuildFiles(folder);
        const hex = files.find(f => f.name.endsWith(".hex"));

        if (!hex) {
            log(`${c.red(`❌ No HEX file in this build.`)}`);
            return;
        }

        log(`📤 Flashing: ${hex.path}`);
        const res = await window.api.flashHex(hex.path);

        if (res.ok) {
            log(`${c.green(`✔ ${res.message}`)}`);
        } else {
            log(`${c.red(`❌ ${res.error}`)}`);
        }
    };

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.className = "btn small danger";
    delBtn.innerHTML = '<span class="material-icons">delete</span>Delete';
    delBtn.style.fontSize = "11px";
    delBtn.style.padding = "4px 8px";

    delBtn.onclick = async () => {
        await window.api.deleteBuild(folder);

        if (currentBuildFolder === folder) {
            currentBuildFolder = null;
            buildViewer.innerHTML = `
                <div class="empty-state">
                    <div class="material-icons">inventory_2</div>
                    <div class="empty-state-text">Select a build to view files</div>
                </div>`;
            setMeta("Ready", "idle");
        }

        refreshBuildHistory();
    };

    actions.appendChild(flashBtn2);
    actions.appendChild(delBtn);

    header.appendChild(title);
    header.appendChild(actions);
    buildViewer.appendChild(header);

    // File area
    const area = document.createElement("div");
    area.className = "build-file-area";

    const fileList = document.createElement("div");
    fileList.className = "build-file-list";

    const fileContent = document.createElement("div");
    fileContent.className = "build-file-content";
    fileContent.textContent = "Select a file to view its contents.";

    files.forEach(f => {
        const item = document.createElement("div");
        item.className = "build-file";
        item.textContent = f.name;

        item.onclick = async () => {
            if (/\.(log|ts|py|cpp|c|txt|hex|json)$/i.test(f.name)) {
                const content = await window.api.readFile(f.path);
                fileContent.textContent = content;
            } else {
                fileContent.textContent = `Binary file: ${f.name}`;
            }
        };

        fileList.appendChild(item);
    });

    area.appendChild(fileList);
    area.appendChild(fileContent);
    buildViewer.appendChild(area);
}

// ===== INITIALIZATION =====
(async () => {
    log(`${c.green(`✔ Micro:bit Compiler Studio ready`)}`);
    await refreshBuildHistory();
})();