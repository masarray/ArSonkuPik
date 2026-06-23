#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const files = fs.readdirSync(releaseDir).filter((name) => name.endsWith('.zip')).sort();
if (!files.length) throw new Error('No release ZIP files found. Run package scripts first.');

const lines = [];
for (const file of files) {
  const data = fs.readFileSync(path.join(releaseDir, file));
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  lines.push(`${hash}  ${file}`);
}
const outPath = path.join(releaseDir, 'SHA256SUMS.sha256');
fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(`Created ${path.relative(root, outPath)}.`);
