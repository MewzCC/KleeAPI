<script setup lang="ts">
import { kleeTheme, setKleeTheme } from '../modules/decoration'
</script>

<template>
  <button class="theme-toggle" type="button" :aria-pressed="kleeTheme" @click="setKleeTheme(!kleeTheme)">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 12C2 14 1 7 5 5c3-2 6 1 7 7Zm0 0C10 2 17 1 19 5c2 3-1 6-7 7Zm0 0c10-2 11 5 7 7-3 2-6-1-7-7Zm0 0c2 10-5 11-7 7-2-3 1-6 7-7Z"/></svg>
    <span>{{ kleeTheme ? '可莉主题已开启' : '开启可莉主题' }}</span>
    <span class="theme-toggle-track" aria-hidden="true"><i /></span>
  </button>
</template>

<style scoped>
.theme-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 8px 12px; min-height: 40px; border: 1px solid var(--border); border-radius: 24px; background: var(--surface); color: var(--muted); font-size: 12px; line-height: 1.4; cursor: pointer; white-space: nowrap; }
.theme-toggle:hover { color: var(--accent); border-color: var(--accent); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.theme-toggle[aria-pressed=true] { color: #a83e58; background: #fff5f6; border-color: #edb7c5; box-shadow: 0 3px 12px #ba638416; }
.theme-toggle-track { width: 28px; height: 16px; padding: 2px; border-radius: 10px; background: #626e85; }
.theme-toggle-track i { display: block; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .2s; }
.theme-toggle[aria-pressed=true] .theme-toggle-track { background: #be526b; }
.theme-toggle[aria-pressed=true] .theme-toggle-track i { transform: translateX(12px); }
@media (max-width: 450px) { .theme-toggle { gap: 6px; font-size: 11px; padding: 8px 10px; }.theme-toggle-track { display: none; } }
</style>
