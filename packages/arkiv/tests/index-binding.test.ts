import {expect,test} from 'vitest';
import {stringToHex} from 'viem';
import {SdkArkivTransport} from '../src/transport.js';
import type {PublicEntity,StoredEntity} from '../src/schemas.js';
// Offline decoder test. No RPC request or blockchain write occurs.
test('every queryable correlation index is bound to its immutable body',()=>{
 const transport=new SdkArkivTransport({privateKey:('0x'+'01'.repeat(32)) as `0x${string}`,trustedPublishers:[],maxTransactionFeeWei:'1',publishingEnabled:false});
 const record:PublicEntity={schemaVersion:'1.0.0',entityType:'AnswerReceipt',publicationId:'a'.repeat(64),publisher:transport.publisher,createdAt:'2026-11-06T12:00:00.000Z',expiresAt:'2026-11-07T12:00:00.000Z',runId:'run-one',providerId:'provider-a',questionTemplateId:'ERC20_TOKEN_METADATA',metric:'ERC20_DECIMALS',unit:'decimal-places',answerHash:'b'.repeat(64),verificationId:'verification-one',status:'ACCEPTED',executionMode:'CRE_CLI_SIMULATION',methodologyVersion:'link-decimals-v1',originTrust:'UNTRUSTED_MOCK',source:{chainId:'eip155:1'},redistributionAllowed:false};
 const row:Record<string,unknown>={$key:'0x01',$owner:transport.publisher,$creationFlags:{readonly:true},body:{value:stringToHex(JSON.stringify(record))},publication_id:{value:record.publicationId},provider_id:{value:record.providerId},run_id:{value:record.runId},verification_id:{value:record.verificationId},question_template_id:{value:record.questionTemplateId},execution_mode:{value:record.executionMode},metric:{value:record.metric},status:{value:record.status},created_at:{value:BigInt(Date.parse(record.createdAt))},expires_at:{value:BigInt(Date.parse(record.expiresAt))}};
 const decoder=transport as unknown as {decode(row:Record<string,unknown>):StoredEntity};
 expect(decoder.decode(row).record).toEqual(record);
 for(const index of ['run_id','verification_id','question_template_id','execution_mode'])expect(()=>decoder.decode({...row,[index]:{value:'forged'}})).toThrow('ARKIV_INDEX_BODY_MISMATCH');
});
