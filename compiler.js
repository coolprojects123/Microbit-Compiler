const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const isWin = process.platform === "win32";

// External tools: installed by the user (or overridden via env vars)
const TOOLS = {
    npx: process.env.MB_NPX || "npx",
    python: process.env.MB_PYTHON || (isWin ? "python" : "python3"),
    py2hex: process.env.MB_PY2HEX || "py2hex", // pip install uflash
    git: process.env.MB_GIT || "git",
};
const CODAL_REPO = "https://github.com/lancaster-university/codal-microbit-v2";

// file extension -> root folder inside buildengine
const ROOTS = { ".ts": "Makecode", ".py": "MPython", ".cpp": "C++", ".c": "C++" };

let ENGINE = null;

// Step 1: app open -> create buildengine folder.
// Call init(baseDir) on startup; if you don't, the first build falls back
// to Electron's userData folder (or ./ when running outside Electron).
function init(baseDir) {
    ENGINE = path.join(baseDir, "buildengine");
    fs.mkdirSync(ENGINE, { recursive: true });
    return ENGINE;
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

function makeOutDir(root, file) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = path.basename(file, path.extname(file));
    const dir = path.join(root, "out", `${stamp}_${name}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const q = s => (/\s/.test(s) ? `"${s}"` : s);

function runAsync(cmd, args, cwd, onData) {
    return new Promise((resolve, reject) => {
        // shell only on Windows, where npx is a .cmd file
        const child = isWin
            ? spawn([cmd, ...args].map(q).join(" "), { cwd, shell: true })
            : spawn(cmd, args, { cwd });
        child.stdout.on("data", d => onData(d.toString()));
        child.stderr.on("data", d => onData(d.toString()));
        child.on("error", err =>
            reject(new Error(`Could not run "${cmd}". Is it installed and on PATH? (${err.message})`)));
        child.on("close", code =>
            code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
    });
}

async function buildTS(tsFile, onLog) {
    const root = ensureRoot(".ts");
    const buildFolder = makeOutDir(root, tsFile);

    onLog("🔨 Building TypeScript...\n");
    fs.copyFileSync(tsFile, path.join(root, "main.ts"));
    fs.writeFileSync(path.join(root, "pxt.json"), JSON.stringify({
        name: "build",
        dependencies: { core: "*", radio: "*", microphone: "*" },
        files: ["main.ts"],
    }, null, 2));

    if (!fs.existsSync(path.join(root, "pxt_modules"))) {
        await runAsync(TOOLS.npx, ["pxt", "target", "microbit"], root, onLog);
    }
    await runAsync(TOOLS.npx, ["pxt", "install"], root, onLog);
    await runAsync(TOOLS.npx, ["pxt", "build", "--hw", "v2"], root, onLog);

    const dest = path.join(buildFolder, `${path.basename(tsFile, ".ts")}-v2.hex`);
    fs.copyFileSync(path.join(root, "built", "mbcodal-binary.hex"), dest);
    return { folder: buildFolder, hex: dest };
}

async function buildPython(pyFile, onLog) {
    const root = ensureRoot(".py");
    const buildFolder = makeOutDir(root, pyFile);

    onLog("🔨 Building MicroPython...\n");
    // Same call as the original: -o takes the output folder
    await runAsync(TOOLS.py2hex, [pyFile, "-o", buildFolder], root, onLog);

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
    const codal = process.env.MB_CODAL_DIR || path.join(root, "codal-microbit-v2");

    onLog("🔨 Building C++ (CODAL)...\n");

    // first C++ build: fetch CODAL into the C++ root (needs git + network)
    if (!fs.existsSync(codal)) {
        onLog("Cloning codal-microbit-v2 (first run)...\n");
        await runAsync(TOOLS.git, ["clone", CODAL_REPO, codal], root, onLog);
    }

    // cmake, ninja and arm-none-eabi-gcc are expected on PATH
    fs.copyFileSync(src, path.join(codal, "source", "main.cpp"));
    await runAsync(TOOLS.python, ["build.py"], codal, onLog);

    const dest = path.join(buildFolder, `${path.basename(src, ext)}.hex`);
    fs.copyFileSync(path.join(codal, "MICROBIT.hex"), dest);
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

module.exports = { init, build };