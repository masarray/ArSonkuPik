#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const site = path.join(root, 'site');
const fail = [];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

for (const htmlFile of walk(site).filter((file) => file.endsWith('.html'))) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  if (!/<title>[^<]+<\/title>/.test(html)) fail.push(`${htmlFile} is missing a title.`);
  if (!/name="description"/.test(html)) fail.push(`${htmlFile} is missing meta description.`);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(https?:)?\/\//i.test(ref)) continue;
    if (ref.startsWith('#') || ref.startsWith('mailto:')) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = path.resolve(path.dirname(htmlFile), clean);
    if (clean.endsWith('/')) {
      if (!fs.existsSync(path.join(target, 'index.html'))) fail.push(`${htmlFile} links missing page: ${ref}`);
    } else if (!fs.existsSync(target)) {
      fail.push(`${htmlFile} references missing asset: ${ref}`);
    }
  }
}

if (fail.length) {
  console.error('Site validation failed:');
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}
console.log('Site validation passed.');
