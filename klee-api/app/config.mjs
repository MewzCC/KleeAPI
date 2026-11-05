import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
export const root=dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** 统一端口配置仅控制回环监听，不能把管理接口绑定到任意网络地址。 */
export function loadConfig(base=root){
  let input={};try{input=JSON.parse(readFileSync(join(base,'klee-config.json'),'utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code!=='ENOENT')throw Error('klee-config.json 格式无效');}
  if(!input||Array.isArray(input)||typeof input!=='object')throw Error('配置必须是 JSON 对象');
  const ports={workbuddy:18791,trae:17864,qoder:17865,gateway:18887};
  for(const platform of Object.keys(ports)){
    if(input[platform]!==undefined){const section=input[platform];if(!section||Array.isArray(section)||typeof section!=='object')throw Error(platform+' 配置无效');if(section.port!==undefined)ports[platform]=section.port;}
    if(!Number.isInteger(ports[platform])||ports[platform]<1||ports[platform]>65535||ports[platform]===18080)throw Error(platform+' 端口须为 1–65535 的整数，不能占用登录回调端口 18080');
  }
  if(new Set(Object.values(ports)).size!==Object.keys(ports).length)throw Error('各平台的端口不能相同');
  const aliases=Object.create(null),configured=input.gateway?.aliases??{};
  if(!configured||Array.isArray(configured)||typeof configured!=='object')throw Error('gateway.aliases 必须是模型别名对象');
  for(const [name,targets]of Object.entries(configured)){
    if(!name.trim()||name.length>256||!Array.isArray(targets)||!targets.length||targets.some(target=>typeof target!=='string'||!target.trim()||target.length>1024))throw Error('gateway.aliases 的每个别名必须指向非空模型 ID 数组');
    aliases[name]=[...new Set(targets)];
  }
  return {ports,callbackPort:18080,gateway:{aliases}};
}
