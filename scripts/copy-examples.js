const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'Examples');
const dest = path.join(root, 'dist', 'Examples');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true, force: true });
console.log(`Copied examples from ${src} to ${dest}`);
