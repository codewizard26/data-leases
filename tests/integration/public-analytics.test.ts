import {expect,test} from 'vitest';
import type {StoredEntity} from '@data-leases/arkiv';
import {summarizePublicEntities} from '../../apps/agent-gateway/src/public-analytics.js';
const now=Date.parse('2026-11-07T00:00:00Z');
function entity(key:string,record:Record<string,unknown>):StoredEntity{return {entityKey:key,owner:'public-owner',record:{providerId:'provider-a',createdAt:'2026-11-06T12:00:00Z',expiresAt:'2026-11-08T00:00:00Z',...record}} as unknown as StoredEntity;}
const payment=(key:string,transactionId:string,amountTinybars:string)=>entity(key,{entityType:'PaymentReference',network:'hedera:testnet',transactionId,amountTinybars,settlementStatus:'CONFIRMED',buyerId:'never-public',value:'private-value'});
test('public spend counts a shared bundle transaction once, preserves exact amounts and filters scope',()=>{
 const rows=[payment('p1','tx1','900719925474099300'),payment('p2','tx1','900719925474099300'),payment('p3','tx2','100'),entity('a1',{entityType:'AnswerReceipt',questionTemplateId:'LIQUIDITY',runId:'bundle',value:'private-value'}),entity('a2',{entityType:'AnswerReceipt',questionTemplateId:'LIQUIDITY',runId:'bundle'}),entity('a3',{entityType:'AnswerReceipt',questionTemplateId:'YIELD',runId:'bundle'}),entity('expired',{entityType:'ProviderOffer',expiresAt:'2026-11-06T00:00:00Z'}),entity('other',{entityType:'ProviderOffer',providerId:'outsider'})];
 const result=summarizePublicEntities([...rows,rows[0]!],['provider-a'],now);
 expect(result.confirmedPurchases).toBe(2);expect(result.totalTinybars).toBe('900719925474099400');expect(result.entities).toBe(6);
 expect(result.usage).toEqual([{questionTemplateId:'LIQUIDITY',answerRuns:1},{questionTemplateId:'YIELD',answerRuns:1}]);
 expect(result.spendingByPublicationDate).toEqual([{date:'2026-11-06',amountTinybars:'900719925474099400'}]);
 expect(JSON.stringify(result)).not.toContain('private-value');expect(JSON.stringify(result)).not.toContain('never-public');expect(JSON.stringify(result)).not.toContain('tx1');
});
test('conflicting public amounts for one transaction never inflate spending',()=>{
 const result=summarizePublicEntities([payment('p1','tx','10'),payment('p2','tx','20')],['provider-a'],now);
 expect(result.conflictingPayments).toBe(1);expect(result.confirmedPurchases).toBe(0);expect(result.totalTinybars).toBe('0');
});
