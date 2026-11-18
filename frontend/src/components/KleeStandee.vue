<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import figure from '../assets/klee/klee-splash.png'
import clover from '../assets/klee/clover.svg'

const phrases = ['蹦！今天的好运送给你。', '嘟嘟可说，还想再玩一次！', '嘿嘿，可莉接住你的开心啦！', '休息一下，再一起出发吧。', '四叶草，给你！不许不开心哦。']
const taps = ref(0)
const speaking = ref(false)
const collapsed = ref(false)
const playButton = ref<HTMLButtonElement>()
const restoreButton = ref<HTMLButtonElement>()
let bubbleTimer: ReturnType<typeof setTimeout> | undefined
try { collapsed.value = localStorage.getItem('klee.standee.collapsed') === 'true' } catch { /* 存储受限时仍可在本页收起。 */ }

function bounce() {
  taps.value++
  speaking.value = true
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => { speaking.value = false }, 2400)
}
async function setCollapsed(value: boolean) {
  collapsed.value = value
  speaking.value = false
  clearTimeout(bubbleTimer)
  try { localStorage.setItem('klee.standee.collapsed', String(value)) } catch { /* 只保存本地展示偏好。 */ }
  await nextTick()
  const target = value ? restoreButton.value : playButton.value
  target?.focus()
}
onBeforeUnmount(() => clearTimeout(bubbleTimer))
</script>

<template>
  <aside class="klee-standee" :class="{ 'is-collapsed': collapsed }" aria-label="可莉弹弹乐">
    <button v-if="collapsed" ref="restoreButton" class="standee-restore" type="button" aria-label="展开可莉立牌" @click="setCollapsed(false)">
      <img :src="clover" width="18" height="18" alt=""><span>可莉</span>
    </button>
    <template v-else>
      <Transition name="standee-pop">
        <p v-if="speaking" class="standee-bubble" role="status">{{ phrases[(taps - 1) % phrases.length] }}</p>
      </Transition>
      <button class="standee-close" type="button" aria-label="收起可莉立牌" @click="setCollapsed(true)">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
      </button>
      <button ref="playButton" class="standee-play" type="button" aria-label="戳戳可莉，弹一下" @click="bounce">
        <svg class="standee-spring" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 2h14L6 7l12 5-12 5 13 5H5" /></svg>
        <span :key="taps" class="standee-action" :class="{ 'is-bouncing': taps > 0 }" aria-hidden="true">
          <svg class="standee-figure" viewBox="42 16 582 894" width="146" height="224" focusable="false">
            <defs>
              <!-- 只裁切官方展示图的外围特效，保留人物原画与原始 PNG。 -->
              <path id="klee-official-cut" d="M62 96 Q94 81 113 97 L122 125 154 143 167 161 194 173 218 195 230 170 242 128 Q201 128 198 98 Q192 67 217 53 L239 44 Q206 70 218 99 L225 109 244 109 Q252 61 299 40 Q358 14 393 49 L409 68 421 96 440 100 Q458 74 442 39 Q484 60 481 110 Q484 159 450 182 L433 209 439 226 474 188 512 165 544 142 Q564 126 574 134 L569 142 Q595 140 606 153 L601 159 575 160 Q565 178 544 181 L531 210 516 221 499 243 484 262 453 280 442 299 420 311 420 334 430 373 Q471 375 468 430 Q494 435 517 433 Q506 473 472 473 L435 468 434 493 447 520 447 537 436 543 398 534 390 582 367 582 323 562 Q296 609 282 665 L283 674 308 680 322 706 334 727 Q370 752 373 815 Q373 842 357 845 Q339 845 335 824 L330 791 Q316 771 282 755 L249 738 216 713 Q192 765 198 811 L206 854 Q212 883 191 891 Q174 896 166 877 L149 820 140 774 140 746 124 735 117 712 113 692 Q115 671 135 683 L143 686 148 657 147 608 151 574 144 551 126 518 116 500 Q81 495 64 446 L96 431 119 414 130 389 163 370 192 345 205 328 219 280 206 267 202 254 182 241 157 215 141 201 134 179 119 170 109 153 104 138 82 123Z" />
              <clipPath id="klee-official-clip"><use href="#klee-official-cut" /></clipPath>
            </defs>
            <use href="#klee-official-cut" fill="#fffdfb" stroke="#fffdfb" stroke-width="9" stroke-linejoin="round" />
            <image :href="figure" x="-1225" y="-467.5" width="3072" height="1536" clip-path="url(#klee-official-clip)" />
          </svg>
          <i v-for="n in 5" v-show="taps > 0" :key="n" class="standee-spark"></i>
        </span>
        <span class="standee-base" aria-hidden="true"><img :src="clover" width="10" height="10" alt="">戳戳 · 蹦一下</span>
      </button>
    </template>
  </aside>
</template>

<style scoped>
.klee-standee { --standee-width: 150px; position: fixed; right: max(18px, env(safe-area-inset-right)); bottom: calc(16px + env(safe-area-inset-bottom)); width: var(--standee-width); height: 244px; z-index: 18; pointer-events: none; color: #a44961; }
.klee-standee button { pointer-events: auto; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.standee-play { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; color: inherit; user-select: none; border-radius: 32px; }
.klee-standee .standee-play:focus-visible, .klee-standee .standee-close:focus-visible, .klee-standee .standee-restore:focus-visible { outline: 2px dashed #b3546a; outline-offset: 4px; }
.standee-action { position: absolute; bottom: 17px; left: 0; width: 100%; height: 224px; display: flex; align-items: flex-end; justify-content: center; transform-origin: 50% 100%; pointer-events: none; }
.standee-figure { width: auto; height: 100%; max-width: 100%; display: block; object-fit: contain; filter: drop-shadow(2px 5px 4px #97465b26); }
.standee-play:hover .standee-figure { filter: drop-shadow(2px 5px 6px #b3546a40); }
.standee-base { position: absolute; bottom: 0; left: 12%; width: 76%; height: 25px; display: flex; align-items: center; justify-content: center; gap: 5px; border: 2px solid #fffdfb; border-radius: 50%; background: linear-gradient(#fff9ef, #f3d5d9); box-shadow: 0 3px 0 #dfa9b6, 0 7px 10px #b3546a1c; font-size: 10px; font-weight: 600; letter-spacing: .3px; }
.standee-spring { position: absolute; bottom: 15px; left: calc(50% - 10px); width: 20px; height: 24px; color: #c68b9b; }
.standee-close { position: absolute; right: -2px; top: 0; z-index: 2; width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 1px solid #edd4da; border-radius: 50%; color: #a9667b; background: #fffdfbe6; opacity: 0; transition: opacity 150ms; }
.klee-standee:hover .standee-close, .klee-standee:focus-within .standee-close { opacity: 1; }
.standee-close:hover { background: #fbe9ee; }
.standee-bubble { position: absolute; right: 5px; bottom: calc(100% + 12px); width: 180px; max-width: calc(100vw - 40px); box-sizing: border-box; margin: 0; padding: 12px 15px; border: 1px solid #e9bccb; border-radius: 17px 17px 5px 17px; background: #fffdfb; box-shadow: 0 4px 0 #f5e4e8, 0 9px 24px #b3546a12; color: #915269; font-size: 12px; line-height: 1.7; text-align: center; }
.standee-bubble::after { content: ''; position: absolute; bottom: -5px; right: 25px; width: 8px; height: 8px; border-right: 1px solid #e9bccb; border-bottom: 1px solid #e9bccb; background: #fffdfb; transform: rotate(45deg); }
.is-bouncing { animation: standee-bounce 900ms both; }
.standee-spark { --spark-x: -65px; --spark-y: -65px; --spark-turn: -35deg; position: absolute; left: calc(50% - 7px); bottom: 38%; width: 14px; height: 14px; background: url('../assets/klee/clover.svg') center / contain no-repeat; opacity: 0; animation: standee-spark 850ms 60ms both; }
.standee-spark:nth-of-type(2) { --spark-x: 65px; --spark-y: -72px; --spark-turn: 45deg; width: 11px; height: 11px; }
.standee-spark:nth-of-type(3) { --spark-x: -45px; --spark-y: -122px; --spark-turn: -80deg; width: 9px; height: 9px; }
.standee-spark:nth-of-type(4) { --spark-x: 34px; --spark-y: -135px; --spark-turn: 60deg; }
.standee-spark:nth-of-type(5) { --spark-x: 0px; --spark-y: -155px; --spark-turn: 100deg; width: 8px; height: 8px; }
.standee-pop-enter-active, .standee-pop-leave-active { transition: opacity 160ms, transform 160ms; }
.standee-pop-enter-from, .standee-pop-leave-to { opacity: 0; transform: translateY(5px) scale(.96); }
.is-collapsed { width: 64px; height: 38px; }
.standee-restore { display: flex; align-items: center; gap: 5px; min-height: 38px; padding: 7px 10px; border: 1px solid #e9bccb; border-radius: 20px; background: #fffdfb; color: #a44961; box-shadow: 0 3px 10px #b3546a12; font-size: 11px; }
.standee-restore:hover { background: #fcecf1; }
@keyframes standee-bounce {
  0%, 100% { transform: translateY(0) rotate(0) scale(1); }
  12% { transform: translateY(5px) rotate(-5deg) scale(1.07, .9); }
  32% { transform: translateY(-34px) rotate(8deg) scale(.96, 1.06); }
  50% { transform: translateY(0) rotate(-6deg) scale(1.06, .94); }
  68% { transform: translateY(-14px) rotate(4deg) scale(.98, 1.02); }
  84% { transform: translateY(0) rotate(-2deg) scale(1.02, .98); }
}
@keyframes standee-spark {
  0% { opacity: 0; transform: translate(0, 0) scale(.3); }
  20% { opacity: .9; }
  100% { opacity: 0; transform: translate(var(--spark-x), var(--spark-y)) rotate(var(--spark-turn)) scale(.7); }
}
@media (max-width: 600px) {
  .klee-standee:not(.is-collapsed) { --standee-width: 108px; height: 174px; right: max(12px, env(safe-area-inset-right)); bottom: calc(12px + env(safe-area-inset-bottom)); }
  .standee-action { height: 158px; bottom: 14px; }
  .standee-base { height: 21px; font-size: 8px; gap: 3px; }
  .standee-close { top: -4px; right: -3px; }
  .standee-bubble { width: 164px; bottom: calc(100% + 8px); }
}
@media (hover: none) { .standee-close { opacity: .85; } }
@media (prefers-reduced-motion: reduce) {
  .standee-action, .standee-spark { animation: none !important; }
  .standee-pop-enter-active, .standee-pop-leave-active, .standee-close { transition: none; }
}
:global(html[data-klee-motion=off] .standee-action), :global(html[data-klee-motion=off] .standee-spark) { animation: none !important; }
:global(html[data-klee-motion=off] .standee-bubble) { transition: none; }
</style>
