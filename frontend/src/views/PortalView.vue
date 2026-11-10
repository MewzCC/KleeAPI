<script setup lang="ts">
import { baseURL, names, platformLink, session } from '../modules/session'
import { copy } from '../modules/workspace'
import { kleeTheme } from '../modules/decoration'
import ThemeToggle from '../components/ThemeToggle.vue'
import ConsoleIcon from '../components/ConsoleIcon.vue'
import plush from '../assets/klee/klee-plush.png'
const descriptions = {
  workbuddy: '通过官方网页登录或读取桌面登录，连接 WorkBuddy 账号。',
  trae: '连接 Trae 国内版账号，集中管理授权、签到与积分。',
  qoder: '支持国内版与国际版，按区域查看活动奖励与额度。',
}
</script>
<template>
  <div class="console-home">
    <a class="skip-link" href="#home-content">跳到主要内容</a>
    <header class="home-top"><a href="/admin" class="home-brand" aria-label="KleeAPI 首页"><span class="brand-mark">K</span><span>KleeAPI<small>LOCAL CONSOLE</small></span></a><div class="theme-header-actions"><span class="local-label"><i /> 本地运行</span><ThemeToggle /></div></header>
    <main id="home-content">
      <section class="home-hero"><p class="eyebrow">{{ kleeTheme ? '可莉的灵感工作台' : '更简单的模型与账号管理' }}</p><h1>{{ kleeTheme ? '带上嘟嘟可，' : '连接所有平台，' }}<br><span>{{ kleeTheme ? '一起出发寻找灵感。' : '专注每一次灵感。' }}</span></h1><p>一个网关连接模型，一个工作台管理账号、签到与额度。</p><img v-if="kleeTheme" :src="plush" alt="可莉与嘟嘟可毛绒二创" class="home-art" /></section>
      <section class="home-gateway" aria-labelledby="gateway-title"><div><div class="home-gateway-title"><span class="quick-icon"><ConsoleIcon name="pool" :size="24" /></span><h2 id="gateway-title">统一网关</h2><el-tag effect="plain" type="success">推荐入口</el-tag></div><p>汇集可用账号与模型，通过一个 Base URL 调用。签到、调用记录和接入指南，在这里一起管理。</p><div class="home-gateway-links"><a class="home-primary" :href="platformLink('gateway')">进入工作台<ConsoleIcon name="arrow" :size="17" /></a><a class="text-link" :href="platformLink('gateway', 'checkin')"><ConsoleIcon name="checkin" :size="16" />全部平台签到</a><a class="text-link" :href="platformLink('gateway', 'guide')"><ConsoleIcon name="guide" :size="16" />API 接入</a></div></div><div class="gateway-diagram" aria-label="网关聚合的平台"><span>一个入口 · 三个平台</span><div v-for="p in (['workbuddy', 'trae', 'qoder'] as const)" :key="p"><span class="platform-dot" :class="p" />{{ names[p] }}<code>{{ session.ports[p] }}</code></div></div></section>
      <div class="home-section-heading"><h2>管理你的平台账号</h2><p>独立管理授权与额度，保留你熟悉的操作。</p></div>
      <section class="home-platforms" aria-label="平台工作空间"><article v-for="p in (['workbuddy', 'trae', 'qoder'] as const)" :key="p" class="home-platform"><span class="platform-symbol">{{ names[p].slice(0, 1) }}</span><header><h3>{{ names[p] }}</h3><code>:{{ session.ports[p] }}</code></header><p>{{ descriptions[p] }}</p><a :href="platformLink(p)">进入工作空间<ConsoleIcon name="arrow" :size="17" /></a><div class="home-platform-shortcuts"><a :href="platformLink(p, 'accounts')">账号管理</a><a :href="platformLink(p, 'checkin')">签到</a><a :href="platformLink(p, 'quota')">额度</a></div></article></section>
      <aside class="home-help"><ConsoleIcon name="guide" /><p>准备接入应用？复制网关地址，再到接入指南选择模型与获取请求示例。</p><button class="text-link" @click="copy(baseURL('gateway') + '/v1')">复制 Base URL<ConsoleIcon name="arrow" :size="15" /></button></aside>
    </main>
    <footer class="home-footer"><span>KleeAPI <span aria-hidden="true">·</span> 本地工作空间</span><span>{{ kleeTheme ? '愿四叶草带来好运 · 静音陪伴' : '账号独立管理 · 模型统一接入' }}</span></footer>
  </div>
</template>
