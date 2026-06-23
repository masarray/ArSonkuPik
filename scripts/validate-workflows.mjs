#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowDir = path.join(root, '.github/workflows');
const fail = [];
for (const file of fs.readdirSync(workflowDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))) {
  const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');
  if (!/^name:/m.test(text)) fail.push(`${file} is missing a workflow name.`);
  if (!/^permissions:/m.test(text)) fail.push(`${file} should declare explicit permissions.`);
  if (/uses:\s+[^\s]+@(master|main)\b/.test(text)) fail.push(`${file} uses an unpinned floating branch action reference.`);
  if (/pull_request_target:/m.test(text)) fail.push(`${file} must not use pull_request_target in a public repo.`);
  if (/workflow_run:/m.test(text)) fail.push(`${file} must not use workflow_run unless reviewed for privilege escalation.`);
  if (/CWS_|Chrome Web Store API|upload.*webstore|submit.*webstore/i.test(text)) fail.push(`${file} contains auto-submit Web Store logic, which is intentionally disabled.`);
  if (/\.crx\b/i.test(text)) fail.push(`${file} contains CRX release logic, which is intentionally disabled.`);
}
if (fail.length) {
  console.error('Workflow validation failed:');
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}
console.log('Workflow validation passed.');
