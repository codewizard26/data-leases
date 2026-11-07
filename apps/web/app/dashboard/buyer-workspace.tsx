'use client';

import {useEffect, useState} from 'react';
import {hbar} from './public-dashboard';
import type {BuyerApproval, BuyerLeasePolicy} from '@data-leases/contracts';

export type BuyerRun = {runId: string; sessionId: string; leaseId?: string; status: string; paymentStatus: string; deliveryStatus: string; verificationStatus: string; publicationStatus: string};

type BuyerSession = {
 authenticated: boolean;
 buyer?: {buyerId: string};
 csrfToken?: string;
 world: {configured: boolean; environment: string; notice?: string};
};

async function request<T>(path: string, options?: {body: unknown; csrfToken?: string}, signal?: AbortSignal): Promise<T> {
 const response = await fetch('/api/' + path, {
  cache: 'no-store', credentials: 'same-origin', signal,
  ...(options ? {method: 'POST', headers: {'Content-Type': 'application/json', ...(options.csrfToken ? {'x-csrf-token': options.csrfToken} : {})}, body: JSON.stringify(options.body)} : {}),
 });
 const data = await response.json();
 if (!response.ok) throw new Error(data.error ?? 'Request failed');
 return data as T;
}

export default function BuyerWorkspace({initialApproval, onRun}: {initialApproval?: BuyerApproval; onRun?: (run: BuyerRun) => void}) {
 const [session, setSession] = useState<BuyerSession>();
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 useEffect(() => {
  const controller = new AbortController();
  void request<BuyerSession>('auth/session', undefined, controller.signal).then(setSession).catch((cause: unknown) => {
   if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Session unavailable');
  });
  return () => controller.abort();
 }, []);
 async function signIn() {
  setBusy(true); setError('');
  try {
   const result = await request<{authorizationUrl: string}>('auth/world/start', {body: {returnTo: '/dashboard'}, csrfToken: session?.csrfToken});
   const destination = new URL(result.authorizationUrl, window.location.origin);
   if (destination.protocol !== 'https:' && destination.origin !== window.location.origin) throw new Error('Unsafe authentication destination');
   window.location.assign(destination.href);
  } catch (cause) {setError(cause instanceof Error ? cause.message : 'Sign-in unavailable'); setBusy(false);}
 }
 async function logout() {
  setBusy(true); setError('');
  try {
   await request('auth/logout', {body: {}, csrfToken: session?.csrfToken});
   setSession(undefined);
   window.location.reload();
  } catch (cause) {setError(cause instanceof Error ? cause.message : 'Sign-out failed');}
  finally {setBusy(false);}
 }
 return <section className="single-workspace" aria-labelledby="buyer-workspace-title">
  <div className="workspace-heading"><div><p className="section-context">Your private buyer workspace</p><h2 id="buyer-workspace-title">Your agent. Your authority.</h2></div><span className="status-pill neutral">{session?.authenticated ? 'Signed in' : 'Sign-in required'}</span></div>
  <div className="workspace-content">
   <div className="panel-title"><div><h3>World Agent Pass</h3><p>Approve bounded spending. Routine runs stay within the policy you authorize.</p></div>{session?.authenticated ? <button disabled={busy} onClick={() => void logout()}>Sign out</button> : <button className="primary" disabled={busy || !session?.world.configured} onClick={() => void signIn()}>{busy ? 'Opening World…' : 'Sign in with World'}</button>}</div>
   {session ? <p className="hint">{session.world.environment}{session.world.notice ? ' · ' + session.world.notice : ''}</p> : <p className="hint">Checking application session…</p>}
   {session && !session.world.configured ? <p className="inline-warning">World Agent Pass is not configured. Sign-in and spending approvals remain unavailable.</p> : null}
   <p className="hint">Human verification does not fund your wallet or verify a provider’s answer. Signing out ends browser access; pause or cancel a lease to stop future runs.</p>
   {error ? <p className="inline-warning" role="alert">{error}</p> : null}
   {session?.authenticated ? <PrivateOverview/> : null}
   {session?.authenticated ? <BuyerLeases csrfToken={session.csrfToken} worldConfigured={session.world.configured} initialApproval={initialApproval} onRun={onRun} /> : <div className="empty-state compact"><h3>Sign in to see your leases and spending</h3><p>Only your authenticated buyer can access your private records and approve increased authority.</p></div>}
  </div>
 </section>;
}

type OwnedLease = {
 leaseId: string;
 revision: number;
 active: boolean;
 schedule?: {state: string};
 policy: BuyerLeasePolicy;
 reservedTinybars: string;
 remainingTinybars: string;
 approval?: BuyerApproval;
};

function BuyerLeases({csrfToken, worldConfigured, initialApproval, onRun}: {csrfToken?: string; worldConfigured: boolean; initialApproval?: BuyerApproval; onRun?: (run: BuyerRun) => void}) {
 const [leases, setLeases] = useState<OwnedLease[]>([]);
 const [approvals, setApprovals] = useState<BuyerApproval[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const [editing, setEditing] = useState<OwnedLease | undefined>(initialApproval ? {leaseId: initialApproval.leaseId, revision: initialApproval.baseRevision, active: false, policy: initialApproval.proposedPolicy, reservedTinybars: '0', remainingTinybars: '0'} : undefined);
 const [perRequest, setPerRequest] = useState(initialApproval?.proposedPolicy.perRequestTinybars ?? '');
 const [total, setTotal] = useState(initialApproval?.proposedPolicy.totalTinybars ?? '');
 const [expiry, setExpiry] = useState(initialApproval?.proposedPolicy.expiresAt ?? '');
 const [approval, setApproval] = useState<BuyerApproval | undefined>(initialApproval);
 const [reviewed, setReviewed] = useState(false);
 useEffect(() => {
  const controller = new AbortController();
  void request<{leases: OwnedLease[]; approvals: BuyerApproval[]}>('buyer/leases', undefined, controller.signal).then(result => {setLeases(result.leases);setApprovals(result.approvals);}).catch((cause: unknown) => {
   if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Spending unavailable');
  }).finally(() => {if (!controller.signal.aborted) setLoading(false);});
  return () => controller.abort();
 }, []);
 async function refresh() {
  const result = await request<{leases: OwnedLease[]; approvals: BuyerApproval[]}>('buyer/leases');
  setLeases(result.leases); setApprovals(result.approvals);
 }
 async function mutate(action: () => Promise<void>) {
  setBusy(true); setError('');
  try {await action();} catch (cause) {setError(cause instanceof Error ? cause.message : 'Action failed');}
  finally {setBusy(false);}
 }
 function reviewApproval(item: BuyerApproval) {
  const lease = leases.find(value => value.leaseId === item.leaseId);
  setEditing(lease ?? {leaseId: item.leaseId, revision: item.baseRevision, active: false, policy: item.proposedPolicy, reservedTinybars: '0', remainingTinybars: '0'});
  setPerRequest(item.proposedPolicy.perRequestTinybars); setTotal(item.proposedPolicy.totalTinybars); setExpiry(item.proposedPolicy.expiresAt);
  setApproval(item); setReviewed(false); setError('');
 }
 function edit(lease: OwnedLease) {
  setEditing(lease); setPerRequest(lease.policy.perRequestTinybars); setTotal(lease.policy.totalTinybars);
  setExpiry(lease.policy.expiresAt); setApproval(undefined); setReviewed(false); setError('');
 }
 async function propose() {
  if (!editing || !/^[1-9][0-9]{0,18}$/.test(perRequest) || !/^[1-9][0-9]{0,18}$/.test(total)) throw new Error('Enter positive integer tinybar amounts.');
  const expiresAt = new Date(expiry).toISOString();
  const proposedPolicy = {...editing.policy, perRequestTinybars: perRequest, totalTinybars: total, expiresAt};
  if (editing.revision > 0 && BigInt(perRequest) <= BigInt(editing.policy.perRequestTinybars) && BigInt(total) <= BigInt(editing.policy.totalTinybars) && Date.parse(expiresAt) <= Date.parse(editing.policy.expiresAt)) {
   await request('leases/' + editing.leaseId + '/reduce', {body: {proposedPolicy, baseRevision: editing.revision}, csrfToken});
   await refresh(); setEditing(undefined); setApproval(undefined); return;
  }
  const result = await request<{approval: BuyerApproval}>('leases/' + editing.leaseId + '/budget-requests', {body: {proposedPolicy, purpose: 'INCREASE_AUTHORITY'}, csrfToken});
  setApproval(result.approval); setReviewed(false); await refresh();
 }
 async function control(leaseId: string, action: 'PAUSE' | 'RESUME' | 'CANCEL') {
  await request(action === 'CANCEL' ? 'leases/cancel' : 'leases/control', {body: action === 'CANCEL' ? {leaseId} : {leaseId, action}, csrfToken});
  await refresh();
 }
 async function runOnce(leaseId: string) {
  const run = await request<BuyerRun>('runs', {body: {runId: crypto.randomUUID(), leaseId, mode: 'ARKIV'}, csrfToken});
  onRun?.(run);
 }
 async function deny() {
  if (!approval) return;
  await request('approvals/' + approval.approvalId + '/deny', {body: {}, csrfToken});
  setApproval({...approval, status: 'DENIED'}); await refresh();
 }
 async function approve() {
  if (!approval || !reviewed || !worldConfigured) return;
  const result = await request<{authorizationUrl: string}>('approvals/' + approval.approvalId + '/start', {body: {policyHash: approval.policyHash}, csrfToken});
  const destination = new URL(result.authorizationUrl, window.location.origin);
  if (destination.protocol !== 'https:' && destination.origin !== window.location.origin) throw new Error('Unsafe authentication destination');
  window.location.assign(destination.href);
 }
 const reducing = Boolean(editing && editing.revision > 0 && /^[1-9][0-9]{0,18}$/.test(perRequest) && /^[1-9][0-9]{0,18}$/.test(total) && BigInt(perRequest) <= BigInt(editing.policy.perRequestTinybars) && BigInt(total) <= BigInt(editing.policy.totalTinybars) && Date.parse(expiry) <= Date.parse(editing.policy.expiresAt));
 const approvalExpired = approval ? Date.parse(approval.expiresAt) <= Date.now() : false;
 return <section aria-labelledby="owned-leases-title" style={{marginTop: 32}}>
  <div className="panel-title"><div><h3 id="owned-leases-title">Your leases and spending</h3><p>Amounts use exact tinybars. Reserved funds include unresolved payments.</p></div><button disabled={busy || loading} onClick={() => void mutate(refresh)}>Refresh</button></div>
  {error ? <p className="inline-warning" role="alert">{error}</p> : null}
  {loading ? <p role="status">Loading your leases…</p> : leases.length ? leases.map(lease => <article className="lease-row" key={lease.leaseId}>
   <div><h3>{lease.policy.questionTemplateId}</h3><p>{lease.schedule?.state ?? (lease.active ? 'ACTIVE' : 'INACTIVE')} · Revision {lease.revision}</p><strong>{lease.remainingTinybars} tinybars remaining</strong><p>Committed {lease.reservedTinybars} tinybars</p><p className="hint">Per request {lease.policy.perRequestTinybars} · Total {lease.policy.totalTinybars} · Ends {new Date(lease.policy.expiresAt).toLocaleString()}</p>{lease.approval ? <p className="hint">Approval {lease.approval.status}</p> : null}</div>
   <div className="actions">{lease.active && !lease.policy.schedule && onRun ? <button className="primary" disabled={busy || Date.parse(lease.policy.expiresAt) <= Date.now() || BigInt(lease.remainingTinybars) <= 0n} onClick={() => void mutate(() => runOnce(lease.leaseId))}>Run once</button> : null}{lease.schedule?.state === 'PAUSED' ? <button disabled={busy} onClick={() => void mutate(() => control(lease.leaseId, 'RESUME'))}>Resume</button> : null}<button disabled={busy} onClick={() => edit(lease)}>Review budget</button>{lease.active && Boolean(lease.policy.schedule) ? <button disabled={busy} onClick={() => void mutate(() => control(lease.leaseId, 'PAUSE'))}>Pause</button> : null}{lease.schedule?.state !== 'CANCELLED' ? <button disabled={busy} onClick={() => void mutate(() => control(lease.leaseId, 'CANCEL'))}>Cancel lease</button> : null}</div>
  </article>) : <div className="empty-state compact"><h3>No owned leases yet</h3><p>Choose a service and review its exact spending policy before activation.</p></div>}
  {approvals.length ? <section aria-label="Approval requests"><h3>Approval requests</h3>{approvals.map(item => <div className="lease-row" key={item.approvalId}><div><strong>{item.purpose === 'ACTIVATE_LEASE' ? 'Lease activation' : 'Budget revision'}</strong><p>{Date.parse(item.expiresAt) <= Date.now() && item.status === 'PENDING' ? 'EXPIRED' : item.status} · {item.proposedPolicy.totalTinybars} tinybars maximum</p></div><button disabled={busy} onClick={() => reviewApproval(item)}>Review exact terms</button></div>)}</section> : null}
  {editing ? <section aria-labelledby="budget-review-title" style={{marginTop: 24}}>
   <div className="panel-title"><h3 id="budget-review-title">Review spending authority</h3><button disabled={busy} onClick={() => {setEditing(undefined); setApproval(undefined);}}>Close review</button></div>
   <p>{approval?.purpose === 'ACTIVATE_LEASE' ? 'Activation pending. No spending authority exists until approval completes.' : 'Current revision ' + editing.revision + '. Existing limits remain until the exact revision is approved.'}</p>
   <div className="fields"><label>Proposed per-request cap (tinybars)<input inputMode="numeric" value={perRequest} disabled={busy || Boolean(approval)} onChange={event => setPerRequest(event.target.value)} /></label><label>Proposed total cap (tinybars)<input inputMode="numeric" value={total} disabled={busy || Boolean(approval)} onChange={event => setTotal(event.target.value)} /></label><label>Proposed expiry (ISO UTC)<input value={expiry} disabled={busy || Boolean(approval)} onChange={event => setExpiry(event.target.value)} /></label></div>
   <dl><dt>Currency</dt><dd>{editing.policy.currency}</dd><dt>Allowed providers</dt><dd>{editing.policy.providerIds.join(', ')}</dd><dt>Maximum total exposure</dt><dd>{approval?.purpose === 'ACTIVATE_LEASE' ? 'No active policy' : editing.policy.totalTinybars + ' current'} · {approval?.proposedPolicy.totalTinybars ?? total} proposed tinybars</dd><dt>Per-request exposure</dt><dd>{approval?.purpose === 'ACTIVATE_LEASE' ? 'No active policy' : editing.policy.perRequestTinybars + ' current'} · {approval?.proposedPolicy.perRequestTinybars ?? perRequest} proposed tinybars</dd><dt>Expiry</dt><dd>{approval?.purpose === 'ACTIVATE_LEASE' ? 'No active policy' : editing.policy.expiresAt + ' current'} · {approval?.proposedPolicy.expiresAt ?? expiry} proposed</dd></dl>
   <details><summary>Complete proposed policy</summary><pre>{JSON.stringify(approval?.proposedPolicy ?? {...editing.policy,perRequestTinybars:perRequest,totalTinybars:total,expiresAt:expiry}, null, 2)}</pre></details>
   {!approval ? <button disabled={busy || !csrfToken} onClick={() => void mutate(propose)}>{reducing ? 'Apply reduced limits' : 'Create budget request'}</button> : <><p role="status">Approval {approvalExpired && approval.status === 'PENDING' ? 'EXPIRED' : approval.status} · Expires {new Date(approval.expiresAt).toLocaleString()}</p><p className="hint">Policy hash <code style={{overflowWrap: 'anywhere'}}>{approval.policyHash}</code></p>{approval.status === 'PENDING' && !approvalExpired ? <><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={busy} /> I authorize this exact policy revision and maximum exposure.</label><div className="panel-actions"><button className="primary" disabled={busy || !reviewed || !worldConfigured} onClick={() => void mutate(approve)}>Verify with World and approve</button><button disabled={busy} onClick={() => void mutate(deny)}>Deny request</button></div></> : <p>Existing policy remains unchanged unless the backend completed this approval.</p>}</>}
   <p className="hint">Reduced limits apply without fresh World verification. They must still cover committed payments. An increased budget does not add funds, reset spending, or release reserved payments.</p>
  </section> : null}
 </section>;
}

function PrivateOverview(){
 const [data,setData]=useState<{settledTinybars:string;heldTinybars:string;settledPurchases:number;runs:BuyerRun[]}>(),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();void request<{settledTinybars:string;heldTinybars:string;settledPurchases:number;runs:BuyerRun[]}>('buyer/overview',undefined,controller.signal).then(setData).catch((cause:unknown)=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Private overview unavailable');});return()=>controller.abort();},[]);
 return <section aria-labelledby="private-overview-title" style={{marginTop:24}}><h3 id="private-overview-title">Your purchases</h3><p>Only your authenticated buyer can open these reports. Public spending analytics do not include your World identity.</p>{error?<p className="inline-warning" role="alert">{error}</p>:data?<><dl className="registry-stat-grid"><div><dt>Your confirmed spending · HBAR</dt><dd>{hbar(data.settledTinybars)}</dd></div><div><dt>Reserved or unresolved · HBAR</dt><dd>{hbar(data.heldTinybars)}</dd></div><div><dt>Your confirmed purchases</dt><dd>{data.settledPurchases}</dd></div></dl><a href="/dashboard/reports">View previous analysis reports</a></>:<p role="status">Reading your private purchases…</p>}</section>;
}
