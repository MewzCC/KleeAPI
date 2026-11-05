<script setup lang="ts">
import { names, platformLink, platforms, session } from '../modules/session'
</script>

<template>
  <div class="portal">
    <header class="portal-top">
      <a class="portal-brand" href="/admin" aria-label="KleeAPI 首页"><span class="portal-mark" aria-hidden="true">K</span><span>KleeAPI<small>LOCAL CONSOLE</small></span></a>
      <span class="portal-local">LOCALHOST</span>
    </header>
    <main class="portal-main">
      <section class="portal-hero">
        <p class="portal-eyebrow">ONE GATEWAY · ALL YOUR ACCOUNTS</p>
        <h1>一个入口，连接所有模型</h1>
        <p class="portal-intro">使用统一网关接入，或进入各平台管理账号与额度。</p>
      </section>
      <a :href="platformLink('gateway')" class="portal-card portal-gateway">
        <div class="portal-card-top"><span class="portal-symbol" aria-hidden="true">G</span><span class="portal-badge">统一调用入口</span></div>
        <h2>统一网关</h2>
        <p class="portal-description">一个 Base URL、一枚独立 Key，汇集 WorkBuddy、Trae 与 Qoder 各区域的可用账号。</p>
        <ul class="portal-features"><li>跨平台号池</li><li>聚合模型目录</li><li>自动分配可用账号</li><li>统一 API 指南</li></ul>
        <div class="portal-card-bottom"><span class="portal-action">进入网关与接入指南 <span aria-hidden="true">↗</span></span><span class="portal-port">本地端口 <code>{{ session.ports.gateway }}</code></span></div>
      </a>
      <section class="portal-platforms" aria-labelledby="platform-heading">
        <h2 id="platform-heading">平台账号管理</h2>
        <div class="portal-platform-grid">
          <a v-for="p in platforms.filter(p => p !== 'gateway')" :key="p" :href="platformLink(p)" class="portal-card" :class="`portal-${p}`">
            <div class="portal-card-top"><span class="portal-symbol" aria-hidden="true">{{ names[p].slice(0, 1) }}</span><span class="portal-badge">独立工作空间</span></div>
            <h3>{{ names[p] }}</h3>
            <p v-if="p === 'workbuddy'" class="portal-description">网页登录与桌面登录，连接你的 WorkBuddy 账号。</p>
            <p v-else-if="p === 'trae'" class="portal-description">官方网页登录与 JSON 导入，连接你的 Trae 账号。</p>
            <p v-else class="portal-description">选择中国大陆或国际版，使用官方网页登录或 JSON 导入账号。</p>
            <ul class="portal-features"><li>多账号管理</li><li>模型目录</li><li>{{ p === 'qoder' ? '活动签到' : '每日签到' }}</li><li>{{ p === 'qoder' ? '分区额度' : '额度监控' }}</li></ul>
            <div class="portal-card-bottom"><span class="portal-action">进入管理 <span aria-hidden="true">↗</span></span><span class="portal-port">本地端口 <code>{{ session.ports[p] }}</code></span></div>
          </a>
        </div>
      </section>
      <p class="portal-note">账号和额度仍由各平台独立管理；网关使用独立 API Key，仅调度已启用且具备对应模型可用额度的账号。</p>
    </main>
    <footer class="portal-footer"><span>KleeAPI</span><span>本地运行 · 自由连接</span></footer>
  </div>
</template>

<style scoped>
.portal {
  --portal-border: #343d4c;
  --portal-muted: #abb8ce;
  width: 100%; max-width: none; min-height: 100svh; margin: 0;
  padding: clamp(14px, 2.2vh, 26px) max(24px, calc((100vw - 1360px) / 2));
  display: flex; flex-direction: column; gap: clamp(16px, 3vh, 36px);
  background: radial-gradient(ellipse at 15% 0%, #151923 0%, transparent 55%), #0f1217; color: #e9edf7;
}
.portal-top { display: flex; justify-content: space-between; align-items: center; }
.portal-brand { display: flex; align-items: center; gap: 14px; font-size: 25px; font-weight: 700; line-height: 1.2; }
.portal-mark { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: #e9edf7; color: #111725; font-size: 29px; }
.portal-brand small { display: block; margin-top: 7px; color: var(--portal-muted); font-size: 10px; font-weight: 500; letter-spacing: 3px; }
.portal-local { padding: 6px 10px; border: 1px solid var(--portal-border); border-radius: 6px; font-size: 10px; letter-spacing: 1px; }
.portal-main { width: 100%; max-width: 1236px; margin: auto; display: flex; flex-direction: column; gap: clamp(14px, 2.5vh, 30px); }
.portal-hero { padding: clamp(0px, 1.4vh, 16px) 0 clamp(0px, 1vh, 12px); }
.portal-eyebrow { color: #7197ff; font-size: 11px; font-weight: 600; letter-spacing: 1.8px; }
.portal-hero h1 { margin: clamp(10px, 1.8vh, 20px) 0 12px; font-size: clamp(28px, 3.2vw, 48px); line-height: 1.25; letter-spacing: -1.5px; }
.portal-intro { color: var(--portal-muted); font-size: clamp(13px, 1.2vw, 17px); }
.portal-card { --card-accent: #83a2ff; display: flex; flex-direction: column; min-width: 0; padding: clamp(18px, 2.5vh, 32px); border: 1px solid var(--portal-border); border-radius: 22px; background: linear-gradient(130deg, color-mix(in srgb, var(--card-accent) 5%, #181b21), #181b21 65%); transition: border-color .18s, box-shadow .18s; }
.portal-card:hover { color: #e9edf7; border-color: var(--card-accent); box-shadow: 0 0 24px color-mix(in srgb, var(--card-accent) 7%, transparent); }
.portal-card:focus-visible { outline: 2px solid var(--card-accent); outline-offset: 4px; }
.portal-gateway { --card-accent: #69d8b6; }
.portal-trae { --card-accent: #ff958c; }
.portal-qoder { --card-accent: #b39aff; }
.portal-card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: clamp(12px, 2vh, 24px); }
.portal-symbol { display: grid; place-items: center; flex: none; width: clamp(40px, 5.5vh, 64px); height: clamp(40px, 5.5vh, 64px); border: 1px solid color-mix(in srgb, var(--card-accent) 35%, transparent); border-radius: 17px; color: var(--card-accent); background: color-mix(in srgb, var(--card-accent) 10%, transparent); font-size: 28px; font-weight: 600; }
.portal-badge { padding: 4px 8px; border: 1px solid #414b5b; border-radius: 5px; color: #c4d0e4; font-size: 11px; white-space: nowrap; }
.portal-gateway .portal-badge { border-color: #305e50; background: #1c352d; color: #87e3c7; }
.portal-card h2, .portal-card h3 { color: #e9edf7; font-size: clamp(23px, 2vw, 32px); font-weight: 600; line-height: 1.3; }
.portal-description { margin-top: 10px; color: var(--portal-muted); font-size: clamp(13px, 1.15vw, 16px); line-height: 1.7; }
.portal-features { display: flex; flex-wrap: wrap; column-gap: 20px; row-gap: 8px; padding: 0; margin: clamp(14px, 2.2vh, 26px) 0; list-style: none; color: #c8d3e6; font-size: 12px; line-height: 1.5; }
.portal-features li::before { content: '·'; margin-right: 8px; color: var(--card-accent); }
.portal-card-bottom { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; margin-top: auto; padding-top: clamp(12px, 2vh, 24px); border-top: 1px solid var(--portal-border); }
.portal-action { color: var(--card-accent); font-size: 15px; font-weight: 600; }
.portal-action > span { margin-left: 10px; }
.portal-port { color: var(--portal-muted); font-size: 11px; white-space: nowrap; }
.portal-port code { margin-left: 6px; color: #c5d4ed; font-size: 11px; }
.portal-platforms > h2 { margin-bottom: clamp(10px, 1.6vh, 20px); font-size: 18px; }
.portal-platform-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(16px, 2vw, 30px); }
.portal-note { color: var(--portal-muted); font-size: 12px; line-height: 1.6; }
.portal-footer { margin: 0; padding: 14px 8px 0; border-top: 1px solid #2b323e; display: flex; justify-content: space-between; color: #94a2ba; font-size: 11px; }
@media (max-height: 1200px) and (min-width: 701px) {
  .portal { gap: 14px; padding-top: 14px; padding-bottom: 14px; }
  .portal-main { gap: 14px; }
  .portal-hero { padding: 0; }
  .portal-hero h1 { margin: 8px 0; font-size: 34px; }
  .portal-card { padding: 18px 22px; border-radius: 18px; }
  .portal-card-top { margin-bottom: 10px; }
  .portal-symbol { width: 40px; height: 40px; font-size: 23px; border-radius: 12px; }
  .portal-description { margin-top: 6px; font-size: 13px; }
  .portal-features { margin: 12px 0; gap: 6px 14px; }
  .portal-card-bottom { padding-top: 12px; }
  .portal-card h2, .portal-card h3 { font-size: 24px; }
}
@media (min-width: 701px) and (max-height: 800px) {
  .portal-card { padding: 12px 20px; }
  .portal-symbol { width: 32px; height: 32px; font-size: 21px; border-radius: 10px; }
  .portal-card-top { margin-bottom: 8px; }
  .portal-features { margin: 10px 0; }
  .portal-main { gap: 12px; }
  .portal-hero h1 { font-size: 30px; }
}
@media (max-width: 700px) and (min-height: 451px), (min-width: 701px) and (max-width: 900px) and (min-height: 651px) {
  .portal { padding: 14px 18px; gap: 18px; }
  .portal-main { gap: 16px; }
  .portal-brand { font-size: 21px; gap: 10px; }
  .portal-mark { width: 38px; height: 38px; font-size: 25px; border-radius: 12px; }
  .portal-brand small { font-size: 8px; letter-spacing: 2px; margin-top: 5px; }
  .portal-hero { padding: 0; }
  .portal-eyebrow { font-size: 9px; letter-spacing: 1.2px; }
  .portal-hero h1 { font-size: clamp(23px, 5.5vw, 34px); letter-spacing: -1px; margin: 10px 0 8px; }
  .portal-intro { font-size: 12px; line-height: 1.6; }
  .portal-card { padding: 16px; border-radius: 16px; }
  .portal-card-top { margin-bottom: 10px; }
  .portal-symbol { width: 36px; height: 36px; font-size: 22px; border-radius: 11px; }
  .portal-card h2, .portal-card h3 { font-size: 21px; }
  .portal-description { font-size: 12px; margin-top: 6px; line-height: 1.6; }
  .portal-features { gap: 4px 12px; font-size: 10px; margin: 10px 0; }
  .portal-features li::before { margin-right: 5px; }
  .portal-card-bottom { padding-top: 10px; }
  .portal-action { font-size: 13px; }
  .portal-platform-grid { grid-template-columns: 1fr; gap: 10px; }
  .portal-platform-grid .portal-card { position: relative; padding-left: 66px; }
  .portal-platform-grid .portal-card-top { position: absolute; left: 16px; top: 16px; margin: 0; }
  .portal-platform-grid .portal-badge, .portal-platform-grid .portal-features { display: none; }
  .portal-platform-grid .portal-description { margin-bottom: 10px; }
  .portal-platforms > h2 { font-size: 15px; margin-bottom: 10px; }
  .portal-note { font-size: 10px; }
  .portal-footer { padding: 10px 0 0; font-size: 10px; flex-direction: row; }
}
@media (max-width: 700px) and (min-height: 451px) and (max-height: 900px) {
  .portal { gap: 10px; padding: 10px 14px; }
  .portal-main { gap: 10px; }
  .portal-card { padding: 12px; }
  .portal-gateway { display: grid; grid-template-columns: 1fr auto; column-gap: 10px; }
  .portal-gateway .portal-card-top { grid-column: 2; grid-row: 1; margin: 0; }
  .portal-gateway .portal-symbol { display: none; }
  .portal-gateway .portal-description, .portal-gateway .portal-features, .portal-gateway .portal-card-bottom { grid-column: 1 / -1; }
  .portal-features { margin: 8px 0; }
  .portal-platform-grid .portal-card { padding: 10px 12px 10px 60px; }
  .portal-platform-grid .portal-card-top { top: 12px; left: 12px; }
  .portal-platform-grid .portal-description { margin: 4px 0 8px; }
  .portal-platform-grid .portal-card-bottom { padding-top: 6px; }
  .portal-card h3 { font-size: 18px; }
}
@media (max-width: 700px) and (min-height: 451px) and (max-height: 740px) {
  .portal-platform-grid .portal-description { display: none; }
  .portal-platform-grid .portal-card-bottom { border: 0; padding-top: 8px; }
  .portal-platform-grid .portal-card { padding-top: 8px; padding-bottom: 8px; }
}
@media (max-width: 700px) and (min-height: 451px) and (max-height: 650px) {
  .portal-gateway .portal-description, .portal-gateway .portal-features { display: none; }
  .portal-gateway .portal-card-bottom { margin-top: 10px; }
  .portal-hero h1 { font-size: 22px; }
  .portal-main { gap: 8px; }
  .portal-platform-grid .portal-card { padding-top: 6px; padding-bottom: 6px; }
  .portal { gap: 8px; padding-top: 8px; padding-bottom: 8px; }
}
@media (min-width: 601px) and (max-height: 650px) {
  .portal-main { display: grid; grid-template-columns: 1fr 2.2fr; gap: 14px 20px; }
  .portal-hero, .portal-note { grid-column: 1 / -1; }
  .portal-platform-grid { gap: 12px; }
  .portal-platforms { display: flex; flex-direction: column; }
  .portal-platform-grid { flex: 1; }
  .portal-card { padding: 16px; }
  .portal-badge { font-size: 9px; padding: 4px; }
  .portal-card-top { gap: 6px; }
  .portal-card h3 { font-size: 21px; }
  .portal-card-bottom { align-items: flex-start; flex-direction: column; }
}
@media (min-width: 601px) and (max-height: 450px) {
  .portal { padding: 8px 18px; gap: 8px; }
  .portal-hero { padding: 0; }
  .portal-card-top { display: none; }
  .portal-brand { font-size: 20px; }
  .portal-brand small { margin-top: 3px; font-size: 8px; }
  .portal-mark { width: 34px; height: 34px; font-size: 24px; border-radius: 10px; }
  .portal-main { gap: 10px 14px; }
  .portal-hero h1 { font-size: 26px; margin: 4px 0; }
  .portal-eyebrow { font-size: 9px; }
  .portal-intro { font-size: 12px; }
  .portal-card { padding: 12px; border-radius: 14px; }
  .portal-symbol { width: 30px; height: 30px; font-size: 20px; border-radius: 9px; }
  .portal-badge, .portal-features { display: none; }
  .portal-description { display: none; }
  .portal-card h2, .portal-card h3 { margin-bottom: 10px; }
  .portal-card-bottom { flex-direction: row; padding-top: 8px; }
  .portal-action { font-size: 12px; }
  .portal-note { font-size: 10px; }
  .portal-platforms > h2 { font-size: 14px; margin-bottom: 8px; }
  .portal-footer { padding-top: 8px; }
}
</style>
