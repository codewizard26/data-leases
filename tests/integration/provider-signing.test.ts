import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createPublicKey,verify} from 'node:crypto';
import {negotiate,startProvider,type NegotiationStrategy} from '../../packages/agents/src/index.js';
import {VerificationRequestSchema} from '@data-leases/contracts';
import {answerSigningBytes} from '@data-leases/cre-adapter';
import {loadAnswerSigner} from '../../apps/provider-agent/src/provider-signing.js';
const answer=VerificationRequestSchema.parse(JSON.parse(readFileSync(new URL('../cre/fixtures/request.json',import.meta.url),'utf8'))).answer;
test('live LINK delivery reads its source before signing even with unpaid currency',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'live-source-'));
 const signer=loadAnswerSigner('live-source',directory);
 const strategy:NegotiationStrategy={
  async buyer(input){return {action:'ACCEPT',priceMinor:input.quoteMinor,reason:'Fixture buyer accepts.',provider:'OPENROUTER',model:'test-fixture'};},
  async seller(input){return {action:'PROPOSE',priceMinor:input.askMinor,reason:'Fixture seller quotes.',provider:'OPENROUTER',model:'test-fixture'};},
 };
 let sourceReads=0;
 const provider=await startProvider({port:0,providerId:'live-source',askMinor:'10',floorMinor:'1',liveOnly:true,strategy,signAnswer:signer.sign,async answerSource(){sourceReads++;return {value:'27',sourceBlockNumber:'123',sourceBlockHash:'0x'+'ab'.repeat(32),evidenceRefs:['https://example.com/test-source']};}});
 try{
  const result=await negotiate({baseUrl:provider.baseUrl,providerId:'live-source',maxPriceMinor:'100',questionTemplateId:'ERC20_TOKEN_METADATA',mode:'LIVE',strategy});
  expect(result.status).toBe('AGREED');expect(sourceReads).toBe(1);
  expect(result.answer).toMatchObject({value:'27',sourceBlockNumber:'123',demoTrustMode:'SIGNED_PROVIDER',evidenceRefs:['https://example.com/test-source']});
  const delivered=result.answer!;
  const publicKey=createPublicKey({key:Buffer.from('302a300506032b6570032100'+signer.publicKey,'hex'),format:'der',type:'spki'});
  expect(verify(null,answerSigningBytes(delivered),publicKey,Buffer.from(delivered.providerSignature!.slice(8),'hex'))).toBe(true);
 }finally{await provider.close();rmSync(directory,{recursive:true,force:true});}
});
test('live provider identity persists and binds every answer field without reusing a wallet key',()=>{const directory=mkdtempSync(join(tmpdir(),'provider-signing-'));try{const signer=loadAnswerSigner(answer.providerId,directory),signed={...answer,demoTrustMode:'SIGNED_PROVIDER' as const};const signature=signer.sign(signed);expect(signature).toMatch(/^ed25519:[a-f0-9]{128}$/);expect(verify(null,answerSigningBytes(signed),createPublicKey({key:Buffer.from('302a300506032b6570032100'+signer.publicKey,'hex'),format:'der',type:'spki'}),Buffer.from(signature.slice(8),'hex'))).toBe(true);expect(verify(null,answerSigningBytes({...signed,value:'19'}),createPublicKey({key:Buffer.from('302a300506032b6570032100'+signer.publicKey,'hex'),format:'der',type:'spki'}),Buffer.from(signature.slice(8),'hex'))).toBe(false);expect(loadAnswerSigner(answer.providerId,directory).publicKey).toBe(signer.publicKey);expect(()=>signer.sign({...signed,providerId:'another-provider'})).toThrow('PROVIDER_SIGNING_BINDING_MISMATCH');}finally{rmSync(directory,{recursive:true,force:true});}});
