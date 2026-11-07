import {generateKeyPairSync,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {answerSigningBytes} from '@data-leases/cre-adapter';
import type {AnswerEnvelope} from '@data-leases/contracts';
/** Independent local provider identity; never reuse a payment wallet signing key. */
export function loadAnswerSigner(providerId:string,directory=resolve('data/tmp/provider-keys')){
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(providerId))throw new Error('INVALID_PROVIDER_ID');
 mkdirSync(directory,{recursive:true,mode:0o700});const path=resolve(directory,providerId+'.pem');
 if(!existsSync(path)){const pair=generateKeyPairSync('ed25519');writeFileSync(path,pair.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});}
 const key=createPrivateKey(readFileSync(path));if(key.asymmetricKeyType!=='ed25519')throw new Error('INVALID_PROVIDER_SIGNING_KEY');
 const publicKey=createPublicKey(key).export({type:'spki',format:'der'}).subarray(-32).toString('hex');
 writeFileSync(resolve(directory,providerId+'.public.json'),JSON.stringify({providerId,scheme:'ed25519',publicKey},null,2)+'\n',{mode:0o600});
 return {publicKey,sign(answer:AnswerEnvelope){if(answer.providerId!==providerId||answer.demoTrustMode!=='SIGNED_PROVIDER')throw new Error('PROVIDER_SIGNING_BINDING_MISMATCH');return 'ed25519:'+sign(null,answerSigningBytes(answer),key).toString('hex');}};
}
