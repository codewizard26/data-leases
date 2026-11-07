import type {BuyerSession} from '@data-leases/contracts';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname} from 'node:path';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const sessionSecret=()=>randomBytes(32).toString('base64url');
export const SESSION_TTL_MS=8*3600_000;
export interface StoredBuyerSession extends BuyerSession {authTime:number;identityHash:string;issuer?:string}

/**
 * Private buyer identity and session storage. The identity provider subject (for example a Privy DID)
 * is stored only as a hash; buyers are referenced everywhere else by an opaque buyerId.
 * Never pass these rows to the public event sink, Parquet or Arkiv.
 */
export class BuyerSessionStore {
 private db:DatabaseSync;
 constructor(path:string,private now:()=>number=Date.now){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);
  if(path!==':memory:')chmodSync(path,0o600);
  this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS buyer_identities(identity_hash TEXT PRIMARY KEY,buyer_id TEXT UNIQUE NOT NULL); CREATE TABLE IF NOT EXISTS buyer_sessions(token_hash TEXT PRIMARY KEY,value TEXT NOT NULL,expires_at INTEGER NOT NULL)');
 }
 private identityHash(issuer:string,subject:string){return hash(JSON.stringify([issuer,subject]));}
 createSession(issuer:string,subject:string,authTime:number,previousToken?:string){
  const identityHash=this.identityHash(issuer,subject);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('INSERT OR IGNORE INTO buyer_identities VALUES(?,?)').run(identityHash,randomUUID());
   const buyerId=String(this.db.prepare('SELECT buyer_id FROM buyer_identities WHERE identity_hash=?').get(identityHash)!.buyer_id);
   const token=sessionSecret();
   const session:StoredBuyerSession={buyerId,identityHash,issuer,authTime,csrfToken:sessionSecret(),expiresAt:new Date(this.now()+SESSION_TTL_MS).toISOString()};
   this.db.prepare('DELETE FROM buyer_sessions WHERE expires_at<=?').run(this.now());
   if(previousToken)this.db.prepare('DELETE FROM buyer_sessions WHERE token_hash=?').run(hash(previousToken));
   this.db.prepare('INSERT INTO buyer_sessions VALUES(?,?,?)').run(hash(token),JSON.stringify(session),Date.parse(session.expiresAt));
   this.db.exec('COMMIT');
   return {token,...session};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 authenticate(token:string|undefined){
  if(!token)return undefined;
  const row=this.db.prepare('SELECT value,expires_at FROM buyer_sessions WHERE token_hash=?').get(hash(token));
  if(!row||Number(row.expires_at)<=this.now())return undefined;
  return JSON.parse(String(row.value)) as StoredBuyerSession;
 }
 identityMatches(buyerId:string,issuer:string,subject:string){return Boolean(this.db.prepare('SELECT 1 FROM buyer_identities WHERE buyer_id=? AND identity_hash=?').get(buyerId,this.identityHash(issuer,subject)));}
 revoke(token:string){this.db.prepare('DELETE FROM buyer_sessions WHERE token_hash=?').run(hash(token));}
 close(){this.db.close();}
}
