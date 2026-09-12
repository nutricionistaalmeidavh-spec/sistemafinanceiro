#!/usr/bin/env python3
"""Local security gate. Raw scanner output is temporary and never printed."""
import argparse
import json
import re
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
IMAGES = {'gitleaks': 'zricethezav/gitleaks:v8.24.3', 'trivy': 'aquasec/trivy:0.61.1', 'semgrep': 'semgrep/semgrep:1.116.0'}
VERSIONS = {'gitleaks': '8.24.3', 'trivy': '0.61.1', 'semgrep': '1.116.0'}
RANK = {'UNKNOWN': 3, 'INFO': 0, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'CRITICAL': 4}
SEM_GREP_EXCLUDES = ['node_modules', 'dist', 'release', 'qa-artifacts', '.git']

class GateError(Exception):
    pass


def evaluate(tool, report, mode):
    findings = []
    rule_ids = []
    locations = []
    try:
        if tool == 'gitleaks':
            if not isinstance(report, list):
                raise ValueError()
            for item in report:
                if not isinstance(item, dict) or not isinstance(item['RuleID'], str):
                    raise ValueError()
                findings.append('CRITICAL')
                rule_ids.append(item['RuleID'])
                file_name = item.get('File')
                line = item.get('StartLine')
                if isinstance(file_name, str):
                    locations.append({'file': file_name, 'line': line if isinstance(line, int) else None})
        elif tool == 'trivy':
            if report['SchemaVersion'] != 2 or not isinstance(report.get('ArtifactName'), str) or not isinstance(report.get('Metadata'), dict) or report.get('ArtifactType') != 'filesystem':
                raise ValueError()
            results = report.get('Results', [])
            if not isinstance(results, list):
                raise ValueError()
            for result in results:
                if not isinstance(result.get('Target'), str):
                    raise ValueError()
                for key in ('Vulnerabilities', 'Misconfigurations'):
                    rows = result.get(key, [])
                    if rows is None:
                        rows = []
                    if not isinstance(rows, list):
                        raise ValueError()
                    for item in rows:
                        if key == 'Misconfigurations':
                            if item.get('Status') not in ('FAIL', 'PASS', 'EXCEPTION'):
                                raise ValueError()
                            if item['Status'] != 'FAIL':
                                continue
                        severity = item['Severity']
                        if severity not in RANK:
                            raise ValueError()
                        findings.append(severity)
        elif tool == 'semgrep':
            if not isinstance(report['errors'], list) or report['errors']:
                raise ValueError()
            if not isinstance(report['results'], list):
                raise ValueError()
            for item in report['results']:
                findings.append({'ERROR': 'HIGH', 'WARNING': 'MEDIUM', 'INFO': 'LOW'}[item['extra']['severity']])
                check_id = item.get('check_id')
                if isinstance(check_id, str):
                    rule_ids.append(check_id)
                file_name = item.get('path')
                start = item.get('start', {})
                line = start.get('line') if isinstance(start, dict) else None
                if isinstance(file_name, str):
                    locations.append({'file': file_name, 'line': line if isinstance(line, int) else None})
        else:
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        raise GateError(f'{tool}: invalid or incomplete scanner report') from None
    threshold = 3 if mode == 'commit' else 2
    result = {'findings': len(findings), 'blocking': sum(RANK[s] >= threshold for s in findings)}
    if tool in ('gitleaks', 'semgrep'):
        result['ruleIds'] = sorted(set(rule_ids))
        result['locations'] = sorted(locations, key=lambda row: (row['file'], row['line'] or 0))
    return result


def scan(target, mode='commit', engine='native', execute=subprocess.run):
    target = Path(target).resolve(strict=True)
    if not target.is_dir() or mode not in ('commit', 'release') or engine not in ('native', 'docker'):
        raise GateError('invalid target, mode or engine')
    if mode == 'release' and (not (target / '.git').is_dir() or (target / '.git/shallow').exists()):
        raise GateError('release requires a complete Git checkout')
    if engine == 'native':
        for tool, expected in VERSIONS.items():
            try:
                version = execute([tool, 'version' if tool in ('gitleaks', 'trivy') else '--version'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=False)
                raw = version.stdout.decode('utf-8') if isinstance(version.stdout, bytes) else version.stdout
                if version.returncode != 0 or not isinstance(raw, str) or not re.search(r'(?<![0-9.])' + re.escape(expected) + r'(?![0-9.])', raw):
                    raise GateError(f'{tool}: unexpected version')
            except (OSError, subprocess.TimeoutExpired, UnicodeError):
                raise GateError(f'{tool}: version unavailable') from None
    with tempfile.TemporaryDirectory(prefix='artisys-security-') as temp:
        temp = Path(temp)
        def run(tool, arguments, output):
            command = [tool, *arguments]
            if engine == 'docker':
                command = ['docker', 'run', '--rm', '-e', 'GIT_CONFIG_COUNT=1', '-e', 'GIT_CONFIG_KEY_0=safe.directory', '-e', f'GIT_CONFIG_VALUE_0={target}', '-v', f'{target}:{target}:ro', '-v', f'{ROOT}:{ROOT}:ro', '-v', f'{temp}:{temp}', '-w', str(target), '--entrypoint', tool, IMAGES[tool], *arguments]
            try:
                result = execute(command, cwd=target, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900, check=False)
                if result.returncode != 0:
                    raise GateError(f'{tool}: execution failed (exit {result.returncode})')
                return evaluate(tool, json.loads(output.read_text()), mode)
            except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, UnicodeError):
                raise GateError(f'{tool}: unavailable, timed out, or report unreadable') from None
        summary = {}
        for scope in ('dir', 'git'):
            if scope == 'git' and not (target / '.git').exists():
                if mode == 'release':
                    raise GateError('release requires a Git checkout for history scanning')
                continue
            output = temp / f'gitleaks-{scope}.json'
            summary[f'gitleaks-{scope}'] = run('gitleaks', [scope, str(target), '--redact=100', '--exit-code=0', '--report-format=json', '--report-path', str(output), '--config', str(ROOT / 'config/gitleaks.toml')], output)
        output = temp / 'trivy.json'
        summary['trivy'] = run('trivy', ['fs', '--scanners', 'vuln,misconfig', '--include-dev-deps', '--format', 'json', '--exit-code', '0', '--output', str(output), str(target)], output)
        output = temp / 'semgrep.json'
        semgrep_args = ['scan', '--config', str(ROOT / 'config/semgrep.yml'), '--metrics=off', '--disable-version-check', '--strict', '--json', '--output', str(output)]
        for excluded in SEM_GREP_EXCLUDES:
            semgrep_args.extend(['--exclude', excluded])
        semgrep_args.append(str(target))
        summary['semgrep'] = run('semgrep', semgrep_args, output)
        return {'schemaVersion': 1, 'mode': mode, 'passed': not any(row['blocking'] for row in summary.values()), 'scanners': summary}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', nargs='?', default='.')
    parser.add_argument('--mode', choices=['commit', 'release'], default='commit')
    parser.add_argument('--engine', choices=['native', 'docker'], default='native')
    args = parser.parse_args()
    try:
        result = scan(args.target, args.mode, args.engine)
        print(json.dumps(result, indent=2))
        return 0 if result['passed'] else 1
    except (GateError, OSError):
        print(json.dumps({'passed': False, 'error': 'Security scan incomplete; check tool installation, checkout and scanner configuration.'}))
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
