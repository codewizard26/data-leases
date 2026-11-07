import type {AccessTokenVerifier} from '../../apps/agent-gateway/src/buyer-auth.js';
/** Test fixture verifier: maps opaque fixture tokens to Privy DIDs. Never used outside tests. */
export const fixtureVerifier:AccessTokenVerifier={async verify(token){const match=/^fixture-privy-token-([a-z]+)$/.exec(token);if(!match)throw new Error('invalid');return {userId:'did:privy:'+match[1]};}};
