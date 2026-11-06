import {expect,test} from 'vitest';
import * as payments from '../src/payments.js';
const quote={runId:'run',quoteId:'quote',termsHash:'hash',priceMinor:'500',currency:'hedera:testnet/HBAR',expiresAt:new Date(Date.now()+60000).toISOString()};
test('x402 exact challenge is bound to negotiated quote, merchant and HBAR units',()=>{
 expect(payments.createHederaChallenge).toBeTypeOf('function');
 const challenge=payments.createHederaChallenge(quote,'http://127.0.0.1:4101/paid-answers/run','0.0.123','0.0.456');
 expect(challenge.x402Version).toBe(2);expect(challenge.accepts[0]).toMatchObject({scheme:'exact',network:'hedera:testnet',asset:'0.0.0',amount:'500',payTo:'0.0.123',extra:{feePayer:'0.0.456'}});
 expect(()=>payments.validateHederaChallenge(challenge,quote,{resourceUrl:challenge.resource.url,payTo:'0.0.999',feePayer:'0.0.456',maxAmount:'500'})).toThrow('PAYMENT_TERMS_MISMATCH');
 expect(()=>payments.validateHederaChallenge(challenge,quote,{resourceUrl:challenge.resource.url,payTo:'0.0.123',feePayer:'0.0.456',maxAmount:'499'})).toThrow('PAYMENT_BUDGET_EXCEEDED');
});
test('demo USD amounts are never silently converted to tinybars',()=>{
 expect(()=>payments.createHederaChallenge({...quote,currency:'demo:USD6'},'http://127.0.0.1:4101/paid-answers/run','0.0.123','0.0.456')).toThrow('PAYMENT_CURRENCY_MISMATCH');
});

test('accepted HBAR quote withholds answer before x402 settlement',async()=>{
 const {startProvider,negotiate}=await import('../src/index.js');
 const journal=new payments.PaymentJournal(':memory:');
 const provider=await startProvider({port:0,providerId:'paid-provider',askMinor:'500',floorMinor:'300',payment:{payTo:'0.0.123',journal}});
 try{const result=await negotiate({baseUrl:provider.baseUrl,providerId:'paid-provider',maxPriceMinor:'350',currency:payments.HEDERA_CURRENCY});expect(result.status).toBe('AGREED');expect(result.deliveryStatus).toBe('PAYMENT_REQUIRED');expect(result.answer).toBeUndefined();expect(result.paymentRequired?.payTo).toBe('0.0.123');}finally{await provider.close();journal.close();}
});
test('verification is not settlement, and a repeated paid request does not settle twice',async()=>{
 const {encodePaymentSignatureHeader}=await import('@x402/core/http');
 const fixture=(await import('../../contracts/fixtures/answer.valid.json')).default;
 const journal=new payments.PaymentJournal(':memory:');let settlements=0;
 const facilitator={getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'hedera:testnet',extra:{feePayer:'0.0.456'}}],extensions:[],signers:{}}),verify:async()=>({isValid:true,payer:'0.0.777'}),settle:async()=>{settlements++;return {success:true,transaction:'0.0.456@123.000000001',network:'hedera:testnet' as const,payer:'0.0.777'};}};
 const wall=new payments.HederaPaywall({payTo:'0.0.123',resourceOrigin:'http://127.0.0.1:4101',journal,facilitator});wall.register(quote,{...fixture,schemaVersion:'1.0.0',runId:'run',acceptedQuoteId:'quote',demoTrustMode:'UNTRUSTED_MOCK'});
 const challenge=await wall.respond('run');expect(challenge.status).toBe(402);expect(settlements).toBe(0);
 const required=challenge.body as import('@x402/core/types').PaymentRequired;
 const signature=encodePaymentSignatureHeader({x402Version:2,resource:required.resource,accepted:required.accepts[0]!,payload:{transaction:'fake-test-only'}});
 expect((await wall.respond('run',signature)).status).toBe(200);expect((await wall.respond('run',signature)).status).toBe(200);expect(settlements).toBe(1);journal.close();
});

test('read and simulated write utilities publish different rates without accepting or paying',async()=>{
 const {startProvider,negotiate}=await import('../src/index.js');const journal=new payments.PaymentJournal(':memory:');const provider=await startProvider({port:0,providerId:'rates',askMinor:'500',floorMinor:'300',payment:{payTo:'0.0.123',journal}});
 try{const read=await negotiate({baseUrl:provider.baseUrl,providerId:'rates',maxPriceMinor:'0',currency:payments.HEDERA_CURRENCY,quoteOnly:true,questionTemplateId:'ERC20_TOKEN_METADATA'});const write=await negotiate({baseUrl:provider.baseUrl,providerId:'rates',maxPriceMinor:'0',currency:payments.HEDERA_CURRENCY,quoteOnly:true,questionTemplateId:'SIMULATED_LINK_REPORT_WRITE'});expect(read.status).toBe('QUOTED');expect(write.status).toBe('QUOTED');expect(read.quote?.priceMinor).toBe('500');expect(write.quote?.priceMinor).toBe('2000');expect(read.answer).toBeUndefined();expect(write.answer).toBeUndefined();expect(journal.get('seller:'+read.runId)).toBeUndefined();}finally{await provider.close();journal.close();}
});
test('an indeterminate settlement is never retried automatically',async()=>{
 const {encodePaymentSignatureHeader}=await import('@x402/core/http');const fixture=(await import('../../contracts/fixtures/answer.valid.json')).default;const journal=new payments.PaymentJournal(':memory:');let calls=0;
 const wall=new payments.HederaPaywall({payTo:'0.0.123',resourceOrigin:'http://127.0.0.1:4101',journal,facilitator:{getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'hedera:testnet',extra:{feePayer:'0.0.456'}}],extensions:[],signers:{}}),verify:async()=>({isValid:true}),settle:async()=>{calls++;throw new Error('timeout after possible broadcast');}}});wall.register(quote,{...fixture,schemaVersion:'1.0.0',runId:'run',acceptedQuoteId:'quote',demoTrustMode:'UNTRUSTED_MOCK'});
 const required=(await wall.respond('run')).body as import('@x402/core/types').PaymentRequired;const signature=encodePaymentSignatureHeader({x402Version:2,resource:required.resource,accepted:required.accepts[0]!,payload:{transaction:'test-only'}});
 expect((await wall.respond('run',signature)).status).toBe(409);expect((await wall.respond('run',signature)).status).toBe(409);expect(calls).toBe(1);expect(journal.get('seller:run')?.status).toBe('UNKNOWN');journal.close();
});

test('challenge initialization cannot reset an in-progress settlement to READY',async()=>{
 const fixture=(await import('../../contracts/fixtures/answer.valid.json')).default;const journal=new payments.PaymentJournal(':memory:');let release!:()=>void;let supports=0;let verifyRelease!:()=>void;let settlements=0;
 const {encodePaymentSignatureHeader}=await import('@x402/core/http');
 const supported={kinds:[{x402Version:2,scheme:'exact',network:'hedera:testnet' as const,extra:{feePayer:'0.0.456'}}],extensions:[],signers:{}};
 const wall=new payments.HederaPaywall({payTo:'0.0.123',resourceOrigin:'http://127.0.0.1:4101',journal,facilitator:{getSupported:async()=>{if(++supports===1)await new Promise<void>(r=>{release=r;});return supported;},verify:async()=>{await new Promise<void>(r=>{verifyRelease=r;});return {isValid:true};},settle:async()=>{settlements++;return {success:true,network:'hedera:testnet',transaction:'test:once'};}}});
 wall.register(quote,{...fixture,schemaVersion:'1.0.0',runId:'run',acceptedQuoteId:'quote',demoTrustMode:'UNTRUSTED_MOCK'});
 const slowUnsigned=wall.respond('run');const required=(await wall.respond('run')).body as import('@x402/core/types').PaymentRequired;
 const signature=encodePaymentSignatureHeader({x402Version:2,resource:required.resource,accepted:required.accepts[0]!,payload:{transaction:'test:only'}});
 const signed=wall.respond('run',signature);release();expect((await slowUnsigned).status).toBe(409);expect((await wall.respond('run',signature)).status).toBe(409);verifyRelease();expect((await signed).status).toBe(200);expect(settlements).toBe(1);journal.close();
});

test('insufficient testnet balance fails before creating a buyer authorization',async()=>{
 const {vi}=await import('vitest');const journal=new payments.PaymentJournal(':memory:');const url='http://127.0.0.1:4101/paid-answers/run';const challenge=payments.createHederaChallenge(quote,url,'0.0.123','0.0.456');const {encodePaymentRequiredHeader}=await import('@x402/core/http');
 const fake=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{const target=String(input);if(target===url)return new Response(null,{status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(challenge)}});if(target.endsWith('/supported'))return Response.json({kinds:[{x402Version:2,scheme:'exact',network:'hedera:testnet',extra:{feePayer:'0.0.456'}}],extensions:[],signers:{}});if(target.includes('/accounts/'))return Response.json({balance:{balance:1}});throw new Error('UNEXPECTED_TEST_HTTP');});
 try{await expect(payments.payHederaAnswer({url,quote,payTo:'0.0.123',config:{accountId:'0.0.777',privateKey:'unused-test-placeholder',keyType:'ECDSA',maxTinybars:'500',journal}})).rejects.toThrow('INSUFFICIENT_BALANCE');expect(journal.get('buyer:run')).toBeUndefined();}finally{fake.mockRestore();journal.close();}
});
test('read-only mirror reconciliation validates exact debit and merchant credit',async()=>{
 const {vi}=await import('vitest');const journal=new payments.PaymentJournal(':memory:');journal.register('buyer:run',{quote,status:'UNKNOWN',transactionId:'0.0.456@123.000000001',payTo:'0.0.123',payer:'0.0.777'});
 const fake=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({transactions:[{transaction_id:'0.0.456-123-000000001',result:'SUCCESS',transfers:[{account:'0.0.123',amount:500},{account:'0.0.777',amount:-500}]}]}));
 try{const result=await payments.reconcileHederaPayment(journal,'run');expect(result).toMatchObject({status:'SETTLED_DELIVERY_FAILED',receipt:{success:true,network:'hedera:testnet',transaction:'0.0.456@123.000000001',amount:'500'}});expect(fake).toHaveBeenCalledTimes(1);}finally{fake.mockRestore();journal.close();}
});

test('lease cancellation while awaiting balance blocks signing and submission',async()=>{
 const {vi}=await import('vitest');const journal=new payments.PaymentJournal(':memory:');const url='http://127.0.0.1:4101/paid-answers/run';const challenge=payments.createHederaChallenge(quote,url,'0.0.123','0.0.456');const {encodePaymentRequiredHeader}=await import('@x402/core/http');let active=true,submissions=0;
 const fake=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{if(init?.headers&&'PAYMENT-SIGNATURE' in Object(init.headers)){submissions++;throw new Error('UNEXPECTED_SUBMISSION');}const target=String(input);if(target===url)return new Response(null,{status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(challenge)}});if(target.endsWith('/supported'))return Response.json({kinds:[{x402Version:2,scheme:'exact',network:'hedera:testnet',extra:{feePayer:'0.0.456'}}],extensions:[],signers:{}});if(target.includes('/accounts/')){active=false;return Response.json({balance:{balance:1000000}});}throw new Error('UNEXPECTED_TEST_HTTP');});
 try{await expect(payments.payHederaAnswer({url,quote,payTo:'0.0.123',config:{accountId:'0.0.777',privateKey:'unused-test-placeholder',keyType:'ECDSA',maxTinybars:'500',journal,authorize:()=>{if(!active)throw new Error('LEASE_EXPIRED_OR_CANCELLED');}}})).rejects.toThrow('LEASE_EXPIRED_OR_CANCELLED');expect(submissions).toBe(0);expect(journal.get('buyer:run')).toBeUndefined();}finally{fake.mockRestore();journal.close();}
});

test('paid LINK source runs only after quote acceptance and cannot replace accepted bindings',async()=>{
 const {startProvider,negotiate}=await import('../src/index.js');const journal=new payments.PaymentJournal(':memory:');let reads=0;
 const provider=await startProvider({port:0,providerId:'source-provider',askMinor:'500',floorMinor:'300',payment:{payTo:'0.0.123',journal},answerSource:async()=>{reads++;return {value:'18',sourceBlockNumber:'123',sourceBlockHash:'0x'+'ab'.repeat(32),evidenceRefs:['https://etherscan.io/block/123'],acceptedQuoteId:'must-not-replace-quote'};}});
 try{await negotiate({baseUrl:provider.baseUrl,providerId:'source-provider',maxPriceMinor:'500',currency:payments.HEDERA_CURRENCY,questionTemplateId:'ERC20_TOKEN_METADATA',quoteOnly:true});expect(reads).toBe(0);
 const result=await negotiate({baseUrl:provider.baseUrl,providerId:'source-provider',maxPriceMinor:'500',currency:payments.HEDERA_CURRENCY,questionTemplateId:'ERC20_TOKEN_METADATA'});expect(reads).toBe(1);const stored=journal.get('seller:'+result.runId);expect(stored?.status).toBe('READY');expect(stored?.answer).toMatchObject({acceptedQuoteId:result.paymentRequired?.quote.quoteId,sourceBlockNumber:'123'});expect(result.answer).toBeUndefined();
 }finally{await provider.close();journal.close();}
});
