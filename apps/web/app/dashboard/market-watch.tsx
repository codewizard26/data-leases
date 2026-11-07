'use client';
import {useEffect,useState} from 'react';
import type {ProviderOffer} from './provider-offers';
type Observation={providerId:string;value:string;unit:string;sourceBlockNumber?:string;deliveredAt:string};
type FeedEvent={eventId:string;providerId?:string;status:string;occurredAt:string;payloadJson:string};
type Result={executionMode:string;status:string;referenceBlockNumber?:string;checks:{checkId:string;status:string;reasonCode:string}[]};
function unitLabel(unit:string){return ({USDC_RAW_6_DECIMALS:'USDC',WETH_RAW_18_DECIMALS:'WETH',BASIS_POINTS:'Percent', 'decimal-places':'Decimal places'} as Record<string,string>)[unit]??unit;}
function display(value:string,unit:string){
 const decimals=unit.includes('RAW_6')?6:unit.includes('RAW_18')?18:unit==='BASIS_POINTS'?2:0;
 if(!/^\d+$/.test(value))return value;
 const padded=value.padStart(decimals+1,'0'),whole=(decimals?padded.slice(0,-decimals):padded).replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return whole+(decimals?'.'+padded.slice(-decimals).slice(0,Math.min(decimals,4)):'')+(unit==='BASIS_POINTS'?'%':'');
}
export default function MarketWatch({questionTemplateId,offers=[],providerIds=[]}:{questionTemplateId:string;offers?:ProviderOffer[];providerIds?:string[]}){
 const [rows,setRows]=useState<Record<string,{answer?:Observation;status:string;changedAt?:string;previousValue?:string}>>({});
 const [events,setEvents]=useState<FeedEvent[]>([]),[connected,setConnected]=useState(false),[notice,setNotice]=useState('');
 const [job,setJob]=useState<{verificationId:string;providerId:string}>(),[result,setResult]=useState<Result>(),[starting,setStarting]=useState(false);
 const [requestId,setRequestId]=useState<string>();
 const [requestedProviderIds,setRequestedProviderIds]=useState<string[]>([]);
 const [now,setNow]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(!requestId)return;
  const params=new URLSearchParams({questionTemplateId,requestId});for(const id of requestedProviderIds)params.append('providerId',id);
  const stream=new EventSource('/api/market/events?'+params);
  stream.onopen=()=>setConnected(true);stream.onerror=()=>{stream.close();setConnected(false);setRequestId(undefined);setNotice('Request interrupted. Request another update to retry.');};
  stream.onmessage=message=>{
   try{
    const event=JSON.parse(message.data) as FeedEvent;if(event.status==='SOURCE_REQUEST_COMPLETED'){stream.close();setConnected(false);setRequestId(undefined);setNotice('Request complete. Values stay saved until you ask for another update.');return;}if(!event.providerId)return;
    const payload=JSON.parse(event.payloadJson) as {answer?:Observation;changed?:boolean;previousValue?:string};
    setEvents(previous=>previous.some(item=>item.eventId===event.eventId)?previous:[event,...previous].slice(0,8));
    setRows(previous=>{const prior=previous[event.providerId!];return {...previous,[event.providerId!]:{answer:payload.answer??prior?.answer,status:event.status,changedAt:payload.changed?event.occurredAt:prior?.changedAt,previousValue:payload.changed?payload.previousValue:prior?.previousValue}};});
   }catch{setNotice('Source event could not be read. Reconnecting preserves saved observations.');}
  };
  return()=>stream.close();
 },[questionTemplateId,requestId,requestedProviderIds]);
 useEffect(()=>{
  if(!job)return;let cancelled=false;let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   try{const response=await fetch('/api/observations/verification/'+encodeURIComponent(job.verificationId),{cache:'no-store'});if(!response.ok)throw Error('Simulation status unavailable.');const data=await response.json();if(cancelled)return;if(data.state==='FAILED'){setNotice('CRE simulation failed. The observation remains unverified. Retry when the CLI is available.');setJob(undefined);return;}if(data.result){setResult(data.result);setJob(undefined);return;}}
   catch{if(!cancelled)setNotice('Waiting for CRE simulation. The source observation remains unverified.');}
   if(!cancelled)timer=setTimeout(()=>void poll(),2000);
  };void poll();return()=>{cancelled=true;if(timer)clearTimeout(timer);};
 },[job]);
 async function simulate(providerId:string){
  setStarting(true);setResult(undefined);setNotice('CRE CLI simulation requested for this provider snapshot.');
  try{const response=await fetch('/api/observations/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionTemplateId,providerId})});const data=await response.json();if(!response.ok)throw Error(data.error??'Simulation unavailable.');setJob({verificationId:data.verificationId,providerId});}
  catch(error){setNotice((error as Error).message);}finally{setStarting(false);}
 }
 return <section className="market-watch" aria-label="Live provider source observations">
  <div className="panel-title"><div><h3>Request a source update</h3><p>Agents fetch one snapshot only when you ask. No automatic refresh or payment.</p></div><span className={'status-pill '+(connected?'live':'neutral')}>{requestId?(connected?'Working':'Starting'):'Idle'}</span></div>
  <div className="market-request-controls"><button disabled={Boolean(requestId)||!providerIds.length} onClick={()=>{setRequestedProviderIds([...providerIds]);setNotice('Reading public sources for the selected agents…');setRequestId(crypto.randomUUID());}}>Request update</button>{requestId&&<button onClick={()=>{setRequestId(undefined);setConnected(false);setNotice('Stopped listening. Already requested reads may finish; no further reads will start.');}}>Stop request</button>}<span>{providerIds.length} selected {providerIds.length===1?'agent':'agents'} · one snapshot each</span></div>
  <div className="market-provider-grid">{Object.entries(rows).map(([providerId,row])=>{
   const stale=Boolean(row.answer&&now-Date.parse(row.answer.deliveredAt)>60000),changed=Boolean(row.changedAt&&now-Date.parse(row.changedAt)<30000);
   const offer=offers.find(offer=>offer.providerId===providerId);
   return <article className={'market-provider'+(changed?' value-changed':'')} key={providerId}><div className="agent-heading"><span className="agent-avatar" aria-hidden="true">{providerId.slice(-1).toUpperCase()}</span><div><h4>{offer?.displayName??'Agent '+providerId.replace('provider-','').toUpperCase()}</h4><small>{row.status==='READING_PUBLIC_SOURCE'?'Reading Ethereum RPC…':row.status==='SOURCE_UNAVAILABLE'?'Source unavailable':stale?'Last observation is stale':'Source read complete'}</small></div></div>
    {offer?.askMinor&&<p className="watch-asking-rate">Starting ask <strong>{offer.askMinor}</strong> tinybars / request</p>}{row.answer?<><strong className="market-value" title={row.answer.value+' '+row.answer.unit}>{display(row.answer.value,row.answer.unit)}</strong><small>{unitLabel(row.answer.unit)}</small>{changed&&row.previousValue&&<p className="value-change-note">Changed from {display(row.previousValue,row.answer.unit)}</p>}<p className="hint">Block {row.answer.sourceBlockNumber} · {new Date(row.answer.deliveredAt).toLocaleTimeString()}</p><button disabled={starting||Boolean(job)||stale||row.status==='SOURCE_UNAVAILABLE'} onClick={()=>void simulate(providerId)}>{job?.providerId===providerId?'CRE simulation running…':'Verify snapshot with CRE'}</button><small className="market-unverified">Source observation · unverified until simulation completes</small></>:<p className="hint">Waiting for a real source response.</p>}
   </article>;
  })}</div>
  {!Object.keys(rows).length&&<p className="market-idle-note">{requestId?'Waiting for the requested source responses…':'Agents are idle. Choose your providers, then request an update.'}</p>}
  <details className="market-events"><summary>Requested agent updates</summary><ol>{events.map(event=><li key={event.eventId}><time>{new Date(event.occurredAt).toLocaleTimeString()}</time><strong>{event.providerId}</strong><span>{event.status.replaceAll('_',' ').toLowerCase()}</span></li>)}</ol></details>
  {notice&&<p role="status" className="hint">{notice}</p>}
  {result&&<div className="market-verification"><strong>CRE CLI simulation: {result.status}</strong><p>Snapshot block {result.referenceBlockNumber??'unavailable'}. Local simulation, separate from subsequent source updates.</p><details><summary>View service checks</summary><ul>{result.checks.map(check=><li key={check.checkId}>{check.checkId}: {check.status} · {check.reasonCode}</li>)}</ul></details></div>}
 </section>;
}
