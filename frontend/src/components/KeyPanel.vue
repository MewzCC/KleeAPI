<script setup lang="ts">
import KeyEditor from './KeyEditor.vue'
import { names, session } from '../modules/session'
import type { Platform } from '../types'
defineProps<{ platform: Platform }>()
const emit = defineEmits<{ saved: [] }>()
</script>
<template><section class="panel key-panel"><div><p class="eyebrow">连接与鉴权</p><h2>{{ names[platform] }} API Key</h2><p class="muted">每个平台使用独立密钥。新值保存后生效；已有有效密钥时，保存会同时更新服务端密钥。</p><el-tag :type="session.keys[platform] ? 'success' : 'warning'" effect="plain">{{ session.keys[platform] ? '本页已配置密钥' : '尚未配置' }}</el-tag></div><KeyEditor :platform="platform" @saved="emit('saved')" /></section></template>
