import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const python = process.platform === 'win32' ? 'python' : 'python3';
const primary = path.resolve('vendor/utilidades/modules/artisys-security/security.py');
const fallback = path.resolve('ci/artisys-security/security.py');
const engine = process.env.ARTISYS_SECURITY_ENGINE || 'docker';
const preferPortableSnapshot = process.platform === 'win32' && engine === 'docker';
const scanner = preferPortableSnapshot && fs.existsSync(fallback)
  ? fallback
  : (fs.existsSync(primary) ? primary : fallback);
const mode = process.argv.includes('--release') ? 'release' : 'commit';
const args = [scanner, process.cwd(), '--engine', engine];
if (mode === 'release') args.push('--mode', 'release');

if (!fs.existsSync(scanner)) {
  console.error('artisys-security não encontrado no submódulo nem no snapshot CI fixado.');
  process.exit(2);
}

const result = spawnSync(python, args, { stdio: 'inherit' });
if (result.error) {
  console.error(`Falha ao iniciar artisys-security: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 2);
