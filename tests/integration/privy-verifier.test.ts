import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,sign,type KeyObject} from 'node:crypto';
import {privyVerifier,privyConfigFromEnv} from '../../apps/agent-gateway/src/buyer-auth.js';

// Offline check of the real @privy-io/node verification path with a locally generated ES256 key.
const keys=generateKeyPairSync('ec',{namedCurve:'P-256'}),other=generateKeyPairSync('ec',{namedCurve:'P-256'});
const pem=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(claims:Record<string,unknown>={},key:KeyObject=keys.privateKey){
 const now=Math.floor(Date.now()/1000);
 const message=encode({alg:'ES256',typ:'JWT'})+'.'+encode({iss:'privy.io',aud:'test-app',sub:'did:privy:abc123',sid:'session-1',iat:now,exp:now+3600,...claims});
 return message+'.'+sign('sha256',Buffer.from(message),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
describe('Privy access-token verifier (real SDK, local key)',()=>{
 const verifier=privyVerifier({appId:'test-app',verificationKey:pem});
 it('accepts a valid ES256 token and returns the Privy DID',async()=>{expect(await verifier.verify(jwt())).toEqual({userId:'did:privy:abc123'});});
 it.each([[{aud:'other-app'}],[{iss:'attacker.example'}],[{exp:Math.floor(Date.now()/1000)-60}],[{sub:'not-a-privy-did'}]])('rejects invalid claims %j',async(claims)=>{await expect(verifier.verify(jwt(claims))).rejects.toThrow();});
 it('rejects a token signed by another key and malformed tokens',async()=>{await expect(verifier.verify(jwt({},other.privateKey))).rejects.toThrow();await expect(verifier.verify('not.a.jwt')).rejects.toThrow();});
 it('reads an escaped-newline PEM from the environment',async()=>{const config=privyConfigFromEnv({PRIVY_APP_ID:'test-app',PRIVY_VERIFICATION_KEY:pem.trim().replace(/\n/g,'\\n')})!;expect(await privyVerifier(config).verify(jwt())).toEqual({userId:'did:privy:abc123'});});
});
