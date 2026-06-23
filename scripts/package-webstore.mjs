#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');
const manifestPath = path.join(extensionDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
const zipName = `arsonkupik-extension-v${version.replaceAll('.', '_')}-webstore-upload.zip`;
const outPath = path.join(releaseDir, zipName);

const allowedTopLevel = new Set(['manifest.json', 'popup.html', 'studio.html', 'offscreen.html', 'src', 'icons']);
const forbiddenPatterns = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)tools(\/|$)/,
  /\.md$/i,
  /CHROME_/i,
  /PRIVACY_/i,
  /STORE_/i,
  /RELEASE_/i,
  /CSS_OWNERSHIP/i,
  /\.map$/i
];
const blockedExtensions = new Set(['.ttf', '.otf', '.woff', '.woff2', '.pem', '.key', '.p12', '.pfx']);

fs.mkdirSync(releaseDir, { recursive: true });
for (const entry of fs.readdirSync(releaseDir)) {
  if (entry.endsWith('-webstore-upload.zip')) fs.rmSync(path.join(releaseDir, entry), { force: true });
}

for (const item of allowedTopLevel) {
  const abs = path.join(extensionDir, item);
  if (!fs.existsSync(abs)) throw new Error(`Missing runtime item: ${item}`);
}

const files = [];
function walk(rel = '') {
  const abs = path.join(extensionDir, rel);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(rel, entry.name);
    const first = child.split('/')[0];
    if (!allowedTopLevel.has(first)) continue;
    if (forbiddenPatterns.some((re) => re.test(child))) continue;
    if (entry.isDirectory()) walk(child);
    else files.push(child);
  }
}
walk('');
files.sort();

if (!files.includes('manifest.json')) throw new Error('manifest.json must be at the root of the Web Store ZIP.');
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  if (blockedExtensions.has(ext)) throw new Error(`Blocked sensitive or font file in Web Store package: ${file}`);
}

const zipArgs = ['-X', '-q', outPath, ...files];
execFileSync('zip', zipArgs, { cwd: extensionDir, stdio: 'inherit' });
execFileSync('unzip', ['-tq', outPath], { stdio: 'inherit' });

const listing = execFileSync('unzip', ['-Z1', outPath], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const bad = listing.filter((file) => {
  const top = file.split('/')[0];
  return !allowedTopLevel.has(top) || forbiddenPatterns.some((re) => re.test(file)) || blockedExtensions.has(path.extname(file).toLowerCase());
});
if (bad.length) throw new Error(`Web Store ZIP contains forbidden entries:\n${bad.join('\n')}`);
console.log(`Created ${path.relative(root, outPath)} (${files.length} runtime files).`);
