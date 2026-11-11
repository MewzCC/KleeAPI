import {ApiError} from './http.mjs';
import {createCreditEstimator} from './credit-estimate.mjs';

/** 平台进程独占账号状态；号池只缓存无凭据的模型、额度，并保留请求生命周期内的槽位。 */
export function createPool({platform,store,adapter,fresh,clock=Date.now}){
  const cache=new Map(),loading=new Map(),versions=new Map(),busy=new Set();
  const unit=region=>platform==='qoder'?(region==='cn'?'Qoder CN Credits':'Qoder Global Credits'):platform+' credits';
  const safeError=(error,fallback)=>error instanceof ApiError?error.message:fallback;
  const unavailable=message=>Object.assign(new ApiError(message,503,'no_available_account'),{retryable:true});

  /** 账号修改清空全部元数据；对话完成只失效额度，不使其他账号的目录失效。 */
  function invalidate(uid,all=true){
    versions.set(uid,(versions.get(uid)||0)+1);
    if(all)cache.delete(uid);else if(cache.has(uid))cache.get(uid).quotaAt=0;
  }
  function empty(summary){return {uid:summary.uid,nickname:summary.nickname||summary.uid,region:summary.region||'cn',enabled:summary.enabled!==false,status:'unknown',remaining:null,limit:null,used:null,unlimited:false,unit:unit(summary.region),quotaAt:0,modelsAt:0,models:[],quotaError:null,modelsError:null,inFlight:busy.has(summary.uid)?1:0};}

  /** 按账号合并同时到来的目录和额度查询，过期查询失败时不继续投放旧的正余额。 */
  async function metadata(uid,force=false){
    const summary=store.list().find(a=>a.uid===uid);
    if(!summary)throw unavailable('账号已移出号池');
    if(summary.enabled===false)return {...empty(summary),status:'disabled',quotaError:'账号已停用'};
    if(loading.has(uid))return loading.get(uid);
    const version=versions.get(uid)||0;
    const task=(async()=>{
      let row={...empty(summary),...cache.get(uid),inFlight:busy.has(uid)?1:0},account;
      try{
        account=await fresh(store.get(uid));
        if(account.expiresAt&&account.expiresAt<=clock())throw new ApiError('账号授权已过期，请重新登录',401);
      }catch(error){row={...empty(summary),status:'expired',quotaError:safeError(error,'账号授权无法确认')};if((versions.get(uid)||0)===version)cache.set(uid,row);return row;}
      const now=clock(),needsQuota=force||!row.quotaAt||now-row.quotaAt>=60000,needsModels=force||!row.modelsAt||now-row.modelsAt>=300000;
      await Promise.all([
        needsQuota?(async()=>{try{
          const quota=await adapter.quota(account);
          row.remaining=typeof quota.remaining==='number'&&Number.isFinite(quota.remaining)?quota.remaining:null;
          row.limit=Number.isFinite(quota.limit)&&quota.limit>=0?quota.limit:null;
          row.used=Number.isFinite(quota.used)&&quota.used>=0?quota.used:null;
          row.unlimited=quota.unlimited===true;row.unit=typeof quota.unit==='string'&&quota.unit?quota.unit:unit(row.region);
          row.quotaAt=clock();row.quotaError=row.remaining===null&&!row.unlimited?'平台未能确认通用可用额度':null;
        }catch(error){row.remaining=null;row.limit=null;row.used=null;row.unlimited=false;row.quotaAt=0;row.quotaError=safeError(error,'额度查询失败');}})():null,
        needsModels?(async()=>{try{
          const models=await adapter.models(account);
          if(!Array.isArray(models)||!models.length||models.some(m=>typeof m?.id!=='string'||!m.id.trim()))throw new ApiError('平台未返回有效模型目录',502);
          row.models=models.map(m=>({id:m.id,...(typeof m.name==='string'?{name:m.name}:{}),...(Number.isFinite(m.context_length)?{context_length:m.context_length}:{})}));
          row.modelsAt=clock();row.modelsError=null;
        }catch(error){row.models=[];row.modelsAt=0;row.modelsError=safeError(error,'模型目录查询失败');}})():null,
      ]);
      if((versions.get(uid)||0)!==version)return {...empty(summary),quotaError:'账号状态已变化，请刷新号池'};
      row.status=row.quotaError||row.modelsError?'unknown':row.unlimited||row.remaining>0?'ready':'no_credits';
      cache.set(uid,row);return {...row,inFlight:busy.has(uid)?1:0};
    })();
    loading.set(uid,task);
    try{return await task;}finally{if(loading.get(uid)===task)loading.delete(uid);}
  }

  async function snapshot({force=false}={}){
    const summaries=store.list(),accounts=[];
    const present=new Set(summaries.map(a=>a.uid));
    for(const uid of cache.keys())if(!present.has(uid))cache.delete(uid);
    // 限制同平台并发探测，避免多账号首次刷新形成上游请求洪峰。
    for(let i=0;i<summaries.length;i+=3)accounts.push(...await Promise.all(summaries.slice(i,i+3).map(a=>metadata(a.uid,force))));
    return {platform,fetchedAt:clock(),accounts};
  }

  /** 按指定账号调用，不改 activeUid；返回的 release 必须由流/JSON 响应的 finally 调用。 */
  async function chat(uid,request,{signal}={}){
    if(signal?.aborted)throw new ApiError('请求已取消',499,'request_canceled');
    if(busy.has(uid))throw Object.assign(new ApiError('该账号正在处理号池请求',429,'account_busy'),{retryable:true});
    busy.add(uid);let released=false,dispatched=false;
    const version=versions.get(uid)||0;
    const release=()=>{if(released)return;released=true;busy.delete(uid);invalidate(uid,false);};
    try{
      const row=await metadata(uid),account=await fresh(store.get(uid));
      if((versions.get(uid)||0)!==version||account.expiresAt&&account.expiresAt<=clock())throw unavailable('账号授权或状态已变化，请刷新号池');
      if(store.get(uid).enabled===false)throw unavailable('账号已停用');
      if(!row.enabled||row.quotaError||row.modelsError||(!row.unlimited&&!(row.remaining>0))||!row.models.some(m=>m.id===request.model))throw unavailable('账号缺少所选模型的可确认通用额度或模型权限');
      if(signal?.aborted)throw new ApiError('请求已取消',499,'request_canceled');
      const finalizeUsage=await createCreditEstimator({readQuota:()=>adapter.quota(account),unit:row.unit,signal});
      if(signal?.aborted)throw new ApiError('请求已取消',499,'request_canceled');
      if((versions.get(uid)||0)!==version||store.get(uid).enabled===false)throw unavailable('账号状态已变化，请刷新号池');
      dispatched=true;const response=await adapter.chat(account,request,{signal});
      if(!response.ok){await response.body?.cancel();const error=new ApiError('平台拒绝号池请求（HTTP '+response.status+'）',response.status,'upstream_http_error');if(response.status===429)error.retryable=true;throw error;}
      return {response,release,finalizeUsage};
    }catch(error){release();if(!dispatched&&!signal?.aborted&&error instanceof ApiError&&(error.code==='account_changed'||error.status===404))throw unavailable('账号已移出号池或授权已改变');if(error instanceof ApiError&&error.status===429)error.retryable=true;throw error;}
  }
  return {snapshot,chat,invalidate};
}
