import type {BuyerActionBinding,BuyerSession} from '@data-leases/contracts';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname} from 'node:path';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const worldSecret=()=>randomBytes(32).toString('base64url');
export interface WorldSession extends BuyerSession {authTime:number;identityHash:string}
export interface WorldActionBinding extends BuyerActionBinding {approvalId:string}
export interface WorldAttempt {state:string;browserHash:string;nonce:string;verifier:string;createdAt:number;expiresAt:number;approval?:WorldActionBinding}
/** Private authentication storage. Never pass these rows to the public event sink. */
export class WorldSessionStore {
 private db:DatabaseSync;
 constructor(path:string,private now:()=>number=Date.now){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS world_buyers(identity_hash TEXT PRIMARY KEY,buyer_id TEXT UNIQUE NOT NULL); CREATE TABLE IF NOT EXISTS world_sessions(token_hash TEXT PRIMARY KEY,value TEXT NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS world_attempts(state_hash TEXT PRIMARY KEY,value TEXT NOT NULL,expires_at INTEGER NOT NULL)');}
 saveAttempt(browserBinding:string,approval?:WorldActionBinding){const createdAt=this.now();const attempt:WorldAttempt={state:worldSecret(),browserHash:hash(browserBinding),nonce:worldSecret(),verifier:worldSecret(),createdAt,expiresAt:createdAt+300_000,...(approval?{approval}:{})};this.db.prepare('DELETE FROM world_attempts WHERE expires_at<=?').run(createdAt);this.db.prepare('INSERT INTO world_attempts VALUES(?,?,?)').run(hash(attempt.state),JSON.stringify(attempt),attempt.expiresAt);return attempt;}
 consumeAttempt(state:string,browserBinding:string){this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT value FROM world_attempts WHERE state_hash=?').get(hash(state));if(!row)throw new Error('WORLD_FLOW_INVALID');const attempt=JSON.parse(String(row.value)) as WorldAttempt;if(attempt.browserHash!==hash(browserBinding)||attempt.expiresAt<=this.now())throw new Error('WORLD_FLOW_INVALID');this.db.prepare('DELETE FROM world_attempts WHERE state_hash=?').run(hash(state));this.db.exec('COMMIT');return attempt;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 createSession(issuer:string,subject:string,authTime:number,previousToken?:string){const identityHash=hash(JSON.stringify([issuer,subject]));this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR IGNORE INTO world_buyers VALUES(?,?)').run(identityHash,randomUUID());const buyerId=String(this.db.prepare('SELECT buyer_id FROM world_buyers WHERE identity_hash=?').get(identityHash)!.buyer_id);const token=worldSecret();const session:WorldSession={buyerId,identityHash,authTime,csrfToken:worldSecret(),expiresAt:new Date(this.now()+8*3600_000).toISOString()};if(previousToken)this.db.prepare('DELETE FROM world_sessions WHERE token_hash=?').run(hash(previousToken));this.db.prepare('INSERT INTO world_sessions VALUES(?,?,?)').run(hash(token),JSON.stringify(session),Date.parse(session.expiresAt));this.db.exec('COMMIT');return {token,...session};}catch(error){this.db.exec('ROLLBACK');throw error;}}
 authenticate(token:string|undefined){if(!token)return undefined;const row=this.db.prepare('SELECT value,expires_at FROM world_sessions WHERE token_hash=?').get(hash(token));if(!row||Number(row.expires_at)<=this.now())return undefined;return JSON.parse(String(row.value)) as WorldSession;}
 identityMatches(buyerId:string,issuer:string,subject:string){return Boolean(this.db.prepare('SELECT 1 FROM world_buyers WHERE buyer_id=? AND identity_hash=?').get(buyerId,hash(JSON.stringify([issuer,subject]))));}
 revoke(token:string){this.db.prepare('DELETE FROM world_sessions WHERE token_hash=?').run(hash(token));}
 close(){this.db.close();}
}
