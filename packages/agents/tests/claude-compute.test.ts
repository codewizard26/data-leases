import {expect,test,vi} from 'vitest';
import {ClaudeComputeAdapter,createComputeAdapter} from '../src/compute.js';
import {AiNegotiationStrategy} from '../src/strategy.js';
const options={apiKey:'secret-test-key',model:'claude-sonnet-5-5'},input={messages:[{role:'system' as const,content:'Return public structured terms.'},{role:'user' as const,content:'Quote within bounds.'}],jsonMode:true};
test('Claude uses its native Messages API and structured decision schema without exposing the key',async()=>{
 let sent:Request|undefined;
 const adapter=new ClaudeComputeAdapter(options,async(url,init)=>{sent=new Request(url,init);return Response.json({model:'claude-sonnet-5-5',stop_reason:'end_turn',content:[{type:'text',text:'{"action":"PROPOSE","priceMinor":"500","reason":"Posted ask."}'}]});});
 const decision=await new AiNegotiationStrategy(adapter,'FIRM').seller({kind:'initial',askMinor:'500',floorMinor:'300',round:1});
 expect(decision).toMatchObject({provider:'CLAUDE',action:'PROPOSE',priceMinor:'500'});
 expect(sent?.url).toBe('https://api.anthropic.com/v1/messages');expect(sent?.headers.get('x-api-key')).toBe(options.apiKey);
 const body=await sent!.json();expect(body.system).toContain('preserving your asking margin');expect(body.output_config.format.type).toBe('json_schema');expect(body.messages.every((message:{role:string})=>message.role!=='system')).toBe(true);expect(JSON.stringify(body)).not.toContain(options.apiKey);
 expect(createComputeAdapter({COMPUTE_PROVIDER:'claude',ANTHROPIC_API_KEY:'key'})).toBeInstanceOf(ClaudeComputeAdapter);
});
test('Claude responses cannot authorize prices outside deterministic policy',async()=>{
 const adapter=new ClaudeComputeAdapter(options,async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"action":"PROPOSE","priceMinor":"1","reason":"Low offer."}'}]}));
 await expect(new AiNegotiationStrategy(adapter).seller({kind:'initial',askMinor:'500',floorMinor:'300',round:1})).rejects.toThrow('AI_INVALID_DECISION');
});
test('Claude rejects HTTP errors, truncated output, refusals and oversized responses with sanitized errors',async()=>{
 const cases:[Response,string][]=[[new Response('secret-test-key',{status:401}),'COMPUTE_HTTP_401'],[Response.json({stop_reason:'max_tokens',content:[{type:'text',text:'{}'}]}),'COMPUTE_INVALID_RESPONSE'],[Response.json({stop_reason:'end_turn',content:[{type:'refusal',refusal:'refused'}]}),'COMPUTE_INVALID_RESPONSE'],[new Response('x'.repeat(65537)),'COMPUTE_RESPONSE_TOO_LARGE']];
 for(const [response,error] of cases)await expect(new ClaudeComputeAdapter(options,async()=>response).generate(input)).rejects.toThrow(error);
 const network=vi.fn(async()=>{throw Error('secret-test-key');});await expect(new ClaudeComputeAdapter(options,network).generate(input)).rejects.toThrow('COMPUTE_UNAVAILABLE');
});
