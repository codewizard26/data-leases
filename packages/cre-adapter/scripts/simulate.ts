import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { VerificationRequestSchema, VerificationResultSchema } from '@data-leases/contracts';
import { CreSimulationVerificationClient, requestDigest } from '../src/index.js';
import { readSimulationOutput } from '../src/transcript.js';

const root = resolve(import.meta.dirname, '../../..');
const requestPath = resolve(root, process.argv[2] ?? 'data/tmp/cre/request.json');
const request = VerificationRequestSchema.parse(JSON.parse(await readFile(requestPath, 'utf8')));
const cli = process.env.CRE_BIN ?? 'cre';
const version = await new Promise<string>((ok, fail) => {
  const child = spawn(cli, ['version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', d => { text += d.toString(); });
  child.on('error', () => fail(new Error('CRE_CLI_NOT_INSTALLED')));
  child.on('close', code => code === 0 ? ok(text) : fail(new Error('CRE_VERSION_FAILED')));
});
if (!version.includes('v1.39.0')) throw new Error('EXPECTED_CRE_CLI_1_39_0');
const capture = await new Promise<{ code: number | null; text: string }>((ok, fail) => {
  const child = spawn(cli, ['workflow', 'simulate', 'verify-answer', '--target', 'local-simulation',
    '--non-interactive', '--trigger-index', '0', '--http-payload', requestPath],
  { cwd: resolve(root, 'workflows/cre'), stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
  const collect = (chunk: Uint8Array) => {
    text += chunk.toString();
    if (text.length > 2_000_000) child.kill('SIGTERM');
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  child.on('error', () => { clearTimeout(timer); fail(new Error('CRE_CLI_START_FAILED')); });
  child.on('close', code => { clearTimeout(timer); ok({ code, text }); });
});
const output = resolve(root, 'data/tmp/cre');
await mkdir(output, { recursive: true, mode: 0o700 });
if (capture.code !== 0) {
  // Deliberately avoid persisting arbitrary SDK diagnostics, which may contain secret RPC URLs.
  const reason = /not logged in|Authentication required|no credentials/.test(capture.text) ? 'CRE_AUTHENTICATION_REQUIRED' : 'CRE_SIMULATION_FAILED';
  await writeFile(resolve(output, 'last-failure.txt'), `${version.trim()}\n${reason}\nexit=${capture.code}\n`, { mode: 0o600 });
  throw new Error(`${reason}: see data/tmp/cre/last-failure.txt`);
}
const plain = stripVTControlCharacters(capture.text);
const returned = readSimulationOutput(plain);
const result = VerificationResultSchema.parse(returned.result);
if (returned.requestSha256 !== requestDigest(request)) throw new Error('MISSING_CLI_REQUEST_EVIDENCE');
const transcript = `${version.trim()}\nCLI_EXIT_CODE:0\nDATA_LEASES_REQUEST_SHA256:${requestDigest(request)}\nDATA_LEASES_RESULT:${JSON.stringify(result)}\nCLI_RETURNED_RESULT:${JSON.stringify(result)}\nExecution finished signal received\n`;
const artifact = { request, requestSha256: requestDigest(request), result,
  transcriptSha256: createHash('sha256').update(transcript).digest('hex') };
const client = new CreSimulationVerificationClient();
await client.submit(request); client.importArtifact(artifact, transcript);
await writeFile(resolve(output, `${request.verificationId}.log`), transcript, { mode: 0o600 });
await writeFile(resolve(output, `${request.verificationId}.artifact.json`), JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
console.log(`CRE_CLI_SIMULATION ${result.status}; sanitized artifacts in data/tmp/cre`);
