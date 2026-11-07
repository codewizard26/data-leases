'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {PaidAnalysisBrief} from '@data-leases/contracts';
import AnalysisResult from '../analysis-result';
import {formatMetric} from '../format-metric';

type Answer={questionTemplateId:string;metric:string;value:string;unit:string};
type Report={runId:string;status:string;paymentStatus:string;verificationStatus:string;publicationStatus:string;analysisBrief?:PaidAnalysisBrief;computation?:{text:string;provider:string;model:string};answer?:Answer;measurements?:{answer:Answer;verification?:{executionMode:string;status:string};publicationStatus:string}[];quote?:{questionTemplateId?:string};verification?:{executionMode:string;status:string};error?:string};

export default function ReportsWorkspace({runId}:{runId?:string}){
 const [reports,setReports]=useState<Report[]>([]),[report,setReport]=useState<Report>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setReport(undefined);setReports([]);
  const path=runId?'runs/'+encodeURIComponent(runId):'runs';
  void fetch('/api/'+path,{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(async response=>{
   const body=await response.json();if(!response.ok)throw new Error(response.status===401?'Sign in to open your previous reports.':response.status===404?'This report is unavailable for your account.':body.error??'Reports unavailable');
   if(!controller.signal.aborted){if(runId)setReport(body);else setReports(body.runs);}
  }).catch((cause:unknown)=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Reports unavailable');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[runId,revision]);
 const saved=reports.filter(item=>item.analysisBrief||item.computation||item.measurements?.length||item.answer);
 return <main className="saved-reports-page"><header className="saved-reports-header"><Link href="/dashboard">← Back to dashboard</Link><Link href="/dashboard?view=account">My dashboard</Link></header><section className="single-workspace"><div className="workspace-heading"><div><p className="section-context">PRIVATE / SAVED ANALYSIS</p><h1>{runId?'Saved analysis report':'Previous analysis reports'}</h1><p>{runId?'Read a saved result without starting another request or payment.':'Your previous reports live here, separate from your current analysis and spending controls.'}</p></div><button disabled={loading} onClick={()=>setRevision(value=>value+1)}>Refresh</button></div><div className="workspace-content">
 {runId&&<p><Link href="/dashboard/reports">View all previous reports</Link></p>}
 {loading?<p role="status">Loading saved reports…</p>:error?<div role="alert"><p className="inline-warning">{error}</p><Link href="/dashboard?view=account">Open sign-in and account</Link></div>:runId&&report?<>
 <p className="hint">Report {report.runId}</p><dl className="registry-stat-grid">{[{label:'Execution',value:report.status},{label:'Payment',value:report.paymentStatus},{label:'Evidence',value:report.verification?.executionMode??report.verificationStatus}].map(item=><div key={item.label}><dt>{item.label}</dt><dd style={{fontSize:16}}>{item.value}</dd></div>)}</dl>
 {report.error&&<p className="inline-warning">{report.error}</p>}
 {report.analysisBrief&&<AnalysisResult brief={report.analysisBrief} titleFor={id=>id.replaceAll('_',' ')} evidenceAccepted={report.verificationStatus==='ACCEPTED'}/>}
 {report.computation&&<section aria-label="Saved computation"><h2>Delivered analysis</h2><p style={{whiteSpace:'pre-wrap'}}>{report.computation.text}</p><p className="hint">{report.computation.provider} · {report.computation.model}. Verification: {report.verificationStatus}.</p></section>}
 {(report.measurements??(report.answer?[{answer:report.answer,verification:report.verification,publicationStatus:report.publicationStatus}]:[])).map(item=>{const value=formatMetric(item.answer.value,item.answer.unit);return <article className="delivered-result" key={item.answer.questionTemplateId}><span>{item.answer.metric}</span><strong>{value.approximate?'≈ ':''}{value.value}</strong><p>{value.unit}</p><p className="hint">{item.verification?item.verification.executionMode+' · '+item.verification.status:'Evidence unavailable'}</p></article>;})}
 {!report.analysisBrief&&!report.computation&&!report.answer&&!report.measurements?.length&&<p>No report content is available for this request yet.</p>}
 </>:saved.length?<div className="saved-report-list">{saved.map(item=><article key={item.runId}><div><h2>{item.analysisBrief?.narrative.headline??item.answer?.metric??item.quote?.questionTemplateId??(item.computation?'Analysis report':'Measurement report')}</h2><p>{item.analysisBrief?new Date(item.analysisBrief.generatedAt).toLocaleString()+' · ':''}{item.paymentStatus} · {item.verification?.executionMode??item.verificationStatus}</p><code>{item.runId}</code></div><Link href={'/dashboard/reports?runId='+encodeURIComponent(item.runId)}>Open report</Link></article>)}</div>:<div className="empty-state compact"><h2>No previous reports</h2><p>Delivered analysis reports will appear here after your requests complete.</p><Link href="/dashboard">Start from Services</Link></div>}
 </div></section></main>;
}
