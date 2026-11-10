<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { saveKey } from '../api/client'
import { copy } from '../modules/workspace'
import { remembered, safe, session } from '../modules/session'
import type { Platform } from '../types'

const props = withDefaults(defineProps<{ platform: Platform; plaintext?: boolean }>(), { plaintext: false })
const emit = defineEmits<{ saved: [] }>()
const candidate = ref(session.keys[props.platform] || ''), remember = ref(remembered(props.platform)), busy = ref(false)
async function save() { if (busy.value) return; busy.value = true; try { await saveKey(props.platform, candidate.value, remember.value); ElMessage.success('密钥已保存并生效。'); emit('saved') } catch (e) { ElMessage.error(safe(e, candidate.value)) } finally { busy.value = false } }
</script>

<template>
  <el-form label-position="top" class="key-editor" @submit.prevent="save">
    <el-form-item label="API Key"><el-input v-model="candidate" :type="plaintext ? 'text' : 'password'" :show-password="!plaintext" autocomplete="off" :spellcheck="false" aria-label="API Key" placeholder="klee-自定义Key" /></el-form-item>
    <div class="key-actions"><el-checkbox v-model="remember">在此浏览器记住</el-checkbox><div class="actions"><el-button :disabled="!session.keys[platform]" @click="copy(session.keys[platform])">复制已保存 Key</el-button><el-button type="primary" native-type="submit" :loading="busy">保存并连接</el-button></div></div>
  </el-form>
</template>
