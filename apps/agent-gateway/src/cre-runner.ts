import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VerificationRequestSchema, type VerificationResult } from '@data-leases/contracts';
import { CreSimulationVerificationClient } from '@data-leases/cre-adapter';

export type CreCase = 'valid' | 'tampered' | 'inconclusive';
export interface PublicCreJob {
  jobId: string;
  case: CreCase;
  createdAt: string;
  state: 'RUNNING' | 'COMPLETED' | 'FAILED';
  result?: VerificationResult;
  error?: string;
  request?: { verificationId: string; runId: string; providerId: string; blockNumber?: string; blockHash?: string; claimedValue: string };
}
export interface CreRunner {
  start(input: CreCase): { jobId: string; state: 'RUNNING' };
  get(jobId: string): PublicCreJob | null;
}
export interface CreProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}
export type CreProcessRunner = (spec: CreProcessSpec) => Promise<{ exitCode: number | null; output: string }>;
interface CreRunnerOptions {
  rootDirectory?: string;
  runProcess?: CreProcessRunner;
  historyLimit?: number;
  bunBinary?: string;
  creBinary?: string;
}

/** Spawn a bounded process group; never interpolate a shell command or expose diagnostics. */
export const runCreProcess: CreProcessRunner = spec => new Promise((resolveResult, reject) => {
  const grouped = process.platform !== 'win32';
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'], detached: grouped, shell: false });
  const chunks: Buffer[] = [];
  let size = 0;
  let failure: string | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signal = (name: NodeJS.Signals) => {
    try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Already reaped. */ }
  };
  const stop = (reason: string) => {
    if (failure) return;
    failure = reason;
    signal('SIGTERM');
    killTimer = setTimeout(() => signal('SIGKILL'), 1000);
  };
  const timeout = setTimeout(() => stop('CRE_TIMEOUT'), spec.timeoutMs);
  const collect = (chunk: Buffer) => {
    if (failure) return;
    size += chunk.byteLength;
    if (size > spec.maxOutputBytes) { stop('CRE_OUTPUT_LIMIT'); return; }
    chunks.push(chunk);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('error', () => {
    clearTimeout(timeout); if (killTimer) clearTimeout(killTimer);
    reject(new Error('CRE_RUNTIME_UNAVAILABLE'));
  });
  child.once('close', code => {
    clearTimeout(timeout); if (killTimer) clearTimeout(killTimer);
    if (failure) reject(new Error(failure));
    else resolveResult({ exitCode: code, output: Buffer.concat(chunks).toString('utf8') });
  });
});

async function boundedFile(path: string, maximum: number): Promise<string> {
  if ((await stat(path)).size > maximum) throw new Error('CRE_ARTIFACT_INVALID');
  const value = await readFile(path);
  if (value.byteLength > maximum) throw new Error('CRE_ARTIFACT_INVALID');
  return value.toString('utf8');
}
function safeFailure(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/CRE_AUTHENTICATION_REQUIRED|Authentication required|not logged in/.test(message)) return 'CRE_AUTHENTICATION_REQUIRED';
  if (/CRE_CLI_NOT_INSTALLED|CRE_CLI_START_FAILED/.test(message)) return 'CRE_CLI_UNAVAILABLE';
  if (['CRE_CLI_UNAVAILABLE', 'CRE_RUNTIME_UNAVAILABLE', 'CRE_TIMEOUT', 'CRE_OUTPUT_LIMIT', 'CRE_ARTIFACT_INVALID'].includes(message)) return message;
  return fallback;
}

export function createCreRunner(options: CreRunnerOptions = {}): CreRunner {
  const root = resolve(options.rootDirectory ?? fileURLToPath(new URL('../../../', import.meta.url)));
  const output = resolve(root, 'data/tmp/cre');
  const homeCre = resolve(homedir(), '.cre/bin/cre');
  const cre = options.creBinary ?? process.env.CRE_BIN ?? (existsSync(homeCre) ? homeCre : 'cre');
  const bun = options.bunBinary ?? process.env.BUN_BIN ?? (existsSync('/opt/homebrew/bin/bun') ? '/opt/homebrew/bin/bun' : 'bun');
  const executeProcess = options.runProcess ?? runCreProcess;
  const limit = options.historyLimit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('CRE_INVALID_HISTORY_LIMIT');
  const jobs = new Map<string, PublicCreJob>();
  let busy = false;
  async function run(job: PublicCreJob): Promise<void> {
    let failureCode = 'CRE_PREPARATION_FAILED';
    const environment = { ...process.env, CRE_BIN: cre };
    const invoke = async (args: string[], timeoutMs: number) => {
      const result = await executeProcess({ command: bun, args, cwd: root, env: environment, timeoutMs, maxOutputBytes: 262144 });
      if (result.exitCode !== 0) throw new Error(safeFailure(new Error(result.output), failureCode));
    };
    try {
      await invoke([resolve(root, 'packages/cre-adapter/scripts/prepare.ts')], 30000);
      const requestPath = resolve(output, job.case === 'valid' ? 'request.json' : `${job.case}.json`);
      const request = VerificationRequestSchema.parse(JSON.parse(await boundedFile(requestPath, 32768)));
      job.request = { verificationId: request.verificationId, runId: request.runId, providerId: request.providerId, blockNumber: request.answer.sourceBlockNumber, blockHash: request.answer.sourceBlockHash, claimedValue: request.answer.value };
      failureCode = 'CRE_SIMULATION_FAILED';
      await invoke([resolve(root, 'packages/cre-adapter/scripts/simulate.ts'), requestPath], 210000);
      failureCode = 'CRE_ARTIFACT_INVALID';
      const basename = createHash('sha256').update(request.verificationId).digest('hex');
      const artifact = JSON.parse(await boundedFile(resolve(output, `${basename}.artifact.json`), 1048576));
      const transcript = await boundedFile(resolve(output, `${basename}.log`), 262144);
      const client = new CreSimulationVerificationClient();
      await client.submit(request);
      client.importArtifact(artifact, transcript);
      const result = await client.getResult(request.verificationId);
      if (!result) throw new Error('CRE_ARTIFACT_INVALID');
      // Artifact paths and raw simulator output never cross the browser boundary.
      const publicResult = structuredClone(result);
      delete publicResult.rawArtifactRef;
      delete publicResult.reportSignature;
      job.result = publicResult;
      job.state = 'COMPLETED';
    } catch (error) {
      job.error = safeFailure(error, failureCode);
      job.state = 'FAILED';
    } finally { busy = false; }
  }
  return {
    start(input) {
      if (!['valid', 'tampered', 'inconclusive'].includes(input)) throw new Error('CRE_INVALID_CASE');
      if (busy) throw new Error('CRE_BUSY');
      busy = true;
      while (jobs.size >= limit) jobs.delete(jobs.keys().next().value!);
      const job: PublicCreJob = { jobId: randomUUID(), case: input, createdAt: new Date().toISOString(), state: 'RUNNING' };
      jobs.set(job.jobId, job);
      void run(job);
      return { jobId: job.jobId, state: 'RUNNING' };
    },
    get(jobId) { const job = jobs.get(jobId); return job ? structuredClone(job) : null; },
  };
}
