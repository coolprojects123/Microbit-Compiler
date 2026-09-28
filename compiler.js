const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const isWin = process.platform === "win32";

// ---------------------------------------------------------------------------
// Tools that can be downloaded (portable Windows zips, no admin needed) after the user approves.
// Anything already on PATH is used as-is and never downloaded.
// NOTE: versions/URLs are pinned here in one place. Check they still resolve.
// ---------------------------------------------------------------------------
const DOWNLOADS = {
    node: {
        label: "Node.js 20 (for MakeCode/pxt)", root: "Makecode", sizeMB: 35, check: "npx",
        url: "https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip",
        strip: 1, bins: ["."],
    },
    ninja: {
        label: "Ninja build tool", root: "C++", sizeMB: 1, check: "ninja",
        url: "https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip",
        strip: 0, bins: ["."],
    },
    cmake: {
        label: "CMake", root: "C++", sizeMB: 40, check: "cmake",
        url: "https://github.com/Kitware/CMake/releases/download/v3.31.4/cmake-3.31.4-windows-x86_64.zip",
        strip: 1, bins: ["bin"],
    },
    git: {
        // MinGit = Git for Windows' official portable zip (no installer, no admin)
        label: "Git (portable)", root: "C++", sizeMB: 55, check: "git",
        url: "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/MinGit-2.47.1-64-bit.zip",
        strip: 0, bins: ["cmd"],
    },
    armgcc: {
        label: "Arm GNU Toolchain (arm-none-eabi-gcc)", root: "C++", sizeMB: 150, check: "arm-none-eabi-gcc",
        url: "https://developer.arm.com/-/media/Files/downloads/gnu/13.3.rel1/binrel/arm-gnu-toolchain-13.3.rel1-mingw-w64-i686-arm-none-eabi.zip",
        strip: 1, bins: ["bin"],
    },
};

const PF = process.env.ProgramFiles || "C:\\Program Files";

// Default install folders, so a tool that is installed but not on PATH is still found.
const PF86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
const LOCAL = process.env.LOCALAPPDATA || "";
const EXTS = [".exe", ".cmd", ".bat"];
const inDir = (dir, cmd) => EXTS.some(e => fs.existsSync(path.join(dir, cmd + e)));

function armDirs() {
    const out = [];
    for (const base of [PF, PF86]) {
        try {
            for (const d of fs.readdirSync(base)) {
                if (!/^Arm GNU Toolchain/i.test(d)) continue;
                for (const v of fs.readdirSync(path.join(base, d))) out.push(path.join(base, d, v, "bin"));
            }
        } catch (_) { /* folder missing */ }
    }
    return out;
}

const KNOWN_DIRS = {
    node:   () => [path.join(PF, "nodejs"), path.join(LOCAL, "Programs", "nodejs")],
    cmake:  () => [path.join(PF, "CMake", "bin"), path.join(LOCAL, "Programs", "CMake", "bin")],
    git:    () => [path.join(PF, "Git", "cmd"), path.join(LOCAL, "Programs", "Git", "cmd")],
    ninja:  () => [],
    armgcc: armDirs,
};

const CODAL_REPO = "https://github.com/lancaster-university/microbit-v2-samples";
const ROOTS = { ".ts": "Makecode", ".py": "MPython", ".cpp": "C++", ".c": "C++" };

let ENGINE = null;
let approve = null; // async ({ name, sizeMB, url }) => boolean

// Step 1: app open -> create buildengine folder.
// opts.approve: called before any download; return true to allow it.
function init(baseDir, opts = {}) {
    ENGINE = path.join(baseDir, "buildengine");
    fs.mkdirSync(ENGINE, { recursive: true });
    approve = opts.approve || null;
    return ENGINE;
}

// Asks the user before installing/downloading.
// Uses the handler from init(), else an Electron dialog. Returns null if neither exists.
async function askApproval(info) {
    if (approve) return !!(await approve(info));
    try {
        const { dialog } = require("electron");
        const { response } = await dialog.showMessageBox({
            type: "question",
            buttons: ["Install", "Cancel"],
            defaultId: 0,
            cancelId: 1,
            message: `${info.name} is needed to build this file.`,
            detail: info.via === "pip"
                ? `It will be installed with pip (about ${info.sizeMB} MB).`
                : `Download about ${info.sizeMB} MB now? It is kept in the app's data folder and needs no admin rights.`,
        });
        return response === 0;
    } catch (_) {
        return null; // not in Electron's main process
    }
}

function defaultBaseDir() {
    try {
        const { app } = require("electron");
        if (app && app.getPath) return app.getPath("userData");
    } catch (_) { /* not running in Electron */ }
    return process.cwd();
}

// Step 3: on first build of a type -> create its root folder
function ensureRoot(ext) {
    if (!ENGINE) init(defaultBaseDir());
    const name = ROOTS[ext];
    if (!name) throw new Error("Unsupported file type: " + ext);
    const dir = path.join(ENGINE, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getBuildsDir() {
    if (!ENGINE) init(defaultBaseDir());
    const dir = path.join(ENGINE, "Builds");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// One flat Builds folder for every type, so the history list can just read it
function makeOutDir(_root, file) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = path.basename(file, path.extname(file));
    const dir = path.join(getBuildsDir(), `${stamp}_${name}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// ---------------------------------------------------------------------------
// Process running
// ---------------------------------------------------------------------------
const q = s => (/\s/.test(s) ? `"${s}"` : s);

function withPath(env, dirs) {
    if (!dirs.length) return env;
    const key = Object.keys(env).find(k => k.toLowerCase() === "path") || "PATH";
    return { ...env, [key]: [...dirs, env[key] || ""].join(path.delimiter) };
}

function runAsync(cmd, args, cwd, onData, dirs = []) {
    return new Promise((resolve, reject) => {
        const opts = { cwd, env: withPath(process.env, dirs) };
        // shell only on Windows, where npx is a .cmd file
        const child = isWin
            ? spawn([cmd, ...args].map(q).join(" "), { ...opts, shell: true })
            : spawn(cmd, args, opts);
        child.stdout.on("data", d => onData(d.toString()));
        child.stderr.on("data", d => onData(d.toString()));
        child.on("error", err =>
            reject(new Error(`Could not run "${cmd}". Is it installed and on PATH? (${err.message})`)));
        child.on("close", code =>
            code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
    });
}

// true if `cmd` is found on PATH (plus any extra dirs)
function onPath(cmd, dirs = []) {
    return new Promise(resolve => {
        const child = spawn(isWin ? "where" : "which", [cmd], { env: withPath(process.env, dirs), shell: isWin });
        child.on("error", () => resolve(false));
        child.on("close", code => resolve(code === 0));
    });
}

// ---------------------------------------------------------------------------
// Download-on-approval
// ---------------------------------------------------------------------------
// Returns extra PATH dirs for the tool ([] if the system one is used).
async function ensureTool(name, log) {
    const def = DOWNLOADS[name];
    const dir = path.join(ENGINE, def.root, "tools", name);
    const bins = def.bins.map(b => path.join(dir, b));

    // 1. already on PATH -> use it
    if (await onPath(def.check)) return [];

    // 2. installed in its default folder but not on PATH -> use it
    if (isWin) {
        const known = (KNOWN_DIRS[name] ? KNOWN_DIRS[name]() : []).find(d => inDir(d, def.check));
        if (known) return [known];
    }

    // 3. downloaded by this app earlier
    if (fs.existsSync(path.join(dir, ".installed"))) return bins;

    // 4. otherwise ask before downloading

    if (!isWin) {
        throw new Error(`${def.label} is required. Install it and make sure "${def.check}" is on PATH.`);
    }
    const ok = await askApproval({ name: def.label, sizeMB: def.sizeMB, url: def.url });
    if (ok === null) throw new Error(`${def.label} is required, and no approval handler is available.`);
    if (!ok) throw new Error(`${def.label} is required, but the download was declined.`);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, "download.zip");

    log(`⬇️  Downloading ${def.label} (~${def.sizeMB} MB)...\n`);
    await runAsync("curl", ["-L", "--fail", "-o", zip, def.url], dir, log);

    log(`📦 Extracting ${def.label}...\n`);
    const tarArgs = ["-xf", zip, "-C", dir];
    if (def.strip) tarArgs.push(`--strip-components=${def.strip}`);
    await runAsync("tar", tarArgs, dir, log); // Windows 10+ ships curl and tar
    fs.rmSync(zip, { force: true });

    if (def.post) await def.post(dir, log);
    fs.writeFileSync(path.join(dir, ".installed"), new Date().toISOString());
    return bins;
}

// ---------------------------------------------------------------------------
// System Python (the default `python` command) and the uflash package
// ---------------------------------------------------------------------------
const noop = () => {};
const canRun = (cmd, args) => runAsync(cmd, args, ENGINE, noop).then(() => true, () => false);

async function ensurePython() {
    // `python --version` also rejects the Microsoft Store "python" stub
    if (await canRun("python", ["--version"])) return;
    throw new Error("Python is required. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH') and restart the app.");
}

// py2hex comes from the uflash package; installed with pip after approval
async function ensureUflash(log) {
    await ensurePython();
    if (await canRun("python", ["-c", "import uflash"])) return;

    const ok = await askApproval({ name: "uflash (Python package for MicroPython builds)", sizeMB: 1, via: "pip" });
    if (ok === null) throw new Error("The uflash Python package is required. Run: python -m pip install uflash");
    if (!ok) throw new Error("uflash is required, but the install was declined.");

    log("⬇️  Installing uflash with pip...\n");
    await runAsync("python", ["-m", "pip", "install", "uflash"], ENGINE, log);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
async function buildTS(tsFile, onLog) {
    const root = ensureRoot(".ts");
    const buildFolder = makeOutDir(root, tsFile);
    const dirs = await ensureTool("node", onLog);

    onLog("🔨 Building TypeScript...\n");
    fs.copyFileSync(tsFile, path.join(root, "main.ts"));
    fs.writeFileSync(path.join(root, "pxt.json"), JSON.stringify({
        name: "build",
        dependencies: { core: "*", radio: "*", microphone: "*" },
        files: ["main.ts"],
    }, null, 2));

    if (!fs.existsSync(path.join(root, "pxt_modules"))) {
        await runAsync("npx", ["pxt", "target", "microbit"], root, onLog, dirs);
    }
    await runAsync("npx", ["pxt", "install"], root, onLog, dirs);
    await runAsync("npx", ["pxt", "build", "--hw", "v2"], root, onLog, dirs);

    const dest = path.join(buildFolder, `${path.basename(tsFile, ".ts")}-v2.hex`);
    fs.copyFileSync(path.join(root, "built", "mbcodal-binary.hex"), dest);
    return { folder: buildFolder, hex: dest };
}

async function buildPython(pyFile, onLog) {
    const root = ensureRoot(".py");
    const buildFolder = makeOutDir(root, pyFile);
    await ensureUflash(onLog);

    onLog("🔨 Building MicroPython...\n");
    // same as the py2hex command, but doesn't depend on Python's Scripts folder being on PATH
    await runAsync("python", ["-c", "import sys, uflash; uflash.py2hex(sys.argv[1:])", pyFile, "-o", buildFolder], root, onLog);

    const outHex = path.join(buildFolder, `${path.basename(pyFile, ".py")}.hex`);
    if (!fs.existsSync(outHex)) {
        throw new Error(`py2hex finished but ${outHex} was not created.`);
    }
    return { folder: buildFolder, hex: outHex };
}

async function buildCpp(src, onLog) {
    const ext = path.extname(src).toLowerCase();
    const root = ensureRoot(ext);
    const buildFolder = makeOutDir(root, src);

    const dirs = [
        ...(await ensureTool("cmake", onLog)),
        ...(await ensureTool("git", onLog)),
        ...(await ensureTool("ninja", onLog)),
        ...(await ensureTool("armgcc", onLog)),
    ];
    await ensurePython();
    const project = process.env.MB_CODAL_DIR || path.join(root, "microbit-v2-samples");

    onLog("🔨 Building C++ (CODAL)...\n");

    if (!fs.existsSync(path.join(project, "build.py"))) {
        onLog("Cloning microbit-v2-samples (first run)...\n");
        fs.rmSync(project, { recursive: true, force: true }); // clear any partial clone
        await runAsync("git", ["clone", CODAL_REPO, project], root, onLog, dirs);
    }

    fs.copyFileSync(src, path.join(project, "source", "main.cpp"));
    await runAsync("python", ["build.py"], project, onLog, dirs);

    const dest = path.join(buildFolder, `${path.basename(src, ext)}.hex`);
    fs.copyFileSync(path.join(project, "MICROBIT.hex"), dest);
    return { folder: buildFolder, hex: dest };
}

// Builds run one at a time, since each root has shared working files
let chain = Promise.resolve();

function build(file, onLog) {
    if (typeof onLog !== "function") onLog = console.log;

    const ext = path.extname(file).toLowerCase();
    const job = () => {
        if (ext === ".ts") return buildTS(file, onLog);
        if (ext === ".py") return buildPython(file, onLog);
        if (ext === ".cpp" || ext === ".c") return buildCpp(file, onLog);
        throw new Error("Unsupported file type: " + ext);
    };
    const p = chain.then(job);
    chain = p.catch(() => {});
    return p;
}

module.exports = { init, build, getBuildsDir };