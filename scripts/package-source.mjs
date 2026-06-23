#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const version = manifest.version;
const zipName = `arsonkupik-public-source-v${version.replaceAll('.', '_')}.zip`;
const outPath = path.join(releaseDir, zipName);

const excluded = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)release\/.*\.zip$/,
  /(^|\/)release\/.*\.sha256$/,
  /(^|\/)release\/RELEASE_NOTES\.md$/,
  /(^|\/)\.chrome-test-profile(\/|$)/,
  /\.log$/,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)\.env(\.|$)/
];

fs.mkdirSync(releaseDir, { recursive: true });
for (const entry of fs.readdirSync(releaseDir)) {
  if (entry.startsWith('arsonkupik-public-source-') && entry.endsWith('.zip')) fs.rmSync(path.join(releaseDir, entry), { force: true });
}

const files = [];
function walk(absDir, relDir = '') {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(relDir, entry.name);
    if (excluded.some((re) => re.test(rel))) continue;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) walk(abs, rel);
    else files.push(rel);
  }
}
walk(root, '');
files.sort();

execFileSync('zip', ['-X', '-q', outPath, ...files], { cwd: root, stdio: 'inherit' });
execFileSync('unzip', ['-tq', outPath], { stdio: 'inherit' });
console.log(`Created ${path.relative(root, outPath)} (${files.length} source files).`);
