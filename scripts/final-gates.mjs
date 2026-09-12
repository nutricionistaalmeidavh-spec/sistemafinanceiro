import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, label) {
  console.log(`\n[final-gate] ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, env: process.env });
  if (result.error) {
    console.error(`[final-gate] ${label} não iniciou: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) {
    console.error(`[final-gate] ${label} falhou com código ${result.status}.`);
    process.exit(result.status || 1);
  }
}

function collectCjs(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'release' || entry.name === 'dist') continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectCjs(target));
    else if (entry.isFile() && entry.name.endsWith('.cjs')) files.push(target);
  }
  return files.sort();
}

run(npm, ['test'], 'test');
for (const file of collectCjs(path.resolve('electron'))) {
  // node --check is intentionally explicit: syntax must fail closed before build/release.
  run(process.execPath, ['--check', file], `node --check ${path.relative(process.cwd(), file)}`);
}
run(npm, ['run', 'build'], 'build');
run(npm, ['run', 'security'], 'security');
run(npm, ['run', 'release:check'], 'release:check');
console.log('\nFINAL_GATES_OK');
