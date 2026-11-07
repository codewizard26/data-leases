import {createPublicClient,createWalletClient,ExpirationTime,ENTITY_EVENTS_ABI,type PublicArkivClient,type WalletArkivClient} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {eq,gt,gte,desc} from '@arkiv-network/sdk/query';
import {u64} from '@arkiv-network/sdk/schema';
import {http,custom,parseTransaction,decodeEventLog,keccak256,hexToString,type Hex,type Address} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {ARKIV_SCHEMAS,PublicEntitySchema,type EntityKind,type PublicEntity,type StoredEntity,type QueryFilters} from './schemas.js';
export const RABDI_CHAIN_ID=7794095;
// Confirmed from the installed official SDK1.0.1 src/consts.ts.
export const ARKIV_ENGINE='0x4400000000000000000000000000000000000044';
export type BeforeBroadcast=(raw:Hex,hash:Hex,maximumFeeWei:string)=>void;
export interface ArkivTransport {publisher:Address;create(record:PublicEntity,beforeBroadcast:BeforeBroadcast):Promise<StoredEntity>;query(kind:EntityKind,filters:QueryFilters):Promise<StoredEntity[]>;recover(record:PublicEntity,hash:Hex):Promise<StoredEntity|null>;rebroadcast(raw:Hex,beforeBroadcast:BeforeBroadcast):Promise<void>}
export class SdkArkivTransport implements ArkivTransport {
 readonly publisher:Address;
 readonly reader:PublicArkivClient;
 private writer:WalletArkivClient;
 private beforeBroadcast:BeforeBroadcast|undefined;
 private maxFee:bigint;
 constructor(options:{privateKey:Hex;accessKey?:string;trustedPublishers:Address[];maxTransactionFeeWei:string;publishingEnabled:boolean}){
  const chain=rabdi({accessKey:options.accessKey??''}),account=privateKeyToAccount(options.privateKey);this.publisher=account.address;this.trusted=new Set([...options.trustedPublishers,account.address].map(a=>a.toLowerCase()));this.maxFee=BigInt(options.maxTransactionFeeWei);this.enabled=options.publishingEnabled;
  this.reader=createPublicClient({chain,transport:http(undefined,{timeout:15000,retryCount:0})});
  const rpc=http(undefined,{timeout:15000,retryCount:0})({chain});
  this.writer=createWalletClient({chain,account,transport:custom({request:async(args)=>{
   if(args.method==='eth_sendRawTransaction'){
    if(!this.enabled||!this.beforeBroadcast)throw new Error('ARKIV_PUBLISHING_DISABLED');const raw=(args.params as Hex[])[0]!;const tx=parseTransaction(raw),cost=(tx.gas??0n)*(tx.maxFeePerGas??tx.gasPrice??0n);
    if(tx.chainId!==RABDI_CHAIN_ID||tx.to?.toLowerCase()!==ARKIV_ENGINE||tx.value&&tx.value!==0n||cost<=0n||cost>this.maxFee)throw new Error('ARKIV_TRANSACTION_POLICY_REJECTED');
    this.beforeBroadcast(raw,keccak256(raw),cost.toString());
   }
   return rpc.request(args);
  }},{retryCount:0})});
 }
 private readonly trusted:Set<string>;
 private readonly enabled:boolean;
 private decode(row:{$key:Hex;$owner:Hex;$creationFlags:{readonly:boolean};body:{value:Hex};publication_id:{value:string};provider_id:{value:string};run_id:{value:string};verification_id:{value:string};question_template_id:{value:string};execution_mode:{value:string};created_at:{value:bigint};expires_at:{value:bigint};status:{value:string};metric:{value:string}},expected?:PublicEntity):StoredEntity{
  if(!this.trusted.has(row.$owner.toLowerCase()))throw new Error('ARKIV_UNTRUSTED_PUBLISHER');
  const record=PublicEntitySchema.parse(JSON.parse(hexToString(row.body.value)));if(!row.$creationFlags.readonly||row.publication_id.value!==record.publicationId||row.provider_id.value!==record.providerId||row.run_id.value!==('runId' in record?record.runId:'')||row.verification_id.value!==('verificationId' in record?record.verificationId:'')||row.question_template_id.value!==('questionTemplateId' in record?record.questionTemplateId:'')||row.execution_mode.value!==('executionMode' in record?record.executionMode:'')||row.created_at.value!==BigInt(Date.parse(record.createdAt))||row.expires_at.value!==BigInt(Date.parse(record.expiresAt))||row.status.value!==('status' in record?record.status:record.settlementStatus)||row.metric.value!==('metric' in record?record.metric:''))throw new Error('ARKIV_INDEX_BODY_MISMATCH');if(record.publisher.toLowerCase()!==row.$owner.toLowerCase())throw new Error('ARKIV_OWNER_MISMATCH');if(expected&&record.publicationId!==expected.publicationId)throw new Error('ARKIV_RECEIPT_BINDING_MISMATCH');return {entityKey:row.$key,owner:row.$owner as Address,record};
 }
 async create(record:PublicEntity,beforeBroadcast:BeforeBroadcast){
  if(!this.enabled)throw new Error('ARKIV_PUBLISHING_DISABLED');if(record.publisher.toLowerCase()!==this.publisher.toLowerCase())throw new Error('ARKIV_OWNER_MISMATCH');if(await this.reader.getChainId()!==RABDI_CHAIN_ID)throw new Error('ARKIV_WRONG_CHAIN');
  const schema=ARKIV_SCHEMAS[record.entityType];this.beforeBroadcast=beforeBroadcast;
  try{const created=await this.writer.createEntity(schema,{publication_id:record.publicationId,provider_id:record.providerId,run_id:'runId' in record?record.runId:'',verification_id:'verificationId' in record?record.verificationId:'',question_template_id:'questionTemplateId' in record?record.questionTemplateId:'',metric:'metric' in record?record.metric:'',status:'status' in record?record.status:record.settlementStatus,execution_mode:'executionMode' in record?record.executionMode:'',created_at:u64(BigInt(Date.parse(record.createdAt))),expires_at:u64(BigInt(Date.parse(record.expiresAt))),body:new TextEncoder().encode(JSON.stringify(record))},{expiration:ExpirationTime.atDate(new Date(record.expiresAt)),flags:{readonly:true}});const read=await this.reader.getEntity(created.entityKey,schema);return {...this.decode(read,record),transactionHash:created.txHash};}finally{this.beforeBroadcast=undefined;}
 }
 async query(kind:EntityKind,filters:QueryFilters){
  const schema=ARKIV_SCHEMAS[kind],limit=filters.limit??100;if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('ARKIV_INVALID_QUERY_LIMIT');const all:StoredEntity[]=[];
  for(const owner of this.trusted){let query=this.reader.select().from(schema).ownedBy(owner as Address).where(gt('expires_at',u64(BigInt(Date.parse(filters.expiresAfter??new Date().toISOString()))))).orderBy(desc('created_at')).limit(limit);
   for(const [name,key] of [['publicationId','publication_id'],['providerId','provider_id'],['runId','run_id'],['verificationId','verification_id'],['questionTemplateId','question_template_id'],['metric','metric'],['status','status'],['executionMode','execution_mode']] as const){const value=filters[name];if(value!==undefined)query=query.where(eq(key,value));}
   if(filters.createdAfter)query=query.where(gte('created_at',u64(BigInt(Date.parse(filters.createdAfter)))));
   const page=await query.fetch();for(const row of page.entities){const decoded=this.decode(row);if(decoded.record.entityType!==kind)continue;all.push(decoded);}
  }
  return [...new Map(all.map(entity=>[entity.entityKey,entity])).values()].sort((a,b)=>b.record.createdAt.localeCompare(a.record.createdAt)||a.entityKey.localeCompare(b.entityKey)).slice(0,limit);
 }
 async recover(record:PublicEntity,hash:Hex){
  let receipt;try{receipt=await this.reader.getTransactionReceipt({hash});}catch(error){if(error instanceof Error&&error.name==='TransactionReceiptNotFoundError')return null;throw new Error('ARKIV_RECONCILIATION_UNAVAILABLE');}
  if(receipt.status!=='success')throw new Error('ARKIV_TRANSACTION_REVERTED');
  for(const log of receipt.logs){if(log.address.toLowerCase()!==ARKIV_ENGINE)continue;try{const event=decodeEventLog({abi:ENTITY_EVENTS_ABI,data:log.data,topics:log.topics});if(event.eventName!=='EntityCreated'||event.args.owner.toLowerCase()!==this.publisher.toLowerCase())continue;const row=await this.reader.getEntity(event.args.entityKey,ARKIV_SCHEMAS[record.entityType]);return {...this.decode(row,record),transactionHash:hash};}catch(error){if(error instanceof Error&&error.message.startsWith('ARKIV_'))throw error;}}
  throw new Error('ARKIV_ENTITY_RECEIPT_UNAVAILABLE');
 }
 async rebroadcast(raw:Hex,beforeBroadcast:BeforeBroadcast){this.beforeBroadcast=beforeBroadcast;try{await this.writer.sendRawTransaction({serializedTransaction:raw});}finally{this.beforeBroadcast=undefined;}}
}
