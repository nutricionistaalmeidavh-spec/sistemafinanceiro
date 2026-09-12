import { spawnSync } from 'node:child_process';
import { runReleaseGate } from '@artisys/release';

function command(check, command, args) {
  return async () => {
    const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    return result.status === 0
      ? { status: 'pass' }
      : { status: 'fail', reason: `${check}-failed` };
  };
}

const runners = {
  unit: command('unit', 'npm', ['test']),
  build: command('build', 'npm', ['run', 'build']),
  qa: command('qa', 'npm', ['run', 'qa:validate']),
  security: command('security', 'node', ['scripts/security.mjs', '--release']),
};

const result = await runReleaseGate(runners, {
  product: 'ArtiSys Financeiro',
  version: process.env.npm_package_version || '0.1.0',
  checks: ['unit', 'build', 'qa', 'security'],
  artifacts: [],
});

if (result.status !== 'pass') {
  console.error(`Release bloqueada: ${result.failedChecks.join(', ')}`);
  process.exit(1);
}
console.log('Release gate aprovado.');
