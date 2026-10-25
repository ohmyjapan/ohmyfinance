<template>
  <section class="card min-w-0 text-gray-800 dark:text-gray-100 space-y-5 p-4 md:p-6" data-bank-connections>
    <header class="flex flex-wrap justify-between gap-2"><h2 class="font-semibold">銀行口座の接続・自動取得</h2><button class="text-sm text-gray-500" @click="emit('close')">閉じる</button></header>
    <p class="text-sm leading-relaxed text-gray-500" data-bank-login-guidance>接続したPCのChromeで銀行サイトを開きます。取得手順を実装したログイン方式（楽天銀行とPayPay銀行の標準ログイン）は、指定した期間の入出金明細のCSVを自動で取得します。楽天銀行の標準ログインは、接続したPCのダウンローダーの設定画面にログインIDとパスワードを一度保存すると、取得のたびに自動でサインインし、ふだんは画面の裏で動きます（保存したログインは暗号化してそのPCにだけ置かれ、OMFには送られません）。銀行が追加の確認（認証コード・パスワード変更など）を求めたときや、保存していない・受け付けられなかったときは、同じChromeの画面が表示されるので本人が操作してください。それ以外の銀行・ログイン方式は「観察取得（準備）」として画面の手順を記録し、CSVが出力された場合のみ取り込みます。PayPay銀行の標準ログインは口座ごとに接続し、取得期間を保存します。接続したPCのダウンローダーの設定画面に口座ごとの店番号・口座番号・ログインパスワードを一度保存すると、取得のたびにそのPCのChromeで1回だけ自動でサインインし、普通預金取引明細照会で期間を選んでCSVを1回だけ出力し、最後にログアウトします。別の場所でログイン中のときや銀行が追加の確認を求めたときは、上書きせずに止めてお知らせします。テンプレートを選ばずに接続した口座は、最初に受信したCSVを列の割り当てが済むまで「要確認」として保存し、取引は取り込みません。同じ取引を含む明細をもう一度受信しても、取り込み済みの取引は重ねて登録されません。列の割り当て・符号・取得期間は予約時に固定され、あとで変えても過去の取得分は変わりません。池田泉州銀行のビジネスゲート（電子証明書ログイン）は、口座の支店名・種別・口座番号を接続に保存し、PCのダウンローダーにログインパスワードだけを保存すると、PCのChromeで銀行の電子証明書を選んで1回だけサインインし、その口座を選んで銀行で照会できる期間（前々月の1日から当日まで）のCSVを1回だけ出力してログアウトします。それより前の期間は銀行から取得できないため、お手元のCSVを「銀行のExcel・CSVを取込」で取り込んでください。手順が実装済みでも、実際の接続テストが成功するまでは確認済みではありません。</p>
    <p v-if="error" role="alert" class="break-words text-sm text-red-600 dark:text-red-300">{{ error }}</p>
    <div class="flex min-w-0 flex-wrap items-end gap-3 rounded-xl border border-dashed border-gray-200 p-3 dark:border-gray-700" data-bank-account-new>
      <label class="min-w-0 text-sm">新しい銀行口座の名前<input v-model="newAccount.name" data-bank-account-new-name type="text" maxlength="100" placeholder="楽天銀行 普通" :class="INPUT"></label>
      <label class="min-w-0 text-sm">通貨<input v-model="newAccount.currency" data-bank-account-new-currency type="text" maxlength="3" :class="INPUT"></label>
      <button class="btn btn-secondary" :disabled="busy || !newAccount.name.trim()" data-bank-account-create @click="createAccount">口座を追加</button>
    </div>
    <p v-if="!accounts.length" class="text-sm text-gray-500">銀行口座がありません。上で口座を追加するか、「銀行のExcel・CSVを取込」で追加してください。</p>
    <article v-for="a in accounts" :key="a.id" class="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700" :data-bank-connection="a.id">
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-2"><h3 class="min-w-0 break-words font-medium" data-bank-account-name>{{ a.name }}（{{ a.currency }}）</h3><button v-if="renaming !== a.id" class="text-sm text-primary-main dark:text-primary-light" :disabled="busy" data-bank-account-rename @click="startRename(a)">口座名を変更</button></div>
      <div v-if="renaming === a.id" class="min-w-0 space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700" data-bank-account-rename-form>
        <label class="block min-w-0 text-sm">口座名<input v-model="renameDraft" data-bank-account-name-input type="text" maxlength="100" :class="INPUT" @keydown.enter.prevent="saveRename(a)" @keydown.esc.prevent="cancelRename"></label>
        <p class="break-words text-xs leading-relaxed text-gray-500">口座名はOMFの画面に表示する名前です。変更しても、口座の接続・取得の記録・明細・仕訳はそのまま残ります。銀行の画面との一致確認に使う下の「口座の表示名（任意・一致確認用）」は別の項目で、変わりません。</p>
        <p v-if="renameError" role="alert" class="break-words text-sm text-red-600 dark:text-red-300" data-bank-account-rename-error>{{ renameError }}</p>
        <div class="flex flex-wrap gap-2"><button class="btn btn-primary" :disabled="busy || !renameDraft.trim()" data-bank-account-rename-save @click="saveRename(a)">保存</button><button class="btn btn-secondary" :disabled="busy" data-bank-account-rename-cancel @click="cancelRename">キャンセル</button></div>
      </div>
      <p class="break-words text-sm" data-bank-connection-state>{{ connectionText(a) }}</p>
      <div class="grid min-w-0 gap-3 md:grid-cols-3">
        <label class="min-w-0 text-sm">銀行<select v-model="forms[a.id].provider" data-bank-provider :class="INPUT"><option value="">選択してください</option><option v-for="[key,label,support] in BANK_PROVIDERS" :key="key" :value="key">{{ label }}（{{ providerSupportText(key, support) }}）</option></select></label>
        <label class="min-w-0 text-sm">テンプレート（列の割り当て）<select v-model="forms[a.id].templateId" data-bank-connection-template :class="INPUT"><option value="">{{ nativeOf(forms[a.id]) ? '自動（' + nativeOf(forms[a.id]).name + '）' : templateFreeOf(forms[a.id]) ? '未割り当て（初回の取得後に取込画面で割り当て）' : '選択してください' }}</option><option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label class="min-w-0 text-sm">口座の表示名（任意・一致確認用）<input v-model="forms[a.id].accountLabel" data-bank-account-label type="text" maxlength="100" placeholder="普通 1234567 ○○商事" :class="INPUT"></label>
        <label v-if="BANK_LOGIN_VARIANTS[forms[a.id].provider]" class="min-w-0 text-sm">ログイン方式<select v-model="forms[a.id].variant" data-bank-variant :class="INPUT"><option value="">選択してください</option><option v-for="[key,label] in BANK_LOGIN_VARIANTS[forms[a.id].provider]" :key="key" :value="key">{{ label }}</option></select></label>
        <label v-if="capabilityOf(forms[a.id]).period === 'required'" class="min-w-0 text-sm">取得期間の開始日<input v-model="forms[a.id].coverageFrom" data-bank-coverage-from type="date" :class="INPUT"></label>
        <label v-if="capabilityOf(forms[a.id]).period === 'required'" class="min-w-0 text-sm">取得期間の終了日（空欄は取得日の当日）<input v-model="forms[a.id].coverageTo" data-bank-coverage-to type="date" :class="INPUT"></label>
        <label v-if="identityOf(forms[a.id])" class="min-w-0 text-sm">口座の支店名（銀行の画面の表示どおり）<input v-model="forms[a.id].identityBranch" data-bank-identity-branch type="text" maxlength="40" placeholder="本店営業部" :class="INPUT"></label>
        <label v-if="identityOf(forms[a.id])" class="min-w-0 text-sm">口座の種別<select v-model="forms[a.id].identityType" data-bank-identity-type :class="INPUT"><option value="">選択してください</option><option v-for="t in BANK_ACCOUNT_TYPES" :key="t" :value="t">{{ t }}</option></select></label>
        <label v-if="identityOf(forms[a.id])" class="min-w-0 text-sm">口座番号（7桁）<input v-model="forms[a.id].identityNumber" data-bank-identity-number type="text" inputmode="numeric" maxlength="7" pattern="[0-9]{7}" :class="INPUT"></label>
      </div>
      <p v-if="identityOf(forms[a.id])" class="break-words text-xs leading-relaxed text-gray-500" data-bank-identity-note>銀行の画面の口座の一覧から、この支店名・種別・口座番号（7桁すべて）が一致する口座を1つだけ選んで明細を出力します。一致する口座が見つからないときや複数あるときは、口座を選ばずに止めてお知らせします（末尾の数桁や一覧の最初の口座では選びません）。</p>
      <p v-if="forms[a.id].provider" class="break-words text-xs leading-relaxed" :class="capabilityOf(forms[a.id]).mode === 'retrieve' ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500'" data-bank-capability>{{ capabilityText(forms[a.id]) }}</p>
      <p v-if="nativeOf(forms[a.id]) && !forms[a.id].templateId" class="break-words text-xs leading-relaxed text-gray-500" data-bank-native-template>テンプレートを選ばない場合は「{{ nativeOf(forms[a.id]).name }}」（{{ nativeOf(forms[a.id]).headers.join('・') }}、出金がマイナス、取引IDなし）を自動で作成して使います。CSVを先にアップロードする必要はありません。</p>
      <p v-if="templateFreeOf(forms[a.id]) && !forms[a.id].templateId" class="break-words text-xs leading-relaxed text-gray-500" data-bank-first-capture>テンプレートを選ばない場合は、列の割り当てなしで接続します。最初に受信したCSVは「要確認（列の割り当て待ち）」として原本を保存し、取引は取り込みません。「取込で割り当て」で列を割り当てて取り込み、そのテンプレートをここで選んで接続を保存すると、次回からの受信分はその割り当てで取り込まれます。CSVを先にアップロードする必要はありません。</p>
      <p v-if="BANK_SOFTWARE[forms[a.id].provider]" data-bank-software class="text-xs leading-relaxed text-gray-500">{{ BANK_SOFTWARE[forms[a.id].provider] }}</p>
      <p v-if="schedules[a.id]?.availability" class="break-words text-xs leading-relaxed" data-bank-availability>{{ availabilityText(schedules[a.id].availability) }}</p>
      <p v-if="schedules[a.id]?.availability?.gaps?.length" role="alert" class="break-words text-xs leading-relaxed text-amber-700 dark:text-amber-300" data-bank-archive-gaps>{{ gapsText(schedules[a.id].availability) }}</p>
      <label v-if="mapsTransactionId(forms[a.id].templateId)" class="flex items-start gap-2 text-sm"><input v-model="forms[a.id].transactionIdConfirmed" data-bank-id-confirm class="mt-1" type="checkbox">このテンプレートの取引ID列は銀行が発行した一意の取引IDです（摘要・メモではありません）。</label>
      <div class="flex flex-wrap gap-2"><button class="btn btn-secondary" :disabled="busy || !forms[a.id].provider || (!forms[a.id].templateId && !nativeOf(forms[a.id]) && !templateFreeOf(forms[a.id]))" data-bank-connect-save @click="saveConnection(a)">接続を保存</button><button class="btn btn-primary" :disabled="busy || !a.connection" data-bank-sync @click="sync(a)">{{ syncLabel(a) }}</button></div>
      <p v-if="messages[a.id]" class="text-sm text-green-700 dark:text-green-300" role="status" data-bank-sync-message>{{ messages[a.id] }}</p>
      <p v-if="a.connection" class="break-words text-xs" data-bank-test-state>{{ testStateText(a) }}</p>
      <div class="space-y-1"><p class="text-sm font-medium">取得を許可するPC</p><p class="text-xs text-gray-500" data-bank-pc-status>{{ pcStatusText(a) }}</p><p v-if="!collectors.length" class="text-xs text-gray-500">接続済みのPCがありません。カード連携の手順でPCを接続してください。</p><label v-for="c in collectors" :key="c._id" class="flex items-center gap-2 text-sm"><input type="checkbox" :data-bank-device="c._id" :checked="(c.bankAccountIds || []).map(String).includes(a.id)" :disabled="busy" @change="toggleDevice(c, a.id, $event)">{{ c.name }}</label></div>
      <div v-if="a.connection" class="min-w-0 space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700" data-bank-schedule>
        <p class="text-sm font-medium">毎日の自動取得</p>
        <p class="break-words text-xs" data-bank-schedule-saved>{{ scheduleSavedText(a) }}</p>
        <p class="break-words text-xs" :class="scheduleTone(a)" :role="scheduleAlert(a) ? 'alert' : 'status'" :data-bank-schedule-state="schedules[a.id]?.status?.state || ''" data-bank-schedule-status>{{ scheduleStatusText(a) }}</p>
        <p v-if="schedules[a.id]?.status?.lastFailure" role="alert" class="break-words text-xs text-amber-700 dark:text-amber-300" data-bank-schedule-last-failure>{{ lastFailureText(a) }}</p>
        <template v-if="scheduleForms[a.id] && (schedules[a.id]?.supported || schedules[a.id]?.schedule?.enabled)">
          <div class="flex min-w-0 flex-wrap items-end gap-3">
            <label class="flex items-center gap-2 text-sm"><input v-model="scheduleForms[a.id].enabled" data-bank-schedule-enabled type="checkbox" :disabled="busy">毎日自動で取得する</label>
            <label class="min-w-0 text-sm">取得する時刻（日本時間）<select v-model.number="scheduleForms[a.id].hour" data-bank-schedule-hour :class="INPUT" :disabled="busy"><option v-for="h in 24" :key="h" :value="h - 1">{{ h - 1 }}時以降</option></select></label>
            <button class="btn btn-secondary" :disabled="busy || (!scheduleDirty(a) && schedules[a.id]?.status?.state !== 'reconfirm')" data-bank-schedule-save @click="saveSchedule(a)">{{ schedules[a.id]?.status?.state === 'reconfirm' && !scheduleDirty(a) ? '現在の接続で自動取得を保存し直す' : '自動取得の設定を保存' }}</button>
          </div>
          <p v-if="scheduleDirty(a)" class="text-xs text-amber-700 dark:text-amber-300" data-bank-schedule-unsaved>未保存の変更があります（保存するまで反映されません）</p>
        </template>
        <p v-else-if="schedules[a.id]" class="break-words text-xs text-gray-500" data-bank-schedule-unsupported>{{ unsupportedText(supportReason(a)) }}「{{ syncLabel(a) }}」ボタンはこれまでどおり使えます。</p>
        <p v-if="scheduleErrors[a.id]" role="alert" class="break-words text-sm text-red-600 dark:text-red-300" data-bank-schedule-error>{{ scheduleErrors[a.id] }}</p>
        <p class="break-words text-xs leading-relaxed text-gray-500" data-bank-schedule-note>毎日、指定した時刻（日本時間）以降に1回だけ、接続したPCで「取得」と同じ手順で取得します。取得期間は接続に保存した期間です（終了日が空欄なら開始日から取得する日の当日まで）。PCが起動していなかった日の分は、次の1回にまとめて取得します。銀行が追加の確認を求めたときや、保存済みのログインが使えないときは、PCのChromeでお知らせして待ち、保存済みのログインを自動で再送信することはありません。失敗したときはここにお知らせし、翌日も1回だけ自動で取得します。手動の「取得」とCSVの取込はこれまでどおり使えます。</p>
      </div>
      <div class="space-y-1"><p class="text-sm font-medium">取得の記録</p><p v-if="!(jobs[a.id] || []).length" class="text-xs text-gray-500">まだ取得はありません。</p><template v-for="j in jobs[a.id] || []" :key="j.jobId"><p class="break-words text-xs" :data-bank-job="j.jobId">{{ j.trigger === 'schedule' ? '毎日の自動取得（' + (j.scheduledDay || '') + '）' : kindName(j.kind, j) }} · {{ stateName(j.state) }}<span v-if="jst(j.requestedAt)"> · {{ jst(j.requestedAt) }}（日本時間）</span><span v-if="j.snapshot?.coverage && !j.snapshot?.requestedCoverage"> · 取得期間（指定） {{ j.snapshot.coverage.from }}〜{{ j.snapshot.coverage.to }}</span><span v-if="j.snapshot?.requestedCoverage" data-bank-job-window> · {{ jobWindowText(j.snapshot) }}</span> · 取得時の設定 {{ (j.snapshotHash || '').slice(0, 8) }}<span v-if="j.lastMessage"> · {{ j.lastMessage }}</span><span v-if="j.hasObservation"> · 観察記録あり{{ eventChannelText(j.eventChannel) }} · <button class="text-primary-main dark:text-primary-light" data-bank-observation-open @click="toggleObservation(a.id, j.jobId)">{{ observations[a.id + ':' + j.jobId] ? '観察記録を閉じる' : '観察記録を見る' }}</button></span></p><pre v-if="observations[a.id + ':' + j.jobId]" data-bank-observation class="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200 p-2 text-xs dark:border-gray-700">{{ observationText(observations[a.id + ':' + j.jobId]) }}</pre></template></div>
      <div class="space-y-1"><p class="text-sm font-medium">受信した明細</p><p v-if="!(captures[a.id] || []).length" class="text-xs text-gray-500">まだありません。</p><div v-for="c in captures[a.id] || []" :key="c.id" class="flex flex-wrap items-center gap-2 text-xs" :data-bank-capture="c.id"><span class="min-w-0 flex-1 break-words">{{ c.name }} · {{ captureState(c.state) }} · 口座照合 {{ labelCheckText(c.labelChecked) }}<span v-if="c.dateRange" data-bank-capture-range> · 明細の日付 {{ c.dateRange.min }}〜{{ c.dateRange.max }}</span><span v-if="c.rows"> · 新規 {{ c.rows.new }} 既存 {{ c.rows.existing }} 差異 {{ c.rows.differs }}</span><span v-if="emptyCapture(c)" class="text-amber-700 dark:text-amber-300" data-bank-capture-empty> · 明細0件（期間内に取引がないのか取得できていないのかは未確認・要確認）</span><span v-if="mappingPending(c)" class="text-amber-700 dark:text-amber-300" data-bank-capture-mapping> · {{ c.dateRange ? '列の割り当て後に取込で割り当て済み（この受信の記録は要確認のまま残ります）' : '列の割り当て待ち（取引はまだ取り込まれていません。「取込で割り当て」から割り当ててください）' }}</span><span v-else-if="c.reason"> · {{ c.reason }}</span></span><button class="text-primary-main dark:text-primary-light" data-bank-capture-map @click="emit('map', c.id)">取込で割り当て</button></div></div>
    </article>
  </section>
</template>
<script setup lang="ts">
import { BANK_PROVIDERS, BANK_LOGIN_VARIANTS, BANK_SOFTWARE, BANK_NATIVE_TEMPLATES, BANK_VARIANT_COLLECTION, BANK_ACCOUNT_TYPES, bankCapability, bankFirstCapture, bankIdentityRequired, bankCoverageWindow, jstToday } from '~/shared/finance-payment-match.mjs'
import { useUserStore } from '~/stores/user'
const emit=defineEmits<{(e:'map',fileId:string):void;(e:'close'):void;(e:'changed'):void}>(),user=useUserStore(),api='/api/finance-payments/bank/'
const INPUT='input mt-1 w-full max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
const accounts=ref<any[]>([]),templates=ref<any[]>([]),collectors=ref<any[]>([]),jobs=reactive<Record<string,any[]>>({}),captures=reactive<Record<string,any[]>>({}),forms=reactive<Record<string,any>>({}),messages=reactive<Record<string,string>>({}),observations=reactive<Record<string,any[]>>({}),busy=ref(false),error=ref(''),newAccount=reactive({name:'',currency:'JPY'})
const providerOf=(key:string)=>BANK_PROVIDERS.find(p=>p[0]===key)
const variantLabel=(provider:string,variant:string)=>(BANK_LOGIN_VARIANTS[provider]||[]).find(([k])=>k===variant)?.[1]||variant
// Plan omf-rakuten-native-shiwake-20261020 §3: the capability of the chosen provider AND login variant (implemented retrieval steps
// vs the observe stage) is separate from the connection-test state, which only an actual retrieve job can show.
const capabilityOf=(f:any)=>bankCapability(f?.provider,f?.variant||null)
const nativeOf=(f:any)=>f?.variant?BANK_NATIVE_TEMPLATES[f.provider]?.[f.variant]||null:null
const supportText=(c:any)=>c.steps==='implemented'?'取得手順 実装済み':'取得手順 未確認'
const providerSupportText=(key:string,support:string)=>support==='verified'?'取得手順 確認済み':Object.keys(BANK_VARIANT_COLLECTION[key]||{}).length?(BANK_LOGIN_VARIANTS[key]||[]).filter(([v])=>BANK_VARIANT_COLLECTION[key][v]==='retrieve').map(([,label])=>label.replace(/（.*$/,'')).join('・')+'は取得手順 実装済み':'取得手順 未確認'
// Plan omf-paypay-four-accounts-20261021: the template-free first capture (shared BANK_FIRST_CAPTURE, PayPay銀行 標準 only) and its guided
// observe jobs. Imported by name from the declared shared module (no silent fallback).
const firstCaptureOf=(provider:any,variant:any)=>bankFirstCapture(provider,variant||null)
const templateFreeOf=(f:any)=>!!f?.variant&&firstCaptureOf(f.provider,f.variant)==='unmapped'
const guidedOf=(c:any)=>!!c?.provider&&firstCaptureOf(c.provider,c.variant??null)==='unmapped'
const mappingPending=(c:any)=>c?.state==='needs_review'&&/^mapping-required/.test(String(c?.reason||''))
const GUIDED_TEXT='取得手順 未確認（ガイド付き取得）: 自動取得はまだできません。取得のたびに、接続したPCのChromeで、ダウンローダーの設定画面に保存したこの口座のログイン（店番号・口座番号・ログインパスワード）で1回だけ自動でサインインします（未保存なら本人がサインイン）。銀行の追加の確認と入出金明細のCSVの出力は本人がその画面で行います。受信したCSVは原本を保存し、列の割り当てがない間は「要確認」として取引を取り込みません。'
// Plan omf-paypay-routine-20261022: PayPay銀行 標準 retrieves; its own plain description (楽天銀行's sentence below is unchanged).
const PAYPAY_ROUTINE_TEXT='取得手順 実装済み（自動取得）: PCのダウンローダーに保存した店番号・口座番号・ログインパスワードで、PCのChromeが1回だけ自動でサインインし、普通預金取引明細照会で指定した期間を選んでCSVを1回だけ出力し、最後にログアウトします（未保存なら本人がChromeでサインインします）。別の場所でログイン中のときや、銀行が追加の確認を求めたときは、上書きせずに止めてChromeの画面でお知らせします。銀行が一度に出力できる期間の上限は、まだ確認していません。実際の接続テストの結果は下の「接続テスト」に表示されます。'
// Plan omf-ikeda-collector-20261025: 池田泉州銀行 ビジネスゲート retrieves within the bank's window; its own plain description.
const IKEDA_PORTAL_TEXT='取得手順 実装済み（自動取得）: PCのダウンローダーに保存したログインパスワードで、PCのChromeが池田泉州銀行の電子証明書を選んで1回だけ自動でサインインし（証明書を1つに特定できないときは、そのChromeの画面で本人が選びます）、入出金明細で接続に保存した口座を選び、日付範囲をカレンダーで指定して検索し、表示された件数と同じ件数のCSVを1回だけ出力して取り込み、最後にログアウトします。銀行で照会できるのは前々月の1日から当日までのため、保存した取得期間のうちそれより前の分は取得しません（取り込み済みの明細と原本はそのまま残ります）。インターネットEBへの直接ログインは対象外です。実際の接続テストの結果は下の「接続テスト」に表示されます。'
const identityOf=(f:any)=>!!f?.provider&&bankIdentityRequired(f.provider,f.variant||null)
const availabilityText=(v:any)=>`銀行で照会できる期間: ${v.from}〜当日（前々月の1日から。それより前の明細は銀行から取得できません）${v.effective?` · 次の取得の期間: ${v.effective.from}〜${v.effective.to}`:''}${v.missing?` · 保存した取得期間のうち ${v.missing.from}〜${v.missing.to} は銀行で照会できないため取得しません`:''}`
const gapsText=(v:any)=>`要確認 — 自動取得で取り込みを確認できていない期間があります（銀行では照会できなくなりました）: ${v.gaps.map((g:any)=>g.from+'〜'+g.to).join('、')}。取り込み済みの明細と原本はそのまま残ります。お手元に明細のCSVがあれば「銀行のExcel・CSVを取込」で取り込んでください（取り込み後もこの表示は自動取得の記録に基づくため残ります）。`
const jobWindowText=(s:any)=>`取得期間（指定） ${s.requestedCoverage.from}〜${s.requestedCoverage.to||'当日'}${s.coverage?` · 銀行で照会できる期間で取得 ${s.coverage.from}〜${s.coverage.to}`:''}${s.missingCoverage?` · 照会できず取得しない期間 ${s.missingCoverage.from}〜${s.missingCoverage.to}`:''}`
const capabilityText=(f:any)=>{const c=capabilityOf(f);if(c.mode!=='retrieve'&&templateFreeOf(f))return GUIDED_TEXT;if(c.mode==='retrieve'&&f?.provider==='paypay')return PAYPAY_ROUTINE_TEXT;if(c.mode==='retrieve'&&f?.provider==='ikeda')return IKEDA_PORTAL_TEXT;return c.mode==='retrieve'?`${supportText(c)}（自動取得）: 指定した期間を銀行の画面に入力し、楽天銀行フォーマットのCSVを1回だけ出力します。サインインは、PCのダウンローダーの設定画面に保存したログインで自動（1回の取得で1回だけ送信）、未保存なら本人がChromeで行います。銀行の追加の確認は本人が行います。実際の接続テストの結果は下の「接続テスト」に表示されます。`:`${supportText(c)}: 観察取得（準備）になります${providerOf(f?.provider)&&BANK_LOGIN_VARIANTS[f.provider]&&!f.variant?'（ログイン方式を選ぶと取得手順を確認できます）':''}。`}
const connectionText=(a:any)=>{const c=a.connection;if(!c?.provider)return '未接続';const p=providerOf(c.provider);return `${p?.[1]||c.provider} · ${supportText(bankCapability(c.provider,c.variant??null))} · テンプレート ${c.templateId?templates.value.find(t=>t.id===c.templateId)?.name||c.templateId:'未割り当て（初回の取得後に割り当て）'}${c.accountLabel?' · '+c.accountLabel:''}${c.variant?' · '+variantLabel(c.provider,c.variant):''}${c.coverage?' · 取得期間 '+c.coverage.from+'〜'+(c.coverage.to||'当日'):''}${c.accountIdentity?' · 口座 '+c.accountIdentity.branch+' '+c.accountIdentity.type+' '+c.accountIdentity.number:bankIdentityRequired(c.provider,c.variant??null)?' · 口座（支店名・種別・口座番号）未保存':''}`}
const syncLabel=(a:any)=>bankCapability(a.connection?.provider,a.connection?.variant??null).mode==='retrieve'?'取得':guidedOf(a.connection)?'ガイド付き取得':'観察取得（準備）'
// The connection test is the latest retrieve job: success only when it completed and a capture of it was imported.
const testStateText=(a:any)=>{
 const retrieves=bankCapability(a.connection?.provider,a.connection?.variant??null).mode==='retrieve'
 if(!retrieves&&guidedOf(a.connection))return '接続テスト: 自動取得の手順が未確認のため対象外（ガイド付き取得のみ・自動取得は未実施）'
 if(!retrieves)return '接続テスト: 自動取得の手順が未確認のため対象外（観察取得のみ）'
 const job=(jobs[a.id]||[]).find((j:any)=>j.kind==='retrieve'&&j.state!=='superseded');if(!job)return '接続テスト: 未実施（「取得」を押すと実際の銀行で試します）'
 if(job.state==='complete'&&(job.captures||[]).some((c:any)=>c.state==='imported'))return `接続テスト: 成功（${jst(job.completedAt||job.requestedAt)?jst(job.completedAt||job.requestedAt)+'（日本時間） · ':''}明細を取り込みました）`
 if(job.state==='complete')return `接続テスト: 完了（取り込んだ明細なし・要確認）${job.lastMessage?' · '+job.lastMessage:''}`
 if(job.state==='failed')return `接続テスト: 失敗（${job.lastMessage||'理由不明'}）`
 return `接続テスト: ${stateName(job.state)}`
}
const pcStatusText=(a:any)=>{const n=collectors.value.filter((c:any)=>(c.bankAccountIds||[]).map(String).includes(a.id)).length;return n?`取得を許可したPC: ${n}台`:'この口座の取得を許可したPCがありません（下のチェックで許可してください）'}
const emptyCapture=(c:any)=>c.state==='imported'&&!!c.rows&&Number(c.rows.new||0)+Number(c.rows.existing||0)+Number(c.rows.unchanged||0)===0
const kindName=(k:string,j?:any)=>k==='retrieve'?'自動取得':j&&guidedOf(j.snapshot)?'ガイド付き取得':'観察取得'
const stateName=(s:string)=>({queued:'予約',running:'実行中',verification_required:'サインイン・確認待ち（PCのChromeを確認）',complete:'完了',failed:'失敗',superseded:'置き換え済み（未実行）'} as Record<string,string>)[s]||s
const captureState=(s:string)=>({received:'受信',imported:'取込済み',needs_review:'要確認'} as Record<string,string>)[s]||s
const labelCheckText=(checked:any)=>['未確認','確認済み'][Number(checked===true)]
const eventChannelText=(channel:any)=>({false:' · 操作の記録なし（画面の記録は保存済み）'} as Record<string,string>)[String(channel)]||''
const mapsTransactionId=(templateId:string)=>{const t=templates.value.find(t=>t.id===templateId);return !!t&&t.mapping?.transactionId!==undefined&&t.mapping.transactionId!==''}
// The read-only view of a stored observation (GET …/jobs/:jobId/observation): pathnames, titles, clicked controls, edited
// fields, inputs and downloads per recorded page — the server stores no typed value, so none can appear here.
const observationText=(pages:any[])=>(pages||[]).map((p:any,i:number)=>`${i+1}. ${p.pathname} · ${p.title}${eventChannelText(p.eventChannel)}${(p.clicks||[]).length?' · クリック: '+p.clicks.map((c:any)=>c.text||c.id||c.tag).join(', '):''}${(p.typedInto||[]).length?' · 入力: '+p.typedInto.map((t:any)=>t.id+'('+t.type+')').join(', '):''}${(p.inputs||[]).length?' · 項目: '+p.inputs.map((x:any)=>x.id+'('+x.type+')').join(', '):''}${(p.downloadEvents||[]).length?' · ダウンロード: '+p.downloadEvents.map((d:any)=>d.host+'/'+d.suggestedFilename).join(', '):''}${p.eventsDropped?' · 記録できなかった操作 '+p.eventsDropped:''}`).join('\n')
async function toggleObservation(accountId:string,jobId:string){const key=accountId+':'+jobId;if(observations[key]){delete observations[key];return}await run(async()=>{const r:any=await $fetch(api+'accounts/'+accountId+'/jobs/'+jobId+'/observation',{headers:user.authHeader});observations[key]=r.observation||[]})}
// Plan omf-workflow-daily-20261025 Phase B: the daily schedule of one account (GET/PUT …/schedule). The saved setting and the server's
// derived state are shown apart from the unsaved form; times are shown in JST. Saving sends the revision that was read (409 when another
// screen saved first: the saved state is reloaded, the form is kept). A failed latest run is shown on its own line (lastFailure); the
// schedule is not held by it.
const schedules=reactive<Record<string,any>>({}),scheduleForms=reactive<Record<string,any>>({}),scheduleErrors=reactive<Record<string,string>>({})
// Phase C (parent lead 8): every time on this screen (取得の記録 and the connection test included) is this one JST rendering, labelled
// 日本時間 where it is shown; an absent or unreadable stored time renders as nothing. Stored times are never changed.
const jst=(v:any)=>{const t=v?new Date(v).getTime():NaN;return Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(0,16).replace('T',' '):''}
const scheduleDirty=(a:any)=>{const f=scheduleForms[a.id],s=schedules[a.id]?.schedule;return !!f&&!!s&&(f.enabled!==s.enabled||f.hour!==s.hour)}
function setSchedule(id:string,r:any){const f=scheduleForms[id],s=schedules[id]?.schedule,dirty=!!f&&!!s&&(f.enabled!==s.enabled||f.hour!==s.hour);schedules[id]=r;if(!dirty)scheduleForms[id]={enabled:r.schedule.enabled,hour:r.schedule.hour}}
const UNSUPPORTED_TEXT:Record<string,string>={'no-connection':'接続が保存されていないため、毎日の自動取得はできません。','observe-only':'このログイン方式は自動取得の手順が未確認のため、毎日の自動取得の対象外です。','unmapped':'列の割り当て（テンプレート）がない接続は、毎日の自動取得の対象外です。最初の明細を割り当て、そのテンプレートで接続を保存すると対象になります。','no-coverage':'取得期間（開始日）が保存されていないため、毎日の自動取得の対象外です。','no-identity':'口座の支店名・種別・口座番号が保存されていないため、毎日の自動取得の対象外です。','bank-window':'保存した取得期間は銀行で照会できる期間より前のため、毎日の自動取得の対象外です。この期間の明細はCSVの取込で取り込んでください。','template-missing':'接続のテンプレートが見つからないため、毎日の自動取得の対象外です。接続を保存し直してください。'}
const unsupportedText=(reason:any)=>UNSUPPORTED_TEXT[String(reason)]||'この接続は毎日の自動取得の対象外です。'
const windowGone=(c:any)=>{try{const w=bankCoverageWindow(c.provider,c.variant??null,c.coverage,jstToday());return !!w&&!w.effective}catch{return false}}
const supportReason=(a:any)=>!a.connection?.provider?'no-connection':bankCapability(a.connection.provider,a.connection.variant??null).mode!=='retrieve'?'observe-only':!a.connection.templateId?'unmapped':!a.connection.coverage?'no-coverage':bankIdentityRequired(a.connection.provider,a.connection.variant??null)&&!a.connection.accountIdentity?'no-identity':windowGone(a.connection)?'bank-window':'template-missing'
const coverageText=(a:any)=>{const c=a.connection?.coverage;if(!c)return '';return c.to?`取得期間 ${c.from}〜${c.to}（終了日が指定されているため、毎日同じ期間を取得します）`:`取得期間 ${c.from}〜取得する日の当日`}
const scheduleSavedText=(a:any)=>{const s=schedules[a.id]?.schedule;if(!s)return '保存済みの設定: 読み込み中';return s.enabled?`保存済みの設定: 毎日 ${s.hour}時（日本時間）以降に1回、自動で取得${coverageText(a)?' · '+coverageText(a):''}`:'保存済みの設定: オフ（自動では取得しません）'}
const scheduleAlert=(a:any)=>['attention','reconfirm'].includes(schedules[a.id]?.status?.state)
const scheduleTone=(a:any)=>scheduleAlert(a)?'text-amber-700 dark:text-amber-300':['off','unsupported','waiting-pc'].includes(schedules[a.id]?.status?.state)?'text-gray-500':'text-gray-700 dark:text-gray-200'
const scheduleStatusText=(a:any)=>{const st=schedules[a.id]?.status;if(!st)return '';const j=st.job||{},by=j.trigger==='schedule'?'毎日の自動取得':'手動の取得'
 switch(st.state){
  case 'off':return '状態: 自動取得はオフです'
  case 'unsupported':return '状態: 対象外のため自動では取得していません — '+unsupportedText(st.reason)
  case 'reconfirm':return '状態: 要確認 — 保存したときから接続（銀行・ログイン方式・テンプレート・口座）が変わったため、自動取得を止めています。内容を確認して設定を保存し直すと再開します'
  case 'attention':return `状態: 要対応 — 銀行のサインイン・追加の確認待ちです。接続したPCのChromeで操作してください（${by} · ${jst(j.requestedAt)} 予約）`
  case 'running':return `状態: 取得中（${by} · ${jst(j.requestedAt)} 予約）`
  case 'interrupted':return `状態: 取得が途中で止まっています（${by} · ${jst(j.requestedAt)} 予約）。PCのダウンローダーが同じ取得を再開します。新しい取得は予約しません`
  case 'queued':return `状態: 予約済み・PCの受け取り待ち（${by} · ${jst(j.requestedAt)} 予約）。PCが起動していない間は、この予約のまま待ちます`
  case 'waiting-pc':return '状態: PC待ち — この口座の取得を許可した接続済みのPCがないため、予約できません'
  case 'done-today':return `状態: 本日分は${j.state==='complete'?'取得済み':j.state==='failed'?'実行済み（失敗）':'実行済み'}（${by} · ${jst(j.completedAt||j.requestedAt)}）。次回は ${jst(st.nextAt)}（日本時間）以降`
  case 'due':return `状態: 本日 ${st.hour}時（日本時間）を過ぎたため、まもなく予約されます`
  case 'waiting':return `状態: 次回は ${jst(st.nextAt)}（日本時間）以降に予約されます`
  default:return '状態: '+st.state}}
const lastFailureText=(a:any)=>{const f=schedules[a.id]?.status?.lastFailure;if(!f)return '';return `要対応 — 前回の取得は失敗しました（${f.trigger==='schedule'?'毎日の自動取得':'手動の取得'} · ${jst(f.completedAt||f.requestedAt)}）。理由は下の「取得の記録」に表示されます。銀行の確認が必要なときは接続したPCのChromeで操作し、ログインを保存し直した場合などは「${syncLabel(a)}」で取り直せます。毎日の自動取得は続けますが、確認できていない保存済みのログインは自動では送信しません`}
async function saveSchedule(a:any){const f=scheduleForms[a.id],s=schedules[a.id]?.schedule;if(!f||!s||busy.value)return;busy.value=true;scheduleErrors[a.id]=''
 try{const r:any=await $fetch(api+'accounts/'+a.id+'/schedule',{method:'PUT',headers:user.authHeader,body:{enabled:f.enabled,hour:f.hour,revision:s.revision}});schedules[a.id]=r;scheduleForms[a.id]={enabled:r.schedule.enabled,hour:r.schedule.hour};messages[a.id]=r.schedule.enabled?'自動取得の設定を保存しました。':'自動取得をオフにしました。'}
 catch(e:any){scheduleErrors[a.id]=e.data?.data?.message||e.data?.statusMessage||e.message;try{schedules[a.id]=await $fetch(api+'accounts/'+a.id+'/schedule',{headers:user.authHeader})}catch{}}
 finally{busy.value=false}}
async function run(fn:()=>Promise<void>){busy.value=true;error.value='';try{await fn()}catch(e:any){error.value=e.data?.data?.message||e.data?.statusMessage||e.message}finally{busy.value=false}}
async function loadJobs(id:string){const [j,c,s]:any[]=await Promise.all([$fetch(api+'accounts/'+id+'/jobs',{headers:user.authHeader}),$fetch(api+'accounts/'+id+'/captures',{headers:user.authHeader}),$fetch(api+'accounts/'+id+'/schedule',{headers:user.authHeader})]);jobs[id]=j.jobs;captures[id]=c.captures;setSchedule(id,s)}
// The per-account form state exists before the account renders (the template reads forms[a.id]); jobs and captures follow.
async function load(){const [a,t,c]:any[]=await Promise.all([$fetch(api+'accounts',{headers:user.authHeader}),$fetch(api+'templates',{headers:user.authHeader}),$fetch('/api/finance/collectors',{headers:user.authHeader})]);templates.value=t.templates;collectors.value=(c.collectors||[]).filter((x:any)=>!x.revokedAt)
 for(const acc of a.accounts)forms[acc.id]??={provider:acc.connection?.provider||'',templateId:acc.connection?.templateId||'',accountLabel:acc.connection?.accountLabel||'',transactionIdConfirmed:!!acc.connection?.transactionIdConfirmed,variant:acc.connection?.variant||'',coverageFrom:acc.connection?.coverage?.from||'',coverageTo:acc.connection?.coverage?.to||'',identityBranch:acc.connection?.accountIdentity?.branch||'',identityType:acc.connection?.accountIdentity?.type||'',identityNumber:acc.connection?.accountIdentity?.number||''}
 accounts.value=a.accounts;await Promise.all(a.accounts.map((acc:any)=>loadJobs(acc.id)))}
async function createAccount(){await run(async()=>{await $fetch(api+'accounts',{method:'POST',headers:user.authHeader,body:{name:newAccount.name.trim(),currency:(newAccount.currency||'JPY').trim().toUpperCase()}});newAccount.name='';await load();emit('changed')})}
// Plan omf-bank-account-names-20261024: the account name (BankAccount.name) is edited in place, one account at a time; the name only
// is sent. A refused name keeps the form open with the reason; cancel discards the draft.
const renaming=ref(''),renameDraft=ref(''),renameError=ref('')
function startRename(a:any){renaming.value=a.id;renameDraft.value=a.name;renameError.value=''}
function cancelRename(){renaming.value='';renameDraft.value='';renameError.value=''}
async function saveRename(a:any){if(busy.value||!renameDraft.value.trim())return;busy.value=true;renameError.value=''
 try{await $fetch(api+'accounts/'+a.id,{method:'PUT',headers:user.authHeader,body:{name:renameDraft.value.trim()}})}catch(e:any){renameError.value=e.data?.data?.message||e.data?.statusMessage||e.message;return}finally{busy.value=false}
 cancelRename();messages[a.id]='口座名を保存しました。';await run(async()=>{await load();emit('changed')})}
async function saveConnection(a:any){await run(async()=>{const f=forms[a.id],period=capabilityOf(f).period==='required'&&f.coverageFrom?{coverage:{from:f.coverageFrom,to:f.coverageTo||null}}:{},identity=identityOf(f)&&(f.identityBranch||f.identityType||f.identityNumber)?{accountIdentity:{branch:f.identityBranch,type:f.identityType,number:f.identityNumber}}:{};await $fetch(api+'accounts/'+a.id+'/connection',{method:'PUT',headers:user.authHeader,body:{provider:f.provider,templateId:f.templateId||undefined,accountLabel:f.accountLabel,transactionIdConfirmed:f.transactionIdConfirmed,variant:f.variant||null,...period,...identity}});messages[a.id]='接続を保存しました。';const saved=(await $fetch(api+'accounts',{headers:user.authHeader}) as any).accounts.find((x:any)=>x.id===a.id);if(saved?.connection)forms[a.id].templateId=saved.connection.templateId||'';await load();emit('changed')})}
async function sync(a:any){await run(async()=>{const r:any=await $fetch(api+'accounts/'+a.id+'/sync',{method:'POST',headers:user.authHeader,body:{}});messages[a.id]=r.message;await loadJobs(a.id);emit('changed')})}
async function toggleDevice(c:any,accountId:string,event:Event){const checked=(event.target as HTMLInputElement).checked;await run(async()=>{const ids=new Set<string>((c.bankAccountIds||[]).map(String));if(checked)ids.add(accountId);else ids.delete(accountId);await $fetch(api+'collectors/'+c._id,{method:'PUT',headers:user.authHeader,body:{bankAccountIds:[...ids]}});await load()})}
onMounted(()=>run(load))
</script>
