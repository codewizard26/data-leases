import {timingSafeEqual} from 'node:crypto';
import {PrivyClient, verifyAccessToken} from '@privy-io/node';
import {BuyerSessionStore, type StoredBuyerSession} from './buyer-session-store.js';

/** Issuer recorded for Privy identities (Privy access tokens use iss="privy.io"). */
export const PRIVY_ISSUER='privy.io';

/** Verifies a Privy access token and returns the Privy user DID. Injected so tests never call Privy. */
export interface AccessTokenVerifier {verify(accessToken:string):Promise<{userId:string}>}

export interface PrivyAuthConfig {appId:string;appSecret?:string;verificationKey?:string}

export function privyConfigFromEnv(environment:Record<string,string|undefined>=process.env):PrivyAuthConfig|undefined{
 const appId=environment.PRIVY_APP_ID?.trim();
 const appSecret=environment.PRIVY_APP_SECRET?.trim()||undefined;
 // Dashboards and .env files often store PEM newlines escaped.
 const verificationKey=environment.PRIVY_VERIFICATION_KEY?.trim().replace(/\\n/g,'\n')||undefined;
 if(!appId||(!appSecret&&!verificationKey))return undefined;
 return {appId,appSecret,verificationKey};
}

/**
 * Privy server-side verification via the official @privy-io/node SDK (v0.38 types):
 * - with a dashboard verification key: standalone verifyAccessToken({access_token, app_id, verification_key})
 * - otherwise: new PrivyClient({appId, appSecret}).utils().auth().verifyAccessToken(token)
 * https://docs.privy.io/authentication/user-authentication/access-tokens
 */
export function privyVerifier(config:PrivyAuthConfig):AccessTokenVerifier{
 const client=config.verificationKey?undefined:new PrivyClient({appId:config.appId,appSecret:config.appSecret!});
 return {async verify(accessToken){
  const claims=config.verificationKey
   ?await verifyAccessToken({access_token:accessToken,app_id:config.appId,verification_key:config.verificationKey})
   :await client!.utils().auth().verifyAccessToken(accessToken);
  if(claims.app_id!==config.appId||!/^did:privy:[A-Za-z0-9]{1,128}$/.test(claims.user_id))throw new Error('PRIVY_INVALID_TOKEN');
  return {userId:claims.user_id};
 }};
}

export function bearerToken(header:string|string[]|undefined){
 if(typeof header!=='string')return undefined;
 const match=/^Bearer ([A-Za-z0-9._-]{20,8192})$/.exec(header.trim());
 return match?.[1];
}

/**
 * Buyer authentication: a verified Privy access token is exchanged for a private, HttpOnly
 * application session with a CSRF token. Privy proves account control; it does not fund a wallet,
 * prove personhood, or verify a provider's answer.
 */
export class BuyerAuth {
 constructor(readonly store:BuyerSessionStore,readonly verifier?:AccessTokenVerifier,private options:{secureCookies?:boolean}={}){}
 get configured(){return Boolean(this.verifier);}
 status(){return {provider:'PRIVY' as const,configured:this.configured,notice:this.configured?'Privy sign-in. Application spending limits remain separate.':'Privy app ID and server verification credentials required.'};}
 private async userId(accessToken:string|undefined){
  if(!this.verifier)throw new Error('PRIVY_NOT_CONFIGURED');
  if(!accessToken)throw new Error('PRIVY_TOKEN_REQUIRED');
  try{return (await this.verifier.verify(accessToken)).userId;}catch{throw new Error('PRIVY_INVALID_TOKEN');}
 }
 /** Exchange a Privy access token for an application session; rotates any previous session cookie. */
 async exchange(accessToken:string|undefined,previousSessionToken?:string){
  const userId=await this.userId(accessToken);
  return this.store.createSession(PRIVY_ISSUER,userId,Math.floor(Date.now()/1000),previousSessionToken);
 }
 /** Explicit approval confirmation: a currently valid Privy token for the same buyer identity. */
 async confirm(accessToken:string|undefined,buyerId:string){
  const userId=await this.userId(accessToken);
  if(!this.store.identityMatches(buyerId,PRIVY_ISSUER,userId))throw new Error('PRIVY_IDENTITY_MISMATCH');
 }
 authenticate(token:string|undefined){return this.store.authenticate(token);}
 logout(token:string){this.store.revoke(token);}
 assertCsrf(session:StoredBuyerSession,token:string|undefined){if(!token||token.length!==session.csrfToken.length||!timingSafeEqual(Buffer.from(token),Buffer.from(session.csrfToken)))throw new Error('CSRF_INVALID');}
 cookie(token:string,expiresAt:string){return 'data_leases_buyer='+token+'; Path=/; HttpOnly; SameSite=Lax; Expires='+new Date(expiresAt).toUTCString()+(this.options.secureCookies===false?'':'; Secure');}
}

/** Secure cookies everywhere except an explicit, non-production loopback development opt-out. */
export function secureCookiesFromEnv(environment:Record<string,string|undefined>=process.env){
 return !(environment.NODE_ENV!=='production'&&environment.BUYER_ALLOW_LOCAL_HTTP==='true');
}
