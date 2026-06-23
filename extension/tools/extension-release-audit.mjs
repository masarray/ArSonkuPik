import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fail = [];
const warn = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}
function exists(file) {
  return fs.existsSync(path.join(root, file));
}
function pushFail(message) { fail.push(message); }
function pushWarn(message) { warn.push(message); }

const manifest = JSON.parse(read('manifest.json'));
if (manifest.manifest_version !== 3) pushFail('manifest_version must be 3.');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) pushFail('manifest.version must use x.y.z format.');
if (!manifest.description || manifest.description.length > 132) pushFail(`manifest.description must be 1–132 chars, got ${manifest.description?.length || 0}.`);
if (manifest.minimum_chrome_version && Number(manifest.minimum_chrome_version) < 116) pushFail('minimum_chrome_version should be >=116 for offscreen tabCapture stream handoff.');

const permissions = new Set(manifest.permissions || []);
for (const permission of ['webRequest', 'scripting', 'tabs']) {
  if (permissions.has(permission)) pushFail(`Sensitive permission is present: ${permission}`);
}
if (!permissions.has('contentSettings')) pushFail('contentSettings permission is required for AudioPick-style output device enumeration.');
for (const permission of ['activeTab', 'tabCapture', 'offscreen', 'storage']) {
  if (!permissions.has(permission)) pushFail(`Required permission missing: ${permission}`);
}
if ((manifest.host_permissions || []).length) pushFail('host_permissions must stay empty for this package.');

for (const iconSize of ['16', '32', '48', '128']) {
  const icon = manifest.icons?.[iconSize];
  if (!icon || !exists(icon)) pushFail(`Missing icon ${iconSize}: ${icon || '(not declared)'}`);
}

const htmlFiles = ['popup.html', 'studio.html', 'offscreen.html'];
for (const htmlFile of htmlFiles) {
  if (!exists(htmlFile)) {
    pushFail(`Missing HTML file: ${htmlFile}`);
    continue;
  }
  const html = read(htmlFile);
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (/^(https?:)?\/\//i.test(ref)) pushFail(`${htmlFile} uses remote asset: ${ref}`);
    if (!exists(ref)) pushFail(`${htmlFile} references missing asset: ${ref}`);
  }
}

const allSourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replaceAll('\\\\', '/');
    if (entry.isDirectory()) walk(rel);
    else allSourceFiles.push(rel);
  }
}
walk('src');

for (const file of allSourceFiles.filter((file) => /\.(js|css|html)$/i.test(file))) {
  const text = read(file);
  if (/\beval\s*\(/.test(text)) pushFail(`${file} contains eval().`);
  if (/\bnew\s+Function\s*\(/.test(text)) pushFail(`${file} contains new Function().`);
  if (/https?:\/\//i.test(text.replace('http://www.w3.org/2000/svg', ''))) pushWarn(`${file} contains an http(s) string; verify it is not remote executable code.`);
}

if (exists('src/studio/studio.css')) pushFail('Legacy monolithic src/studio/studio.css must not be restored.');
for (const css of ['src/studio/studio.shell.css', 'src/studio/studio.eq.css', 'src/studio/studio.modules.css', 'src/studio/studio.responsive.css']) {
  if (!exists(css)) pushFail(`Missing studio CSS owner file: ${css}`);
}

const studioShell = exists('src/studio/studio.shell.css') ? read('src/studio/studio.shell.css') : '';
for (const fontRef of [...studioShell.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1])) {
  const fontPath = path.posix.normalize(path.posix.join('src/studio', fontRef));
  if (!exists(fontPath)) pushWarn(`Optional bundled font is not present yet: ${fontPath}`);
}

for (const forbidden of ['node_modules', 'dist', '.git']) {
  if (exists(forbidden)) pushFail(`Forbidden package directory present: ${forbidden}`);
}

if (warn.length) {
  console.log('Release audit warnings:');
  for (const message of warn) console.log(`  - ${message}`);
}
if (fail.length) {
  console.error('Release audit failed:');
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}
console.log('Release audit passed. Chrome Store package hygiene looks good.');
