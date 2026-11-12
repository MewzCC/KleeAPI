import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ApiError} from './http.mjs';

/** 同目录写入后替换；失败不改写原文件，也不遗留含凭据的临时文件。 */
export function atomicWrite(file,contents){
  const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  try{writeFileSync(temp,contents,{mode:0o600});renameSync(temp,file);}finally{if(existsSync(temp))unlinkSync(temp);}
}

/** Windows 登录凭据的加密密钥由当前用户的 DPAPI 保护，数据经标准输入传递。 */
async function dpapi(operation,buffer){
  return new Promise((resolve,reject)=>{
    const script=`Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new ApiError('无法打开本机凭据密钥，请重新登录',500));},15000);
    child.stdout.on('data',v=>{output+=v;if(output.length>100000){child.kill();reject(new ApiError('凭据密钥无效',500));}});
    child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new ApiError('无法使用 Windows 凭据保护',500));});
    child.on('close',code=>{clearTimeout(timer);if(code===0&&output.trim())resolve(Buffer.from(output.trim(),'base64'));else reject(new ApiError('登录凭据属于其他电脑或用户，请重新登录',500));});
    child.stdin.on('error',()=>{});child.stdin.end(buffer.toString('base64'));
  });
}

/** 每个平台独立保存账号、选中状态和 API Key；写事务成功后才替换内存状态。 */
export class AccountStore{
  constructor({platform,dir,normalize,protectKey=process.platform==='win32'}){Object.assign(this,{platform,dir,normalize,protectKey});this.state={accounts:[],activeUid:''};this.tail=Promise.resolve();this.warning='';}
  async init(){
    mkdirSync(this.dir,{recursive:true,mode:0o700});this.file=join(this.dir,'accounts.klee.json');this.keyFile=join(this.dir,'klee-store.key');this.apiKeyFile=join(this.dir,'api-key.txt');
    if(!existsSync(this.apiKeyFile))atomicWrite(this.apiKeyFile,'klee-'+randomBytes(20).toString('hex')+'\n');
    this.apiKey=readFileSync(this.apiKeyFile,'utf8').trim();if(!this.apiKey)throw new ApiError('本地 API Key 文件为空',500);
    if(existsSync(this.keyFile)){const saved=JSON.parse(readFileSync(this.keyFile,'utf8'));this.key=saved.dpapi?await dpapi('Unprotect',Buffer.from(saved.data,'base64')):Buffer.from(saved.data,'base64');}
    else{
      if(existsSync(this.file))throw new ApiError('账号加密密钥缺失，已停止以免覆盖原账号',500);
      this.key=randomBytes(32);const wrapped=this.protectKey?await dpapi('Protect',this.key):this.key;atomicWrite(this.keyFile,JSON.stringify({dpapi:this.protectKey,data:wrapped.toString('base64')}));
    }
    if(this.key.length!==32)throw new ApiError('账号加密密钥无效',500);
    if(existsSync(this.file))this.state=this.decrypt(JSON.parse(readFileSync(this.file,'utf8')),'KleeAPI/'+this.platform);
    else await this.migrate();
    if(!Array.isArray(this.state.accounts))throw new ApiError('账号文件结构无效',500);
    // 启动成功后才补齐 klee- 前缀；保留自定义内容，超长旧值重新生成。
    if(!this.apiKey.startsWith('klee-')){
      const custom=this.apiKey.startsWith('klee')?this.apiKey.slice(4):this.apiKey;
      const prefixed='klee-'+custom;
      const next=prefixed.length<=256?prefixed:'klee-'+randomBytes(20).toString('hex');
      atomicWrite(this.apiKeyFile,next+'\n');this.apiKey=next;
    }
    return this;
  }
  decrypt(envelope,aad,key=this.key){const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));}
  persist(state){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from('KleeAPI/'+this.platform));const data=Buffer.concat([cipher.update(JSON.stringify(state),'utf8'),cipher.final()]);atomicWrite(this.file,JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));}
  /** 只读迁移原有本机账号；任意一条无法解密时保留原文件，不创建不完整的新账号库。 */
  async migrate(){
    const accounts=[];let active='';
    try{
      if(this.platform==='workbuddy'){
        const dir=join(this.dir,'credentials');const files=existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('.cred')):[];
        if(files.length){const raw=readFileSync(join(dir,'store.key'),'utf8').trim();let key;if(/^[a-f\d]{64}$/i.test(raw))key=Buffer.from(raw,'hex');else{const decoded=Buffer.from(raw,'base64');key=decoded.length===32?decoded:await dpapi('Unprotect',decoded);}
          for(const file of files){const env=JSON.parse(readFileSync(join(dir,file),'utf8'));accounts.push(await this.normalize(this.decrypt(env,'workbuddy-credential\0'+env.uid+'\0v1',key)));}
          try{active=JSON.parse(readFileSync(join(dir,'active.json'),'utf8')).uid||'';}catch{}
        }
      }else if(this.platform==='trae'){
        const dir=join(this.dir,'auths');if(existsSync(dir))for(const file of readdirSync(dir).filter(f=>f.endsWith('.json')))accounts.push(await this.normalize(JSON.parse(readFileSync(join(dir,file),'utf8'))));
        try{const old=JSON.parse(readFileSync(join(this.dir,'state.json'),'utf8'));active=old.active_uid||'';for(const a of accounts){const entry=old.accounts?.[a.uid];if(entry){a.enabled=entry.enabled!==false;a.credits=entry.credits??null;}}}catch{}
      }
      this.state={accounts:accounts.map(a=>({...a,enabled:a.enabled!==false})),activeUid:active};this.persist(this.state);
    }catch{this.warning='旧账号未能完整迁移，原始数据已保留；请重新导入登录 JSON。';}
  }
  authorized(value){const a=Buffer.from(String(value||'')),b=Buffer.from(this.apiKey);return a.length===b.length&&timingSafeEqual(a,b);}
  replaceKey(value,current){if(!this.authorized(current))throw new ApiError('当前 Key 已失效',401);if(typeof value!=='string'||!/^klee-[\x21-\x7e]{3,251}$/.test(value))throw new ApiError('Key 格式须为 klee-自定义Key，共 8–256 位 ASCII 字符，不能包含空格',400,'invalid_api_key_format');atomicWrite(this.apiKeyFile,value+'\n');this.apiKey=value;}
  list(){return this.state.accounts.map(a=>({uid:a.uid,...(a.providerUid?{providerUid:a.providerUid}:{}),nickname:a.nickname||'',...(typeof a.email==='string'&&a.email?{email:a.email}:{}),region:a.region||'cn',enabled:a.enabled!==false,active:a.uid===this.state.activeUid,expiresAt:a.expiresAt||null,credits:typeof a.credits==='number'?a.credits:null,source:a.source||'bound',...(this.platform==='trae'?{desktopBound:a.desktopBound===true}:{}),status:a.enabled===false?'disabled':a.expiresAt&&a.expiresAt<=Date.now()?'expired':'ready'}));}
  get(uid){const a=this.state.accounts.find(a=>a.uid===uid);if(!a)throw new ApiError('账号不存在',404);return structuredClone(a);}
  selected(){if(this.state.activeUid){const a=this.get(this.state.activeUid);if(a.enabled===false)throw new ApiError('当前账号已停用，请手动切换',403);return a;}const a=this.state.accounts.find(a=>a.enabled!==false);if(!a)throw new ApiError('尚无可用账号，请先登录或导入 JSON');return structuredClone(a);}
  mutate(fn){const run=this.tail.then(()=>{const next=structuredClone(this.state);const result=fn(next);this.persist(next);this.state=next;return result;});this.tail=run.catch(()=>{});return run;}
  save(account,activate=true){return this.mutate(s=>{const found=s.accounts.findIndex(a=>a.uid===account.uid);const record={...account,enabled:found>=0&&!activate?s.accounts[found].enabled:account.enabled!==false};if(found<0)s.accounts.push(record);else s.accounts[found]={...s.accounts[found],...record};if(activate)s.activeUid=record.uid;return structuredClone(record);});}
  /** 刷新只能更新仍存在且未被重新导入的凭据，避免异步刷新复活已删除账号。 */
  saveRefreshed(original,changes){return this.mutate(s=>{
    const current=s.accounts.find(a=>a.uid===original.uid);
    if(!current||changes.uid!==original.uid||['accessToken','refreshToken','deviceToken','deviceRefreshToken','region'].some(key=>(current[key]??'')!==(original[key]??'')))throw new ApiError('账号已删除或授权已改变，请重新读取账号',409,'account_changed');
    const next={...current,...changes,uid:current.uid,enabled:current.enabled};Object.assign(current,next);return structuredClone(current);
  });}
  updateCredits(uid,credits){return this.mutate(s=>{const a=s.accounts.find(a=>a.uid===uid);if(a)a.credits=credits;});}
  patch(uid,patch){return this.mutate(s=>{const a=s.accounts.find(a=>a.uid===uid);if(!a)throw new ApiError('账号不存在',404);if(patch.active===true)s.activeUid=uid;if(typeof patch.enabled==='boolean')a.enabled=patch.enabled;return structuredClone(a);});}
  remove(uid){return this.mutate(s=>{if(!s.accounts.some(a=>a.uid===uid))throw new ApiError('账号不存在',404);s.accounts=s.accounts.filter(a=>a.uid!==uid);if(s.activeUid===uid)s.activeUid='';});}
}
