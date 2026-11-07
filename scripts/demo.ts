import { spawn, type ChildProcess } from 'node:child_process';
const children: ChildProcess[] = [];
function run(file: string, environment: Record<string,string> = {}, captureOutput = false) {
 const child = spawn(process.execPath, ['--import', 'tsx', file], { stdio: captureOutput ? ['inherit', 'pipe', 'inherit'] : 'inherit', env: { ...process.env, ...environment } });
 children.push(child); return child;
}
function stop() { for (const child of children) child.kill('SIGTERM'); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop);
/** Read the listening address from this child, so unrelated local services cannot satisfy readiness. */
function providerOrigin(child: ChildProcess): Promise<string> {
 return new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => finish(new Error('Provider startup timed out')), 10_000);
  const onError = (error: Error) => finish(error);
  const onExit = (code: number | null) => finish(new Error(`Provider exited before readiness: ${code}`));
  function finish(error?: Error, origin?: string) {
   clearTimeout(timer); child.off('error', onError); child.off('exit', onExit);
   if (error) reject(error); else resolve(origin!);
  }
  child.once('error', onError); child.once('exit', onExit);
  child.stdout!.on('data', (chunk: Buffer) => {
   process.stdout.write(chunk);
   output += chunk.toString('utf8');
   const match = /provider ready: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
   if (match) finish(undefined, match[1]);
   // Startup diagnostics must not create an unbounded buffer.
   if (output.length > 8192) output = output.slice(-4096);
  });
 });
}
try {
 const dynamicPorts = process.env.DEMO_DYNAMIC_PORTS === 'true';
 const first = run('apps/provider-agent/src/main.ts', { PORT: dynamicPorts ? '0' : '4101', PROVIDER_ID: 'provider-a', ASK_MINOR: '500', FLOOR_MINOR: '300' }, true);
 const firstOrigin = providerOrigin(first);
 const second = run('apps/provider-agent/src/main.ts', { PORT: dynamicPorts ? '0' : '4102', PROVIDER_ID: 'provider-b', ASK_MINOR: '700', FLOOR_MINOR: '400' }, true);
 const origins = await Promise.all([firstOrigin, providerOrigin(second)]);
 const buyer = run('apps/agent-gateway/src/buyer.ts', {DEMO_PROVIDER_ORIGINS: JSON.stringify(origins)});
 const code = await new Promise<number | null>((resolve, reject) => { buyer.once('exit', resolve); buyer.once('error', reject); });
 if (code !== 0) process.exitCode = 1;
} finally { stop(); }
