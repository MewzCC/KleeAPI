import {randomUUID} from 'node:crypto';
import {ApiError,json} from './http.mjs';

/** 按完整 SSE 帧读取，保留跨网络分片的 UTF-8 字符与多行 data。 */
export async function* parseEvents(body,{signal}={}){
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
  const abort=()=>reader.cancel(signal.reason).catch(()=>{});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const parse=block=>{let event='message';const data=[];for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}return {event,data:data.join('\n')};};
  try{
    for(;;){if(signal?.aborted)throw new ApiError('响应读取已取消或超时',502,'response_aborted');const {done,value}=await reader.read();if(signal?.aborted)throw new ApiError('响应读取已取消或超时',502,'response_aborted');buffer+=done?decoder.decode():decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');if(buffer.length>2*1024*1024)throw new ApiError('上游流事件过大',502);let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=parse(buffer.slice(0,end));buffer=buffer.slice(end+2);if(frame.data)yield frame;}if(done)break;}
    if(buffer.trim()){const frame=parse(buffer);if(frame.data)yield frame;}
  }finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}

/** JSON 正文也受请求生命周期约束，不能在已收到响应头后无限占用账号槽位。 */
async function readJSON(response,signal){
  if(!response.body)throw new ApiError('平台未返回对话正文',502,'invalid_upstream_response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  const abort=()=>reader.cancel(signal.reason).catch(()=>{});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{for(;;){if(signal?.aborted)throw new ApiError('响应读取已取消或超时',502,'response_aborted');const {done,value}=await reader.read();if(signal?.aborted)throw new ApiError('响应读取已取消或超时',502,'response_aborted');if(done)break;size+=value.length;if(size>16*1024*1024)throw new ApiError('对话响应过大',502);chunks.push(value);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError('平台没有返回有效对话',502);}
  }finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}

/** 等待可写缓冲区恢复；客户端关闭时停止读取上游，避免后台继续消耗。 */
async function write(res,value,signal){
  if(signal?.aborted)throw new ApiError('响应写入已取消或超时',502,'response_aborted');
  if(res.destroyed)throw new ApiError('客户端已断开',499);
  if(res.write(value))return;
  await new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',drain);res.off('close',close);signal?.removeEventListener('abort',abort);};const drain=()=>{cleanup();resolve();};const close=()=>{cleanup();reject(new ApiError('客户端已断开',499));};const abort=()=>{cleanup();reject(new ApiError('响应写入已取消或超时',502,'response_aborted'));};res.once('drain',drain);res.once('close',close);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
}

function toolDelta(value){
  return (Array.isArray(value)?value:value?[value]:[]).map((tool,index)=>{const f=tool.function||tool.function_call||{};return {index:tool.index??index,...(tool.id?{id:tool.id}:{}),type:'function',function:{...(f.name?{name:f.name}:{}),...(f.arguments!==undefined?{arguments:typeof f.arguments==='string'?f.arguments:JSON.stringify(f.arguments)}:{})}};});
}

/** 将平台 SSE 统一成 OpenAI 格式，同时支持流式与完整响应，不重试请求。 */
export async function relayCompletion(response,res,{stream=false,model,format='openai',signal}={}){
  const send=value=>write(res,value,signal);
  if(!response.ok){await response.body?.cancel();throw new ApiError('上游返回 HTTP '+response.status,response.status,'upstream_http_error');}
  if(!(response.headers.get('content-type')||'').includes('text/event-stream')){
    const data=await readJSON(response,signal);
    if(data.error||!Array.isArray(data.choices))throw new ApiError('平台拒绝对话请求',502,'upstream_chat_error');
    if(!stream)return json(res,200,data);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache'});
    await send('data: '+JSON.stringify({id:data.id,object:'chat.completion.chunk',created:data.created,model:data.model||model,choices:data.choices.map(c=>({index:c.index,delta:c.message,finish_reason:c.finish_reason}))})+'\n\n');res.end('data: [DONE]\n\n');return;
  }
  const id='chatcmpl-'+randomUUID(),created=Math.floor(Date.now()/1000);let content='',reasoning='',finish='stop',usage=null,started=false,total=0,terminal=false;const tools=[];
  const chunk=(delta,reason=null)=>({id,object:'chat.completion.chunk',created,model,choices:[{index:0,delta,finish_reason:reason}]});
  const emit=async delta=>{if(!stream)return;if(!started){res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','X-Accel-Buffering':'no'});started=true;await send('data: '+JSON.stringify(chunk({role:'assistant'}))+'\n\n');}await send('data: '+JSON.stringify(chunk(delta))+'\n\n');};
  try{
    for await(const event of parseEvents(response.body,{signal})){
      if(event.data==='[DONE]'){terminal=true;break;}
      let data;try{data=JSON.parse(event.data);}catch{throw new ApiError('上游流格式无效',502);}
      if(event.event==='error'||data.error)throw new ApiError('平台对话失败'+(data.code?'（'+data.code+'）':''),502,'upstream_stream_error');
      let delta={};
      if(format==='solo'){
        if(event.event==='output'){if(typeof data.response==='string')delta.content=data.response;if(typeof data.reasoning_content==='string')delta.reasoning_content=data.reasoning_content;if(data.tool_calls)delta.tool_calls=toolDelta(data.tool_calls);}
        if(event.event==='token_usage')usage=data;
        if(event.event==='done'){finish=data.finish_reason||'stop';terminal=true;}
      }else{const choice=data.choices?.[0];if(choice){delta=choice.delta||choice.message||{};if(choice.finish_reason){finish=choice.finish_reason;terminal=true;}}if(data.usage)usage=data.usage;}
      if(delta.content)content+=delta.content;if(delta.reasoning_content)reasoning+=delta.reasoning_content;
      for(const tool of delta.tool_calls||[]){const index=tool.index??0;const old=tools[index]||{id:tool.id||'call-'+index,type:'function',function:{name:'',arguments:''}};if(tool.id)old.id=tool.id;if(tool.function?.name)old.function.name+=tool.function.name;if(tool.function?.arguments)old.function.arguments+=tool.function.arguments;tools[index]=old;}
      total+=JSON.stringify(delta).length;if(total>16*1024*1024)throw new ApiError('对话响应过大',502);
      if(Object.keys(delta).length)await emit(delta);
    }
    if(!terminal)throw new ApiError('上游对话流提前结束',502,'incomplete_stream');
    if(stream){if(!started)await emit({});await send('data: '+JSON.stringify(chunk({},finish))+'\n\n');if(usage)await send('data: '+JSON.stringify({id,object:'chat.completion.chunk',created,model,choices:[],usage})+'\n\n');res.end('data: [DONE]\n\n');}
    else json(res,200,{id,object:'chat.completion',created,model,choices:[{index:0,message:{role:'assistant',content,...(reasoning?{reasoning_content:reasoning}:{}),...(tools.length?{tool_calls:tools.filter(Boolean)}:{})},finish_reason:finish}],...(usage?{usage}:{})});
  }catch(error){if(res.headersSent){if(!res.destroyed)res.end('data: '+JSON.stringify({error:{message:error.message,code:error.code||'upstream_stream_error'}})+'\n\n');}else throw error;}
}
