import { spawn, type ChildProcess } from 'node:child_process';
import {PROVIDER_PROFILES,providerPrefix} from '../packages/agents/src/provider-profiles.js';
const children: ChildProcess[] = [];
let stopping = false;
function stop() { stopping = true; for (const child of children) child.kill('SIGTERM'); }
function run(file: string, environment: Record<string,string> = {}) {
 const child=spawn(process.execPath,['--import','tsx',file],{stdio:'inherit',env:{...process.env,...environment}});
 children.push(child);child.on('error',()=>{console.error('Unable to start local service');stop();process.exitCode=1});
 child.on('exit',()=>{if(!stopping) process.exitCode=1;stop()}); return child;
}
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,stop);
for(const profile of PROVIDER_PROFILES)run('apps/provider-agent/src/main.ts',{PORT:process.env[providerPrefix(profile.providerId)+'_PORT']??String(profile.port),PROVIDER_ID:profile.providerId,ASK_MINOR:process.env[providerPrefix(profile.providerId)+'_ASK_MINOR']??profile.askMinor,FLOOR_MINOR:process.env[providerPrefix(profile.providerId)+'_FLOOR_MINOR']??profile.floorMinor});
run('apps/agent-gateway/src/main.ts');

const web=spawn('pnpm',['--filter','@data-leases/web','dev'],{stdio:'inherit',env:process.env});children.push(web);web.on('error',stop);web.on('exit',()=>{if(!stopping)process.exitCode=1;stop();});
