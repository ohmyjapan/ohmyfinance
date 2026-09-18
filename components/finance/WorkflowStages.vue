<template>
 <div class="grid grid-cols-2 gap-2 sm:grid-cols-4" data-workflow-stages>
  <div v-for="(stage,index) in stages" :key="stage.key" class="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
   <p class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ index + 1 }} · {{ stage.label }}</p>
   <p class="mt-2 text-sm font-semibold" :class="stageColor(stage.key)">{{ stageText(stage.key) }}</p>
   <p v-if="entries(stage.key).length > 1" class="mt-1 text-xs text-gray-500">{{ done(stage.key) }} / {{ entries(stage.key).length }}件</p>
  </div>
 </div>
</template>
<script setup lang="ts">
const props=defineProps<{steps:Record<string,any>}>()
const stages=[{key:'purchase',label:'購入記録'},{key:'inventory',label:'在庫'},{key:'shipment',label:'出荷'},{key:'documents',label:'輸出書類'}]
const entries=(stage:string)=>Object.values(props.steps||{}).filter((s:any)=>s.stage===stage)
const done=(stage:string)=>entries(stage).filter((s:any)=>['complete','not_applicable'].includes(s.state)).length
function stageText(stage:string){const items=entries(stage);if(!items.length)return '未処理';if(items.some((s:any)=>s.state==='manual_review'))return '要確認';if(items.some((s:any)=>s.state==='connection_required'))return '接続待ち';if(items.every((s:any)=>s.state==='not_applicable'))return '対象外';if(done(stage)===items.length)return '完了';if(done(stage))return '一部完了';return items.some((s:any)=>s.state==='waiting')?'資料待ち':'未処理'}
const stageColor=(stage:string)=>({'完了':'text-green-700 dark:text-green-400','要確認':'text-amber-700 dark:text-amber-400','接続待ち':'text-amber-700 dark:text-amber-400'}[stageText(stage)]||'text-gray-700 dark:text-gray-300')
</script>
