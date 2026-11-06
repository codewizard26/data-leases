import { spawn, type ChildProcess } from 'node:child_process';
const children: ChildProcess[] = [];
function run(file: string, environment: Record<string,string> = {}) {
 const child = spawn(process.execPath, ['--import', 'tsx', file], { stdio: 'inherit', env: { ...process.env, ...environment } });
 children.push(child); return child;
}
function stop() { for (const child of children) child.kill('SIGTERM'); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop);
try {
 run('apps/provider-agent/src/main.ts', { PORT: '4101', PROVIDER_ID: 'provider-a', ASK_MINOR: '500', FLOOR_MINOR: '300' });
 run('apps/provider-agent/src/main.ts', { PORT: '4102', PROVIDER_ID: 'provider-b', ASK_MINOR: '700', FLOOR_MINOR: '400' });
 for (const port of [4101, 4102]) {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
   try { const response = await fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(200) }); if (response.ok) { ready = true; break; } } catch { /* Wait for the child process to bind. */ }
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Provider on port ${port} did not start`);
 }
 const buyer = run('apps/agent-gateway/src/buyer.ts');
 const code = await new Promise<number | null>((resolve, reject) => { buyer.once('exit', resolve); buyer.once('error', reject); });
 if (code !== 0) process.exitCode = 1;
} finally { stop(); }
