// ===== DOM ELEMENTS =====
const selectBtn = document.getElementById("select");
const useExampleBtn = document.getElementById("use-example");
const exampleModal = document.getElementById("example-modal");
const examplePicker = document.getElementById("example-picker");
const exampleCloseBtn = document.getElementById("example-close");
const toolbarBuildBtn = document.getElementById("toolbar-build");
const toolbarFlashBtn = document.getElementById("toolbar-flash");

const statusBox = document.getElementById("status");
const fileDisplay = document.getElementById("file-name-display");
const fileSize = document.getElementById("file-size");
const progressBar = document.getElementById("progress-bar");
const buildMeta = document.getElementById("build-meta");

const buildHistory = document.getElementById("build-history");
const buildViewer = document.getElementById("build-viewer");
const buildCount = document.getElementById("build-count");
const buildSelectAll = document.getElementById("build-select-all");
const bulkDeleteBuildsBtn = document.getElementById("bulk-delete-builds");
const bulkDeleteCount = document.getElementById("bulk-delete-count");

const consoleClearBtn = document.getElementById("console-clear");
const consoleToggleBtn = document.getElementById("console-toggle");
const settingsToggles = document.querySelectorAll(".toggle");
const settingsModal = document.getElementById("settings-modal");
const settingsCloseBtn = document.getElementById("settings-close");
const settingsCancelBtn = document.getElementById("settings-cancel");
const settingsSaveBtn = document.getElementById("settings-save");
const settingsResetBtn = document.getElementById("settings-reset");
const settingsTabs = document.querySelectorAll(".settings-tab");
const settingsPanels = document.querySelectorAll(".settings-content");

// ===== STATE =====
let selectedFile = null;
let currentBuildFolder = null;
let lastHexPath = null;
let consoleCollapsed = false;
let displayedBuilds = [];
const selectedBuildPaths = new Set();
const DEFAULT_SETTINGS = {
    defaultFormat: "MakeCode",
    themeMode: "system",
    accent: "mint",
    spacing: "comfortable",
    consoleFontSize: 12,
    clearConsoleBeforeBuild: true,
    verboseLogs: false,
    allowProjectFiles: true,
    allowFlashing: true
};
let appSettings = loadSettings();
const systemDarkMode = window.matchMedia("(prefers-color-scheme: dark)");

// ===== UTILITIES =====
// ---- xterm console ----
const terminalTheme = {
    background: "#ffffff",
    foreground: "#26343b",
    cursor: "#226b54",
    selectionBackground: "rgba(34, 107, 84, 0.18)",
    red: "#a44444",
    green: "#226b54",
    yellow: "#806019",
    blue: "#355c82",
    brightBlack: "#6d7b82",
    white: "#26343b"
};
const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.5,
    scrollback: 5000,
    convertEol: true,
    disableStdin: true,
    cursorInactiveStyle: "none",
    theme: terminalTheme
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
    if (appSettings.verboseLogs) {
        const timestamp = new Date().toLocaleTimeString();
        text = `[${timestamp}] ${text}`;
    }
    writeRaw((atLineStart ? "" : "\n") + text + "\n");
}

function loadSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem("microbit-compiler-settings") || "{}");
        return { ...DEFAULT_SETTINGS, ...stored };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function populateSettingsForm(settings = appSettings) {
    document.querySelectorAll("[data-setting]").forEach(control => {
        const value = settings[control.dataset.setting];
        if (control.classList.contains("toggle")) {
            control.classList.toggle("on", Boolean(value));
            control.setAttribute("aria-pressed", String(Boolean(value)));
        } else if (value !== undefined) {
            control.value = String(value);
        }
    });
}

function readSettingsForm() {
    const settings = { ...DEFAULT_SETTINGS };
    document.querySelectorAll("[data-setting]").forEach(control => {
        const key = control.dataset.setting;
        settings[key] = control.classList.contains("toggle")
            ? control.classList.contains("on")
            : control.type === "number" || key === "consoleFontSize"
                ? Number(control.value)
                : control.value;
    });
    return settings;
}

function applySettings(settings) {
    const palettes = {
        mint: {
            light: { green: "#226b54", blue: "#355c82", cyan: "#2d6576", terminal: "#226b54", soft: "#e5f1eb" },
            dark: { green: "#71c6a1", blue: "#91bde5", cyan: "#8cc2cb", terminal: "#71c6a1", soft: "#2b4037" }
        },
        blue: {
            light: { green: "#245f73", blue: "#275d8a", cyan: "#275d8a", terminal: "#275d8a", soft: "#e8f0f6" },
            dark: { green: "#78b9ce", blue: "#8bb9e1", cyan: "#8bb9e1", terminal: "#8bb9e1", soft: "#2b3945" }
        },
        amber: {
            light: { green: "#806019", blue: "#755b20", cyan: "#755b20", terminal: "#806019", soft: "#f4efdf" },
            dark: { green: "#d9bb70", blue: "#d9bb70", cyan: "#d9bb70", terminal: "#d9bb70", soft: "#443c2b" }
        }
    };
    const themeMode = ["system", "light", "dark"].includes(settings.themeMode) ? settings.themeMode : "system";
    const isDark = themeMode === "dark" || (themeMode === "system" && systemDarkMode.matches);
    const paletteSet = palettes[settings.accent] || palettes.mint;
    const palette = isDark ? paletteSet.dark : paletteSet.light;
    const root = document.documentElement;
    root.dataset.theme = isDark ? "dark" : "light";
    const spacingModes = ["compact", "comfortable", "spacious"];
    root.dataset.spacing = spacingModes.includes(settings.spacing) ? settings.spacing : "comfortable";
    root.style.setProperty("--green", palette.green);
    root.style.setProperty("--blue", palette.blue);
    root.style.setProperty("--cyan", palette.cyan);
    root.style.setProperty("--accent-soft", palette.soft);
    term.setOption("fontSize", Number(settings.consoleFontSize) || DEFAULT_SETTINGS.consoleFontSize);
    term.setOption("theme", {
        ...terminalTheme,
        background: isDark ? "#222a2f" : "#f3f5f4",
        foreground: isDark ? "#e4e9e7" : "#26343b",
        cursor: palette.terminal,
        selectionBackground: isDark ? "rgba(113, 198, 161, 0.22)" : "rgba(34, 107, 84, 0.18)",
        red: isDark ? "#ee9595" : "#a44444",
        yellow: isDark ? "#e2c273" : "#806019",
        green: palette.green,
        blue: palette.blue,
        brightBlack: isDark ? "#a2b0b3" : "#6d7b82",
        white: isDark ? "#e4e9e7" : "#26343b"
    });

    selectBtn.disabled = !settings.allowProjectFiles;
    useExampleBtn.disabled = !settings.allowProjectFiles;
    toolbarBuildBtn.disabled = !settings.allowProjectFiles;
    toolbarFlashBtn.disabled = !settings.allowFlashing;
    selectBtn.title = settings.allowProjectFiles ? "Choose a source file" : "Project file access is disabled in Settings";
    useExampleBtn.title = settings.allowProjectFiles ? "Load a sample project" : "Project file access is disabled in Settings";
    toolbarBuildBtn.title = settings.allowProjectFiles ? "Build the selected project" : "Project file access is disabled in Settings";
    toolbarFlashBtn.title = settings.allowFlashing ? "Flash the latest build" : "Device flashing is disabled in Settings";
    fitTerminal();
}

function saveSettings(settings) {
    appSettings = settings;
    try {
        localStorage.setItem("microbit-compiler-settings", JSON.stringify(settings));
    } catch {
        log(`${c.red("Could not save settings to this app profile.")}`);
    }
    applySettings(settings);
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
    bytes = Number(bytes);
    if (!Number.isFinite(bytes) || bytes < 0) return "";
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

function openSettingsModal() {
    if (!settingsModal) return;
    populateSettingsForm();
    setActiveSettingsTab("general");
    settingsModal.classList.add("open");
}

function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.remove("open");
}

function setActiveSettingsTab(tabName) {
    settingsTabs.forEach(tab => {
        tab.classList.toggle("active", tab.dataset.settingsTab === tabName);
    });

    settingsPanels.forEach(panel => {
        panel.classList.toggle("active", panel.dataset.settingsPanel === tabName);
    });
}

// ===== SIDEBAR NAVIGATION =====
document.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
        if (btn.dataset.view === "settings") {
            openSettingsModal();
            return;
        }

        document.querySelectorAll("[data-view]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
        const viewId = btn.dataset.view + "-view";
        const target = document.getElementById(viewId);
        if (target) target.classList.add("active");
    });
});

settingsTabs.forEach(tab => {
    tab.addEventListener("click", () => setActiveSettingsTab(tab.dataset.settingsTab));
});

settingsCloseBtn?.addEventListener("click", closeSettingsModal);
settingsCancelBtn?.addEventListener("click", closeSettingsModal);
settingsSaveBtn?.addEventListener("click", () => {
    saveSettings(readSettingsForm());
    log(`${c.green("Settings saved")}`);
    closeSettingsModal();
});
settingsResetBtn?.addEventListener("click", () => {
    saveSettings({ ...DEFAULT_SETTINGS });
    populateSettingsForm();
    setActiveSettingsTab("general");
    log(`${c.yellow("Settings restored to defaults")}`);
});
document.getElementById("settings-restore")?.addEventListener("click", () => {
    populateSettingsForm(DEFAULT_SETTINGS);
});

settingsModal?.addEventListener("click", (event) => {
    if (event.target === settingsModal) closeSettingsModal();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && exampleModal.classList.contains("open")) {
        closeExampleChooser();
    }

    if (event.key === "Escape" && settingsModal && settingsModal.classList.contains("open")) {
        closeSettingsModal();
    }
});

settingsToggles.forEach(toggle => {
    toggle.addEventListener("click", () => {
        toggle.classList.toggle("on");
        toggle.setAttribute("aria-pressed", String(toggle.classList.contains("on")));
    });
});

populateSettingsForm();
applySettings(appSettings);
systemDarkMode.addEventListener("change", () => {
    if (appSettings.themeMode === "system") applySettings(appSettings);
});

const EXAMPLE_GROUPS = [
    {
        name: "MakeCode",
        items: [
            {
                label: "Blink",
                description: "Simple LED pulse loop",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Makecode/Blink.ts",
                    "../Examples/Makecode/Blink.ts",
                    "Examples/Makecode/Blink.ts",
                    "./Examples/Makecode/Blink.ts"
                ]
            },
            {
                label: "Button Counter",
                description: "Counts presses and shows the value",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Makecode/Button Counter.ts",
                    "../Examples/Makecode/Button Counter.ts",
                    "Examples/Makecode/Button Counter.ts",
                    "./Examples/Makecode/Button Counter.ts"
                ]
            },
            {
                label: "Temperature",
                description: "Shows a happy or sad face based on temperature",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Makecode/Temperature.ts",
                    "../Examples/Makecode/Temperature.ts",
                    "Examples/Makecode/Temperature.ts",
                    "./Examples/Makecode/Temperature.ts"
                ]
            },
            {
                label: "Compass",
                description: "Reads the magnetic field and shows direction",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Makecode/Compass.ts",
                    "../Examples/Makecode/Compass.ts",
                    "Examples/Makecode/Compass.ts",
                    "./Examples/Makecode/Compass.ts"
                ]
            },
            {
                label: "Bluetooth Message",
                description: "Sends a short Bluetooth alert",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Makecode/Bluetooth Message.ts",
                    "../Examples/Makecode/Bluetooth Message.ts",
                    "Examples/Makecode/Bluetooth Message.ts",
                    "./Examples/Makecode/Bluetooth Message.ts"
                ]
            },
            {
                label: "Radio Ping",
                description: "Sends a radio packet between devices (V2)",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Makecode/Radio Ping.ts",
                    "../Examples/Makecode/Radio Ping.ts",
                    "Examples/Makecode/Radio Ping.ts",
                    "./Examples/Makecode/Radio Ping.ts"
                ]
            }
        ]
    },
    {
        name: "MicroPython",
        items: [
            {
                label: "Blink",
                description: "Flashes the heart pattern repeatedly",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Micropython/blink.py",
                    "../Examples/Micropython/blink.py",
                    "Examples/Micropython/blink.py",
                    "./Examples/Micropython/blink.py"
                ]
            },
            {
                label: "Button Counter",
                description: "Increments a counter on button presses",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Micropython/button_counter.py",
                    "../Examples/Micropython/button_counter.py",
                    "Examples/Micropython/button_counter.py",
                    "./Examples/Micropython/button_counter.py"
                ]
            },
            {
                label: "Temperature",
                description: "Shows a warm or cool mood based on temperature",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Micropython/temperature.py",
                    "../Examples/Micropython/temperature.py",
                    "Examples/Micropython/temperature.py",
                    "./Examples/Micropython/temperature.py"
                ]
            },
            {
                label: "Compass",
                description: "Reads the compass heading and displays it",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Micropython/compass.py",
                    "../Examples/Micropython/compass.py",
                    "Examples/Micropython/compass.py",
                    "./Examples/Micropython/compass.py"
                ]
            },
            {
                label: "Bluetooth Message",
                description: "Advertises small Bluetooth data",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Micropython/bluetooth_message.py",
                    "../Examples/Micropython/bluetooth_message.py",
                    "Examples/Micropython/bluetooth_message.py",
                    "./Examples/Micropython/bluetooth_message.py"
                ]
            },
            {
                label: "Radio Ping",
                description: "Sends radio packets between devices (V2)",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/Micropython/radio_ping.py",
                    "../Examples/Micropython/radio_ping.py",
                    "Examples/Micropython/radio_ping.py",
                    "./Examples/Micropython/radio_ping.py"
                ]
            }
        ]
    },
    {
        name: "C++",
        items: [
            {
                label: "Blink",
                description: "Toggles the LED on and off in a loop",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/C++/blink.cpp",
                    "../Examples/C++/blink.cpp",
                    "Examples/C++/blink.cpp",
                    "./Examples/C++/blink.cpp"
                ]
            },
            {
                label: "Button Counter",
                description: "Counts A button presses and shows totals",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/C++/button_counter.cpp",
                    "../Examples/C++/button_counter.cpp",
                    "Examples/C++/button_counter.cpp",
                    "./Examples/C++/button_counter.cpp"
                ]
            },
            {
                label: "Temperature",
                description: "Checks the current temperature and shows a mood",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/C++/temperature.cpp",
                    "../Examples/C++/temperature.cpp",
                    "Examples/C++/temperature.cpp",
                    "./Examples/C++/temperature.cpp"
                ]
            },
            {
                label: "Compass",
                description: "Reads the compass heading and prints it",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/C++/compass.cpp",
                    "../Examples/C++/compass.cpp",
                    "Examples/C++/compass.cpp",
                    "./Examples/C++/compass.cpp"
                ]
            },
            {
                label: "Bluetooth Message",
                description: "Starts a simple Bluetooth event loop",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/C++/bluetooth_message.cpp",
                    "../Examples/C++/bluetooth_message.cpp",
                    "Examples/C++/bluetooth_message.cpp",
                    "./Examples/C++/bluetooth_message.cpp"
                ]
            },
            {
                label: "Radio Ping",
                description: "Transmits a radio payload between devices (V2)",
                paths: [
                    "C:/Users/akhil/Documents/Code/Microbit-Compiler/Examples/C++/radio_ping.cpp",
                    "../Examples/C++/radio_ping.cpp",
                    "Examples/C++/radio_ping.cpp",
                    "./Examples/C++/radio_ping.cpp"
                ]
            }
        ]
    }
];

async function setSelectedFile(file) {
    selectedFile = file;
    const fileName = file.split(/[\\/]/).pop();
    fileDisplay.textContent = fileName;

    try {
        const bytes = window.api.fileSize ? await window.api.fileSize(file) : 0;
        fileSize.textContent = formatFileSize(bytes);
    } catch {
        fileSize.textContent = "";
    }
}

function renderExampleChooser() {
    examplePicker.innerHTML = "";

    const exampleNames = ["Blink", "Button Counter", "Compass", "Bluetooth", "Radio Ping (V2)"];
    const exampleIcons = {
        Blink: "lightbulb",
        "Button Counter": "smart_button",
        Compass: "explore",
        Bluetooth: "bluetooth",
        "Radio Ping (V2)": "settings_input_antenna"
    };
    const formatNames = ["MakeCode", "MicroPython", "C++"];
    const formatIcons = { MakeCode: "extension", MicroPython: "code", "C++": "memory" };
    let selectedExample = null;
    let selectedFormat = formatNames.includes(appSettings.defaultFormat)
        ? appSettings.defaultFormat
        : formatNames[0];

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "btn primary";
    const loadIcon = document.createElement("span");
    loadIcon.className = "material-icons";
    loadIcon.textContent = "file_download";
    loadButton.append(loadIcon, document.createTextNode("Load example"));
    loadButton.disabled = true;

    function updateLoadButton() {
        loadButton.disabled = !selectedExample || !selectedFormat;
    }

    function selectRowOption(row, button) {
        row.querySelectorAll(".example-btn").forEach(option => {
            const selected = option === button;
            option.setAttribute("aria-pressed", String(selected));
        });
        updateLoadButton();
    }

    const examplesRow = document.createElement("div");
    examplesRow.className = "example-row";

    exampleNames.forEach(name => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "example-btn";
        const icon = document.createElement("span");
        icon.className = "material-icons";
        icon.textContent = exampleIcons[name];
        const label = document.createElement("span");
        label.textContent = name;
        btn.append(icon, label);
        btn.onclick = () => {
            selectedExample = name;
            selectRowOption(examplesRow, btn);
        };
        btn.setAttribute("aria-pressed", "false");
        examplesRow.appendChild(btn);
    });

    const formatRow = document.createElement("div");
    formatRow.className = "example-row";

    formatNames.forEach(name => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "example-btn format";
        const icon = document.createElement("span");
        icon.className = "material-icons";
        icon.textContent = formatIcons[name];
        const label = document.createElement("span");
        label.textContent = name;
        btn.append(icon, label);
        btn.onclick = () => {
            selectedFormat = name;
            selectRowOption(formatRow, btn);
        };
        btn.setAttribute("aria-pressed", String(name === selectedFormat));
        formatRow.appendChild(btn);
    });

    loadButton.onclick = async () => {
        if (!selectedExample || !selectedFormat || !appSettings.allowProjectFiles) return;

        const group = EXAMPLE_GROUPS.find(item => item.name === selectedFormat);
        const label = selectedExample === "Bluetooth"
            ? "Bluetooth Message"
            : selectedExample === "Radio Ping (V2)"
                ? "Radio Ping"
                : selectedExample;
        const example = group?.items.find(item => item.label === label);
        const file = example?.paths.find(Boolean);
        if (!example || !file) {
            log(`${c.red("Example not available.")}`);
            return;
        }

        await setSelectedFile(file);
        log(`${c.green("Loaded example:")} ${example.label} (${selectedFormat})`);
        switchView("editor");
        closeExampleChooser();
    };

    const loadRow = document.createElement("div");
    loadRow.className = "example-load-row";
    loadRow.appendChild(loadButton);
    examplePicker.appendChild(examplesRow);
    examplePicker.appendChild(formatRow);
    examplePicker.appendChild(loadRow);
}

function openExampleChooser() {
    renderExampleChooser();
    exampleModal.classList.add("open");
}

function closeExampleChooser() {
    exampleModal.classList.remove("open");
}

// ===== FILE SELECTION =====
selectBtn.onclick = async () => {
    if (!appSettings.allowProjectFiles) {
        log(`${c.yellow("Project file access is disabled in Settings.")}`);
        return;
    }

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

useExampleBtn.onclick = () => {
    if (!appSettings.allowProjectFiles) {
        log(`${c.yellow("Project file access is disabled in Settings.")}`);
        return;
    }
    openExampleChooser();
};
exampleCloseBtn.onclick = closeExampleChooser;
exampleModal.addEventListener("click", (event) => {
    if (event.target === exampleModal) closeExampleChooser();
});

// ===== BUILD (TOOLBAR BUTTON) =====
toolbarBuildBtn.onclick = () => {
    if (!appSettings.allowProjectFiles) {
        log(`${c.yellow("Project file access is disabled in Settings.")}`);
        return;
    }

    if (!selectedFile) {
        log(`${c.red(`❌ No file selected.`)}`);
        return;
    }

    if (appSettings.clearConsoleBeforeBuild) {
        term.reset();
        term.write("\x1b[?25l");
        atLineStart = true;
    }

    setMeta("Building...", "busy");
    setProgress(0);

    log(`${c.yellow(`🔨 Starting build...`)}`);
    window.api.startBuild(selectedFile);
};

// ===== FLASH (TOOLBAR BUTTON) =====
toolbarFlashBtn.onclick = async () => {
    if (!appSettings.allowFlashing) {
        log(`${c.yellow("Device flashing is disabled in Settings.")}`);
        return;
    }

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
        ? `It will be installed with pip (about ${sizeMB} MB).`
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
    try {
        displayedBuilds = await window.api.listBuilds();
    } catch (error) {
        displayedBuilds = [];
        buildCount.textContent = "0";
        buildHistory.innerHTML = "";
        const message = document.createElement("div");
        message.className = "empty-state";
        message.textContent = `Couldn't load build history: ${error}`;
        buildHistory.appendChild(message);
        updateBulkDeleteControls();
        return;
    }

    const currentPaths = new Set(displayedBuilds.map(build => build.path));
    selectedBuildPaths.forEach(path => {
        if (!currentPaths.has(path)) selectedBuildPaths.delete(path);
    });
    buildCount.textContent = String(displayedBuilds.length);
    buildHistory.innerHTML = "";

    if (displayedBuilds.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        const icon = document.createElement("span");
        icon.className = "material-icons";
        icon.textContent = "history";
        const message = document.createElement("div");
        message.textContent = "No builds yet";
        empty.append(icon, message);
        buildHistory.appendChild(empty);
        updateBulkDeleteControls();
        return;
    }

    displayedBuilds.forEach(build => {
        const div = document.createElement("div");
        div.className = "build-item";
        div.dataset.buildPath = build.path;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "build-select";
        checkbox.setAttribute("aria-label", `Select build ${build.name}`);
        checkbox.checked = selectedBuildPaths.has(build.path);
        checkbox.addEventListener("click", event => event.stopPropagation());
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedBuildPaths.add(build.path);
            else selectedBuildPaths.delete(build.path);
            updateBulkDeleteControls();
        });

        const icon = document.createElement("div");
        icon.className = "build-item-icon";
        icon.innerHTML = '<span class="material-icons">inventory_2</span>';

        const content = document.createElement("div");
        content.className = "build-item-content";

        const name = document.createElement("div");
        name.className = "build-item-name";
        name.textContent = build.name;

        const time = document.createElement("div");
        time.className = "build-item-time";
        const when = parseBuildTime(build.name);
        time.textContent = when ? when.toLocaleString() : "";

        content.appendChild(name);
        content.appendChild(time);
        div.appendChild(checkbox);
        div.appendChild(icon);
        div.appendChild(content);

        div.onclick = () => {
            buildHistory.querySelectorAll(".build-item").forEach(x => x.classList.remove("selected"));
            div.classList.add("selected");
            openBuild(build.path);
        };
        buildHistory.appendChild(div);
    });

    updateBulkDeleteControls();
}

function updateBulkDeleteControls() {
    const selectedCount = selectedBuildPaths.size;
    bulkDeleteCount.textContent = selectedCount ? `Delete (${selectedCount})` : "Delete";
    bulkDeleteBuildsBtn.disabled = selectedCount === 0;
    buildSelectAll.checked = displayedBuilds.length > 0 && selectedCount === displayedBuilds.length;
    buildSelectAll.indeterminate = selectedCount > 0 && !buildSelectAll.checked;

    buildHistory.querySelectorAll(".build-item").forEach(row => {
        const selected = selectedBuildPaths.has(row.dataset.buildPath);
        row.classList.toggle("marked-for-delete", selected);
        const checkbox = row.querySelector(".build-select");
        if (checkbox) checkbox.checked = selected;
    });
}

buildSelectAll.addEventListener("change", () => {
    if (buildSelectAll.checked) displayedBuilds.forEach(build => selectedBuildPaths.add(build.path));
    else displayedBuilds.forEach(build => selectedBuildPaths.delete(build.path));
    updateBulkDeleteControls();
});

bulkDeleteBuildsBtn.addEventListener("click", () => {
    deleteBuildFolders([...selectedBuildPaths]);
});

async function deleteBuildFolders(paths) {
    if (!paths.length) return;
    const count = paths.length;
    const noun = count === 1 ? "build" : "builds";
    if (!window.confirm(`Delete ${count} selected ${noun}? This cannot be undone.`)) return;

    bulkDeleteBuildsBtn.disabled = true;
    const results = await Promise.allSettled(paths.map(path => window.api.deleteBuild(path)));
    const deletedPaths = paths.filter((path, index) =>
        results[index].status === "fulfilled" && results[index].value
    );
    deletedPaths.forEach(path => selectedBuildPaths.delete(path));

    if (currentBuildFolder && deletedPaths.includes(currentBuildFolder)) {
        currentBuildFolder = null;
        lastHexPath = null;
        showEmptyBuildViewer("Select a build to view its files.");
        setMeta("Ready", "idle");
    }

    await refreshBuildHistory();
    const failedCount = count - deletedPaths.length;
    if (failedCount) log(`${c.red(`${failedCount} ${failedCount === 1 ? "build" : "builds"} could not be deleted.`)}`);
    if (deletedPaths.length) log(`${c.green(`Deleted ${deletedPaths.length} ${deletedPaths.length === 1 ? "build" : "builds"}.`)}`);
}

function showEmptyBuildViewer(message) {
    buildViewer.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const icon = document.createElement("span");
    icon.className = "material-icons";
    icon.textContent = "inventory_2";
    const label = document.createElement("div");
    label.textContent = message;
    empty.append(icon, label);
    buildViewer.appendChild(empty);
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

    delBtn.onclick = () => deleteBuildFolders([folder]);

    actions.appendChild(flashBtn2);
    actions.appendChild(delBtn);

    header.appendChild(title);
    header.appendChild(actions);
    buildViewer.appendChild(header);

    const sizes = await Promise.all(files.map(async file => {
        try {
            const size = Number(await window.api.fileSize(file.path));
            return Number.isFinite(size) && size >= 0 ? size : null;
        } catch {
            return null;
        }
    }));
    const knownSizes = sizes.filter(size => size !== null);
    const totalSize = knownSizes.reduce((total, size) => total + size, 0);
    const sizeText = knownSizes.length === 0
        ? "Unavailable"
        : `${knownSizes.length < files.length ? "At least " : ""}${formatFileSize(totalSize)}`;
    const buildDate = parseBuildTime(folder.split(/[\\/]/).pop());
    const hexFile = files.find(file => file.name.toLowerCase().endsWith(".hex"));
    const summary = document.createElement("dl");
    summary.className = "build-summary";
    [
        ["Created", buildDate ? buildDate.toLocaleString() : "Unknown"],
        ["Output items", String(files.length)],
        ["Total size", sizeText],
        ["HEX output", hexFile ? hexFile.name : "None"]
    ].forEach(([label, value]) => {
        const metric = document.createElement("div");
        metric.className = "build-metric";
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        metric.append(term, detail);
        summary.appendChild(metric);
    });
    buildViewer.appendChild(summary);

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

// ===== AUTO-UPDATE =====
const checkUpdateBtn = document.getElementById("check-update");
const updateModal = document.getElementById("update-modal");
const updateMessage = document.getElementById("update-message");
const updateDetail = document.getElementById("update-detail");
const updateNotes = document.getElementById("update-notes");
const updateProgress = document.getElementById("update-progress");
const updateProgressBar = document.getElementById("update-progress-bar");
const updateInstall = document.getElementById("update-install");
const updateLater = document.getElementById("update-later");

let updateInstalling = false;
let updatePending = null;

function showUpdate(info) {
    if (updateModal.classList.contains("open")) return; // already showing one
    updatePending = info;

    updateMessage.textContent = `Version ${info.version} is available.`;
    updateDetail.textContent = `You are running ${info.current}. The app restarts after updating.`;
    updateNotes.textContent = info.notes || "";
    updateProgress.classList.remove("active");
    updateProgressBar.style.width = "0";
    updateInstall.textContent = "Update now";
    updateInstall.disabled = false;
    updateLater.disabled = false;

    updateModal.classList.add("open");
    updateInstall.focus();
}

function closeUpdate() {
    if (updateInstalling) return; // can't cancel mid-install
    updateModal.classList.remove("open");
}

updateInstall.onclick = async () => {
    if (updateInstalling || !updatePending) return;
    updateInstalling = true;
    updateInstall.disabled = true;
    updateLater.disabled = true;
    updateInstall.textContent = "Downloading...";
    updateProgress.classList.add("active");
    log(`${c.yellow(`⬇ Downloading update`)} ${updatePending.version}...`);

    try {
        await window.api.installUpdate();
        // The app restarts on success, so getting here means nothing was installed.
        updateInstalling = false;
        updateModal.classList.remove("open");
        log(`${c.green(`✔ Already up to date`)}`);
    } catch (err) {
        updateInstalling = false;
        updateDetail.textContent = `Update failed: ${err}`;
        updateInstall.textContent = "Retry";
        updateInstall.disabled = false;
        updateLater.disabled = false;
        updateProgress.classList.remove("active");
        log(`${c.red(`❌ Update failed: ${err}`)}`);
    }
};

updateLater.onclick = closeUpdate;
document.addEventListener("keydown", e => {
    if (e.key === "Escape" && updateModal.classList.contains("open")) closeUpdate();
});

checkUpdateBtn.onclick = async () => {
    checkUpdateBtn.disabled = true;
    try {
        const info = await window.api.checkUpdate();
        if (info) showUpdate(info);
        else log(`${c.green(`✔ You're up to date`)}`);
    } catch (err) {
        log(`${c.red(`❌ Update check failed: ${err}`)}`);
    } finally {
        checkUpdateBtn.disabled = false;
    }
};

window.api.onUpdateAvailable(showUpdate);

window.api.onUpdateProgress(([downloaded, total]) => {
    if (!total) return;
    const pct = Math.min(100, Math.round((downloaded / total) * 100));
    updateProgressBar.style.width = pct + "%";
    updateInstall.textContent = `Downloading ${pct}%`;
});

window.api.onUpdateInstalled(() => {
    updateProgressBar.style.width = "100%";
    updateInstall.textContent = "Installing...";
    log(`${c.green(`✔ Update downloaded, installing...`)}`);
});

// ===== INITIALIZATION =====
(async () => {
    log(`${c.green(`✔ Micro:bit Compiler Studio ready`)}`);
    await refreshBuildHistory();
})();