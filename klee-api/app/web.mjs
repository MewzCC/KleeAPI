import {readFileSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,sep,extname} from 'node:path';
import {ApiError} from './http.mjs';

const types={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};

/**
 * 仅从构建目录提供 Vue 页面和白名单资源，API 路径不会回退到 HTML。
 * 编码路径与符号链接都必须保持在构建目录内，防止泄露本机账号和密钥。
 */
export function serveFrontend(req,res,path,base){
  if(!['GET','HEAD'].includes(req.method))return false;
  const page=/^\/admin(?:\/(?:gateway|workbuddy|trae|qoder)(?:\/[^?]*)?)?\/?$/.test(path);
  if(!page&&!path.startsWith('/assets/')&&path!=='/favicon.svg')return false;
  const dist=resolve(base,'frontend','dist');
  let decoded;
  try{decoded=decodeURIComponent(path);}catch{throw new ApiError('静态资源路径无效',400,'invalid_path');}
  if(decoded.includes('\0')||decoded.includes('\\'))throw new ApiError('静态资源路径无效',400,'invalid_path');
  const file=page?join(dist,'index.html'):resolve(dist,'.'+decoded);
  if(!file.startsWith(dist+sep))throw new ApiError('静态资源路径无效',400,'invalid_path');
  let content;
  try{
    const canonicalDist=realpathSync(dist),canonical=realpathSync(file);
    if(!canonical.startsWith(canonicalDist+sep)||!statSync(canonical).isFile())throw new ApiError('静态资源不存在',404,'not_found');
    if(!page&&!types[extname(canonical)])throw new ApiError('静态资源类型不受支持',404,'not_found');
    content=readFileSync(canonical);
  }catch(error){
    if(error instanceof ApiError)throw error;
    if(page&&error.code==='ENOENT')throw new ApiError('前端尚未构建，请执行 npm run setup 和 npm run build',503,'frontend_not_built');
    if(['ENOENT','ENOTDIR'].includes(error.code))throw new ApiError('静态资源不存在',404,'not_found');
    throw error;
  }
  res.writeHead(200,{'Content-Type':page?'text/html; charset=utf-8':types[extname(file)],'Content-Length':content.length,'Cache-Control':page?'no-store':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"frame-ancestors 'none'"});
  res.end(req.method==='HEAD'?undefined:content);
  return true;
}
