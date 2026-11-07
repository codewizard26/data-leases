import type {ComputeAdapter,ComputeInput,ComputeOutput} from './compute.js';
const decisionSchema={type:'object',properties:{action:{type:'string',enum:['PROPOSE','COUNTER','ACCEPT','REJECT']},priceMinor:{type:'string'},reason:{type:'string'}},required:['action','reason'],additionalProperties:false};
/** Direct Anthropic Messages API. No credentials or upstream diagnostics cross this boundary. */
export class ClaudeComputeAdapter implements ComputeAdapter {
 constructor(private readonly options:{apiKey:string;model:string;timeoutMs?:number},private readonly fetcher:typeof fetch=fetch){
  if(!options.apiKey.trim()||!/^claude-[a-zA-Z0-9.-]{1,100}$/.test(options.model)||!Number.isInteger(options.timeoutMs??60000)||(options.timeoutMs??60000)<1||(options.timeoutMs??60000)>60000)throw new Error('COMPUTE_INVALID_CONFIG');
 }
 async generate(input:ComputeInput):Promise<ComputeOutput>{
  if(!input.messages.length||input.messages.length>20||input.messages.some(message=>!['system','user','assistant'].includes(message.role)||typeof message.content!=='string'||message.content.length>8000)||!input.messages.some(message=>message.role!=='system'))throw new Error('COMPUTE_INVALID_INPUT');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.options.timeoutMs??60000);
  try{
   const response=await this.fetcher('https://api.anthropic.com/v1/messages',{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json','x-api-key':this.options.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:this.options.model,max_tokens:input.jsonSchema?1800:1024,system:input.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n'),messages:input.messages.filter(message=>message.role!=='system'),...(input.jsonMode?{output_config:{format:{type:'json_schema',schema:input.jsonSchema??decisionSchema}}}:{})})});
   if(!response.ok)throw new Error('COMPUTE_HTTP_'+response.status);
   const reader=response.body?.getReader();if(!reader)throw new Error('COMPUTE_INVALID_RESPONSE');
   const parts:Uint8Array[]=[];let bytes=0;
   while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>65536){await reader.cancel();throw new Error('COMPUTE_RESPONSE_TOO_LARGE');}parts.push(chunk.value);}
   let data:unknown;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Error('COMPUTE_INVALID_RESPONSE');}
   if(!data||typeof data!=='object'||!('content' in data)||!Array.isArray(data.content)||!('stop_reason' in data)||data.stop_reason!=='end_turn')throw new Error('COMPUTE_INVALID_RESPONSE');
   const text=data.content.filter((part:unknown):part is {type:'text';text:string}=>Boolean(part&&typeof part==='object'&&'type' in part&&part.type==='text'&&'text' in part&&typeof part.text==='string')).map(part=>part.text).join('');
   if(!text.trim())throw new Error('COMPUTE_INVALID_RESPONSE');
   return {provider:'CLAUDE',model:'model' in data&&typeof data.model==='string'?data.model:this.options.model,text};
  }catch(error){if(error instanceof Error&&/^COMPUTE_(HTTP_\d{3}|INVALID_RESPONSE|RESPONSE_TOO_LARGE)$/.test(error.message))throw error;throw new Error('COMPUTE_UNAVAILABLE');}
  finally{clearTimeout(timer);}
 }
}
