import { spawnSync } from 'node:child_process';
import path from 'node:path';

const python = process.platform === 'win32' ? 'python' : 'python3';
const scanner = path.resolve('vendor/utilidades/modules/artisys-security/security.py');
const mode = process.argv.includes('--release') ? 'release' : 'commit';
const args = [scanner, process.cwd(), '--engine', process.env.ARTISYS_SECURITY_ENGINE || 'docker'];
if (mode === 'release') args.push('--mode', 'release');

const result = spawnSync(python, args, { stdio: 'inherit' });
if (result.error) {
  console.error(`Falha ao iniciar artisys-security: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 2);
