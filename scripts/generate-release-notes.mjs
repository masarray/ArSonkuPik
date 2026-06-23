#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const version = manifest.version;
const changelog = fs.existsSync(path.join(root, 'CHANGELOG.md'))
  ? fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  : '';

function extractVersionSection(text, version) {
  const lines = text.split(/\r?\n/);
  const versionHeader = new RegExp(`^##\\s+\\[?v?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?\\b`);
  const start = lines.findIndex((line) => versionHeader.test(line));
  if (start < 0) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join('\n').trim();
}

const section = extractVersionSection(changelog, version);
const body = `# ArSonKuPik v${version}\n\n` +
  (section ? `${section}\n\n` : 'Release package for the current Chrome extension runtime.\n\n') +
  `## Assets\n\n` +
  `- \`arsonkupik-extension-v${version.replaceAll('.', '_')}-webstore-upload.zip\` — clean runtime ZIP for Chrome Web Store upload.\n` +
  `- \`arsonkupik-public-source-v${version.replaceAll('.', '_')}.zip\` — source, documentation, landing page, and release tooling archive.\n` +
  `- \`SHA256SUMS.sha256\` — SHA-256 checksums for release assets.\n\n` +
  `## Safety note\n\n` +
  `This workflow does not auto-submit to Chrome Web Store and does not build CRX files. Upload to Chrome Web Store remains a manual dashboard step.\n`;

fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(path.join(releaseDir, 'RELEASE_NOTES.md'), body);
console.log('Created release/RELEASE_NOTES.md.');
