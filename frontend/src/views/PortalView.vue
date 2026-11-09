<script setup lang="ts">
import { names, platformLink, platforms, session } from '../modules/session'
import splash from '../assets/klee/klee-splash.png'
import clover from '../assets/klee/clover.svg'
import plush from '../assets/klee/klee-plush.png'
import ThemeToggle from '../components/ThemeToggle.vue'
import KleeSticker from '../components/KleeSticker.vue'
import { kleeTheme } from '../modules/decoration'
</script>

<template>
  <el-container direction="vertical" class="portal" :class="{ 'portal-reference': !kleeTheme }">
    <el-header class="portal-top">
      <el-link class="portal-brand" href="/admin" underline="never" aria-label="KleeAPI 首页">
        <el-avatar shape="square" class="portal-mark" aria-hidden="true">K</el-avatar>
        <el-text>KleeAPI<el-text tag="small">LOCAL CONSOLE</el-text></el-text>
      </el-link>
      <el-row class="theme-header-actions">
        <el-tag effect="plain" disable-transitions class="portal-local">{{ kleeTheme ? '四叶草的幸运连接' : 'LOCALHOST' }}</el-tag>
        <ThemeToggle />
      </el-row>
    </el-header>

    <el-main class="portal-main">
      <el-row v-if="kleeTheme" tag="section" class="portal-hero klee-hero" aria-labelledby="adventure-title">
        <el-col :span="24" class="hero-copy">
          <el-text tag="p" class="hero-label"><el-image :src="clover" class="hero-clover" alt="" />KLEE'S LITTLE ADVENTURE</el-text>
          <el-text class="klee-ribbon">可莉的软乎乎秘密基地</el-text>
          <el-text tag="h1" id="adventure-title">蹦蹦跳跳，<el-text tag="em">把灵感装进口袋 ♡</el-text></el-text>
          <el-text tag="p" class="portal-intro">嘟嘟可，今天也要一起玩！<br>在四叶草和小小心愿里，连接每一份闪闪发光的灵感。</el-text>
          <el-row class="hero-note"><el-text>MADE OF LITTLE HAPPY THINGS</el-text><el-text class="klee-handwriting">今天的幸运也分你一半</el-text></el-row>
        </el-col>
        <el-image class="hero-art" :src="plush" alt="抱着爱心抱枕的毛绒可莉与嘟嘟可玩偶二创" />
        <el-text class="hero-stamp" aria-hidden="true">KLEE &amp; DODOCO<br>好心情收集中</el-text>
        <el-text class="klee-hero-bow" aria-hidden="true">୨୧</el-text>
        <el-text class="klee-spark spark-one" aria-hidden="true">✧</el-text>
        <el-text class="klee-spark spark-two" aria-hidden="true">✧</el-text>
        <el-text class="klee-spark spark-three" aria-hidden="true">✦</el-text>
      </el-row>
      <el-row v-else tag="section" class="portal-hero" aria-labelledby="portal-title">
        <el-text tag="p" class="portal-eyebrow">ONE GATEWAY · ALL YOUR ACCOUNTS</el-text>
        <el-text tag="h1" id="portal-title">一个入口，连接所有模型</el-text>
        <el-text tag="p" class="portal-intro">使用统一网关接入，或进入各平台管理账号与额度。</el-text>
      </el-row>

      <el-row v-if="kleeTheme" tag="aside" class="klee-sticker-shelf" aria-label="可莉的贴纸收藏">
        <el-row class="klee-shelf-title"><el-text>LITTLE TREASURES</el-text><el-text tag="strong">今天也要可可爱爱</el-text><el-text tag="small">把好心情贴满每个角落 ♡</el-text></el-row>
        <el-row class="klee-sticker-item"><KleeSticker kind="dodoco" /><el-text>嘟嘟可陪你</el-text></el-row>
        <el-row class="klee-sticker-item"><KleeSticker kind="letter" /><el-text>寄一封好心情</el-text></el-row>
        <el-row class="klee-sticker-item"><KleeSticker kind="cookie" /><el-text>幸运四叶草</el-text></el-row>
        <el-image class="klee-photo-sticker" :src="splash" alt="" loading="lazy" fit="contain" />
      </el-row>

      <el-card class="portal-card portal-gateway" shadow="never" body-class="portal-card-body">
        <el-row class="portal-card-top">
          <el-avatar shape="square" class="portal-symbol" aria-hidden="true">G</el-avatar>
          <el-tag effect="plain" disable-transitions class="portal-badge">统一调用入口</el-tag>
        </el-row>
        <el-text tag="h2">统一网关</el-text>
        <el-text tag="p" class="portal-description">通过一个 Base URL 和独立 API Key，调用各平台的可用模型。</el-text>
        <el-row tag="ul" class="portal-features" role="list">
          <el-text tag="li">跨平台号池</el-text><el-text tag="li">聚合模型目录</el-text>
          <el-text tag="li">自动分配可用账号</el-text><el-text tag="li">统一 API 指南</el-text>
        </el-row>
        <el-row class="portal-card-bottom">
          <el-link :href="platformLink('gateway')" class="portal-action" underline="never">
            进入网关与接入指南 <el-text class="portal-arrow" aria-hidden="true">↗</el-text>
          </el-link>
          <el-text class="portal-port">本地端口 <el-text tag="code">{{ session.ports.gateway }}</el-text></el-text>
        </el-row>
      </el-card>

      <el-row tag="section" class="portal-platforms" aria-labelledby="platform-heading">
        <el-text tag="h2" id="platform-heading">{{ kleeTheme ? '冒险伙伴 · 平台账号管理' : '平台账号管理' }}</el-text>
        <el-row class="portal-platform-grid">
          <el-card v-for="p in platforms.filter(p => p !== 'gateway')" :key="p" class="portal-card" :class="`portal-${p}`" shadow="never" body-class="portal-card-body">
            <el-row class="portal-card-top">
              <el-avatar shape="square" class="portal-symbol" aria-hidden="true">{{ names[p].slice(0, 1) }}</el-avatar>
              <el-tag effect="plain" disable-transitions class="portal-badge">独立工作空间</el-tag>
            </el-row>
            <el-text tag="h3">{{ names[p] }}</el-text>
            <el-text v-if="p === 'workbuddy'" tag="p" class="portal-description">网页登录与桌面登录，连接你的 WorkBuddy 账号。</el-text>
            <el-text v-else-if="p === 'trae'" tag="p" class="portal-description">官方网页登录与 JSON 导入，连接你的 Trae 账号。</el-text>
            <el-text v-else tag="p" class="portal-description">选择中国大陆或国际版，使用官方网页登录或 JSON 导入账号。</el-text>
            <el-row tag="ul" class="portal-features" role="list">
              <el-text tag="li">多账号管理</el-text><el-text tag="li">模型目录</el-text>
              <el-text tag="li">{{ p === 'qoder' ? '活动签到' : '每日签到' }}</el-text>
              <el-text tag="li">{{ p === 'qoder' ? '分区额度' : '额度监控' }}</el-text>
            </el-row>
            <el-row class="portal-card-bottom">
              <el-link :href="platformLink(p)" class="portal-action" underline="never" :aria-label="`进入管理 ${names[p]}`">
                进入管理 <el-text class="portal-arrow" aria-hidden="true">↗</el-text>
              </el-link>
              <el-text class="portal-port">本地端口 <el-text tag="code">{{ session.ports[p] }}</el-text></el-text>
            </el-row>
          </el-card>
        </el-row>
      </el-row>
      <el-text tag="p" class="portal-note">账号和额度仍由各平台独立管理。网关使用独立 API Key，仅调度已启用且具备对应模型可用额度的账号。</el-text>
    </el-main>

    <el-footer class="portal-footer">
      <el-text>KleeAPI</el-text>
      <el-text>{{ kleeTheme ? '愿四叶草带来好运 · 静音陪伴' : '本地运行 · 自由连接' }}</el-text>
    </el-footer>
  </el-container>
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
.portal :deep(:where(.el-text)) { color: inherit; font-size: inherit; align-self: auto; }
.portal-top { display: flex; justify-content: space-between; align-items: center; height: auto; padding: 0; }
.portal-brand { color: inherit; font-size: 25px; font-weight: 700; line-height: 1.2; }
.portal-brand :deep(.el-link__inner) { display: flex; align-items: center; gap: 14px; }
.portal-mark { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: #e9edf7; color: #111725; font-size: 29px; }
.portal-brand small { display: block; margin-top: 7px; color: var(--portal-muted); font-size: 10px; font-weight: 500; letter-spacing: 3px; }
.portal-local { height: auto; padding: 6px 10px; border-color: var(--portal-border); border-radius: 6px; background: transparent; color: inherit; font-size: 10px; letter-spacing: 1px; }
.portal-main { width: 100%; max-width: 1236px; min-width: 0; margin: auto; padding: 0; overflow: visible; flex: none; display: flex; flex-direction: column; gap: clamp(14px, 2.5vh, 30px); }
.portal-hero { display: block; padding: clamp(0px, 1.4vh, 16px) 0 clamp(0px, 1vh, 12px); }
.hero-clover { width: 17px; height: 17px; }
#adventure-title em { display: block; }
.portal-eyebrow { color: #7197ff; font-size: 11px; font-weight: 600; letter-spacing: 1.8px; }
.portal-hero h1 { margin: clamp(10px, 1.8vh, 20px) 0 12px; font-size: clamp(28px, 3.2vw, 48px); line-height: 1.25; letter-spacing: -1.5px; }
.portal-intro { color: var(--portal-muted); font-size: clamp(13px, 1.2vw, 17px); }
.portal-card { --card-accent: #83a2ff; position: relative; display: flex; flex-direction: column; min-width: 0; overflow: visible; padding: clamp(18px, 2.5vh, 32px); border: 1px solid var(--portal-border); border-radius: 22px; color: inherit; background: linear-gradient(130deg, color-mix(in srgb, var(--card-accent) 5%, #181b21), #181b21 65%); transition: border-color .18s, box-shadow .18s; }
.portal-card :deep(.portal-card-body) { display: flex; flex: 1; flex-direction: column; padding: 0; }
.portal-card:hover { color: #e9edf7; border-color: var(--card-accent); box-shadow: 0 0 24px color-mix(in srgb, var(--card-accent) 7%, transparent); }
.portal-card:has(.portal-action:focus-visible) { outline: 2px solid var(--card-accent); outline-offset: 4px; }
.portal-gateway { --card-accent: #69d8b6; }
.portal-trae { --card-accent: #ff958c; }
.portal-qoder { --card-accent: #b39aff; }
.portal-card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: clamp(12px, 2vh, 24px); }
.portal-symbol { display: grid; place-items: center; flex: none; width: clamp(40px, 5.5vh, 64px); height: clamp(40px, 5.5vh, 64px); border: 1px solid color-mix(in srgb, var(--card-accent) 35%, transparent); border-radius: 17px; color: var(--card-accent); background: color-mix(in srgb, var(--card-accent) 10%, transparent); font-size: 28px; font-weight: 600; }
.portal-badge { height: auto; padding: 4px 8px; border-color: #414b5b; border-radius: 5px; background: transparent; color: #c4d0e4; font-size: 11px; white-space: nowrap; }
.portal-gateway .portal-badge { border-color: #305e50; background: #1c352d; color: #87e3c7; }
.portal-card h2, .portal-card h3 { color: #e9edf7; font-size: clamp(23px, 2vw, 32px); font-weight: 600; line-height: 1.3; }
.portal-description { margin-top: 10px; color: var(--portal-muted); font-size: clamp(13px, 1.15vw, 16px); line-height: 1.7; }
.portal-features { display: flex; flex-wrap: wrap; column-gap: 20px; row-gap: 8px; padding: 0; margin: clamp(14px, 2.2vh, 26px) 0; list-style: none; color: #c8d3e6; font-size: 12px; line-height: 1.5; }
.portal-features li::before { content: '·'; margin-right: 8px; color: var(--card-accent); }
.portal-card-bottom { position: static; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; margin-top: auto; padding-top: clamp(12px, 2vh, 24px); border-top: 1px solid var(--portal-border); }
.portal-action, .portal-action:hover { position: static; color: var(--card-accent); font-size: 15px; font-weight: 600; }
.portal-action::after { content: ''; position: absolute; inset: 0; z-index: 1; border-radius: inherit; }
.portal-arrow { margin-left: 10px; }
.portal-port { color: var(--portal-muted); font-size: 11px; white-space: nowrap; }
.portal-port code { margin-left: 6px; color: #c5d4ed; font-size: 11px; }
.portal-platforms { display: block; }
.portal-platforms > h2 { margin-bottom: clamp(10px, 1.6vh, 20px); font-size: 18px; }
.portal-platform-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(16px, 2vw, 30px); }
.portal-note { color: var(--portal-muted); font-size: 12px; line-height: 1.6; }
.portal-footer { height: auto; margin: 0; padding: 10px 8px 0; border-top: 1px solid #2b323e; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #94a2ba; font-size: 11px; }
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
@media (min-height: 950px) and (max-height: 1200px) and (min-width: 1100px) {
  .portal-main { gap: clamp(18px, 2vh, 24px); }
  .portal-hero h1 { font-size: clamp(38px, 4vh, 48px); }
  .portal-card { padding: clamp(21px, 2.4vh, 30px); border-radius: 22px; }
  .portal-symbol { width: clamp(44px, 5vh, 60px); height: clamp(44px, 5vh, 60px); font-size: 27px; }
  .portal-card h2, .portal-card h3 { font-size: 28px; }
  .portal-description { font-size: 15px; }
  .portal-features { font-size: 13px; }
  .portal-action, .portal-action:hover { font-size: 16px; }
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
  .portal-brand { font-size: 21px; }
  .portal-brand :deep(.el-link__inner) { gap: 10px; }
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
  .portal-footer { padding: 4px 0 0; font-size: 10px; flex-direction: row; }
}
@media (max-width: 700px) and (min-height: 451px) and (max-height: 900px) {
  .portal { gap: 10px; padding: 10px 14px; }
  .portal-main { gap: 10px; }
  .portal-card { padding: 12px; }
  .portal-gateway :deep(.portal-card-body) { display: grid; grid-template-columns: 1fr auto; column-gap: 10px; }
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
  .portal-footer { padding-top: 0; }
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
.portal-reference {
  --portal-border: #2d394a;
  --portal-muted: #a6b5cb;
  background: radial-gradient(ellipse at 50% 0%, #182339 0%, transparent 54%), #0f141d;
}

@media (min-width: 960px) {
  .portal-reference {
    --portal-content-width: 880px;
    padding: 24px max(24px, calc((100% - var(--portal-content-width)) / 2)) 22px;
    gap: 0;
  }
  .portal-reference .portal-top {
    padding-bottom: 16px;
    border-bottom: 1px solid var(--portal-border);
  }
  .portal-reference .portal-brand { font-size: 21px; }
  .portal-reference .portal-mark { width: 40px; height: 40px; border-radius: 12px; font-size: 24px; }
  .portal-reference .portal-brand small { margin-top: 5px; letter-spacing: 2px; }
  .portal-reference .portal-main {
    display: flex;
    gap: 24px;
    margin: 36px auto;
  }
  .portal-reference .portal-hero { padding: 0; }
  .portal-reference .portal-eyebrow { color: #9eb6f8; font-size: 11px; letter-spacing: 1.6px; }
  .portal-reference .portal-hero h1 { margin: 12px 0 8px; font-size: 36px; letter-spacing: -1px; }
  .portal-reference .portal-intro { font-size: 15px; }
  .portal-reference .portal-card {
    padding: 18px;
    border-radius: 16px;
    background: linear-gradient(145deg, color-mix(in srgb, var(--card-accent) 6%, #171e2a), #171e2a 68%);
  }
  .portal-reference .portal-card-top { display: contents; }
  .portal-reference .portal-badge { display: none; }
  .portal-reference .portal-symbol {
    grid-area: 1 / 1;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    font-size: 19px;
  }
  .portal-reference .portal-card h2,
  .portal-reference .portal-card h3 { grid-area: 1 / 2; align-self: center; margin: 0; font-size: 20px; }
  .portal-reference .portal-description {
    display: block;
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .portal-reference .portal-features { display: flex; margin: 0; gap: 6px; font-size: 12px; }
  .portal-reference .portal-features li {
    padding: 3px 7px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--card-accent) 9%, transparent);
  }
  .portal-reference .portal-features li::before { content: none; }
  .portal-reference .portal-card-bottom { padding-top: 12px; flex-direction: row; align-items: center; }
  .portal-reference .portal-action { font-size: 14px; }
  .portal-reference .portal-arrow { margin-left: 6px; }

  .portal-reference .portal-gateway {
    padding: 22px;
    border-color: #31534e;
    background: linear-gradient(115deg, #192e32, #182531 68%);
  }
  .portal-reference .portal-gateway :deep(.portal-card-body) {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    grid-template-rows: auto auto auto;
    gap: 8px 14px;
  }
  .portal-reference .portal-gateway .portal-symbol { width: 44px; height: 44px; font-size: 22px; }
  .portal-reference .portal-gateway h2 { font-size: 23px; }
  .portal-reference .portal-gateway .portal-description { grid-area: 2 / 2; }
  .portal-reference .portal-gateway .portal-features { grid-area: 3 / 2; margin-top: 4px; }
  .portal-reference .portal-gateway .portal-card-bottom {
    grid-area: 1 / 3 / span 3;
    flex-direction: column;
    justify-content: center;
    margin: 0 0 0 8px;
    padding: 0 0 0 20px;
    border: 0;
    border-left: 1px solid #34504f;
  }
  .portal-reference .portal-gateway .portal-action {
    min-height: 40px;
    padding: 0 12px;
    border-radius: 9px;
    background: #a3efce;
    color: #142c25;
  }
  .portal-reference .portal-gateway .portal-action:hover { background: #b9f7dc; }
  .portal-reference .portal-platforms { display: block; }
  .portal-reference .portal-platforms > h2 { margin-bottom: 12px; font-size: 17px; }
  .portal-reference .portal-platform-grid { gap: 14px; }
  .portal-reference .portal-platform-grid .portal-card :deep(.portal-card-body) {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    grid-template-rows: auto 1fr auto auto;
    gap: 12px 10px;
  }
  .portal-reference .portal-platform-grid .portal-description,
  .portal-reference .portal-platform-grid .portal-features,
  .portal-reference .portal-platform-grid .portal-card-bottom { grid-column: 1 / -1; }
  .portal-reference .portal-note { font-size: 12px; }
  .portal-reference .portal-footer { padding: 12px 0 0; }
}
</style>
