import {createHash} from 'node:crypto';
import type {LeaseStore,ScheduleRow} from './lease-store.js';
import type {RunOrchestrator} from './orchestrator.js';

/** One durable occurrence per lease. No catch-up bursts and no re-signing unknown payments. */
export class LeaseScheduler {
 private timer:ReturnType<typeof setInterval>|undefined;
 private pending:Promise<void>|undefined;
 private stopped=false;
 constructor(private readonly options:{leases:LeaseStore;runner:Pick<RunOrchestrator,'start'|'get'>;ready:()=>boolean;clock?:()=>number;event?:(leaseId:string,status:string,payload:unknown)=>void}){}
 start(){if(this.timer)return;this.stopped=false;this.timer=setInterval(()=>{void this.tick().catch(()=>{});},1000);this.timer.unref();void this.tick().catch(()=>{});}
 tick(){if(this.stopped)return Promise.resolve();if(this.pending)return this.pending;const task=this.runTick().finally(()=>{this.pending=undefined;});this.pending=task;return task;}
 private pause(row:ScheduleRow,reason:string){this.options.leases.scheduleState(row.leaseId,'PAUSED',reason);this.options.event?.(row.leaseId,'LEASE_PAUSED',{reason});}
 private async runTick(){
  const now=(this.options.clock??Date.now)();
  for(const row of this.options.leases.schedules()){
   if(row.state!=='ACTIVE')continue;
   try{
    const lease=this.options.leases.get(row.leaseId);
    if(!lease.active){this.options.leases.scheduleState(row.leaseId,'CANCELLED','LEASE_INACTIVE');continue;}
    if(Date.parse(lease.policy.expiresAt)<=now){this.options.leases.scheduleState(row.leaseId,'EXPIRED','LEASE_EXPIRED');this.options.event?.(row.leaseId,'LEASE_EXPIRED',{});continue;}
    // Active occurrences must be reconciled before checking remaining budget.
    if(row.activeRunId){const current=this.options.runner.get(row.activeRunId);
     if(current?.paymentStatus==='UNKNOWN'){this.pause(row,'PAYMENT_RECONCILIATION_REQUIRED');continue;}
     if(current&&['COMPLETED','FAILED','VERIFICATION_PENDING','QUOTES_READY'].includes(current.status)){
      this.options.leases.completeOccurrence(row.leaseId,row.activeRunId,now);
      if(current.error==='INSUFFICIENT_BALANCE')this.pause(row,'INSUFFICIENT_BALANCE');
      if(['LEASE_BUDGET_EXCEEDED','LEASE_RUN_LIMIT_EXCEEDED'].includes(current.error??''))this.options.leases.scheduleState(row.leaseId,'COMPLETED',current.error!);
      continue;
     }
     if(!current&&this.options.ready())this.dispatch(row,row.activeRunId);
     continue;
    }
    if(BigInt(lease.remainingTinybars)<=0n||(lease.policy.maxRuns!==undefined&&this.options.leases.fundedRuns(row.leaseId)>=lease.policy.maxRuns)){this.options.leases.scheduleState(row.leaseId,'COMPLETED','BUDGET_OR_RUN_LIMIT_REACHED');this.options.event?.(row.leaseId,'LEASE_COMPLETED',{reason:'BUDGET_OR_RUN_LIMIT_REACHED'});continue;}
    if(row.nextRunAt>now||!this.options.ready())continue;
    const hash=createHash('sha256').update(row.leaseId+':'+row.nextRunAt).digest('hex');
    const runId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
    if(this.options.leases.claimOccurrence(row.leaseId,now,runId))this.dispatch(row,runId);
   }catch{this.pause(row,'SCHEDULE_REQUIRES_REVIEW');}
  }
 }
 private dispatch(row:ScheduleRow,runId:string){const schedule=this.options.leases.get(row.leaseId).policy.schedule!;this.options.event?.(row.leaseId,'SCHEDULED_RUN_STARTED',{runId});this.options.runner.start({runId,leaseId:row.leaseId,mode:schedule.mode,directCardUrl:schedule.directCardUrl});}
 async close(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.pending;}
}
