import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {VerificationRequestSchema} from '@data-leases/contracts';
import {discloseRun,eventDisclosure} from '../../apps/agent-gateway/src/data-access.js';
import type {RunState} from '../../apps/agent-gateway/src/orchestrator.js';
const fixture=VerificationRequestSchema.parse(JSON.parse(readFileSync(new URL('../cre/fixtures/request.json',import.meta.url),'utf8')));
const questionTemplateId='PRIVATE_AAVE_POSITION_HEALTH_FACTOR';
test('private events preserve negotiation fields but conceal raw values and source aliases',()=>{
 const data=eventDisclosure(questionTemplateId,{questionTemplateId,priceMinor:'2000',round:1,answer:{value:'private-test-value',evidenceRefs:['private-source']},checks:[{observed:'private-observed',evidenceRef:'private-reference'}]});
 expect(data).toMatchObject({questionTemplateId,priceMinor:'2000',round:1,dataClassification:'PRIVATE'});expect(JSON.stringify(data)).not.toMatch(/private-test-value|private-source|private-observed|private-reference/);
});
test('private buyer response shows the paid metric only and strips verifier and source aliases',()=>{
 const run:RunState={runId:fixture.runId,sessionId:fixture.sessionId,leaseId:'test',status:'COMPLETED',paymentStatus:'SETTLED',deliveryStatus:'DELIVERED_UNVERIFIED',verificationStatus:'INCONCLUSIVE',publicationStatus:'NOT_ELIGIBLE',payment:{network:'hedera:testnet',transaction:'test:offline',success:true},answer:{...fixture.answer,questionTemplateId,value:'private-test-value',evidenceRefs:['private-source']},verification:{schemaVersion:'1.0.0',verificationId:fixture.verificationId,runId:fixture.runId,providerId:fixture.providerId,executionMode:'MOCK',status:'INCONCLUSIVE',executedAt:fixture.requestedAt,checks:[{checkId:'TEST',status:'UNKNOWN',reasonCode:'TEST_ONLY',observed:'private-observed',evidenceRef:'private-reference'}],evidenceRefs:['private-source'],referenceBlockNumber:'123',referenceBlockHash:'private-block',rawArtifactRef:'private-path'}};
 const response=discloseRun(run);expect(response.answer?.value).toBe('private-test-value');expect(JSON.stringify(response)).not.toMatch(/private-source|private-observed|private-reference|private-block|private-path/);expect(discloseRun(run,true).answer).toBeUndefined();expect(discloseRun({...run,paymentStatus:'UNKNOWN'}).answer).toBeUndefined();expect(run.answer?.evidenceRefs).toEqual(['private-source']);
});
