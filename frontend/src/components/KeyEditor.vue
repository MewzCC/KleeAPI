<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { recoverKey, saveKey } from '../api/client'
import { copy } from '../modules/workspace'
import { remembered, safe, session } from '../modules/session'
import type { Platform } from '../types'

const props = withDefaults(defineProps<{ platform: Platform; plaintext?: boolean }>(), { plaintext: false })
const emit = defineEmits<{ saved: [] }>()
const candidate = ref(session.keys[props.platform] || ''), remember = ref(remembered(props.platform)), busy = ref(false)
const error = ref(''), recovering = ref(false)
watch(candidate, () => { error.value = '' })
async function save() { if (busy.value || recovering.value) return; busy.value = true; error.value = ''; try { await saveKey(props.platform, candidate.value, remember.value); candidate.value = session.keys[props.platform]; ElMessage.success('密钥已保存并生效。'); emit('saved') } catch (e) { error.value = safe(e, candidate.value) } finally { busy.value = false } }
async function recover() { if (busy.value || recovering.value) return; recovering.value = true; try { candidate.value = await recoverKey(props.platform); error.value = ''; ElMessage.success('已补填当前 Key，可直接保存或修改为自定义值。') } catch (e) { error.value = safe(e, candidate.value) } finally { recovering.value = false } }
</script>

<template>
  <el-form label-position="top" class="key-editor" @submit.prevent="save">
    <el-form-item label="API Key"><el-input v-model="candidate" :type="plaintext ? 'text' : 'password'" :show-password="!plaintext" autocomplete="off" :spellcheck="false" aria-label="API Key" placeholder="klee-自定义Key" /></el-form-item>
    <p class="muted">首次使用也可直接填写自定义 Key 并保存，无需使用默认值或提供旧 Key。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div class="key-actions"><el-checkbox v-model="remember">在此浏览器记住</el-checkbox><div class="actions"><el-button v-if="error" :loading="recovering" :disabled="busy" @click="recover">一键补填</el-button><el-button :disabled="!session.keys[platform]" @click="copy(session.keys[platform])">复制已保存 Key</el-button><el-button type="primary" native-type="submit" :loading="busy" :disabled="recovering">保存并连接</el-button></div></div>
  </el-form>
</template>
