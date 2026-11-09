import {serveFrontend} from './web.mjs';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadConfig,root} from './config.mjs';
import {AccountStore,atomicWrite} from './store.mjs';
import {ApiError,json,readBody} from './http.mjs';
import {relayCompletion} from './stream.mjs';
import {createPool} from './pool.mjs';
import workbuddy from '../Klee-workbuddy-web/provider.mjs';
import trae from '../Klee-trae-web/provider.mjs';
import qoder from '../Klee-qoder-web/provider.mjs';

const adapters={workbuddy,trae,qoder};
const folder={workbuddy:'WorkBuddy',trae:'Trae',qoder:'Qoder'};

/** 每个平台一份状态与监听器；账号只手动切换，对话不排队、不自动重试或换号。 */
export async function createService({platform,base=root,adapter=adapters[platform],protectKey,callback=true,poolTimeoutMs=300000}={}){
  if(!adapter||!Object.hasOwn(folder,platform))throw Error('Unknown platform');
  const config=loadConfig(base),port=config.ports[platform],dir=join(base,folder[platform]+'-Chat','data',folder[platform]);
  const store=await new AccountStore({platform,dir,normalize:adapter.normalize,protectKey}).init();
  const pending=new Map(),refreshing=new Map();let checking=false,modelCache=null,callbackAvailable=false;
  const pool=createPool({platform,store,adapter,fresh});
  const origins=new Set(Object.values(config.ports).flatMap(p=>['http://127.0.0.1:'+p,'http://localhost:'+p]));
  if(process.env.KLEE_DEV_ORIGIN==='http://127.0.0.1:15173')origins.add(process.env.KLEE_DEV_ORIGIN);
  const token=req=>/^Bearer /i.test(req.headers.authorization||'')?req.headers.authorization.slice(7):'';

  /** 只合并同一账号的令牌刷新，防止并发轮换 refreshToken；聊天请求仍独立执行。 */
  async function fresh(account,force=false){
    const due=(account.expiresAt&&account.expiresAt<=Date.now()+300000)||(platform==='qoder'&&account.deviceRefreshToken&&(!account.deviceExpiresAt||account.deviceExpiresAt<=Date.now()+300000));
    if(!force&&(!due||!(account.refreshToken||(platform==='qoder'&&account.deviceRefreshToken))))return account;
    return refreshAccount(account);
  }

  function refreshAccount(account,options){
    if(!refreshing.has(account.uid))refreshing.set(account.uid,(async()=>{const original=structuredClone(account),changes=await adapter.refresh(account,options);return store.saveRefreshed(original,{...account,...changes});})().finally(()=>refreshing.delete(account.uid)));
    return refreshing.get(account.uid);
  }

  const upstreamUnauthorized=error=>error instanceof ApiError&&error.status===401&&error.code==='upstream_http_error';
  const deviceReauth=()=>new ApiError('Qoder 设备授权已失效，请在账号管理中使用「官方登录」重新授权该账号。',401,'qoder_device_reauth_required');

  /** Qoder 的活动和额度读取收到 401 时，复用已轮换的授权或续期一次后重读。 */
  async function readWithDeviceRecovery(account,read){
    try{return {account,data:await read(account)};}
    catch(error){if(platform!=='qoder'||!upstreamUnauthorized(error))throw error;}
    try{
      await refreshing.get(account.uid);
      const current=store.get(account.uid);
      if(current.enabled===false)throw new ApiError('账号已停用',403);
      if(current.deviceToken!==account.deviceToken||current.deviceRefreshToken!==account.deviceRefreshToken)account=current;
      else{
        if(!current.deviceRefreshToken)throw deviceReauth();
        account=await refreshAccount(current,{deviceOnly:true});
      }
    }catch(error){
      if(error.code==='upstream_http_error'&&[400,401,403].includes(error.status))throw deviceReauth();
      throw error;
    }
    try{return {account,data:await read(account)};}
    catch(error){if(upstreamUnauthorized(error))throw deviceReauth();throw error;}
  }
  async function importAccount(input,accept=()=>true){const account=await adapter.normalize(input);if(!accept())throw new ApiError('登录请求已取消或过期',409,'login_canceled');if(!account?.uid||typeof account.uid!=='string'||!account.accessToken)throw new ApiError('登录 JSON 缺少有效账号或令牌');const saved=await store.save(account,true);modelCache=null;pool.invalidate(saved.uid);return {account:store.list().find(a=>a.uid===saved.uid),credential:saved};}

  async function models(force){
    const account=await fresh(store.selected());
    if(!modelCache){try{const saved=JSON.parse(readFileSync(join(dir,'models.json'),'utf8'));if(saved.uid===account.uid&&Array.isArray(saved.data))modelCache=saved;}catch{}}
    if(!force&&modelCache?.uid===account.uid&&Date.now()-Date.parse(modelCache.updated_at)<300000)return {...modelCache,source:'cache',fetchedAt:modelCache.updated_at};
    try{
      const entries=await adapter.models(account);if(!Array.isArray(entries)||!entries.length)throw new ApiError('平台没有返回模型目录',502);
      const updated_at=new Date().toISOString(),result={object:'list',platform,uid:account.uid,data:entries.map(m=>({...m,object:'model',owned_by:platform})),updated_at};
      atomicWrite(join(dir,'models.json'),JSON.stringify(result,null,2));atomicWrite(join(dir,'models.txt'),result.data.map(m=>m.id).join('\n')+'\n');modelCache=result;
      return {...result,source:'account',fetchedAt:updated_at};
    }catch(error){if(modelCache?.uid===account.uid)return {...modelCache,source:'cache',fetchedAt:modelCache.updated_at,warning:'平台目录未能刷新，显示此账号的上次结果'};throw error;}
  }

  async function mapAccountReads(read){
    const summaries=store.list();
    if(platform==='qoder')return Promise.all(summaries.map(read));
    const rows=[];
    for(const summary of summaries)rows.push(await read(summary));
    return rows;
  }

  const checkinReads=new Map();
  /** Qoder 只共享同一凭据正在执行的查询，领取前后的复查始终直接请求上游。 */
  function readCheckin(account){
    if(platform!=='qoder')return adapter.checkin(account);
    const key=JSON.stringify([account.uid,account.region,account.providerUid,account.deviceToken,account.accessToken]);
    if(!checkinReads.has(key)){
      const task=readWithDeviceRecovery(account,current=>adapter.checkin(current)).then(result=>result.data);
      checkinReads.set(key,task.finally(()=>checkinReads.delete(key)));
    }
    return checkinReads.get(key);
  }

  async function monitor(){
    const accounts=await mapAccountReads(async summary=>{
      const row={...summary,platform,unit:platform==='qoder'?(summary.region==='cn'?'Qoder CN Credits':'Qoder Global Credits'):folder[platform]+' 积分',remaining:null,limit:null,used:null,packages:[],unlimited:false,checkin:null,checkinError:null,quotaError:null};
      if(!summary.enabled){row.quotaError='账号已停用';return row;}
      let account;try{account=await fresh(store.get(summary.uid));row.expiresAt=account.expiresAt||null;row.status=account.expiresAt&&account.expiresAt<=Date.now()?'expired':'ready';}catch{row.status='expired';row.quotaError='登录刷新失败，请重新登录';return row;}
      const [quota,daily]=await Promise.allSettled([
        readWithDeviceRecovery(account,current=>adapter.quota(current)).then(result=>result.data),
        readCheckin(account),
      ]);
      if(quota.status==='fulfilled'){Object.assign(row,quota.value);if(Number.isFinite(row.remaining))await store.updateCredits(account.uid,row.remaining);pool.invalidate(account.uid,false);}
      else row.quotaError=quota.reason.message||'额度查询失败';
      if(daily.status==='fulfilled')row.checkin=daily.value;else row.checkinError=daily.reason.message||'签到状态查询失败';
      return row;
    });
    return {platform,unit:folder[platform]+' 积分',fetchedAt:Date.now(),accounts};
  }

  /** 查询全部账号本轮状态，不领取奖励，也不重复读取额度；查询失败保持未知。 */
  async function checkinStatus(){
    const accounts=await mapAccountReads(async summary=>{
      const row={...summary,checkedIn:null,status:'unknown',message:'签到状态尚未确认'};
      if(!summary.enabled){row.status='skipped';row.message='账号已停用';return row;}
      try{
        const account=await fresh(store.get(summary.uid)),daily=await readCheckin(account);
        for(const key of ['reward','campaignId','startsAt','endsAt'])if(daily?.[key]!==undefined)row[key]=daily[key];
        if(typeof daily?.checkedIn==='boolean')row.checkedIn=daily.checkedIn;
        if(daily?.checkedIn===true){row.status='already';row.message=platform==='qoder'?'本轮已签到':'今日已签到';}
        else if(daily?.enabled===false){row.status='no_activity';row.message='当前没有可领取的签到活动';}
        else if(daily?.enabled===true&&daily?.checkedIn===false){row.status='available';row.message=platform==='qoder'?'本轮未签到':'今日未签到';}
      }catch(error){row.message=platform==='qoder'&&upstreamUnauthorized(error)?deviceReauth().message:error instanceof ApiError?error.message:'签到状态查询失败，请稍后刷新';}
      return row;
    });
    return {platform,fetchedAt:Date.now(),accounts};
  }

  async function checkinOne(input){
    const result={uid:input.uid,nickname:input.nickname,region:input.region,status:'failed',checkedIn:null,message:'签到失败',balanceBefore:null,balanceAfter:null};
    if(input.enabled===false)return {...result,status:'skipped',message:'账号已停用'};
    let account;try{
      const initial=await fresh(input);
      const {account:authorized,data:before}=await readWithDeviceRecovery(initial,current=>adapter.checkin(current));
      account=authorized;
      if(typeof before.checkedIn==='boolean')result.checkedIn=before.checkedIn;
      for(const key of ['reward','campaignId','startsAt','endsAt'])if(before[key]!==undefined)result[key]=before[key];
      if(before.checkedIn){result.status='already';result.message='今日已签到';}
      else if(!before.enabled){result.status='no_activity';result.message='当前没有可领取的签到活动';}
      else{
        try{result.balanceBefore=(await adapter.quota(account)).remaining;}catch{}
        let claimError;try{await adapter.claim(account,before);}catch(error){claimError=error;}
        let after;try{after=await adapter.checkin(account,before);}catch{}
        if(after&&(!before.campaignId||after.campaignId===before.campaignId)&&typeof after.checkedIn==='boolean')result.checkedIn=after.checkedIn;
        // 活动跨轮时只能确认原领取窗口，不能把另一活动的状态作为本次成功依据。
        if(after?.checkedIn&&(!before.campaignId||after.campaignId===before.campaignId)){result.status=claimError?'already':'claimed';result.message=claimError?'本轮已签到（复查确认）':'签到状态已确认';}
        else if(claimError){result.message=claimError.message;}
        else{result.status='pending';result.message='领取请求已提交，签到结果尚未确认，请核对官方记录';}
      }
      try{result.balanceAfter=(await adapter.quota(account)).remaining;if(Number.isFinite(result.balanceAfter))await store.updateCredits(account.uid,result.balanceAfter);}catch{}
      if(result.status==='claimed'&&result.balanceBefore!==null&&result.balanceAfter===result.balanceBefore)result.message+='，当前查询余额未变化，请核对官方积分明细';
      else if(result.status==='claimed'&&result.balanceAfter===null)result.message+='，余额暂未能读取';
    }catch(error){result.message=platform==='qoder'&&upstreamUnauthorized(error)?deviceReauth().message:error.message||'签到状态查询失败';}
    pool.invalidate(input.uid,false);return result;
  }

  function pruneLogins(){for(const [id,entry]of pending)if(Date.now()-entry.createdAt>600000)pending.delete(id);}
  async function pollLogin(id){
    pruneLogins();const entry=pending.get(id);if(!entry)throw new ApiError('登录请求已过期，请重新打开登录页',404);
    if(entry.status==='pending'&&typeof adapter.pollLogin==='function'&&Date.now()>(entry.nextCheck||0)){
      entry.nextCheck=Date.now()+1500;
      if(!entry.polling)entry.polling=(async()=>{try{const result=await adapter.pollLogin(entry.data);if(result.status==='ready'&&pending.get(id)===entry){const imported=await importAccount(result.account,()=>pending.get(id)===entry&&Date.now()-entry.createdAt<=600000);Object.assign(entry,imported,{status:'ready'});}}catch(error){entry.status='failed';entry.message=error.message;}finally{entry.polling=null;}})();
      await entry.polling;
    }
    return {status:entry.status==='processing'?'pending':entry.status,...(entry.message?{message:entry.message}:{}),...(entry.status==='ready'?{account:entry.account,credential:entry.credential}:{})};
  }
  async function authorize(req,res){
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const url='http://127.0.0.1:18080'+req.url;pruneLogins();const [id,entry]=[...pending].find(([,e])=>e.status==='pending'&&adapter.matchesCallback?.(e.data,url))??[];
    if(!entry){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('登录请求不匹配或已经过期，请回到 KleeAPI 重新登录。');return;}
    // 完成官方回调后再次核对待登录记录，取消或过期的请求不能保存账号。
    entry.status='processing';
    try{const imported=await importAccount(await adapter.completeLogin(entry.data,url),()=>pending.get(id)===entry&&Date.now()-entry.createdAt<600000);Object.assign(entry,imported,{status:'ready'});res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('登录完成，请返回 KleeAPI 管理页面。');}
    catch{entry.status='failed';entry.message='登录回调未能完成，请重新登录或手动导入 JSON。';res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(entry.message);}
  }

  const server=createServer(async(req,res)=>{
    let poolRequest=false;
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try{
      const validHost=['127.0.0.1:'+port,'localhost:'+port];if(!validHost.includes(req.headers.host))throw new ApiError('无效的本机 Host',400);
      if(req.headers.origin){if(!origins.has(req.headers.origin))throw new ApiError('不允许的跨站请求',403);res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'300'});res.end();return;}
      const url=new URL(req.url,'http://127.0.0.1:'+port),path=url.pathname;
      if(req.method==='GET'&&path==='/'){res.writeHead(302,{Location:'/admin'});res.end();return;}
      // 平台页面始终由对应服务提供，避免路径名称和实际操作的账号平台不一致。
      if(req.method==='GET'&&/^\/admin\/(gateway|workbuddy|trae|qoder)(?:\/.*)?$/.test(path)){
        const target=path.split('/')[2];
        if(target!==platform){res.writeHead(302,{Location:'http://127.0.0.1:'+config.ports[target]+path,'Cache-Control':'no-store'});res.end();return;}
      }
      if(serveFrontend(req,res,path,base))return;
      if(req.method==='GET'&&path==='/api/config')return json(res,200,{name:'KleeAPI',platform,ports:config.ports});
      if(req.method==='GET'&&path==='/health')return json(res,200,{ok:true,name:'KleeAPI',platform});
      if(!store.authorized(token(req)))throw new ApiError('API Key 无效',401,'invalid_api_key');
      if(req.method==='GET'&&path==='/api/accounts')return json(res,200,{accounts:store.list(),activeUid:store.state.activeUid,warning:store.warning||undefined});
      if(req.method==='POST'&&path==='/api/key'){const body=await readBody(req,4096);store.replaceKey(body.apiKey,token(req));return json(res,200,{ok:true});}
      if(req.method==='POST'&&path==='/api/accounts/import'){const body=await readBody(req,6*1024*1024);return json(res,200,await importAccount(body.json));}
      if(req.method==='POST'&&path==='/api/accounts/desktop'){if(!adapter.desktop)throw new ApiError('此平台不支持读取桌面登录');return json(res,200,await importAccount(await adapter.desktop()));}
      const match=path.match(/^\/api\/accounts\/([^/]+)(?:\/(export|refresh))?$/);
      if(match){
        const uid=decodeURIComponent(match[1]),action=match[2];
        if(req.method==='GET'&&action==='export')return json(res,200,store.get(uid));
        if(req.method==='POST'&&action==='refresh'){const old=store.get(uid);if(!old.refreshToken&&!(platform==='qoder'&&old.deviceRefreshToken))throw new ApiError('账号没有刷新令牌，请重新登录');const next=await fresh(old,true);modelCache=null;pool.invalidate(uid);return json(res,200,{account:store.list().find(a=>a.uid===uid),credential:next,...(next.refreshWarning?{warning:next.refreshWarning}:{})});}
        if(req.method==='PATCH'&&!action){await store.patch(uid,await readBody(req,4096));modelCache=null;pool.invalidate(uid);return json(res,200,{ok:true});}
        if(req.method==='DELETE'&&!action){await store.remove(uid);modelCache=null;pool.invalidate(uid);return json(res,200,{ok:true});}
      }
      if(req.method==='GET'&&path==='/api/pool')return json(res,200,await pool.snapshot({force:url.searchParams.get('refresh')==='1'}));
      if(req.method==='POST'&&path==='/api/pool/chat/completions'){
        poolRequest=true;
        const input=await readBody(req,8*1024*1024),body=input?.request;
        if(typeof input?.uid!=='string'||!input.uid||!Array.isArray(body?.messages)||!body.messages.length||!body.messages.every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&typeof m.role==='string')||typeof body.model!=='string'||!body.model.trim())throw new ApiError('需要 uid、model 和有效的非空 messages 数组');
        const controller=new AbortController();req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const timer=setTimeout(()=>controller.abort(new DOMException('Response lifetime exceeded','TimeoutError')),poolTimeoutMs);let result;
        try{result=await pool.chat(input.uid,body,{signal:controller.signal});return await relayCompletion(result.response,res,{stream:body.stream===true,model:body.model,format:adapter.streamFormat,signal:controller.signal});}finally{clearTimeout(timer);result?.release();}
      }
      if(req.method==='GET'&&path==='/v1/models')return json(res,200,await models(url.searchParams.get('refresh')==='1'));
      if(req.method==='GET'&&path==='/api/monitor')return json(res,200,await monitor());
      if(req.method==='GET'&&path==='/api/checkin')return json(res,200,await checkinStatus());
      if(req.method==='POST'&&path==='/api/checkin'){
        if(checking)throw new ApiError('签到正在进行，请等待本次结果',409);checking=true;
        try{const body=await readBody(req,4096),accounts=body.all?store.state.accounts.map(a=>structuredClone(a)):[store.selected()];const results=[];for(const a of accounts)results.push(await checkinOne(a));return json(res,200,{platform,fetchedAt:Date.now(),accounts:results});}finally{checking=false;}
      }
      if(req.method==='POST'&&path==='/api/login'){
        pruneLogins();if(platform==='trae'&&!callbackAvailable)throw new ApiError('登录回调端口 18080 被占用，请先释放该端口或手动导入 JSON',503);
        if(pending.size>=20)throw new ApiError('登录请求过多，请取消旧请求后重试',429);
        const body=await readBody(req,4096),data=await adapter.startLogin({region:body.region||'cn',callbackURL:'http://127.0.0.1:18080/authorize'}),id=randomUUID();
        pending.set(id,{data,status:'pending',createdAt:Date.now()});return json(res,200,{id,url:data.url,expiresAt:Date.now()+600000});
      }
      const login=path.match(/^\/api\/login\/([a-f\d-]+)$/i);
      if(login&&req.method==='GET')return json(res,200,await pollLogin(login[1]));
      if(login&&req.method==='DELETE'){pending.delete(login[1]);return json(res,200,{ok:true});}
      if(req.method==='POST'&&path==='/v1/chat/completions'){
        const body=await readBody(req,8*1024*1024);if(!Array.isArray(body.messages)||!body.messages.length||!body.messages.every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&typeof m.role==='string')||typeof body.model!=='string'||!body.model.trim())throw new ApiError('需要 model 和有效的非空 messages 数组');
        const controller=new AbortController();req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const account=await fresh(store.selected()),response=await adapter.chat(account,body,{signal:controller.signal});return await relayCompletion(response,res,{stream:body.stream===true,model:body.model,format:adapter.streamFormat});
      }
      if(req.method==='GET'&&path==='/status')return json(res,200,{platform,accounts:store.list()});
      throw new ApiError('接口不存在',404,'not_found');
    }catch(error){if(!res.headersSent&&!res.destroyed)json(res,Number.isInteger(error.status)?error.status:500,{error:{message:error instanceof ApiError?error.message:'本地服务处理失败，请检查配置或重新导入账号',code:error.code||'internal_error',...(poolRequest&&error.retryable===true?{retryable:true}:{})}});else if(!res.destroyed)res.end();}
  });
  server.requestTimeout=120000;server.headersTimeout=15000;
  const callbackServer=platform==='trae'&&callback?createServer((req,res)=>{if(req.url?.startsWith('/authorize?'))authorize(req,res).catch(()=>res.end('登录失败，请重新登录'));else{res.writeHead(404);res.end();}}):null;
  return {server,store,config,pool,async listen(){if(callbackServer){try{await listen(callbackServer,18080);callbackAvailable=true;}catch{callbackAvailable=false;}}try{await listen(server,port);}catch(error){if(callbackServer?.listening)callbackServer.close();throw error;}},async close(){await Promise.all([server,callbackServer].filter(s=>s?.listening).map(s=>new Promise(r=>{s.closeAllConnections();s.close(r);})));}};
}

function listen(server,port){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const platform=(process.argv[process.argv.indexOf('--provider')+1]||'').toLowerCase();
  try{
    const service=await createService({platform});await service.listen();console.log('KleeAPI '+platform+' ready: http://127.0.0.1:'+service.config.ports[platform]+'/admin');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await service.close();process.exit(0);});
  }catch(error){console.error(error instanceof ApiError?error.message:'服务启动失败：请检查端口、配置和本机数据目录。');process.exitCode=1;}
}
