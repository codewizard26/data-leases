import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createCreRunner, runCreProcess, type CreCase, type CreProcessSpec, type PublicCreJob } from '../../apps/agent-gateway/src/cre-runner.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true,force:true}))); });
async function fixture(name: CreCase) {
 const file = name === 'valid' ? 'accepted' : name === 'tampered' ? 'rejected' : 'inconclusive';
 return {artifact:JSON.parse(await readFile(new URL(`../cre/evidence/${file}.artifact.json`,import.meta.url),'utf8')),log:await readFile(new URL(`../cre/evidence/${file}.log`,import.meta.url),'utf8')};
}
async function setup(change?: (value: Awaited<ReturnType<typeof fixture>>) => void) {
 const root = await mkdtemp(resolve(tmpdir(),'cre-runner-'));roots.push(root);
 const output=resolve(root,'data/tmp/cre');await mkdir(output,{recursive:true});
 const calls:CreProcessSpec[]=[];
 const runProcess=async (spec:CreProcessSpec) => {
  calls.push(spec);
  if(spec.args[0]?.endsWith('prepare.ts')) {
   for(const name of ['valid','tampered','inconclusive'] as const){const {artifact}=await fixture(name);await writeFile(resolve(output,name==='valid'?'request.json':`${name}.json`),JSON.stringify(artifact.request));}
  }else{
   const request=JSON.parse(await readFile(spec.args[1]!,'utf8'));
   const name:CreCase=request.answer.value==='19'?'tampered':/^0x0+$/.test(request.answer.sourceBlockHash)?'inconclusive':'valid';
   const data=await fixture(name);change?.(data);
   const hash=createHash('sha256').update(request.verificationId).digest('hex');
   await writeFile(resolve(output,`${hash}.log`),data.log);await writeFile(resolve(output,`${hash}.artifact.json`),JSON.stringify(data.artifact));
  }
  return {exitCode:0,output:'safe completion'};
 };
 return {root,calls,runProcess};
}
async function completed(runner:ReturnType<typeof createCreRunner>,id:string):Promise<PublicCreJob>{
 for(let attempt=0;attempt<200;attempt++){const job=runner.get(id)!;if(job.state!=='RUNNING')return job;await new Promise(resolve=>setTimeout(resolve,5));}
 throw new Error('job did not complete');
}
for(const name of ['valid','tampered','inconclusive'] as const)test(`imports verified ${name} artifact without executing CRE`,async()=>{
 const context=await setup();const runner=createCreRunner({rootDirectory:context.root,runProcess:context.runProcess});
 const started=runner.start(name);expect(started.state).toBe('RUNNING');
 const job=await completed(runner,started.jobId);
 expect(job.state).toBe('COMPLETED');expect(job.result?.executionMode).toBe('CRE_CLI_SIMULATION');
 expect(job.result?.status).toBe(name==='valid'?'ACCEPTED':name==='tampered'?'REJECTED':'INCONCLUSIVE');
 expect(job.request?.verificationId).toBe(job.result?.verificationId);
 expect(context.calls.map(call=>call.timeoutMs)).toEqual([30000,210000]);
 expect(JSON.stringify(job)).not.toContain(context.root);expect(JSON.stringify(job)).not.toContain('CLI_EXIT_CODE');
});
test('one in-flight job and bounded completed history',async()=>{
 const context=await setup();const runner=createCreRunner({rootDirectory:context.root,runProcess:context.runProcess,historyLimit:2});
 const first=runner.start('valid');expect(()=>runner.start('tampered')).toThrow('CRE_BUSY');await completed(runner,first.jobId);
 const second=runner.start('valid');await completed(runner,second.jobId);const third=runner.start('valid');await completed(runner,third.jobId);
 expect(runner.get(first.jobId)).toBeNull();expect(runner.get('missing')).toBeNull();
 const result=runner.get(third.jobId)!;result.state='FAILED';expect(runner.get(third.jobId)?.state).toBe('COMPLETED');
});
test('tampered artifacts cannot produce a public completion',async()=>{
 const context=await setup(data=>{data.artifact.result.status='REJECTED';});
 const runner=createCreRunner({rootDirectory:context.root,runProcess:context.runProcess});
 const job=await completed(runner,runner.start('valid').jobId);
 expect(job.state).toBe('FAILED');expect(job.error).toBe('CRE_ARTIFACT_INVALID');expect(job.result).toBeUndefined();
});
test('authentication and unavailable CLI errors are sanitized',async()=>{
 for(const [output,error] of [['CRE_AUTHENTICATION_REQUIRED secret-token /private/secrets','CRE_AUTHENTICATION_REQUIRED'],['CRE_CLI_NOT_INSTALLED secret-token','CRE_CLI_UNAVAILABLE']] as const){
  const context=await setup();const runner=createCreRunner({rootDirectory:context.root,runProcess:async spec=>spec.args[0]?.endsWith('prepare.ts')?context.runProcess(spec):{exitCode:1,output}});
  const job=await completed(runner,runner.start('valid').jobId);expect(job.error).toBe(error);expect(JSON.stringify(job)).not.toContain('secret-token');
 }
});
test('unknown cases are rejected without process execution',()=>{
 const runner=createCreRunner({runProcess:async()=>{throw new Error('must not execute');}});
 expect(()=>runner.start('other' as CreCase)).toThrow('CRE_INVALID_CASE');
});
test('process boundary caps combined output and enforces timeout',async()=>{
 const base={command:process.execPath,cwd:process.cwd(),env:process.env,maxOutputBytes:32,timeoutMs:2000};
 await expect(runCreProcess({...base,args:['-e',"process.stdout.write('x'.repeat(10000))"]})).rejects.toThrow('CRE_OUTPUT_LIMIT');
 await expect(runCreProcess({...base,args:['-e','setInterval(()=>{},1000)'],timeoutMs:20})).rejects.toThrow('CRE_TIMEOUT');
});
