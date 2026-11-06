import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {VerificationRequestSchema,type VerificationClient,type VerificationRequest} from '@data-leases/contracts';
import {CreSimulationVerificationClient,requestDigest} from '@data-leases/cre-adapter';
import {runCreProcess,type CreProcessRunner} from './cre-runner.js';
/** Gateway bridge to Developer 2's existing CLI adapter. No workflow or CRE SDK implementation. */
export class RunVerificationClient implements VerificationClient {
 private client=new CreSimulationVerificationClient();
 private active=new Map<string,Promise<void>>();
 private chain:Promise<void>=Promise.resolve();
 private root:string;
 constructor(private readonly options:{rootDirectory?:string;runProcess?:CreProcessRunner}={}){this.root=resolve(options.rootDirectory??fileURLToPath(new URL('../../../',import.meta.url)));}
 private key(id:string){return createHash('sha256').update(id).digest('hex');}
 private requestPath(id:string){return resolve(this.root,'data/tmp/cre/run-requests',this.key(id)+'.json');}
 async submit(input:VerificationRequest){const request=VerificationRequestSchema.parse(input);await this.client.submit(request);const path=this.requestPath(request.verificationId);await mkdir(resolve(this.root,'data/tmp/cre/run-requests'),{recursive:true,mode:0o700});
  if(existsSync(path)){const prior=VerificationRequestSchema.parse(JSON.parse(await readFile(path,'utf8')));if(requestDigest(prior)!==requestDigest(request))throw new Error('VERIFICATION_ID_CONFLICT');}else await writeFile(path,JSON.stringify(request),{mode:0o600,flag:'wx'});
  if(!this.active.has(request.verificationId)){const task=this.chain.catch(()=>{}).then(()=>this.execute(request,path));this.chain=task;this.active.set(request.verificationId,task);void task.catch(()=>{}).finally(()=>this.active.delete(request.verificationId));}
  return {verificationId:request.verificationId,state:'PENDING' as const};
 }
 private async execute(request:VerificationRequest,path:string){const homeCre=resolve(homedir(),'.cre/bin/cre');const result=await (this.options.runProcess??runCreProcess)({command:process.env.BUN_BIN??(existsSync('/opt/homebrew/bin/bun')?'/opt/homebrew/bin/bun':'bun'),args:[resolve(this.root,'packages/cre-adapter/scripts/simulate.ts'),path],cwd:this.root,env:{...process.env,CRE_BIN:process.env.CRE_BIN??(existsSync(homeCre)?homeCre:'cre')},timeoutMs:210000,maxOutputBytes:262144});if(result.exitCode!==0)throw new Error('CRE_RUN_FAILED');await this.importResult(request);}
 private async importResult(request:VerificationRequest){const basename=resolve(this.root,'data/tmp/cre',this.key(request.verificationId));const artifact=JSON.parse(await readFile(basename+'.artifact.json','utf8'));const transcript=await readFile(basename+'.log','utf8');await this.client.submit(request);this.client.importArtifact(artifact,transcript);}
 async getResult(id:string){let result=await this.client.getResult(id);if(result)return result;try{const request=VerificationRequestSchema.parse(JSON.parse(await readFile(this.requestPath(id),'utf8')));await this.importResult(request);result=await this.client.getResult(id);}catch{/* No matching completed artifact yet. Never upgrade unavailable evidence to verified. */}return result;}
 async close(){await this.chain.catch(()=>{});}
}
