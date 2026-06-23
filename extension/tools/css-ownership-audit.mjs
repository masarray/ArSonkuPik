#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const baselinePath = path.join(root, 'tools', 'css-ownership-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const files = Object.keys(baseline);
const forbiddenPatterns = [
  { re: /v\d+\.\d+\.\d+\s*[—-].*(cleanup|polish|authoritative)/i, label: 'versioned release override block' },
  { re: /authoritative\s+layout\s+cleanup/i, label: 'authoritative cleanup block' }
];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function collectRules(css) {
  const clean = stripComments(css);
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const selectorText = m[1].trim();
    if (!selectorText || selectorText.startsWith('@') || /^\d+%$/.test(selectorText) || selectorText === 'from' || selectorText === 'to') continue;
    const selectors = selectorText.split(',').map(s => s.trim()).filter(Boolean);
    const line = lineAt(clean, m.index);
    for (const selector of selectors) rules.push({ selector, line });
  }
  return rules;
}

let failed = false;

const forbiddenFiles = [
  'src/studio/studio.css'
];

for (const rel of forbiddenFiles) {
  if (fs.existsSync(path.join(root, rel))) {
    console.error(`  ERROR: forbidden monolithic CSS file exists: ${rel}`);
    failed = true;
  }
}

const studioCssFiles = fs.readdirSync(path.join(root, 'src', 'studio'))
  .filter(name => name.endsWith('.css'))
  .map(name => `src/studio/${name}`);
for (const rel of studioCssFiles) {
  if (!baseline[rel]) {
    console.error(`  ERROR: Studio CSS file is missing from ownership baseline: ${rel}`);
    failed = true;
  }
}

for (const rel of files) {
  const abs = path.join(root, rel);
  const css = fs.readFileSync(abs, 'utf8');
  const rules = collectRules(css);
  const selectorMap = new Map();
  for (const rule of rules) {
    const list = selectorMap.get(rule.selector) || [];
    list.push(rule.line);
    selectorMap.set(rule.selector, list);
  }

  const duplicates = [...selectorMap.entries()].filter(([, lines]) => lines.length > 1);
  const importantCount = (css.match(/!important/g) || []).length;
  const stats = {
    duplicateSelectors: duplicates.length,
    importantCount
  };

  for (const pattern of forbiddenPatterns) {
    if (pattern.re.test(css)) {
      console.error(`  ERROR: forbidden CSS stacking pattern found in ${rel}: ${pattern.label}`);
      failed = true;
    }
  }

  console.log(`\n${rel}`);
  console.log(`  duplicate selectors: ${stats.duplicateSelectors} / baseline ${baseline[rel].duplicateSelectors}`);
  console.log(`  !important count:    ${stats.importantCount} / baseline ${baseline[rel].importantCount}`);

  if (stats.duplicateSelectors > baseline[rel].duplicateSelectors) {
    console.error(`  ERROR: duplicate selector debt increased in ${rel}`);
    failed = true;
  }
  if (stats.importantCount > baseline[rel].importantCount) {
    console.error(`  ERROR: !important debt increased in ${rel}`);
    failed = true;
  }

  const top = duplicates
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 12);
  if (top.length) {
    console.log('  top duplicated selectors:');
    for (const [selector, lines] of top) {
      console.log(`    ${String(lines.length).padStart(2)}x ${selector} @ lines ${lines.slice(0, 8).join(', ')}${lines.length > 8 ? ', …' : ''}`);
    }
  }
}

if (failed) {
  console.error('\nCSS ownership audit failed. Move edits into the existing owner section instead of appending another override block.');
  process.exit(1);
}

console.log('\nCSS ownership audit passed. No new CSS stacking debt detected.');
