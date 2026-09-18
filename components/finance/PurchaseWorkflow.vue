<template>
 <div v-if="row" class="mt-4 border-t border-gray-100 pt-4 dark:border-white/10" data-purchase-workflow>
  <div class="mb-3 flex flex-wrap justify-between gap-2"><p class="text-xs font-medium text-gray-600 dark:text-gray-300">購入から輸出まで</p><NuxtLink :to="{path:'/purchase-workflow',query:{importId,line}}" class="text-xs text-primary-main underline">進捗と確認事項</NuxtLink></div>
  <WorkflowStages :steps="row.steps" />
 </div>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
import WorkflowStages from './WorkflowStages.vue'
const props=defineProps<{importId:string;line:number}>(),user=useUserStore(),row=ref<any>(null)
onMounted(async()=>{try{const r:any=await $fetch('/api/finance-workflow/status',{headers:user.authHeader,query:{importId:props.importId,line:props.line}});row.value=r.rows[0]||null}catch{row.value=null}})
</script>
