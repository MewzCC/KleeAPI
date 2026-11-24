<script setup lang="ts">
import KeyEditor from './KeyEditor.vue'
import { names, session } from '../modules/session'
import type { Platform } from '../types'
defineProps<{ platform: Platform }>()
const emit = defineEmits<{ saved: [] }>()
</script>
<template><section class="panel key-panel"><div><p class="eyebrow">连接与鉴权</p><h2>{{ names[platform] }} API Key</h2><p class="muted">{{ platform === 'gateway' ? '应用只需配置网关地址和网关 API Key，即可统一调用已接入的各平台模型。' : '直连 ' + names[platform] + ' 时，请使用本平台的地址与 API Key。其他平台需分别配置，也可改用网关统一接入。' }}保存后会同时更新服务端密钥与本页连接。</p><el-tag :type="session.keys[platform] ? 'success' : 'warning'" effect="plain">{{ session.keys[platform] ? '本页已配置密钥' : '尚未配置' }}</el-tag></div><KeyEditor :platform="platform" @saved="emit('saved')" /></section></template>
