import type {IncomingMessage,ServerResponse} from 'node:http';
import {BuyerApprovalPurposeSchema,BuyerLeasePolicySchema} from '@data-leases/contracts';
import {BuyerStore} from './buyer-store.js';
import {WorldAuth} from './world-auth.js';
import {worldSecret} from './world-session-store.js';

export class BuyerHttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
export function requestCookie(request:IncomingMessage,name:string){return request.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1);}
/** HTTP boundaries keep browser input separate from verified action bindings. */
export class BuyerHttp {
 constructor(readonly auth:WorldAuth,readonly buyers:BuyerStore,readonly enabled:boolean,private cap:()=>string|undefined,private audit:(leaseId:string,status:string)=>void=()=>{}){}
 session(request:IncomingMessage){return this.auth.authenticate(requestCookie(request,'data_leases_buyer'));}
 require(request:IncomingMessage,mutate=false){const session=this.session(request);if(!session)throw new BuyerHttpError(401,'BUYER_AUTH_REQUIRED');if(mutate){try{this.auth.assertCsrf(session,typeof request.headers['x-csrf-token']==='string'?request.headers['x-csrf-token']:undefined);}catch{throw new BuyerHttpError(403,'CSRF_INVALID');}}return session;}
 private flowCookie(value:string){return 'data_leases_world_flow='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=300'+(this.auth.config?.allowLocalHttp?'':'; Secure');}
 async handle(request:IncomingMessage,response:ServerResponse,path:string,baseUrl:string,readBody:()=>Promise<Record<string,unknown>>,json:(status:number,value:unknown)=>void):Promise<boolean>{
  if(path==='/api/auth/session'&&request.method==='GET'){const session=this.session(request);json(200,{authenticated:this.enabled&&Boolean(session),...(this.enabled&&session?{buyer:{buyerId:session.buyerId},csrfToken:session.csrfToken,expiresAt:session.expiresAt}:{}),world:{...this.auth.status(),enabled:this.enabled,notice:this.enabled?this.auth.status().notice:'Buyer protection disabled. Local demo only; enable WORLD_AUTH_ENABLED before private use.'}});return true;}
  const authRoute=path.startsWith('/api/auth/'),buyerRoute=path==='/api/buyer/leases'||/^\/api\/(approvals\/[^/]+\/(deny|start)|leases\/[^/]+\/(budget-requests|reduce))$/.test(path);
  if(!authRoute&&!buyerRoute)return false;
  if(!this.enabled)throw new BuyerHttpError(503,'WORLD_AUTH_DISABLED');
  if(request.method==='GET'&&path==='/api/auth/world/callback'){
   const params=new URL(request.url!,baseUrl).searchParams;
   response.setHeader('Set-Cookie',this.flowCookie('')+'; Max-Age=0');
   const result=await this.auth.complete({state:params.get('state')??'',code:params.get('code')??'',issuer:params.get('iss')??'',browserBinding:requestCookie(request,'data_leases_world_flow')??'',previousSessionToken:requestCookie(request,'data_leases_buyer')});
   if(result.approval){const binding=result.approval;this.buyers.complete(result.buyerId,binding.approvalId,{...binding,purpose:BuyerApprovalPurposeSchema.parse(binding.purpose)},this.cap()??'0');const approved=this.buyers.approval(result.buyerId,binding.approvalId);this.audit(approved.leaseId,'BUYER_APPROVAL_COMPLETED');}
   response.writeHead(303,{'Location':'/dashboard','Cache-Control':'no-store','Set-Cookie':[this.auth.cookie(result.token,result.expiresAt),this.flowCookie('')+'; Max-Age=0']});response.end();return true;
  }
  if(request.method==='GET'&&path==='/api/buyer/leases'){const session=this.require(request);json(200,{leases:this.buyers.list(session.buyerId),approvals:this.buyers.approvals(session.buyerId)});return true;}
  if(request.method!=='POST')throw new BuyerHttpError(404,'NOT_FOUND');
  const origin=request.headers.origin;
  const allowed=new Set([baseUrl,baseUrl.replace('127.0.0.1','localhost'),'http://127.0.0.1:3001','http://localhost:3001',...(this.auth.config?[new URL(this.auth.config.redirectUri).origin]:[])]);
  if(!origin||!allowed.has(origin))throw new BuyerHttpError(403,'ORIGIN_NOT_ALLOWED');
  if(path==='/api/auth/world/start'){await readBody();const flow=worldSecret();const result=await this.auth.start({browserBinding:flow});response.setHeader('Set-Cookie',this.flowCookie(flow));json(200,result);return true;}
  const session=this.require(request,true),body=await readBody();
  if(path==='/api/auth/logout'){this.auth.logout(requestCookie(request,'data_leases_buyer')!);response.setHeader('Set-Cookie',this.auth.cookie('',new Date(0).toISOString()));json(200,{authenticated:false});return true;}
  const lease=path.match(/^\/api\/leases\/([^/]+)\/(budget-requests|reduce)$/);
  if(lease){const policy=BuyerLeasePolicySchema.parse(body.proposedPolicy);if(policy.leaseId!==lease[1])throw new BuyerHttpError(400,'LEASE_ID_MISMATCH');this.buyers.assertOwner(session.buyerId,policy.leaseId);if(lease[2]==='reduce'){if(typeof body.baseRevision!=='number')throw new BuyerHttpError(400,'INVALID_REVISION');const reduced=this.buyers.reduce(session.buyerId,policy,body.baseRevision);this.audit(policy.leaseId,'BUYER_AUTHORITY_REDUCED');json(200,reduced);}else{const approval=this.buyers.request(session.buyerId,policy);this.audit(policy.leaseId,'BUYER_APPROVAL_REQUESTED');json(201,{approval});}return true;}
  const approvalPath=path.match(/^\/api\/approvals\/([^/]+)\/(deny|start)$/);
  if(approvalPath){const id=approvalPath[1]!;if(approvalPath[2]==='deny'){const denied=this.buyers.deny(session.buyerId,id);this.audit(denied.leaseId,'BUYER_APPROVAL_DENIED');json(200,{approval:denied});return true;}const approval=this.buyers.approval(session.buyerId,id);if(body.policyHash!==approval.policyHash)throw new BuyerHttpError(400,'APPROVAL_TERMS_CHANGED');if(approval.status!=='PENDING')throw new BuyerHttpError(409,'APPROVAL_NOT_PENDING');const flow=worldSecret();const result=await this.auth.start({browserBinding:flow,approval:{buyerId:session.buyerId,approvalId:id,nonce:approval.nonce,purpose:approval.purpose,policyHash:approval.policyHash}});response.setHeader('Set-Cookie',this.flowCookie(flow));json(200,result);return true;}
  throw new BuyerHttpError(404,'NOT_FOUND');
 }
}
