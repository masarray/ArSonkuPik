#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fail = [];
const warn = [];

const skipDirs = new Set(['.git', 'node_modules', 'release']);
const binaryExt = new Set(['.png', '.ico', '.jpg', '.jpeg', '.webp', '.gif', '.zip']);
const sensitiveNamePatterns = [/\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /^\.env(\.|$)/i];
const secretTextPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /CWS_CLIENT_SECRET\s*=/,
  /CWS_REFRESH_TOKEN\s*=/,
  /CHROME_EXTENSION_PEM_BASE64\s*=/
];

function walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const childRel = path.posix.join(rel, entry.name);
    const childAbs = path.join(dir, entry.name);
    if (sensitiveNamePatterns.some((re) => re.test(entry.name))) fail.push(`Sensitive filename is not allowed: ${childRel}`);
    if (entry.isDirectory()) walk(childAbs, childRel);
    else {
      if (binaryExt.has(path.extname(entry.name).toLowerCase())) continue;
      const text = fs.readFileSync(childAbs, 'utf8');
      for (const pattern of secretTextPatterns) {
        if (pattern.test(text)) fail.push(`Potential secret pattern found in ${childRel}: ${pattern}`);
      }
    }
  }
}
walk(root);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
if (!manifest.manifest_version || manifest.manifest_version !== 3) fail.push('manifest.json must use Manifest V3.');
if (manifest.host_permissions?.length) fail.push('Public Web Store build should not include host_permissions.');
if (manifest.content_scripts?.length) fail.push('This extension should not include content_scripts unless the single purpose changes.');
if (!manifest.permissions?.includes('tabCapture')) fail.push('tabCapture permission missing.');
if (!manifest.permissions?.includes('offscreen')) fail.push('offscreen permission missing.');

const workflows = path.join(root, '.github/workflows');
for (const file of fs.readdirSync(workflows).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))) {
  const text = fs.readFileSync(path.join(workflows, file), 'utf8');
  if (/CWS_|CHROME_EXTENSION_PEM|webstore|upload.*chrome/i.test(text) && file !== 'release.yml' && file !== 'validate.yml') {
    warn.push(`Workflow ${file} references Web Store/Chrome release terms; confirm no auto-submit logic.`);
  }
  if (/client_secret|refresh_token|pem_base64/i.test(text)) fail.push(`Workflow ${file} references sensitive release credentials.`);
}

if (warn.length) {
  console.warn('Repository audit warnings:');
  for (const message of warn) console.warn(`  - ${message}`);
}
if (fail.length) {
  console.error('Repository audit failed:');
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}
console.log('Repository safety audit passed.');
