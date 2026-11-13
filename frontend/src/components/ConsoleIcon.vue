<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  accounts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  pool: 'M4 4h6v6H4z M14 4h6v6h-6z M9 16h6v6H9z M7 10v3h10v-3 M12 13v3',
  models: 'm12 3 9 5-9 5-9-5 9-5 M3 12l9 5 9-5 M3 16l9 5 9-5',
  checkin: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M8 16l3 3 5-6',
  quota: 'M3 20h18 M6 16V9 M12 16V4 M18 16v-5',
  usage: 'M4 19h16 M4 14l5-5 4 3 7-8 M16 4h4v4',
  'auto-models': 'M4 5h5v5H4z M15 14h5v5h-5z M6.5 10v7h8.5 M9 7.5h8.5V14 M14 5l3.5 2.5L14 10',
  guide: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  collapse: 'M4 3h16v18H4z M9 3v18 M16 9l-3 3 3 3',
  expand: 'M4 3h16v18H4z M9 3v18 M13 9l3 3-3 3',
  add: 'M12 5v14 M5 12h14',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 7a9 9 0 1 0 1 7 M20 3v5h-5',
  key: 'M14 7a5 5 0 1 1-2 4l-8 8H1v-3l8-8 M17 7h.01',
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.overview" /></svg></template>
