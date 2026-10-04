#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.BENCAO_PYTHON || 'python3';
const checks = readdirSync(new URL('../checks/', import.meta.url))
  .filter(name => /\.(cjs|mjs)$/.test(name)).sort();
const assets = [
  'verify-research-assets.py', 'verify-formula-corpus.py',
  'verify-processing-assets.py', 'verify-herb-vector-assets.py',
  'verify-herb-images.py'
];
for (const [command, args] of [
  ...checks.map(name => [process.execPath, ['checks/' + name]]),
  ...assets.map(name => [python, ['tools/' + name]])
]) {
  console.log('\nChecking ' + args[0]);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll project checks passed.');
