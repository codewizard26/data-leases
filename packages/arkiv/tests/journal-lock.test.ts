import {mkdtempSync,rmSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {PublicationJournal} from '../src/journal.js';
const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const item of cleanup.splice(0).reverse())item();});
function location(){const directory=mkdtempSync(join(tmpdir(),'arkiv-lock-'));cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));return join(directory,'journal.sqlite');}
function open(path:string){const journal=new PublicationJournal(path);cleanup.push(()=>journal.close());return journal;}
test('file journal excludes a second publisher until close releases ownership',()=>{const path=location(),first=open(path);expect(()=>new PublicationJournal(path)).toThrow('ARKIV_JOURNAL_BUSY');expect(existsSync(path+'.lock')).toBe(true);first.close();expect(existsSync(path+'.lock')).toBe(false);open(path);});
test('stale dead-process lock is recovered and replaced with current ownership',()=>{const path=location();writeFileSync(path+'.lock',JSON.stringify({pid:2147483647,token:'dead'}));open(path);expect(JSON.parse(readFileSync(path+'.lock','utf8'))).toMatchObject({pid:process.pid});});
test('malformed ownership fails closed',()=>{const path=location();writeFileSync(path+'.lock','invalid');expect(()=>new PublicationJournal(path)).toThrow('ARKIV_JOURNAL_BUSY');expect(readFileSync(path+'.lock','utf8')).toBe('invalid');});
test('memory journals remain independent and closing is idempotent',()=>{const one=open(':memory:');open(':memory:');one.close();one.close();});
