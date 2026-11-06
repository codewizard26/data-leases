import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {HTTPFacilitatorClient, type FacilitatorClient} from '@x402/core/server';
import type {PaymentRequired,PaymentRequirements,PaymentPayload,SettleResponse} from '@x402/core/types';
import {encodePaymentRequiredHeader,decodePaymentRequiredHeader,decodePaymentSignatureHeader,encodePaymentSignatureHeader,encodePaymentResponseHeader,decodePaymentResponseHeader,readLimitedText} from '@x402/core/http';
import {ExactHederaScheme} from '@x402/hedera/exact/client';
import {createClientHederaSigner,PrivateKey,inspectHederaTransaction} from '@x402/hedera';
import {MinorUnitsSchema,AnswerEnvelopeSchema,ComputationResultSchema,type ComputationResult,type AnswerEnvelope} from '@data-leases/contracts';
export const HEDERA_CURRENCY='hedera:testnet/HBAR';
export const HEDERA_NETWORK='hedera:testnet' as const;
export const HEDERA_ASSET='0.0.0';
export const HEDERA_FACILITATOR='https://x402.org/facilitator';
export interface PaymentQuote {runId:string;quoteId:string;termsHash:string;priceMinor:string;currency:string;expiresAt:string}
const account=(value:string)=>{if(!/^0\.0\.[1-9][0-9]*$/.test(value))throw new Error('INVALID_HEDERA_ACCOUNT');return value;};
const exact=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
function quoteValid(quote:PaymentQuote){if(quote.currency!==HEDERA_CURRENCY)throw new Error('PAYMENT_CURRENCY_MISMATCH');if(BigInt(MinorUnitsSchema.parse(quote.priceMinor))<=0n||BigInt(quote.priceMinor)>9223372036854775807n)throw new Error('INVALID_PAYMENT_AMOUNT');if(!quote.runId||!quote.quoteId||!quote.termsHash||!Number.isFinite(Date.parse(quote.expiresAt))||Date.parse(quote.expiresAt)<=Date.now())throw new Error('PAYMENT_QUOTE_EXPIRED');}
export function createHederaChallenge(quote:PaymentQuote,resourceUrl:string,payTo:string,feePayer:string):PaymentRequired {
 quoteValid(quote);account(payTo);account(feePayer);
 return {x402Version:2,resource:{url:resourceUrl,description:'Negotiated Data Leases answer; payment does not verify answer quality',mimeType:'application/json'},accepts:[{scheme:'exact',network:HEDERA_NETWORK,asset:HEDERA_ASSET,amount:quote.priceMinor,payTo,maxTimeoutSeconds:Math.max(1,Math.min(180,Math.floor((Date.parse(quote.expiresAt)-Date.now())/1000))),extra:{feePayer,assetTransferMethod:'cryptoTransfer',runId:quote.runId,quoteId:quote.quoteId,termsHash:quote.termsHash}}]};
}
export function validateHederaChallenge(challenge:PaymentRequired,quote:PaymentQuote,policy:{resourceUrl:string;payTo:string;feePayer:string;maxAmount:string}):PaymentRequirements {
 quoteValid(quote);if(BigInt(quote.priceMinor)>BigInt(MinorUnitsSchema.parse(policy.maxAmount)))throw new Error('PAYMENT_BUDGET_EXCEEDED');
 const r=challenge.accepts?.[0];if(challenge.x402Version!==2||challenge.resource?.url!==policy.resourceUrl||challenge.accepts?.length!==1||!r||r.scheme!=='exact'||r.network!==HEDERA_NETWORK||r.asset!==HEDERA_ASSET||r.amount!==quote.priceMinor||r.payTo!==account(policy.payTo)||r.extra?.feePayer!==account(policy.feePayer)||r.extra?.assetTransferMethod!=='cryptoTransfer'||r.extra?.runId!==quote.runId||r.extra?.quoteId!==quote.quoteId||r.extra?.termsHash!==quote.termsHash||!Number.isInteger(r.maxTimeoutSeconds)||r.maxTimeoutSeconds<1||r.maxTimeoutSeconds>180)throw new Error('PAYMENT_TERMS_MISMATCH');return r;
}
export interface PaymentRecord {quote:PaymentQuote;status:string;answer?:AnswerEnvelope;computation?:ComputationResult;requirements?:PaymentRequired;receipt?:SettleResponse;transactionId?:string;payTo?:string;payer?:string;authorization?:{policy:string;signature:string;publicKey:string}}
/** Durable no-retry journal. Unknown settlement must be reconciled, never re-paid automatically. */
export class PaymentJournal {
 private db:DatabaseSync;
 constructor(path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS x402_payments (id TEXT PRIMARY KEY,status TEXT NOT NULL,record TEXT NOT NULL)');}
 get(id:string):PaymentRecord|undefined {const row=this.db.prepare('SELECT status,record FROM x402_payments WHERE id=?').get(id);return row?{...JSON.parse(String(row.record)),status:String(row.status)}:undefined;}
 register(id:string,value:PaymentRecord){const prior=this.get(id);if(prior){if(!exact(prior.quote,value.quote))throw new Error('PAYMENT_ID_CONFLICT');return prior;}this.db.prepare('INSERT INTO x402_payments VALUES (?,?,?)').run(id,value.status,JSON.stringify(value));return value;}
 save(id:string,value:PaymentRecord){this.db.prepare('UPDATE x402_payments SET status=?,record=? WHERE id=?').run(value.status,JSON.stringify(value),id);}
 claim(id:string,from:string,to:string){return Number(this.db.prepare('UPDATE x402_payments SET status=? WHERE id=? AND status=?').run(to,id,from).changes)===1;}
 initializeRequirements(id:string,requirements:PaymentRequired){this.db.prepare("UPDATE x402_payments SET record=json_set(record,'$.requirements',json(?)) WHERE id=? AND status='READY' AND json_extract(record,'$.requirements') IS NULL").run(JSON.stringify(requirements),id);}
 close(){this.db.close();}
}
export class HederaPaywall {
 constructor(private readonly config:{payTo:string;resourceOrigin:string;journal:PaymentJournal;facilitator?:FacilitatorClient}){account(config.payTo);}
 register(quote:PaymentQuote,answer:AnswerEnvelope,computation?:ComputationResult){quoteValid(quote);this.config.journal.register('seller:'+quote.runId,{quote,answer:AnswerEnvelopeSchema.parse(answer),computation,status:'READY'});}
 async respond(runId:string,signature?:string):Promise<{status:number;headers:Record<string,string>;body:unknown}>{
  const id='seller:'+runId;const initial=this.config.journal.get(id);if(!initial)return {status:404,headers:{},body:{error:'PAYMENT_RUN_NOT_FOUND'}};
  let record:PaymentRecord=initial;
  const delivered=()=>({status:200,headers:{'PAYMENT-RESPONSE':encodePaymentResponseHeader(record.receipt!)},body:{answer:record.answer,computation:record.computation,payment:record.receipt}});
  if(record.status==='SETTLED')return delivered();
  if(record.status!=='READY')return {status:409,headers:{},body:{error:'PAYMENT_RECONCILIATION_REQUIRED',paymentStatus:record.status}};
  quoteValid(record.quote);
  const facilitator=this.config.facilitator??new HTTPFacilitatorClient({url:HEDERA_FACILITATOR,timeoutMs:30000});
  if(!record.requirements){const supported=await facilitator.getSupported();const kind=supported.kinds.find(k=>k.x402Version===2&&k.scheme==='exact'&&k.network===HEDERA_NETWORK);const feePayer=kind?.extra?.feePayer;if(typeof feePayer!=='string')throw new Error('HEDERA_FACILITATOR_UNSUPPORTED');this.config.journal.initializeRequirements(id,createHederaChallenge(record.quote,this.config.resourceOrigin+'/paid-answers/'+encodeURIComponent(runId),this.config.payTo,feePayer));record=this.config.journal.get(id)!;if(record.status==='SETTLED')return delivered();if(record.status!=='READY')return {status:409,headers:{},body:{error:'PAYMENT_RECONCILIATION_REQUIRED',paymentStatus:record.status}};}
  if(!signature)return {status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(record.requirements!)},body:record.requirements};
  if(signature.length>65536)throw new Error('PAYMENT_PAYLOAD_TOO_LARGE');
  const payload=decodePaymentSignatureHeader(signature);const required=record.requirements!.accepts[0]!;
  if(payload.x402Version!==2||!exact(payload.accepted,required)||payload.resource?.url!==record.requirements!.resource.url)throw new Error('PAYMENT_TERMS_MISMATCH');
  if(!this.config.journal.claim(id,'READY','VERIFYING'))throw new Error('PAYMENT_ALREADY_IN_PROGRESS');
  try {const verified=await facilitator.verify(payload,required);if(!verified.isValid){record.status='READY';this.config.journal.save(id,record);return {status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(record.requirements!)},body:{error:'PAYMENT_SIGNATURE_INVALID'}};}}
  catch{record.status='READY';this.config.journal.save(id,record);throw new Error('PAYMENT_VERIFICATION_FAILED');}
  record.status='SETTLING';this.config.journal.save(id,record);
  try{const receipt=await facilitator.settle(payload,required);if(!receipt.success||receipt.network!==HEDERA_NETWORK||!receipt.transaction)throw new Error('SETTLEMENT_UNCONFIRMED');record.receipt=receipt;record.status='SETTLED';this.config.journal.save(id,record);return delivered();}
  catch{record.status='UNKNOWN';this.config.journal.save(id,record);return {status:409,headers:{},body:{error:'PAYMENT_RECONCILIATION_REQUIRED',paymentStatus:'UNKNOWN'}};}
 }
}
export interface HederaBuyerConfig {accountId:string;privateKey:string;keyType:'ED25519'|'ECDSA';maxTinybars:string;journal:PaymentJournal;authorize?:()=>void}
export async function payHederaAnswer(input:{url:string;quote:PaymentQuote;payTo:string;config:HederaBuyerConfig}):Promise<{answer:AnswerEnvelope;payment:SettleResponse;computation?:ComputationResult}> {
 const {config,quote}=input;config.authorize?.();quoteValid(quote);account(config.accountId);account(input.payTo);if(config.accountId===input.payTo)throw new Error('BUYER_AND_PROVIDER_MUST_DIFFER');
 const url=new URL(input.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/paid-answers/'+encodeURIComponent(quote.runId)||url.username||url.password||url.search||url.hash)throw new Error('PAYMENT_RESOURCE_NOT_ALLOWED');
 const id='buyer:'+quote.runId;const prior=config.journal.get(id);if(prior){if(!exact(prior.quote,quote))throw new Error('PAYMENT_ID_CONFLICT');if(prior.status==='SETTLED'&&prior.answer&&prior.receipt)return {answer:prior.answer,payment:prior.receipt,computation:prior.computation};throw new Error('PAYMENT_RECONCILIATION_REQUIRED');}
 const response=await fetch(input.url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(response.status!==402)throw new Error('EXPECTED_X402_PAYMENT_CHALLENGE');const header=response.headers.get('PAYMENT-REQUIRED');if(!header||header.length>65536)throw new Error('INVALID_X402_CHALLENGE');
 const challenge=decodePaymentRequiredHeader(header);const supported=await new HTTPFacilitatorClient({url:HEDERA_FACILITATOR,timeoutMs:30000}).getSupported();const kind=supported.kinds.find(k=>k.x402Version===2&&k.scheme==='exact'&&k.network===HEDERA_NETWORK);const feePayer=kind?.extra?.feePayer;if(typeof feePayer!=='string')throw new Error('HEDERA_FACILITATOR_UNSUPPORTED');
 const required=validateHederaChallenge(challenge,quote,{resourceUrl:input.url,payTo:input.payTo,feePayer,maxAmount:config.maxTinybars});
 const balanceResponse=await fetch('https://testnet.mirrornode.hedera.com/api/v1/accounts/'+encodeURIComponent(config.accountId),{redirect:'error',signal:AbortSignal.timeout(10000)});if(!balanceResponse.ok)throw new Error('HEDERA_BALANCE_UNAVAILABLE');const balance=JSON.parse(await readLimitedText(balanceResponse,65536));if(!Number.isSafeInteger(balance.balance?.balance)||BigInt(balance.balance.balance)<BigInt(quote.priceMinor))throw new Error('INSUFFICIENT_BALANCE');
 quoteValid(quote);
 config.authorize?.();
 const key=config.keyType==='ECDSA'?PrivateKey.fromStringECDSA(config.privateKey):PrivateKey.fromStringED25519(config.privateKey);
 const policy=JSON.stringify({domain:'data-leases:hedera-x402-spending-policy:v1',payer:config.accountId,quote,network:HEDERA_NETWORK,asset:HEDERA_ASSET,payTo:input.payTo,maxTinybars:config.maxTinybars,resourceUrl:input.url});const bytes=Buffer.from(policy);const signed=key.sign(bytes);if(!key.publicKey.verify(bytes,signed))throw new Error('SPENDING_POLICY_SIGNATURE_INVALID');
 const record:PaymentRecord={quote,payTo:input.payTo,payer:config.accountId,status:'AUTHORIZED',authorization:{policy,signature:Buffer.from(signed).toString('hex'),publicKey:key.publicKey.toString()}};config.journal.register(id,record);
 if(!config.journal.claim(id,'AUTHORIZED','SIGNING'))throw new Error('PAYMENT_ALREADY_IN_PROGRESS');
 try{
  const scheme=new ExactHederaScheme(createClientHederaSigner(config.accountId,key,{network:HEDERA_NETWORK}));const created=await scheme.createPaymentPayload(2,required);const payload:PaymentPayload={...created,resource:challenge.resource,accepted:required};
  const transaction=payload.payload.transaction;if(typeof transaction!=='string')throw new Error('INVALID_HEDERA_TRANSACTION');const inspected=inspectHederaTransaction(transaction);record.transactionId=inspected.transactionId;
  quoteValid(quote);
  config.authorize?.();
  record.status='SUBMITTED';config.journal.save(id,record);
  const paid=await fetch(input.url,{headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload)},redirect:'error',signal:AbortSignal.timeout(45000)});const receiptHeader=paid.headers.get('PAYMENT-RESPONSE');if(!receiptHeader)throw new Error('PAYMENT_OUTCOME_UNKNOWN');
  const receipt=decodePaymentResponseHeader(receiptHeader);if(!receipt.success||receipt.network!==HEDERA_NETWORK||receipt.payer!==config.accountId||!receipt.transaction||(receipt.amount!==undefined&&receipt.amount!==quote.priceMinor))throw new Error('PAYMENT_RECEIPT_INVALID');
  record.receipt=receipt;record.status='SETTLED_DELIVERY_FAILED';config.journal.save(id,record);if(!paid.ok)throw new Error('PAID_DELIVERY_FAILED');
  const body=JSON.parse(await readLimitedText(paid,65536));const answer=AnswerEnvelopeSchema.parse(body.answer);if(answer.runId!==quote.runId||answer.acceptedQuoteId!==quote.quoteId)throw new Error('PAID_ANSWER_BINDING_MISMATCH');record.computation=body.computation?ComputationResultSchema.parse(body.computation):undefined;record.receipt=receipt;record.answer=answer;record.status='SETTLED';config.journal.save(id,record);return {answer,payment:receipt,computation:record.computation};
 }catch(error){if(record.status!=='SUBMITTED'&&!record.receipt){record.status='NOT_SUBMITTED';config.journal.save(id,record);throw new Error(error instanceof Error&&error.message==='LEASE_EXPIRED_OR_CANCELLED'?'LEASE_EXPIRED_OR_CANCELLED':'PAYMENT_NOT_SUBMITTED');}record.status=record.receipt?'SETTLED_DELIVERY_FAILED':'UNKNOWN';config.journal.save(id,record);throw new Error(record.receipt?'PAYMENT_SETTLED_DELIVERY_FAILED':'PAYMENT_RECONCILIATION_REQUIRED');}
}
export function paymentDigest(quote:PaymentQuote){return createHash('sha256').update(canonical(quote)).digest('hex');}

/** Read-only reconciliation never signs or broadcasts. Missing mirror data stays UNKNOWN. */
export async function reconcileHederaPayment(journal:PaymentJournal,runId:string):Promise<PaymentRecord>{
 const id='buyer:'+runId;const record=journal.get(id);if(!record)throw new Error('PAYMENT_NOT_FOUND');if(record.receipt)return record;
 if(!record.transactionId||!record.payTo||!record.payer)throw new Error('PAYMENT_RECONCILIATION_REQUIRED');
 const match=record.transactionId.match(/^(0\.0\.[0-9]+)@(\d+)\.(\d+)$/);if(!match)throw new Error('INVALID_TRANSACTION_ID');
 const mirrorId=match[1]+'-'+match[2]+'-'+match[3];const response=await fetch('https://testnet.mirrornode.hedera.com/api/v1/transactions/'+encodeURIComponent(mirrorId),{redirect:'error',signal:AbortSignal.timeout(10000)});if(response.status===404)return record;if(!response.ok)throw new Error('RECONCILIATION_UNAVAILABLE');
 const body=JSON.parse(await readLimitedText(response,262144));const transactions=body.transactions as {transaction_id:string;result:string;transfers:{account:string;amount:number}[]}[];
 if(!Array.isArray(transactions))throw new Error('INVALID_MIRROR_RESPONSE');
 const confirmed=transactions.find(t=>t.transaction_id===mirrorId&&t.result==='SUCCESS'&&Array.isArray(t.transfers)&&t.transfers.every(x=>Number.isSafeInteger(x.amount))&&t.transfers.some(x=>x.account===record.payTo&&BigInt(x.amount)===BigInt(record.quote.priceMinor))&&t.transfers.some(x=>x.account===record.payer&&BigInt(x.amount)===-BigInt(record.quote.priceMinor)));
 if(confirmed){record.receipt={success:true,network:HEDERA_NETWORK,transaction:record.transactionId,payer:record.payer,amount:record.quote.priceMinor};record.status='SETTLED_DELIVERY_FAILED';journal.save(id,record);}return record;
}
