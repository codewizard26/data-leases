import {resolve} from 'node:path';
import {inspectParquetDataset} from '@data-leases/event-store';
const index=process.argv.indexOf('--session');
const rows=await inspectParquetDataset(resolve(process.env.DATA_DIRECTORY??'data/tmp/runtime','events'),index<0?undefined:process.argv[index+1]);
console.log(JSON.stringify({source:'PARQUET',count:rows.length,events:rows},null,2));
