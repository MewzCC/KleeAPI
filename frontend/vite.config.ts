import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import config from '../klee-config.json'
const gatewayPort = config.gateway.port
if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error('网关端口配置无效。')
export default defineConfig({ plugins: [vue()], server: { host: '127.0.0.1', port: 15173, strictPort: true, proxy: Object.fromEntries(['/api', '/v1', '/health'].map(path => [path, { target: `http://127.0.0.1:${gatewayPort}`, changeOrigin: true }])) } })
