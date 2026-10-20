<template>
 <div class="mt-3 space-y-2 text-xs">
  <label :class="compact ? 'sr-only' : 'block text-gray-500'" for="assistant-company">相談する会社</label>
  <select id="assistant-company" data-assistant-company :value="organizationId" :disabled="switching" :title="compact ? '相談する会社。切り替えると画面を再読み込みします。' : undefined" class="assistant-input !py-2" @change="switchCompany(($event.target as HTMLSelectElement).value)">
   <option value="" disabled>会社を選択してください</option>
   <option v-for="org in user.organizations" :key="org.id" :value="String(org.id)">{{ org.name }}</option>
  </select>
  <p v-if="!compact" class="text-gray-500">この会社の取引・請求書・支払い予定を確認します。会社を切り替えると画面を再読み込みします。</p>
  <p v-if="!user.organizations.length" class="text-gray-500">設定で会社を作成するか、所属会社への招待を受けてください。</p>
  <p v-if="switching" role="status" class="text-primary-main">会社を切り替えています…</p>
  <p v-if="error" role="alert" class="text-red-600">{{ error }}</p>
 </div>
</template>
<script setup lang="ts">
import {useUserStore} from '~/stores/user'
import {tokenClaims} from '~/utils/auth-session'
const props=defineProps<{organizationId:string,compact?:boolean}>(),user=useUserStore(),switching=ref(false),error=ref('')
let disposed=false
async function switchCompany(organizationId:string){
 if(switching.value||!organizationId||organizationId===props.organizationId)return
 const session=user.sessionId,actor=tokenClaims(user.token)?.userId
 const current=()=>!disposed&&user.isAuthenticated&&user.sessionId===session&&tokenClaims(user.token)?.userId===actor
 switching.value=true;error.value=''
 try{
  const response:any=await $fetch('/api/auth/switch-organization',{method:'POST',headers:user.authHeader,body:{organizationId}})
  if(!current())return
  const claims=tokenClaims(response.tokens?.accessToken)
  if(claims?.userId!==actor||claims?.organizationId!==organizationId)throw Error('Invalid company session')
  const profile:any=await $fetch('/api/auth/me',{headers:{Authorization:'Bearer '+response.tokens.accessToken}})
  if(!current())return
  if(String(profile.user?.id||profile.user?._id)!==actor||String(profile.currentOrganization?.id)!==organizationId)throw Error('Invalid company profile')
  user.acceptSession({...profile,tokens:response.tokens},false)
  window.location.reload()
 }catch{if(current())error.value='会社を切り替えられませんでした。もう一度選択してください。'}finally{if(!disposed)switching.value=false}
}
onBeforeUnmount(()=>{disposed=true})
</script>
