'use client';

import {useEffect,useState} from 'react';

type Entry={entityKey:string;providerId:string;entityType:string;createdAt:string;status:string;executionMode?:string;runId?:string;url:string};

/** A bounded service query describes returned entities, never network-wide totals or trading volume. */
export function summarizeRegistry(entries:Entry[]){
 const unique=[...new Map(entries.map(entry=>[entry.entityKey,entry])).values()];
 return {
  entities:unique.length,
  providers:new Set(unique.map(entry=>entry.providerId)).size,
  offers:unique.filter(entry=>entry.entityType==='ProviderOffer').length,
  answers:unique.filter(entry=>entry.entityType==='AnswerReceipt').length,
  simulations:unique.filter(entry=>entry.entityType==='VerificationRecord'&&entry.executionMode==='CRE_CLI_SIMULATION').length,
  mock:unique.filter(entry=>entry.entityType==='VerificationRecord'&&entry.executionMode==='MOCK').length,
  live:unique.filter(entry=>entry.entityType==='VerificationRecord'&&entry.executionMode==='LIVE_CRE').length,
  payments:unique.filter(entry=>entry.entityType==='PaymentReference'&&entry.status==='CONFIRMED').length,
  accepted:unique.filter(entry=>entry.entityType==='VerificationRecord'&&entry.status==='ACCEPTED').length,
 };
}

export default function RegistryStats({questionTemplateId,title,connected,refreshKey}:{questionTemplateId:string;title:string;connected:boolean;refreshKey:string}){
 const [result,setResult]=useState<{scope:string;entries:Entry[];readAt:string}>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!connected)return;
  const controller=new AbortController();setLoading(true);setError('');
  const params=new URLSearchParams({questionTemplateId});
  void fetch('/api/registry/history?'+params,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   const body=await response.json();if(!response.ok)throw new Error(body.error??'Arkiv query failed');
   if(body.source!=='ARKIV'||!Array.isArray(body.entries))throw new Error('Arkiv response unavailable');
   if(!controller.signal.aborted)setResult({scope:questionTemplateId,entries:body.entries,readAt:new Date().toISOString()});
  }).catch((cause:unknown)=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Arkiv query failed');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[questionTemplateId,connected,refreshKey,revision]);
 const current=result?.scope===questionTemplateId?result:undefined;
 const stats=current?summarizeRegistry(current.entries):undefined;
 return <section className="registry-stats" aria-labelledby="registry-stats-title">
  <div className="panel-title"><div><p className="section-context">ARKIV / RABDI TESTNET</p><h2 id="registry-stats-title">Published evidence, in view.</h2><p>{title} · Records queried from Arkiv for configured providers.</p></div><button disabled={!connected||loading} onClick={()=>setRevision(value=>value+1)}>{loading?'Reading Arkiv…':'Refresh entities'}</button></div>
  {!connected?<p className="inline-warning">Connect Arkiv to read published entities. Statistics are unavailable.</p>:error?<p className="inline-warning" role="alert">{error}. Refresh to retry; previous counts are hidden.</p>:loading?<p role="status">Reading published entities…</p>:stats?<>
   <dl className="registry-stat-grid">{[{label:'Entities returned',value:stats.entities},{label:'Providers represented',value:stats.providers},{label:'Offer records',value:stats.offers},{label:'Answer receipts',value:stats.answers},{label:'Verification records accepted',value:stats.accepted},{label:'Confirmed payment references',value:stats.payments}].map(stat=><div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>
   <p className="hint">Evidence mode: {stats.simulations} CRE CLI simulation records · {stats.live} live CRE records · {stats.mock} mock records. Publication alone does not verify an answer.</p>
   <p className="hint">Up to 100 returned entities for this service; historical offers are included. Counts are not network totals or payment volume. Read {new Date(current!.readAt).toLocaleTimeString()}.</p>
  </>:<p role="status">Waiting for Arkiv records…</p>}
 </section>;
}
