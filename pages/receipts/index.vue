<template>
  <div data-receipt-library>
    <header class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">{{ t('nav.receiptManagement') }}</h1>
        <p class="text-gray-600">{{ t('receipts.description') }}</p>
      </div>

      <div class="mt-4 md:mt-0 flex flex-wrap gap-3">
        <button type="button" data-library-refresh class="btn btn-secondary text-sm" :disabled="isLoading" @click="load"><RefreshCw class="mr-2 h-4 w-4" />{{ locale==='ko'?'새로고침':'再読み込み' }}</button>
        <button type="button" data-library-export :disabled="isLoading||!filteredReceipts.length" @click="exportCSV" class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main disabled:opacity-40">
          <FileText class="mr-2 h-4 w-4 text-gray-500" />
          {{ t('common.export') }} CSV
        </button>
        <button
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark touch-manipulation focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            @click="router.push('/receipts/upload')"
        >
          <Upload class="mr-2 h-4 w-4" />
          {{ t('receipts.upload') }}
        </button>
      </div>
    </header>

    <!-- Stats Cards -->
    <div data-library-stats class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
      <StatCard
          :title="t('receipts.title')"
          :value="stats?String(stats.total):'—'"
          icon="FileText"
          color="primary"
      />

      <StatCard
          :title="t('receipts.matched')"
          :value="stats?String(stats.matched):'—'"
          icon="Package"
          color="green"
      />

      <StatCard
          :title="t('receipts.unmatched')"
          :value="stats?String(stats.unmatched):'—'"
          icon="Activity"
          color="amber"
      />

      <StatCard
          :title="t('receipts.matchRate')"
          :value="stats?stats.matchRate+'%':'—'"
          icon="BarChart2"
          color="blue"
      />
    </div>
    <p class="mb-6 text-xs text-gray-500">{{ locale==='ko'?'선택한 회사 전체의 저장 건수':'選択中の会社全体の保存件数' }}<span v-if="stats&&(stats.processing||stats.error)"> · {{ statusText('processing') }} {{ stats.processing }} · {{ statusText('error') }} {{ stats.error }}</span></p>

    <!-- Filter & Search Bar -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm mb-6">
      <div class="p-4 flex flex-wrap items-center justify-between gap-4">
        <div class="flex min-w-0 flex-1 basis-64 flex-col gap-3">
          <div class="relative flex-1">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search class="h-5 w-5 text-gray-400" />
            </div>
            <input
                v-model="searchQuery"
                data-library-search
                type="text"
                class="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-white/10 rounded-xl leading-5 bg-white dark:bg-white/5 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm"
                :placeholder="t('receiptsList.searchPlaceholder')"
            />
          </div>

          <div class="flex flex-wrap gap-3">
            <div class="relative">
              <select
                  v-model="filters.status"
                  data-library-status
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-xl dark:bg-white/5 dark:border-white/10 dark:text-white"
              >
                <option value="">{{ t('receiptsList.allStatuses') }}</option>
                <option value="matched">{{ t('receipts.matched') }}</option>
                <option value="unmatched">{{ t('receipts.unmatched') }}</option>
                <option value="processing">{{ statusText('processing') }}</option>
                <option value="error">{{ statusText('error') }}</option>
              </select>
            </div>

            <div class="relative">
              <select
                  v-model="filters.type"
                  data-library-type
                  class="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-main focus:border-primary-main sm:text-sm rounded-xl dark:bg-white/5 dark:border-white/10 dark:text-white"
              >
                <option value="">{{ t('receiptsList.allTypes') }}</option>
                <option value="pdf">PDF</option>
                <option value="jpg">JPG/JPEG</option>
                <option value="png">PNG</option>
              </select>
            </div>
            <label><span class="sr-only">{{ locale==='ko'?'통화':'通貨' }}</span><select v-model="filters.currency" data-library-currency class="rounded-xl border-gray-300 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"><option value="">{{ locale==='ko'?'모든 통화':'すべての通貨' }}</option><option v-for="code in currencies" :key="code" :value="code">{{ code }}</option><option value="unknown">{{ unknownCurrency }}</option></select></label>
          </div>
        </div>

        <div class="flex items-center">
          <button
              data-library-filter-toggle
              class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-white/10 rounded-xl shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              @click="showAdvancedFilters = !showAdvancedFilters"
          >
            <Filter class="mr-2 h-4 w-4 text-gray-500" />
            {{ showAdvancedFilters ? t('transactionsList.hideFilters') : t('transactionsList.advancedFilters') }}
          </button>

          <button
              v-if="isFiltered"
              data-library-reset
              class="ml-3 text-sm text-primary-main hover:text-primary-main"
              @click="resetFilters"
          >
            {{ t('transactionsList.clearFilters') }}
          </button>
        </div>
      </div>

      <!-- Advanced Filters (conditional) -->
      <div v-if="showAdvancedFilters" class="px-4 py-3 border-t border-gray-200 bg-gray-50">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('receiptsList.uploadDateRange') }}</label>
            <div class="flex space-x-2">
              <input
                  v-model="filters.dateFrom"
                  data-library-date-from
                  type="date"
                  class="block min-w-0 w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
              <input
                  v-model="filters.dateTo"
                  data-library-date-to
                  type="date"
                  class="block min-w-0 w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('transactionsList.amountRange') }}</label>
            <div class="flex space-x-2">
              <input
                  v-model="filters.minAmount"
                  data-library-min
                  type="number"
                  min="0"
                  step="0.01"
                  :placeholder="t('transactionsList.min')"
                  class="block min-w-0 w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
              <input
                  v-model="filters.maxAmount"
                  data-library-max
                  type="number"
                  min="0"
                  step="0.01"
                  :placeholder="t('transactionsList.max')"
                  class="block min-w-0 w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('receipts.merchant') }}</label>
            <input
                v-model="filters.merchant"
                data-library-merchant
                type="text"
                :placeholder="t('receiptsList.merchantPlaceholder')"
                class="block min-w-0 w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
            />
          </div>
        </div>
      </div>
    </div>

    <p v-if="exportError" data-library-export-error role="alert" class="mb-4 text-sm text-red-600">{{ exportError }}</p>
    <!-- Receipts Table -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="flex justify-center items-center p-12">
        <Loader class="h-8 w-8 text-primary-main animate-spin" />
        <span class="ml-2 text-gray-600">{{ t('receiptsList.loading') }}</span>
      </div>

      <div v-else-if="error" data-library-error role="alert" class="p-6 text-sm text-gray-600"><p>{{ error }}</p><button type="button" data-library-retry class="mt-3 text-primary-main underline" @click="load">{{ locale==='ko'?'다시 시도':'再試行' }}</button></div>
      <div v-else-if="filteredReceipts.length === 0" data-library-empty class="text-center py-16">
        <FileText class="mx-auto h-12 w-12 text-gray-300" />
        <h3 class="mt-2 text-sm font-medium text-gray-900">{{ t('receiptsList.noReceipts') }}</h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ isFiltered ? t('receiptsList.adjustFilters') : t('receiptsList.getStarted') }}
        </p>
        <div class="mt-6">
          <button
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark touch-manipulation focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              @click="router.push('/receipts/upload')"
          >
            <Upload class="mr-2 h-4 w-4" />
            {{ t('receipts.upload') }}
          </button>
        </div>
      </div>

      <div v-else class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50 dark:bg-white/5">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('receiptTable.receipt') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('receiptTable.dateUploaded') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('common.amount') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('receipts.merchant') }}</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ t('common.status') }}</th>
        </tr>
        </thead>
        <tbody class="bg-white dark:bg-white/5 divide-y divide-gray-200 dark:divide-white/5">
        <tr
            v-for="receipt in paginatedReceipts"
            :key="receipt.id"
            data-library-row
            :data-library-id="receipt.id"
            class="hover:bg-gray-50 dark:hover:bg-white/[0.07]"
        >
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center">
              <div class="h-10 w-10 flex-shrink-0 bg-gray-100 rounded">
                <div class="h-10 w-10 flex items-center justify-center text-gray-500">
                  <FileIcon :filename="receipt.filename" />
                </div>
              </div>
              <div class="ml-4">
                <NuxtLink :to="'/receipts/'+receipt.id" data-library-receipt-link class="text-sm font-medium text-gray-900 hover:text-primary-main">{{ receipt.filename }}</NuxtLink>
                <div class="text-sm text-gray-500">{{ formatFileSize(receipt.size) }}</div>
                <NuxtLink :to="'/receipts/'+receipt.id" data-library-view class="mt-1 inline-block text-xs text-primary-main underline">{{ t('common.view') }} ↗</NuxtLink>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900">{{ formatDate(receipt.uploadDate) }}</div>
            <div class="text-sm text-gray-500">{{ formatTime(receipt.uploadDate) }}</div>
          </td>
          <td data-library-amount class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900" v-if="receipt.amount!==null">
              {{ formatCurrency(receipt.amount,receipt.currency) }}
            </div>
            <div class="text-sm text-gray-500" v-else>--</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="text-sm text-gray-900" v-if="receipt.merchant">
              {{ receipt.merchant }}
            </div>
            <div class="text-sm text-gray-500" v-else>--</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
              <span v-if="receipt.status === 'matched'"
                    class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                <CheckCircle size="14" class="mr-1" />
                {{ t('receipts.matched') }}
              </span>
            <span v-else
                  class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                <AlertTriangle size="14" class="mr-1" />
                {{ statusText(receipt.status) }}
              </span>
          </td>
        </tr>
        </tbody>
      </table></div>

      <!-- Pagination -->
      <div v-if="!isLoading&&!error&&filteredReceipts.length > 0" class="bg-white dark:bg-white/5 px-4 py-3 border-t border-gray-200 dark:border-white/10 sm:px-6">
        <div class="flex items-center justify-between">
          <div class="hidden sm:block">
            <p data-library-page-summary class="text-sm text-gray-700">
              {{ t('common.showing') }} <span class="font-medium">{{ paginationStart }}</span> {{ t('common.to') }} <span class="font-medium">{{ paginationEnd }}</span> {{ t('common.of') }} <span class="font-medium">{{ filteredReceipts.length }}</span> {{ t('receiptsList.receipts') }}
            </p>
          </div>
          <div class="flex-1 flex justify-center sm:justify-end">
            <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
              <button
                  @click="currentPage--"
                  data-library-previous
                  :disabled="currentPage === 1"
                  class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="sr-only">Previous</span>
                <ChevronLeft class="h-5 w-5" />
              </button>

              <span data-library-page class="sr-only">{{ currentPage }} / {{ totalPages }}</span>
              <template v-for="page in totalPages" :key="page">
                <button
                    v-if="totalPages <= 7 || page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)"
                    @click="currentPage = page"
                    :class="[
                    currentPage === page
                      ? 'z-10 bg-primary-main/10 border-primary-main text-primary-main'
                      : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50',
                    'relative inline-flex items-center px-4 py-2 border text-sm font-medium'
                  ]"
                >
                  {{ page }}
                </button>
                <span
                    v-else-if="(page === 2 && currentPage > 3) || (page === totalPages - 1 && currentPage < totalPages - 2)"
                    class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700"
                >
                  ...
                </span>
              </template>

              <button
                  @click="currentPage++"
                  data-library-next
                  :disabled="currentPage === totalPages"
                  class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span class="sr-only">Next</span>
                <ChevronRight class="h-5 w-5" />
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import {ref,computed,defineComponent,h} from 'vue'
import {FileText,Upload,Search,Filter,CheckCircle,AlertTriangle,ChevronLeft,ChevronRight,Loader,Image,RefreshCw} from 'lucide-vue-next'
import {useUserStore} from '~/stores/user'
import {tokenClaims} from '~/utils/auth-session'
import {currencyCode} from '~/shared/finance-navi-business.mjs'
type LibraryRow={id:string,filename:string,size:number,uploadDate:string|null,amount:number|null,currency:string|null,merchant:string,status:string}
type LibraryStats={total:number,matched:number,unmatched:number,processing:number,error:number,matchRate:number}
const {t,locale}=useI18n(),user=useUserStore(),router=useRouter()
const receipts=ref<LibraryRow[]>([]),stats=ref<LibraryStats|null>(null),isLoading=ref(false),error=ref(''),exportError=ref(''),searchQuery=ref(''),showAdvancedFilters=ref(false),currentPage=ref(1),itemsPerPage=ref(10)
const filters=ref({status:'',type:'',currency:'',dateFrom:'',dateTo:'',minAmount:'',maxAmount:'',merchant:''})
const unknownCurrency=computed(()=>locale.value==='ko'?'통화 미기록':'通貨未記録')
const statusText=(value:string)=>({matched:t('receipts.matched'),unmatched:t('receipts.unmatched'),processing:locale.value==='ko'?'처리 중':'読み取り中',error:locale.value==='ko'?'오류':'エラー'} as Record<string,string>)[value]||(locale.value==='ko'?'미기록':'未記録')
const scope=computed(()=>{const c=tokenClaims(user.token);return JSON.stringify([c?.userId||'',c?.organizationId||''])})
const currencies=computed(()=>[...new Set(receipts.value.map(r=>r.currency).filter((v):v is string=>!!v))].sort())
const literal=(value:unknown)=>String(value??'').normalize('NFKC').toLowerCase()
const day=(value:string|null)=>{const d=value?new Date(value):null;return d&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):''}
const filteredReceipts=computed(()=>receipts.value.filter(r=>{
 const f=filters.value,extension=r.filename.split('.').pop()?.toLowerCase(),dateKey=day(r.uploadDate)
 return (!searchQuery.value||[r.filename,r.merchant,r.amount].some(v=>literal(v).includes(literal(searchQuery.value))))&&(!f.status||r.status===f.status)&&(!f.type||extension===f.type||(f.type==='jpg'&&extension==='jpeg'))&&(!f.currency||(f.currency==='unknown'?!r.currency:r.currency===f.currency))&&(!f.dateFrom||dateKey>=f.dateFrom)&&(!f.dateTo||!!dateKey&&dateKey<=f.dateTo)&&(f.minAmount===''||r.amount!==null&&r.amount>=Number(f.minAmount))&&(f.maxAmount===''||r.amount!==null&&r.amount<=Number(f.maxAmount))&&(!f.merchant||literal(r.merchant).includes(literal(f.merchant)))
}))
const isFiltered=computed(()=>!!searchQuery.value||Object.values(filters.value).some(value=>value!==''&&value!==null)),totalPages=computed(()=>Math.max(1,Math.ceil(filteredReceipts.value.length/itemsPerPage.value)))
const paginatedReceipts=computed(()=>filteredReceipts.value.slice((currentPage.value-1)*itemsPerPage.value,currentPage.value*itemsPerPage.value)),paginationStart=computed(()=>(currentPage.value-1)*itemsPerPage.value+1),paginationEnd=computed(()=>Math.min(currentPage.value*itemsPerPage.value,filteredReceipts.value.length))
const formatCurrency=(value:number|null,currency:string|null)=>{if(value===null)return locale.value==='ko'?'미기록':'未記録';const code=currencyCode(currency);return code?new Intl.NumberFormat(locale.value==='ko'?'ko-KR':'ja-JP',{style:'currency',currency:code}).format(value):value.toLocaleString()+'（'+unknownCurrency.value+'）'}
const formatDate=(value:string|null)=>day(value)||'—'
const formatTime=(value:string|null)=>{const d=value?new Date(value):null;return d&&Number.isFinite(d.getTime())?d.toLocaleTimeString(locale.value==='ko'?'ko-KR':'ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}):''}
const formatFileSize=(value:number)=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KB':(value/1048576).toFixed(1)+' MB'
function resetFilters(){searchQuery.value='';filters.value={status:'',type:'',currency:'',dateFrom:'',dateTo:'',minAmount:'',maxAmount:'',merchant:''};currentPage.value=1}
let generation=0
async function load(){
 const current=++generation,key=scope.value;receipts.value=[];stats.value=null;error.value='';exportError.value='';isLoading.value=false;currentPage.value=1
 const claims=tokenClaims(user.token)
 if(!claims?.userId||!claims.organizationId){error.value=locale.value==='ko'?'회사를 선택하여 영수증을 확인해주세요.':'会社を選択して領収書を確認してください。';return}
 // Clear before rendering the new scope, then let token/session acceptance finish before session-aware fetch captures it.
 isLoading.value=true;await nextTick();if(current!==generation||key!==scope.value)return
 try{const result=await $fetch<{receipts:LibraryRow[],stats:LibraryStats}>('/api/receipts/library',{headers:user.authHeader});if(current===generation&&key===scope.value){receipts.value=result.receipts;stats.value=result.stats}}
 catch(e:any){if(current===generation&&key===scope.value)error.value=[401,403].includes(e.statusCode)?(locale.value==='ko'?'이 회사의 열람 권한을 확인할 수 없습니다.':'この会社の閲覧権限を確認できませんでした。'):(locale.value==='ko'?'영수증을 불러오지 못했습니다. 다시 시도해주세요.':'領収書を読み込めませんでした。もう一度お試しください。')}
 finally{if(current===generation)isLoading.value=false}
}
function exportCSV(){
 exportError.value=''
 try{
  const cell=(value:unknown)=>{let text=String(value??'');if(typeof value==='string'&&/^[=+@-]/.test(text.trimStart()))text="'"+text;return '"'+text.replaceAll('"','""')+'"'}
  const rows=[['領収書ID','ファイル名','アップロード日時','金額','通貨','店名','状態'],...filteredReceipts.value.map(r=>[r.id,r.filename,r.uploadDate,r.amount,r.currency,r.merchant,r.status])]
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='receipts_'+new Date().toISOString().slice(0,10)+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }catch{exportError.value=locale.value==='ko'?'CSV를 저장하지 못했습니다. 다시 시도해주세요.':'CSVを保存できませんでした。もう一度お試しください。'}
}
const FileIcon=defineComponent({props:{filename:{type:String,required:true}},setup:props=>()=>h(/\.(png|jpe?g)$/i.test(props.filename)?Image:FileText,{size:20})})
watch([searchQuery,filters],()=>{currentPage.value=1;exportError.value=''},{deep:true})
watch(totalPages,value=>{currentPage.value=Math.min(currentPage.value,value)})
watch(scope,()=>{resetFilters();void load()},{immediate:true,flush:'sync'})
onBeforeUnmount(()=>{generation++})
</script>
