import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_RELEASE_PROOF_CHECKS,
  buildReleaseProofArtifact,
} from '../shared/learningReleaseProof';

interface VitestJsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  testResults?: Array<{
    name?: string;
    status?: string;
    assertionResults?: Array<{
      fullName?: string;
      status?: string;
    }>;
  }>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workerRoot = resolve(repoRoot, 'workers', 'api');

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalized(path: string): string {
  return path.replaceAll('\\', '/');
}

async function main(): Promise<void> {
  const configuredOutput = option('--output-dir')
    ?? process.env.SOCIALAI_RELEASE_EVIDENCE_DIR?.trim()
    ?? (process.platform === 'win32'
      ? 'D:\\GitHubBackup\\SocialAi\\release-evidence'
      : null);
  if (!configuredOutput) {
    throw new Error('Set --output-dir or SOCIALAI_RELEASE_EVIDENCE_DIR; no C-drive fallback is allowed.');
  }

  const outputDir = resolve(configuredOutput);
  mkdirSync(outputDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const stem = `learning-release-proof-${generatedAt.replaceAll(':', '-').replaceAll('.', '-')}`;
  const rawReportPath = resolve(outputDir, `${stem}-vitest.json`);
  const artifactPath = resolve(outputDir, `${stem}.json`);
  const hashPath = resolve(outputDir, `${stem}.sha256`);
  const suites = [...new Set(REQUIRED_RELEASE_PROOF_CHECKS.map((check) => check.suite))];
  const vitestCli = resolve(workerRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const args = [
    vitestCli,
    'run',
    ...suites,
    '--reporter=json',
    `--outputFile=${rawReportPath}`,
  ];

  const testRun = spawnSync(process.execPath, args, {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitCode = testRun.status ?? 1;
  const report: VitestJsonReport = existsSync(rawReportPath)
    ? JSON.parse(readFileSync(rawReportPath, 'utf8')) as VitestJsonReport
    : {};
  const reportSha256 = existsSync(rawReportPath) ? sha256File(rawReportPath) : null;

  const checks = REQUIRED_RELEASE_PROOF_CHECKS.map((check) => ({
    ...check,
    passed: (report.testResults ?? []).some((result) => (
      normalized(result.name ?? '').endsWith(check.suite)
      && result.status === 'passed'
      && (result.assertionResults ?? []).some((assertion) => (
        assertion.fullName === check.assertion && assertion.status === 'passed'
      ))
    )),
  }));

  const artifact = await buildReleaseProofArtifact({
    generatedAt,
    git: {
      commit: runGit(['rev-parse', 'HEAD']),
      branch: runGit(['branch', '--show-current']),
      clean: runGit(['status', '--porcelain']).length === 0,
    },
    checks,
    command: {
      executable: process.execPath,
      args,
      exitCode,
      reportSha256,
      summary: {
        totalTests: report.numTotalTests ?? 0,
        passedTests: report.numPassedTests ?? 0,
        failedTests: report.numFailedTests ?? 0,
      },
    },
  });

  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  writeFileSync(hashPath, `${artifact.artifactSha256}  ${artifactPath}\n`, 'utf8');

  process.stdout.write([
    `Release proof: ${artifact.payload.result}`,
    `Artifact: ${artifactPath}`,
    `SHA-256: ${artifact.artifactSha256}`,
    `Raw Vitest report: ${rawReportPath}`,
    'Live staging proven: false',
    'Authenticated evidence submitted: false',
  ].join('\n') + '\n');

  if (artifact.payload.result !== 'offline_pass') {
    if (testRun.stdout.trim()) process.stderr.write(`${testRun.stdout.trim()}\n`);
    if (testRun.stderr.trim()) process.stderr.write(`${testRun.stderr.trim()}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
