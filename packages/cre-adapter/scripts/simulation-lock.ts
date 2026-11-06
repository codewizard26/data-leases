import {existsSync,readFileSync,writeFileSync,mkdirSync,linkSync,unlinkSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
/** CLI compilation touches shared workflow artifacts; only one process may compile at a time. */
export function acquireSimulationLock(path:string):()=>void {
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 if(existsSync(path)){let stale=false;try{const lock=JSON.parse(readFileSync(path,'utf8'));if(Number.isInteger(lock.pid)&&lock.pid>0){try{process.kill(lock.pid,0);}catch(error){stale=(error as NodeJS.ErrnoException).code==='ESRCH';}}}catch{/* Malformed locks fail closed. */}if(!stale)throw new Error('CRE_SIMULATION_BUSY');unlinkSync(path);}
 const value=JSON.stringify({pid:process.pid,token:randomUUID()}),tmp=path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,value,{mode:0o600,flag:'wx'});const fd=openSync(tmp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}try{linkSync(tmp,path);}catch{throw new Error('CRE_SIMULATION_BUSY');}finally{unlinkSync(tmp);}
 return ()=>{try{if(readFileSync(path,'utf8')===value)unlinkSync(path);}catch{/* Malformed locks fail closed. */}};
}
