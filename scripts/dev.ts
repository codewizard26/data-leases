import { spawn, type ChildProcess } from 'node:child_process';
const children: ChildProcess[] = [];
let stopping = false;
function stop() { stopping = true; for (const child of children) child.kill('SIGTERM'); }
function run(file: string, environment: Record<string,string> = {}) {
 const child=spawn(process.execPath,['--import','tsx',file],{stdio:'inherit',env:{...process.env,...environment}});
 children.push(child);child.on('error',()=>{console.error('Unable to start local service');stop();process.exitCode=1});
 child.on('exit',()=>{if(!stopping) process.exitCode=1;stop()}); return child;
}
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,stop);
run('apps/provider-agent/src/main.ts',{PORT:'4101',PROVIDER_ID:'provider-a',ASK_MINOR:'500',FLOOR_MINOR:'300'});
run('apps/provider-agent/src/main.ts',{PORT:'4102',PROVIDER_ID:'provider-b',ASK_MINOR:'700',FLOOR_MINOR:'400'});
run('apps/agent-gateway/src/main.ts');
