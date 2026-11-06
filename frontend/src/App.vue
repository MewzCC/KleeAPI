<script setup lang="ts">
import { onMounted } from 'vue'
import { initialize, session } from './modules/session'
import KleeCompanion from './components/KleeCompanion.vue'
import KleeDecorations from './components/KleeDecorations.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import { kleeTheme } from './modules/decoration'
onMounted(initialize)
</script>
<template>
  <div v-if="session.error" class="boot"><h1>KleeAPI</h1><el-alert :title="session.error" type="error" :closable="false" /><el-button @click="initialize">重新连接</el-button></div>
  <div v-else-if="!session.ready" class="boot" role="status">正在连接本地工作空间…</div>
  <router-view v-else :key="$route.path" />
  <ThemeToggle v-if="!session.ready || session.error" class="boot-theme-toggle" />
  <KleeDecorations v-if="kleeTheme" />
  <KleeCompanion v-if="kleeTheme" />
</template>

<style>
.theme-header-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 12px; }
.boot-theme-toggle { position: fixed; top: 20px; right: 24px; z-index: 30; }
@media (max-width: 600px) { .theme-header-actions { gap: 8px; }.portal-top .portal-local { display: none; }.workspace-top { flex-wrap: wrap; gap: 12px; } }
</style>
