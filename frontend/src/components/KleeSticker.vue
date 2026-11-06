<script setup lang="ts">
defineProps<{ kind: 'dodoco' | 'letter' | 'cookie' }>()
</script>

<template>
  <svg class="klee-sticker" viewBox="0 0 120 120" width="96" height="96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g stroke="#995264" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <g v-if="kind === 'dodoco'" class="sticker-dodoco">
        <ellipse cx="60" cy="104" rx="34" ry="6" fill="#edcbd2" stroke="none" opacity=".5" />
        <path d="M36 49C13 37 10 13 22 12c14-1 24 22 24 37M75 48c0-26 18-43 26-33 8 10-5 30-20 40" fill="#fff2de" />
        <path d="M34 40C23 33 17 21 22 20c7-1 15 11 18 20M83 40c4-14 11-22 14-19 3 6-2 13-11 23" fill="#eab9c0" stroke="none" />
        <path d="M27 72c-2-29 15-39 33-39s37 13 35 39c-1 22-17 32-36 32S28 94 27 72Z" fill="#fff7e8" />
        <path d="M39 92c-10-5-16 7-7 10l13-1m30-8c10-5 16 7 7 10l-12-1" fill="#fff7e8" />
        <g class="sticker-eyes" fill="#714148" stroke="none"><ellipse cx="46" cy="65" rx="3" ry="4" /><ellipse cx="76" cy="65" rx="3" ry="4" /></g>
        <ellipse cx="37" cy="75" rx="7" ry="4" fill="#f5b7c2" stroke="none" /><ellipse cx="85" cy="75" rx="7" ry="4" fill="#f5b7c2" stroke="none" />
        <path d="m57 72 4 3 4-3m-4 3v4m-6-1q6 8 12 0" />
        <path d="M59 91c-18-15-22-2-14 3l13 2m4-5c18-15 22-2 14 3l-13 2" fill="#c74e66" /><circle cx="60" cy="94" r="5" fill="#f7c778" />
      </g>
      <g v-else-if="kind === 'letter'" class="sticker-letter">
        <rect x="19" y="33" width="83" height="61" rx="9" transform="rotate(-8 60 60)" fill="#fff8ed" stroke="#fff" stroke-width="8" />
        <rect x="19" y="33" width="83" height="61" rx="9" transform="rotate(-8 60 60)" fill="#fff8ed" />
        <path d="m20 43 44 24 33-33M27 92l26-32m46 20L74 57" stroke="#d7a6ae" />
        <path d="M60 64C39 50 51 38 60 48c8-13 24-1 0 16Z" fill="#e57f99" stroke="#b84d6e" />
        <path d="m80 18 4 6 8-1-4 7 3 6-8-1-5 5 1-9-6-4 8-1Z" fill="#f7d49c" stroke="#d2a572" />
        <path d="m23 19 2 5 5 1-5 2-1 5-2-5-5-1 5-2Z" fill="#f4c1d0" stroke="none" />
      </g>
      <g v-else class="sticker-cookie">
        <path d="M60 14c10-9 18 1 24 7 13-1 19 6 19 18 11 9 9 20 1 29 4 14-5 22-18 24-7 14-18 15-29 7-14 5-25 0-28-13-15-5-18-16-12-28-8-12-2-24 10-28 1-15 14-23 25-17Z" fill="#e9b27f" stroke="#fff" stroke-width="9" />
        <path d="M60 14c10-9 18 1 24 7 13-1 19 6 19 18 11 9 9 20 1 29 4 14-5 22-18 24-7 14-18 15-29 7-14 5-25 0-28-13-15-5-18-16-12-28-8-12-2-24 10-28 1-15 14-23 25-17Z" fill="#f0c497" stroke="#c28e62" />
        <circle cx="60" cy="58" r="33" stroke="#cf9c70" stroke-dasharray="2 5" />
        <path d="M60 58C34 65 29 43 41 39c10-5 18 4 19 19Zm0 0c-7-26 15-31 19-19 5 10-4 18-19 19Zm0 0c26-7 31 15 19 19-10 5-18-4-19-19Zm0 0c7 26-15 31-19 19-5-10 4-18 19-19Z" fill="#fff2dc" stroke="none" />
        <path d="m89 17 4-8m4 13 8-3" stroke="#d7829b" />
      </g>
    </g>
  </svg>
</template>
