import {spawn} from 'node:child_process';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer as createHttpServer,request} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {existsSync,mkdirSync,openSync,closeSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig,root} from '../klee-api/app/config.mjs';

const stateFile=join(root,'runtime','manager.json');
const identity=resolve(root).toLowerCase();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const node=existsSync(join(root,'runtime','node.exe'))?join(root,'runtime','node.exe'):process.execPath;

/** 检查配置中的全部监听端口；失败只关闭本次探测器，不触碰已有进程。 */
export async function preflightPorts(ports){
  const probes=[];
  try{
    for(const port of ports){
      const server=createNetServer();probes.push(server);
      await new Promise((resolve,reject)=>{server.once('error',()=>reject(Error(`端口 ${port} 已占用或不可监听，请先关闭占用程序或修改 klee-config.json。`)));server.listen(port,'127.0.0.1',resolve);});
    }
  }finally{await Promise.all(probes.filter(server=>server.listening).map(server=>new Promise(resolve=>server.close(resolve))));}
}

/** 固定所有子进程的入口，保证关闭时只处理当前管理器创建的进程。 */
export function serviceSpecs(config,dev=false){
  const services=['workbuddy','trae','qoder'].map(name=>({name,port:config.ports[name],args:[join(root,'klee-api','app','server.mjs'),'--provider',name]}));
  services.push({name:'gateway',port:config.ports.gateway,args:[join(root,'klee-api','app','gateway.mjs')]});
  if(dev)services.push({name:'frontend',port:15173,cwd:join(root,'frontend'),args:[join(root,'frontend','node_modules','vite','bin','vite.js'),'--host','127.0.0.1','--port','15173','--strictPort']});
  return services;
}

function readState(){
  try{
    const state=JSON.parse(readFileSync(stateFile,'utf8'));
    if(state.root!==identity||!Number.isInteger(state.pid)||state.pid<=0||!Number.isInteger(state.port)||state.port<1||state.port>65535||!/^[a-f0-9]{64}$/.test(state.token)||!/^[a-f0-9]{32}$/.test(state.instance))throw Error('管理器状态文件不属于本项目或已损坏。');
    return state;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

/** 关闭操作必须通过回环鉴权，不依靠 PID 杀进程，防止误停其他项目。 */
export function controlRequest(state,path='/status',method='GET'){
  return new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:state.port,path,method,headers:{Host:`127.0.0.1:${state.port}`,Authorization:`Bearer ${state.token}`},timeout:12000},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>{body+=part;if(body.length>65536)req.destroy(Error('管理器响应过大'));});
      res.on('end',()=>{try{const result=JSON.parse(body);if(res.statusCode!==200||result.instance!==state.instance||result.root!==identity)throw Error('管理器身份校验失败');resolve(result);}catch(error){reject(error);}});
    });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('管理器响应超时')));req.end();
  });
}

async function existingManager(){
  const state=readState();if(!state)return null;
  try{return {state,status:await controlRequest(state)};}catch{
    try{process.kill(state.pid,0);}catch(error){if(error.code==='ESRCH'){unlinkSync(stateFile);return null;}}
    throw Error('管理器状态无法验证，未停止任何进程。请检查 runtime/manager.json 对应进程；确认已退出后删除该状态文件。');
  }
}

function healthy(service){
  return new Promise(resolve=>{
    const req=request({host:'127.0.0.1',port:service.port,path:service.name==='frontend'?'/admin':'/health',timeout:800},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>{body+=part;if(body.length>65536)req.destroy();});res.on('end',()=>{
        if(service.name==='frontend')return resolve(res.statusCode===200);
        try{const result=JSON.parse(body);resolve(res.statusCode===200&&result.ok===true&&result.name==='KleeAPI'&&result.platform===service.name);}catch{resolve(false);}
      });
    });req.on('error',()=>resolve(false));req.on('timeout',()=>req.destroy());req.end();
  });
}

/** Key 仅在运行时从新目录读取，经 fragment 交给页面，不写入命令行、查询参数或日志。 */
export async function launchBrowser(url){
  const fragment=new URLSearchParams();
  for(const [name,dir]of Object.entries({gateway:'Gateway',workbuddy:'WorkBuddy',trae:'Trae',qoder:'Qoder'})){
    const key=readFileSync(join(root,dir+'-Chat','data',dir,'api-key.txt'),'utf8').trim();
    if(!/^klee-[\x21-\x7e]{3,251}$/.test(key))throw Error('新项目 API Key 格式无效');
    fragment.set(name,key);
  }
  if(process.platform!=='win32')throw Error('请在浏览器打开管理地址，并在设置中填写新项目 Key。');
  await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $env:KLEE_BROWSER_URL -WindowStyle Hidden'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,KLEE_BROWSER_URL:url+'#'+fragment}});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('自动打开浏览器失败')));
  });
}

/** 前台管理器拥有生命周期与鉴权控制端口；任何子进程异常退出均回收本次启动的其他进程。 */
export async function runManager({dev=false,browser=true,spawnProcess=spawn,checkReady=healthy,openBrowser=launchBrowser}={}){
  if(await existingManager())throw Error('本项目管理器已启动，请使用 npm run status 或 npm stop。');
  const config=loadConfig();
  if(dev){if(!existsSync(join(root,'frontend','node_modules','vite','bin','vite.js')))throw Error('缺少前端依赖，请先运行 npm run setup。');}
  else if(!existsSync(join(root,'frontend','dist','index.html')))throw Error('缺少 frontend/dist/index.html，请先运行 npm run setup 和 npm run build。');
  const services=serviceSpecs(config,dev);
  if(new Set(services.map(service=>service.port)).size!==services.length)throw Error('开发端口 15173 不能与配置中的服务端口重复。');
  await preflightPorts(services.map(service=>service.port));
  mkdirSync(join(root,'runtime'),{recursive:true});mkdirSync(join(root,'runtime','logs'),{recursive:true});
  const state={root:identity,pid:process.pid,port:0,token:randomBytes(32).toString('hex'),instance:randomBytes(16).toString('hex'),mode:dev?'development':'production',status:'starting',children:[]};
  const children=[];let stopping=false;let failure;let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  const control=createHttpServer((req,res)=>{
    const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+state.token);
    if(req.headers.host!==`127.0.0.1:${state.port}`||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(403);res.end();return;}
    if(req.method==='GET'&&req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...state,token:undefined}));return;}
    if(req.method==='POST'&&req.url==='/shutdown'){
      void stop().then(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({root:identity,instance:state.instance,status:'stopped'}));});return;
    }
    res.writeHead(404);res.end();
  });
  let ownsState=false;
  async function stop(){
    if(stopping)return done;stopping=true;state.status='stopping';
    await Promise.all(children.map(child=>new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)return resolve();
      child.once('exit',resolve);child.kill('SIGTERM');
      const timeout=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');resolve();},3000);timeout.unref();
    })));
    if(ownsState){try{if(readState()?.instance===state.instance)unlinkSync(stateFile);}catch{}}
    state.status='stopped';finish();
    // 等当前关闭请求发送完响应，再关控制端口。
    setImmediate(()=>{control.close();control.closeIdleConnections();});
  }
  const signalHandler=()=>{void stop();};
  const ipcHandler=message=>{if(message?.command==='shutdown')void stop();};
  process.on('SIGINT',signalHandler);process.on('SIGTERM',signalHandler);process.on('message',ipcHandler);
  try{
    await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(0,'127.0.0.1',resolve);});state.port=control.address().port;
    const fd=openSync(stateFile,'wx',0o600);ownsState=true;try{writeFileSync(fd,JSON.stringify(state,null,2));}finally{closeSync(fd);}
    for(const service of services){
      if(stopping)throw Error('启动已取消');
      const log=openSync(join(root,'runtime','logs',service.name+'.log'),'a',0o600);
      let child;try{child=spawnProcess(node,service.args,{cwd:service.cwd??root,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,...(dev?{KLEE_DEV_ORIGIN:'http://127.0.0.1:15173'}:{})}});}finally{closeSync(log);}
      children.push(child);state.children.push({name:service.name,pid:child.pid,port:service.port});
      child.once('error',()=>{failure=Error(service.name+' 启动失败，请检查 runtime/logs。');void stop();});
      child.once('exit',()=>{if(!stopping){failure=Error(service.name+' 已退出，请检查 runtime/logs。');void stop();}});
    }
    const deadline=Date.now()+30000;
    for(const service of services){
      while(!stopping&&Date.now()<deadline&&!await checkReady(service))await wait(150);
      if(stopping||Date.now()>=deadline)throw failure??Error(service.name+' 启动超时，请检查 runtime/logs。');
    }
    if(stopping)throw failure??Error('启动已取消');
    state.status='ready';writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});
    const url=`http://127.0.0.1:${dev?15173:config.ports.gateway}/admin`;
    console.log('KleeAPI 已启动：'+url);console.log('停止：npm stop；状态：npm run status；日志：runtime/logs');
    process.send?.({status:'ready',url});
    if(browser){try{await openBrowser(url);}catch{console.error('浏览器未自动打开，请手动打开管理地址并填写新项目 Key。');}}
    await done;if(failure)throw failure;
  }catch(error){await stop();throw error;}
  finally{process.off('SIGINT',signalHandler);process.off('SIGTERM',signalHandler);process.off('message',ipcHandler);}
}

async function detached(dev,browser){
  const existing=await existingManager();
  if(existing){console.log('本项目管理器已运行。');if(existing.status.status==='ready'&&browser)try{await launchBrowser(`http://127.0.0.1:${existing.status.mode==='development'?15173:loadConfig().ports.gateway}/admin`);}catch{console.error('请手动打开管理页面。');}return;}
  mkdirSync(join(root,'runtime','logs'),{recursive:true});
  const fd=openSync(join(root,'runtime','logs','manager.log'),'a',0o600);
  let child;try{child=spawn(node,[fileURLToPath(import.meta.url),dev?'dev':'start',...(browser?[]:['--no-browser'])],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',fd,fd,'ipc']});}finally{closeSync(fd);}
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.send({command:'shutdown'},()=>{});reject(Error('启动超时，请查看 runtime/logs/manager.log。'));},40000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('启动失败，请查看 runtime/logs/manager.log。'));});
    child.on('message',message=>{if(message?.status==='ready'){clearTimeout(timer);console.log('KleeAPI 已启动：'+message.url);child.disconnect();child.unref();resolve();}});
  });
}

export async function main(args=process.argv.slice(2)){
  const command=args[0]??'start';
  if(!['start','dev','stop','status'].includes(command)||args.slice(1).some(arg=>!['--detach','--no-browser'].includes(arg)))throw Error('用法：node scripts/manager.mjs start|dev|stop|status [--detach] [--no-browser]');
  if(command==='stop'||command==='status'){
    const existing=await existingManager();if(!existing){console.log('本项目未运行。');return;}
    if(command==='stop'){await controlRequest(existing.state,'/shutdown','POST');console.log('本项目已停止。');}
    else console.log(JSON.stringify(existing.status,null,2));
    return;
  }
  if(args.includes('--detach'))await detached(command==='dev',!args.includes('--no-browser'));
  else await runManager({dev:command==='dev',browser:!args.includes('--no-browser')});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
