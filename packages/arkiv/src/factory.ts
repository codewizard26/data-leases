import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DurableCreVerificationClient} from '@data-leases/cre-adapter';
import type {VerificationClient,VerificationRequest} from '@data-leases/contracts';
import {privateKeyToAccount} from 'viem/accounts';
import type {Address,Hex} from 'viem';
import {SdkArkivTransport} from './transport.js';
import {PublicationJournal} from './journal.js';
import {ArkivEvidenceClient} from './client.js';

export class PublishingVerificationClient implements VerificationClient {
 constructor(private readonly inner:VerificationClient,private readonly publisher:ArkivEvidenceClient,private readonly onQueued?:(verificationId:string,state:'PENDING_PUBLICATION'|'PUBLICATION_QUEUE_FAILED')=>void){}
 submit(input:VerificationRequest){return this.inner.submit(input);}
 async getResult(id:string){const result=await this.inner.getResult(id);if(result){try{await this.publisher.queueCompletedVerification(id);this.onQueued?.(id,'PENDING_PUBLICATION');}catch{this.onQueued?.(id,'PUBLICATION_QUEUE_FAILED');}}return result;}
}
export function createEvidenceLayerFromEnv(environment:NodeJS.ProcessEnv=process.env){
 const root=fileURLToPath(new URL('../../../',import.meta.url));const keyName=environment.ARKIV_PRIVATE_KEY_ENV??'ARKIV_PRIVATE_KEY';if(!/^[A-Z_][A-Z0-9_]*$/.test(keyName))throw new Error('ARKIV_KEY_VARIABLE_INVALID');const key=environment[keyName];if(!key||!/^(0x)?[a-f0-9]{64}$/i.test(key))throw new Error('ARKIV_PUBLISHER_KEY_NOT_CONFIGURED');const secret=(key.startsWith('0x')?key:'0x'+key) as Hex;
 const account=privateKeyToAccount(secret);if(environment.ARKIV_PUBLISHER_ADDRESS&&environment.ARKIV_PUBLISHER_ADDRESS.toLowerCase()!==account.address.toLowerCase())throw new Error('ARKIV_PUBLISHER_ADDRESS_MISMATCH');
 const trusted=(environment.ARKIV_TRUSTED_PUBLISHERS??account.address).split(',').map(value=>value.trim());if(trusted.some(value=>!/^0x[\da-f]{40}$/i.test(value)))throw new Error('ARKIV_PUBLISHER_ALLOWLIST_INVALID');
 const maximum=environment.ARKIV_MAX_TRANSACTION_FEE_WEI??'100000000000000000',total=environment.ARKIV_MAX_TOTAL_FEE_WEI??'500000000000000000';if(!/^[1-9][0-9]*$/.test(maximum)||!/^[1-9][0-9]*$/.test(total)||BigInt(maximum)>BigInt(total))throw new Error('ARKIV_FEE_POLICY_INVALID');
 const rawVerification=new DurableCreVerificationClient({directory:environment.CRE_VERIFICATION_DIRECTORY??resolve(root,'data/tmp/verification'),rootDirectory:root});
 const transport=new SdkArkivTransport({privateKey:secret,accessKey:environment.ARKIV_ACCESS_KEY,trustedPublishers:trusted as Address[],maxTransactionFeeWei:maximum,publishingEnabled:environment.ARKIV_PUBLISHING_ENABLED==='true'});
 const journal=new PublicationJournal(environment.ARKIV_JOURNAL_PATH??resolve(root,'data/tmp/arkiv/publications.sqlite'));
 const arkiv=new ArkivEvidenceClient({transport,journal,verification:rawVerification,maximumTotalFeeWei:total});
 let timer:ReturnType<typeof setTimeout>|undefined,closed=false;let active:Promise<unknown>|undefined;
 const work=async()=>{if(closed)return;active=arkiv.retryPending();try{await active;}finally{active=undefined;if(!closed){timer=setTimeout(()=>void work(),30000);timer.unref();}}};
 return {arkiv,verification:new PublishingVerificationClient(rawVerification,arkiv),rawVerification,transport,start(){if(environment.ARKIV_PUBLISHING_ENABLED==='true'&&!timer&&!active)void work();},async close(){closed=true;if(timer)clearTimeout(timer);await active;await rawVerification.close();await arkiv.close();}};
}
