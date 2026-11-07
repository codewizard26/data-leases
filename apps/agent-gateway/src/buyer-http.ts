import type {IncomingMessage,ServerResponse} from 'node:http';
import {BuyerApprovalPurposeSchema,BuyerLeasePolicySchema} from '@data-leases/contracts';
import {BuyerStore} from './buyer-store.js';
import {BuyerAuth,bearerToken} from './buyer-auth.js';

export class BuyerHttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
export function requestCookie(request:IncomingMessage,name:string){return request.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1);}

/** Browser origins allowed to mutate buyer state: loopback dev console plus explicit WEB_ORIGINS (e.g. the Vercel URL). */
export function allowedWebOrigins(baseUrl:string,environment:Record<string,string|undefined>=process.env){
 const configured=(environment.WEB_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean).flatMap(value=>{try{const url=new URL(value);return url.protocol==='https:'||['127.0.0.1','localhost'].includes(url.hostname)?[url.origin]:[];}catch{return [];}});
 return new Set([baseUrl,baseUrl.replace('127.0.0.1','localhost'),'http://127.0.0.1:3001','http://localhost:3001',...configured]);
}

/** HTTP boundaries keep browser input separate from verified action bindings. */
export class BuyerHttp {
 private origins:Set<string>|undefined;
 constructor(readonly auth:BuyerAuth,readonly buyers:BuyerStore,readonly enabled:boolean,private cap:()=>string|undefined,private audit:(leaseId:string,status:string)=>void=()=>{}){}
 session(request:IncomingMessage){return this.auth.authenticate(requestCookie(request,'data_leases_buyer'));}
 require(request:IncomingMessage,mutate=false){const session=this.session(request);if(!session)throw new BuyerHttpError(401,'BUYER_AUTH_REQUIRED');if(mutate){try{this.auth.assertCsrf(session,typeof request.headers['x-csrf-token']==='string'?request.headers['x-csrf-token']:undefined);}catch{throw new BuyerHttpError(403,'CSRF_INVALID');}}return session;}
 private privyError(error:unknown):never{const message=error instanceof Error?error.message:'PRIVY_INVALID_TOKEN';if(message==='PRIVY_NOT_CONFIGURED')throw new BuyerHttpError(503,message);if(message==='PRIVY_IDENTITY_MISMATCH')throw new BuyerHttpError(403,message);throw new BuyerHttpError(401,message.startsWith('PRIVY_')?message:'PRIVY_INVALID_TOKEN');}
 async handle(request:IncomingMessage,response:ServerResponse,path:string,baseUrl:string,readBody:()=>Promise<Record<string,unknown>>,json:(status:number,value:unknown)=>void):Promise<boolean>{
  if(path==='/api/auth/session'&&request.method==='GET'){const session=this.session(request);json(200,{authenticated:this.enabled&&Boolean(session),...(this.enabled&&session?{buyer:{buyerId:session.buyerId},csrfToken:session.csrfToken,expiresAt:session.expiresAt}:{}),auth:{...this.auth.status(),enabled:this.enabled,notice:this.enabled?this.auth.status().notice:'Buyer protection disabled. Local demo only; configure Privy before private use.'}});return true;}
  const authRoute=path.startsWith('/api/auth/'),buyerRoute=path==='/api/buyer/leases'||/^\/api\/(approvals\/[^/]+\/(deny|approve)|leases\/[^/]+\/(budget-requests|reduce))$/.test(path);
  if(!authRoute&&!buyerRoute)return false;
  if(!this.enabled)throw new BuyerHttpError(503,'BUYER_AUTH_DISABLED');
  if(request.method==='GET'&&path==='/api/buyer/leases'){const session=this.require(request);json(200,{leases:this.buyers.list(session.buyerId),approvals:this.buyers.approvals(session.buyerId)});return true;}
  if(request.method!=='POST')throw new BuyerHttpError(404,'NOT_FOUND');
  this.origins??=allowedWebOrigins(baseUrl);
  const origin=request.headers.origin;
  if(!origin||!this.origins.has(origin))throw new BuyerHttpError(403,'ORIGIN_NOT_ALLOWED');
  if(path==='/api/auth/privy'){
   await readBody();
   const result=await this.auth.exchange(bearerToken(request.headers.authorization),requestCookie(request,'data_leases_buyer')).catch(error=>this.privyError(error));
   response.setHeader('Set-Cookie',this.auth.cookie(result.token,result.expiresAt));
   json(200,{authenticated:true,buyer:{buyerId:result.buyerId},csrfToken:result.csrfToken,expiresAt:result.expiresAt});return true;
  }
  const session=this.require(request,true),body=await readBody();
  if(path==='/api/auth/logout'){this.auth.logout(requestCookie(request,'data_leases_buyer')!);response.setHeader('Set-Cookie',this.auth.cookie('',new Date(0).toISOString()));json(200,{authenticated:false});return true;}
  const lease=path.match(/^\/api\/leases\/([^/]+)\/(budget-requests|reduce)$/);
  if(lease){const policy=BuyerLeasePolicySchema.parse(body.proposedPolicy);if(policy.leaseId!==lease[1])throw new BuyerHttpError(400,'LEASE_ID_MISMATCH');this.buyers.assertOwner(session.buyerId,policy.leaseId);if(lease[2]==='reduce'){if(typeof body.baseRevision!=='number')throw new BuyerHttpError(400,'INVALID_REVISION');const reduced=this.buyers.reduce(session.buyerId,policy,body.baseRevision);this.audit(policy.leaseId,'BUYER_AUTHORITY_REDUCED');json(200,reduced);}else{const approval=this.buyers.request(session.buyerId,policy);this.audit(policy.leaseId,'BUYER_APPROVAL_REQUESTED');json(201,{approval});}return true;}
  const approvalPath=path.match(/^\/api\/approvals\/([^/]+)\/(deny|approve)$/);
  if(approvalPath){
   const id=approvalPath[1]!;
   if(approvalPath[2]==='deny'){const denied=this.buyers.deny(session.buyerId,id);this.audit(denied.leaseId,'BUYER_APPROVAL_DENIED');json(200,{approval:denied});return true;}
   const approval=this.buyers.approval(session.buyerId,id);
   if(body.policyHash!==approval.policyHash)throw new BuyerHttpError(400,'APPROVAL_TERMS_CHANGED');
   if(approval.status!=='PENDING')throw new BuyerHttpError(409,'APPROVAL_NOT_PENDING');
   if(Date.parse(approval.expiresAt)<=Date.now())throw new BuyerHttpError(409,'APPROVAL_EXPIRED');
   // Explicit confirmation with a currently valid Privy token for the same identity. Not proof of personhood.
   await this.auth.confirm(bearerToken(request.headers.authorization),session.buyerId).catch(error=>this.privyError(error));
   this.buyers.complete(session.buyerId,id,{buyerId:session.buyerId,nonce:approval.nonce,purpose:BuyerApprovalPurposeSchema.parse(approval.purpose),policyHash:approval.policyHash},this.cap()??'0');
   this.audit(approval.leaseId,'BUYER_APPROVAL_COMPLETED');
   json(200,{approval:this.buyers.approval(session.buyerId,id)});return true;
  }
  throw new BuyerHttpError(404,'NOT_FOUND');
 }
}
