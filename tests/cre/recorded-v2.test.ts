import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {CreSimulationVerificationClient,type SimulationArtifact} from '@data-leases/cre-adapter';
for(const [name,status] of [['accepted','ACCEPTED'],['rejected','REJECTED'],['inconclusive','INCONCLUSIVE']] as const){
 it(`imports the recorded real v2 ${name} CLI output with matching correlation`,async()=>{
  const artifact=JSON.parse(readFileSync(new URL(`./evidence/v2/${name}.artifact.json`,import.meta.url),'utf8')) as SimulationArtifact;
  const transcript=readFileSync(new URL(`./evidence/v2/${name}.log`,import.meta.url),'utf8');
  const client=new CreSimulationVerificationClient();await client.submit(artifact.request);client.importArtifact(artifact,transcript);
  expect(await client.getResult(artifact.request.verificationId)).toMatchObject({status,executionMode:'CRE_CLI_SIMULATION',runId:artifact.request.runId,providerId:artifact.request.providerId});
 });
}
