#!/usr/bin/env node
const {spawnSync} = require('child_process');
const path = require('path');

// Resolve package tsconfig absolute path
const pkgRoot = path.resolve(__dirname, '..');
const tsconfig = path.join(pkgRoot, 'tsconfig.json');

process.env.TS_NODE_PROJECT = tsconfig;
process.env.TS_NODE_TRANSPILE_ONLY =
  process.env.TS_NODE_TRANSPILE_ONLY || 'true';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: run-hardhat.js <hardhat-subcommand> [args...]');
  process.exit(1);
}

const res = spawnSync('npx', ['hardhat', ...args], {
  stdio: 'inherit',
  shell: true,
});
process.exit(res.status);
