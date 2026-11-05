<script setup lang="ts">
import { onMounted } from 'vue'
import { initialize, session } from './modules/session'
onMounted(initialize)
</script>
<template>
  <div v-if="session.error" class="boot"><h1>KleeAPI</h1><el-alert :title="session.error" type="error" :closable="false" /><el-button @click="initialize">重新连接</el-button></div>
  <div v-else-if="!session.ready" class="boot" role="status">正在连接本地工作空间…</div>
  <router-view v-else :key="$route.path" />
</template>
