import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {SERVICE_POLICIES,readPlan} from '@data-leases/cre-adapter';
const selected=process.argv.slice(2).find(arg=>!arg.startsWith('--')),root=resolve('.');
const summaryPath=resolve(root,'data/tmp/cre/service-summary.json');
type Summary={questionTemplateId:string;status:string;artifact?:string};
let summary:Summary[]=[];try{summary=JSON.parse(await readFile(summaryPath,'utf8'));}catch{/* First batch has no prior summary. */}
const services=SERVICE_POLICIES.filter(service=>(!selected||service.questionTemplateId===selected)&&(!process.argv.includes('--retry-incomplete')||(readPlan(service.questionTemplateId)&&summary.find(result=>result.questionTemplateId===service.questionTemplateId)?.status!=='ACCEPTED')));if(!services.length&&!process.argv.includes('--retry-incomplete'))throw Error('UNKNOWN_SERVICE');
async function run(command:string,args:string[]){await new Promise<void>((ok,fail)=>{const child=spawn(command,args,{cwd:root,env:{...process.env,CRE_BIN:process.env.CRE_BIN??(existsSync(resolve(homedir(),'.cre/bin/cre'))?resolve(homedir(),'.cre/bin/cre'):'cre')},stdio:['ignore','pipe','pipe']});let bytes=0;const collect=(data:Buffer)=>{bytes+=data.length;if(bytes>262144)child.kill();};child.stdout.on('data',collect);child.stderr.on('data',collect);const timer=setTimeout(()=>child.kill(),210000);child.on('error',()=>{clearTimeout(timer);fail(Error('SERVICE_SIMULATION_RUNTIME_UNAVAILABLE'));});child.on('close',code=>{clearTimeout(timer);if(code===0)ok();else fail(Error('SERVICE_SIMULATION_FAILED'));});});}
const record=(result:Summary)=>{summary=summary.filter(prior=>prior.questionTemplateId!==result.questionTemplateId);summary.push(result);};
for(const service of services){
 try{
  await run(process.execPath,['--import','tsx','scripts/prepare-services.ts',service.questionTemplateId]);
  const path=resolve(root,'data/tmp/cre/services',service.questionTemplateId+'.json');
  await run(process.env.BUN_BIN??'bun',['packages/cre-adapter/scripts/simulate.ts',path]);
  const request=JSON.parse(await readFile(path,'utf8')),key=createHash('sha256').update(request.verificationId).digest('hex'),artifact='data/tmp/cre/'+key+'.artifact.json';
  const saved=JSON.parse(await readFile(resolve(root,artifact),'utf8'));record({questionTemplateId:service.questionTemplateId,status:saved.result.status,artifact});
  console.log(service.questionTemplateId+': CRE_CLI_SIMULATION '+saved.result.status);
 }catch{record({questionTemplateId:service.questionTemplateId,status:'SIMULATION_FAILED'});console.log(service.questionTemplateId+': SIMULATION_FAILED');process.exitCode=1;}
}
await mkdir(resolve(root,'data/tmp/cre'),{recursive:true,mode:0o700});await writeFile(resolve(root,'data/tmp/cre/service-summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
