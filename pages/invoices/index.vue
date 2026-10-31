<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <div class="bg-gradient-to-r from-primary-main to-primary-dark dark:from-primary-dark dark:to-primary-dark/80 rounded-2xl p-6 text-white relative overflow-hidden">
        <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div class="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
        <div class="navi-page-header relative z-10">
          <div>
            <h1 class="text-2xl font-bold mb-1">{{ t('invoices.title') }}</h1>
            <p class="text-primary-light">{{ t('invoices.description') }}</p>
          </div>
          <button
            @click="openModal()"
            class="mt-4 md:mt-0 inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl backdrop-blur-sm transition-all duration-300 touch-manipulation"
          >
            <Plus class="h-5 w-5" />
            {{ t('invoices.newInvoice') }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="printError" role="alert" data-invoice-print-error class="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-900/10 dark:text-red-300">{{ printError }}</p>

    <!-- Stat Cards -->
    <div class="navi-summary-grid gap-6 mb-8">
      <StatCard
        :title="t('common.total')"
        :value="invoices.length.toString()"
        icon="FileText"
        color="blue"
      />
      <StatCard
        :title="t('invoices.statuses.paid')"
        :value="paidCount.toString()"
        icon="DollarSign"
        color="green"
      />
      <StatCard
        :title="t('invoices.statuses.overdue')"
        :value="overdueCount.toString()"
        icon="CreditCard"
        color="red"
      />
      <StatCard
        :title="t('invoices.statuses.draft')"
        :value="draftCount.toString()"
        icon="FileText"
        color="amber"
      />
    </div>

    <!-- Filters -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-4 mb-6">
      <div class="flex items-center gap-4">
        <Filter class="w-5 h-5 text-gray-400" />
        <select
          v-model="statusFilter"
          @change="loadInvoices"
          class="bg-transparent border border-gray-300 dark:border-white/10 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"
        >
          <option value="">{{ t('invoices.allStatus') }}</option>
          <option value="draft">{{ t('invoices.statuses.draft') }}</option>
          <option value="sent">{{ t('invoices.statuses.sent') }}</option>
          <option value="paid">{{ t('invoices.statuses.paid') }}</option>
          <option value="overdue">{{ t('invoices.statuses.overdue') }}</option>
          <option value="cancelled">{{ t('invoices.statuses.cancelled') }}</option>
        </select>
      </div>
    </div>

    <!-- Invoices Table -->
    <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm overflow-hidden">
      <div v-if="isLoading" class="p-12 text-center">
        <div class="flex items-center justify-center gap-2 text-gray-500">
          <Loader2 class="w-6 h-6 animate-spin text-primary-main" />
          <span>{{ t('common.loading') }}</span>
        </div>
      </div>
      <div v-else-if="invoices.length === 0" class="p-12 text-center">
        <FileText class="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
        <p class="text-gray-500 dark:text-gray-400">{{ t('invoices.noInvoices') }}</p>
        <button
          @click="openModal()"
          class="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation"
        >
          <Plus class="h-4 w-4" />
          {{ t('invoices.newInvoice') }}
        </button>
      </div>
      <div v-else class="navi-table-scroll" tabindex="0" role="region" :aria-label="t('invoices.title')">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
        <thead class="bg-gray-50 dark:bg-white/5">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('invoices.invoiceNumber') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('transactions.customer') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('invoices.issueDate') }}</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('invoices.dueDate') }}</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('common.amount') }}</th>
            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('common.status') }}</th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 dark:divide-white/10">
          <tr
            v-for="invoice in invoices"
            :key="invoice.id"
            class="hover:bg-gray-50 dark:hover:bg-white/[0.03] group transition-colors"
          >
            <td class="px-6 py-4">
              <div class="font-medium font-mono text-gray-900 dark:text-gray-100">{{ invoice.invoiceNumber }}</div>
              <NaviConsultButton class="mt-1.5" kind="invoice" :record-id="String(invoice.id)" :label="invoiceLabel(invoice)" :disabled="!navi.available.value" @consult="navi.consult({ id: String(invoice.id), label: invoiceLabel(invoice) })" />
            </td>
            <td class="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{{ invoice.to?.name }}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ formatDate(invoice.issueDate) }}</td>
            <td class="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{{ formatDate(invoice.dueDate) }}</td>
            <td class="px-6 py-4 text-right font-bold font-mono text-gray-900 dark:text-gray-100">{{ formatCurrency(invoice.total, invoice.currency) }}</td>
            <td class="px-6 py-4 text-center">
              <span :class="getStatusClass(invoice.status)" class="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-lg capitalize">
                {{ t(`invoices.statuses.${invoice.status}`) || invoice.status }}
              </span>
            </td>
            <td class="px-6 py-4 text-right">
              <div class="flex justify-end gap-1 transition-opacity duration-300">
                <button
                  @click="viewPdf(invoice.id)"
                  :data-invoice-print="invoice.id"
                  class="p-2 rounded-lg text-gray-400 hover:text-primary-main hover:bg-primary-main/10 transition-colors touch-manipulation"
                  title="印刷用プレビュー（ブラウザの印刷から PDF に保存できます。送信はしません）"
                >
                  <Eye class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-invoice-send
                  :disabled="!mail.canSend"
                  @click="openSend(invoice)"
                  class="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors touch-manipulation"
                  :title="mail.canSend ? t('invoices.mail.send') : t('invoices.mail.senderOnly')"
                >
                  <Mail class="h-4 w-4" />
                  <span class="sr-only">{{ t('invoices.mail.send') }}</span>
                </button>
                <button
                  @click="openModal(invoice)"
                  class="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-500/10 transition-colors touch-manipulation"
                  :title="t('common.edit')"
                >
                  <Pencil class="h-4 w-4" />
                </button>
                <button
                  @click="deleteInvoice(invoice.id)"
                  class="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation"
                  :title="t('common.delete')"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
              <p v-if="lastDelivery(invoice)" data-invoice-delivery class="mt-1 ml-auto max-w-xs text-left text-xs" :class="deliveryClass(lastDelivery(invoice))">
                {{ deliveryText(lastDelivery(invoice)) }}
                <button v-if="['failed', 'unknown'].includes(lastDelivery(invoice).state) && mail.canSend" type="button" data-invoice-resend @click="openSend(invoice)" class="ml-1 underline touch-manipulation">{{ t('invoices.mail.resend') }}</button>
              </p>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <!-- The invoice screen (plan G6): ① 発行者 ② 請求先 ③ 明細 ④ 確認, full screen below sm -->
    <div v-if="showModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-stretch sm:items-center justify-center min-h-screen sm:px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="showModal = false"></div>
        <div data-invoice-panel class="relative bg-white dark:bg-gray-900 sm:rounded-2xl sm:border border-gray-200 dark:border-white/10 shadow-2xl w-full sm:max-w-2xl min-h-screen sm:min-h-0 p-4 sm:p-6 sm:max-h-[90vh] overflow-y-auto">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {{ editingInvoice ? t('invoices.editInvoice') : t('invoices.newInvoice') }}
          </h3>

          <form data-invoice-form @submit.prevent="saveInvoice" class="space-y-6">
            <section data-invoice-step="issuer" data-invoice-issuer class="space-y-2">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ t('invoices.steps.issuer') }}</h4>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('invoices.issuerFromSettings') }}</p>
              <input id="invoice-from-name" v-model="form.from.name" type="text" :placeholder="t('invoices.companyName')" required class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input id="invoice-from-email" v-model="form.from.email" type="email" :placeholder="t('common.email')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                <input id="invoice-from-phone" v-model="form.from.phone" type="tel" :placeholder="t('invoices.phone')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              </div>
              <textarea id="invoice-from-address" v-model="form.from.address" rows="2" :placeholder="t('invoices.address')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"></textarea>
              <p class="text-sm text-gray-700 dark:text-gray-300">
                {{ t('invoices.registrationNumber') }}:
                <span v-if="companyRegistration" data-invoice-registration class="font-mono font-medium">{{ companyRegistration }}</span>
              </p>
              <p v-if="companyLoaded && !companyRegistration" data-invoice-registration-missing class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-300">
                {{ t('invoices.registrationNumberMissing') }}
                <NuxtLink to="/settings/organization" class="underline">{{ t('invoices.openCompanySettings') }}</NuxtLink>
              </p>
            </section>

            <section data-invoice-step="client" class="space-y-2">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ t('invoices.steps.client') }}</h4>
              <select id="invoice-customer" v-model="customerPick" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors">
                <option value="">{{ customers.length ? t('invoices.pickCustomer') : t('invoices.pickCustomerNone') }}</option>
                <option v-for="customer in customers" :key="String(customer._id)" :value="String(customer._id)">{{ customer.name }}{{ customer.company ? '（' + customer.company + '）' : '' }}</option>
              </select>
              <input id="invoice-to-name" v-model="form.to.name" type="text" :placeholder="t('invoices.customerName')" required class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              <input id="invoice-to-email" v-model="form.to.email" type="email" :placeholder="t('common.email')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
              <textarea id="invoice-to-address" v-model="form.to.address" rows="2" :placeholder="t('invoices.address')" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"></textarea>
            </section>

            <section data-invoice-step="items" class="space-y-2">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ t('invoices.steps.items') }}</h4>
              <div v-for="(item, idx) in form.items" :key="idx" data-invoice-item class="grid grid-cols-12 gap-2 items-center">
                <input v-model="item.description" data-item-description type="text" :placeholder="t('invoices.lineDescription')" class="col-span-12 sm:col-span-5 w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                <input v-model.number="item.quantity" data-item-quantity type="number" min="0" step="any" :aria-label="t('invoices.quantity')" class="col-span-3 sm:col-span-2 w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                <input v-model.number="item.unitPrice" data-item-unit-price type="number" step="any" :placeholder="t('invoices.price')" :aria-label="t('invoices.price')" class="col-span-4 sm:col-span-2 w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                <span data-item-amount class="col-span-4 sm:col-span-2 text-right text-sm font-mono text-gray-700 dark:text-gray-300">{{ formatAmount(lineAmount(item)) }}</span>
                <button type="button" @click="removeItem(idx)" :aria-label="t('invoices.removeLine')" class="col-span-1 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10 transition-colors touch-manipulation">
                  <X class="h-4 w-4" />
                </button>
              </div>
              <button type="button" @click="addItem" data-invoice-add-item class="text-sm text-primary-main hover:text-primary-dark font-medium touch-manipulation">+ {{ t('invoices.addItem') }}</button>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label for="invoice-tax-rate" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('invoices.taxRate') }}</label>
                  <select id="invoice-tax-rate" v-model.number="form.taxRate" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors">
                    <option v-for="rate in rateOptions" :key="rate" :value="rate">{{ rateLabel(rate) }}</option>
                  </select>
                </div>
                <div>
                  <label for="invoice-issue-date" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('invoices.issueDate') }}</label>
                  <input id="invoice-issue-date" v-model="form.issueDate" type="date" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                </div>
                <div>
                  <label for="invoice-due-date" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('invoices.dueDate') }}</label>
                  <input id="invoice-due-date" v-model="form.dueDate" type="date" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="invoice-status" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('common.status') }}</label>
                  <select id="invoice-status" v-model="form.status" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors">
                    <option value="draft">{{ t('invoices.statuses.draft') }}</option>
                    <option value="sent">{{ t('invoices.statuses.sent') }}</option>
                    <option value="paid">{{ t('invoices.statuses.paid') }}</option>
                    <option value="overdue">{{ t('invoices.statuses.overdue') }}</option>
                    <option value="cancelled">{{ t('invoices.statuses.cancelled') }}</option>
                  </select>
                </div>
                <div>
                  <label for="invoice-notes" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('invoices.notes') }}</label>
                  <textarea id="invoice-notes" v-model="form.notes" rows="2" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"></textarea>
                </div>
              </div>
            </section>

            <section data-invoice-step="review" class="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 p-3 space-y-1 text-sm">
              <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{{ t('invoices.steps.review') }}</h4>
              <div class="flex justify-between"><span>{{ t('invoices.subtotal') }}</span><span data-invoice-subtotal class="font-mono">{{ formatAmount(totals.subtotal) }}</span></div>
              <div class="flex justify-between"><span data-invoice-tax-label>{{ t('invoices.tax') }}（{{ form.taxRate }}%{{ reducedMark ? ' ' + reducedMark : '' }}）</span><span data-invoice-tax class="font-mono">{{ formatAmount(totals.taxAmount) }}</span></div>
              <div class="flex justify-between font-bold text-base"><span>{{ t('invoices.total') }}</span><span data-invoice-total class="font-mono">{{ formatAmount(totals.total) }}</span></div>
              <p v-if="!canSave" class="pt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('invoices.required') }}</p>
              <p v-if="saveError" data-invoice-save-error role="alert" class="pt-1 text-sm text-red-600 dark:text-red-400">{{ saveError }}</p>
            </section>

            <div class="sticky bottom-0 flex justify-end gap-3 bg-white dark:bg-gray-900 py-3">
              <button type="button" @click="showModal = false" class="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-white/[0.07] transition-colors touch-manipulation">{{ t('common.cancel') }}</button>
              <button type="submit" data-invoice-save :disabled="!canSave || saving" class="px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark hover:from-primary-dark hover:to-primary-main text-white rounded-xl shadow-lg shadow-primary-main/25 transition-all duration-300 touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed">
                {{ editingInvoice ? t('common.edit') : t('common.create') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Send by the company Gmail (plan C6): 送信中… until the delivery has ended -->
    <div v-if="sendTarget" data-invoice-send-dialog class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-stretch sm:items-center justify-center min-h-screen sm:px-4">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" @click="closeSend"></div>
        <div class="relative bg-white dark:bg-gray-900 sm:rounded-2xl sm:border border-gray-200 dark:border-white/10 shadow-2xl w-full sm:max-w-lg min-h-screen sm:min-h-0 p-4 sm:p-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">{{ t('invoices.mail.dialogTitle') }}</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">{{ sendTarget.invoiceNumber }}</p>
          <p v-if="!mail.connected" class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-300">{{ t('invoices.mail.notConnected') }} <NuxtLink to="/settings/organization" class="underline">{{ t('invoices.openCompanySettings') }}</NuxtLink></p>
          <p v-else-if="mail.state === 'reconnect_required'" class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-900/10 dark:text-amber-300">{{ t('invoices.mail.reconnect') }} <NuxtLink to="/settings/organization" class="underline">{{ t('invoices.openCompanySettings') }}</NuxtLink></p>
          <form @submit.prevent="submitSend" class="space-y-3">
            <p data-invoice-send-from class="text-xs text-gray-600 dark:text-gray-400 break-all">{{ t('invoices.mail.from') }}: {{ mail.address || '—' }}</p>
            <div>
              <label for="invoice-send-to" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('invoices.mail.to') }}</label>
              <input id="invoice-send-to" v-model="sendForm.to" type="email" required :disabled="sending" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
            </div>
            <div>
              <label for="invoice-send-subject" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('invoices.mail.subject') }}</label>
              <input id="invoice-send-subject" v-model="sendForm.subject" type="text" required :disabled="sending" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors" />
            </div>
            <div>
              <label for="invoice-send-message" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{{ t('invoices.mail.message') }}</label>
              <textarea id="invoice-send-message" v-model="sendForm.message" rows="6" :disabled="sending" class="w-full border border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-primary-main/50 focus:border-primary-main transition-colors"></textarea>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('invoices.mail.attachment') }}</p>
            <p v-if="sending" data-invoice-send-state class="text-sm font-medium text-blue-700 dark:text-blue-300">{{ t('invoices.mail.sending') }}</p>
            <p v-if="sendError" data-invoice-send-error role="alert" class="text-sm text-red-600 dark:text-red-400">{{ sendError }}</p>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" @click="closeSend" :disabled="sending" class="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-white/[0.07] disabled:opacity-50 transition-colors touch-manipulation">{{ t('common.cancel') }}</button>
              <button type="submit" data-invoice-send-submit :disabled="sending || !mail.connected || mail.state !== 'ok'" class="px-5 py-2.5 bg-gradient-to-r from-primary-main to-primary-dark text-white rounded-xl shadow-lg shadow-primary-main/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 touch-manipulation">{{ sending ? t('invoices.mail.sending') : t('invoices.mail.submit') }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  Plus, FileText, Pencil, Trash2, X, Eye, Filter, Loader2, Mail
} from 'lucide-vue-next'
import { invoiceTotals, isRegistrationNumber, invoiceReducedMark } from '~/shared/finance-invoice.mjs'
import { useUserStore } from '~/stores/user'
import { useAssistantStore } from '~/stores/assistant'
import { tokenClaims } from '~/utils/auth-session'
import NaviConsultButton from '~/components/finance/NaviConsultButton.vue'
import { useNaviRecordSelection } from '~/composables/useNaviRecordSelection'

const { t, locale } = useI18n()
const userStore = useUserStore()
const assistant = useAssistantStore()
const getAuthHeaders = () => userStore.authHeader
// Consulting Navi about one saved invoice (pointer only; the editor and its values are never published).
const navi = useNaviRecordSelection('invoices')
const invoiceLabel = (invoice: any) => String(invoice.invoiceNumber || '') + (invoice.to?.name ? '（' + invoice.to.name + '）' : '')

const isLoading = ref(false)
const showModal = ref(false)
const invoices = ref<any[]>([])
const editingInvoice = ref<any>(null)
const statusFilter = ref('')

// Computed stats
const paidCount = computed(() => invoices.value.filter(i => i.status === 'paid').length)
const overdueCount = computed(() => invoices.value.filter(i => i.status === 'overdue').length)
const draftCount = computed(() => invoices.value.filter(i => i.status === 'draft').length)

const form = reactive({
  issueDate: new Date().toISOString().split('T')[0],
  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  from: { name: '', email: '', phone: '', address: '' } as Record<string, any>,
  to: { name: '', email: '', address: '' } as Record<string, any>,
  items: [{ description: '', quantity: 1, unitPrice: 0 }] as any[],
  taxRate: 10,
  status: 'draft',
  notes: ''
})

// The company the session works in: its saved details fill ① 発行者, and its 登録番号 is what the server writes onto the invoice.
const company = ref<any>(null)
const companyLoaded = ref(false)
const customers = ref<any[]>([])
const customerPick = ref('')
const saving = ref(false)
const saveError = ref('')
const companyRegistration = computed(() => isRegistrationNumber(company.value?.taxId) ? company.value.taxId : '')
const addressText = (address: any) => typeof address === 'string' ? address : address ? [address.postalCode, address.state, address.city, address.line1, address.line2].filter(Boolean).join(' ') : ''
const loadCompany = async () => {
  companyLoaded.value = false
  const id = tokenClaims(userStore.token)?.organizationId
  try { company.value = id ? (await $fetch<any>(`/api/organizations/${encodeURIComponent(id)}`, { headers: getAuthHeaders() })).organization : null } catch { company.value = null } finally { companyLoaded.value = true }
}
const loadCustomers = async () => { try { customers.value = await $fetch<any[]>('/api/customers', { headers: getAuthHeaders() }) } catch { customers.value = [] } }
watch(customerPick, id => { const customer = customers.value.find(c => String(c._id) === id); if (customer) form.to = { name: customer.name || '', email: customer.email || '', address: addressText(customer.address) } })

const lineAmount = (item: any) => Number(item.quantity || 0) * Number(item.unitPrice || 0)
const savedItems = computed(() => form.items.filter(item => String(item.description || '').trim()))
const totals = computed(() => invoiceTotals(savedItems.value.map(item => ({ ...item, amount: lineAmount(item) })), Number(form.taxRate) || 0))
const reducedMark = computed(() => invoiceReducedMark({ issueDate: form.issueDate, taxRate: form.taxRate }))
const canSave = computed(() => !!String(form.from.name || '').trim() && !!String(form.to.name || '').trim() && savedItems.value.length > 0)
const rateOptions = computed(() => { const rates = [10, 8, 0]; return rates.includes(Number(form.taxRate)) ? rates : [...rates, Number(form.taxRate)] })
const rateLabel = (rate: number) => [10, 8, 0].includes(rate) ? t(`invoices.rates.${rate}`) : `${rate}%`
const formatAmount = (value: number) => formatCurrency(value, editingInvoice.value?.currency || 'JPY')

// Gmail sending (plan C6): who may send and the company connection, read fresh with every list load.
const mail = reactive({ canSend: false, configured: false, connected: false, state: 'not_connected', address: '' as string | null })
const loadMail = async () => {
  try { const status = await $fetch<any>('/api/company-mail/gmail', { headers: getAuthHeaders() }); Object.assign(mail, { canSend: !!status.canSend, configured: !!status.configured, connected: !!status.connected, state: status.state, address: status.address }) } catch { mail.canSend = false }
}
const lastDelivery = (invoice: any) => { const list = Array.isArray(invoice?.deliveries) ? invoice.deliveries : []; return list.find((d: any) => d.state === 'sending') || list[list.length - 1] || null }
const deliveryText = (delivery: any) => delivery.state === 'sending' ? t('invoices.mail.sending') : delivery.state === 'sent' ? (delivery.confirmedBy === 'sent_count' ? t('invoices.mail.sentCounted') : t('invoices.mail.sentAccepted')) : delivery.state === 'failed' ? t('invoices.mail.failed', { reason: delivery.error || '' }) : t('invoices.mail.unknown', { reason: delivery.error || '' })
const deliveryClass = (delivery: any) => ({ sending: 'text-blue-600 dark:text-blue-300', sent: 'text-green-700 dark:text-green-300', failed: 'text-red-600 dark:text-red-400', unknown: 'text-amber-700 dark:text-amber-300' } as Record<string, string>)[delivery.state] || ''
const sendTarget = ref<any>(null)
const sending = ref(false)
const sendError = ref('')
const sendForm = reactive({ to: '', subject: '', message: '' })
const openSend = (invoice: any) => {
  if (!mail.canSend) return
  navi.clear()
  const issuer = invoice.from?.name || '', client = invoice.to?.name || ''
  sendForm.to = invoice.to?.email || ''
  sendForm.subject = t('invoices.mail.subjectTemplate', { number: invoice.invoiceNumber, issuer })
  sendForm.message = t('invoices.mail.messageTemplate', { number: invoice.invoiceNumber, issuer, client })
  sendError.value = ''
  sendTarget.value = invoice
  loadMail()
}
const closeSend = () => { if (!sending.value) sendTarget.value = null }
// The reply comes when the delivery has ended. If the reply is lost, the dialog keeps 送信中… until the saved delivery has ended.
const waitForDelivery = async (id: string) => {
  for (let i = 0; i < 1200; i++) {
    try { const r = await $fetch<any>(`/api/invoices/${encodeURIComponent(id)}`, { headers: getAuthHeaders() }); if (!(r.invoice?.deliveries || []).some((d: any) => d.state === 'sending')) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
}
const submitSend = async () => {
  if (!sendTarget.value || sending.value) return
  const id = String(sendTarget.value.id), scope = tokenClaims(userStore.token)
  sending.value = true
  sendError.value = ''
  try {
    await $fetch(`/api/invoices/${encodeURIComponent(id)}/send`, { method: 'POST', headers: getAuthHeaders(), body: { to: sendForm.to, subject: sendForm.subject, message: sendForm.message } })
    sendTarget.value = null
  } catch (error: any) {
    if (error?.response?.status || error?.statusCode) sendError.value = error?.data?.message || error?.data?.statusMessage || t('common.error')
    else { await waitForDelivery(id); sendTarget.value = null }
  } finally {
    sending.value = false
    const current = tokenClaims(userStore.token)
    if (scope?.userId === current?.userId && scope?.organizationId === current?.organizationId) loadInvoices()
  }
}

let loadTicket = 0
const loadInvoices = async () => {
  const ticket = ++loadTicket, scope = tokenClaims(userStore.token), rows = navi.loading()
  isLoading.value = true
  loadMail()
  try {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    const data = await $fetch(`/api/invoices?${params.toString()}`, { headers: getAuthHeaders() })
    const current = tokenClaims(userStore.token)
    if (ticket === loadTicket && scope?.userId === current?.userId && scope?.organizationId === current?.organizationId) { invoices.value = data.invoices; navi.loaded(rows) }
  } catch (error) {
    console.error('Failed to load invoices:', error)
  } finally {
    if (ticket === loadTicket) isLoading.value = false
  }
}

const openModal = async (invoice?: any) => {
  navi.clear()
  saveError.value = ''
  customerPick.value = ''
  if (invoice) {
    editingInvoice.value = invoice
    form.issueDate = new Date(invoice.issueDate).toISOString().split('T')[0]
    form.dueDate = new Date(invoice.dueDate).toISOString().split('T')[0]
    form.from = { name: invoice.from?.name || '', email: invoice.from?.email || '', phone: invoice.from?.phone || '', address: invoice.from?.address || '' }
    form.to = { name: invoice.to?.name || '', email: invoice.to?.email || '', address: invoice.to?.address || '' }
    form.items = invoice.items.map((i: any) => ({ ...i }))
    form.taxRate = invoice.taxRate
    form.status = invoice.status
    form.notes = invoice.notes || ''
  } else {
    editingInvoice.value = null
    form.issueDate = new Date().toISOString().split('T')[0]
    form.dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    form.from = { name: '', email: '', phone: '', address: '' }
    form.to = { name: '', email: '', address: '' }
    form.items = [{ description: '', quantity: 1, unitPrice: 0 }]
    form.taxRate = 10
    form.status = 'draft'
    form.notes = ''
  }
  showModal.value = true
  const editing = editingInvoice.value
  await Promise.all([loadCompany(), loadCustomers()])
  // ① 発行者 starts from the company settings on a new invoice; an edited invoice keeps its saved issuer block.
  if (!editing && editingInvoice.value === null && company.value && !form.from.name) form.from = { name: company.value.name || '', email: company.value.email || '', phone: company.value.phone || '', address: addressText(company.value.address) }
}

const addItem = () => {
  form.items.push({ description: '', quantity: 1, unitPrice: 0 })
}

const removeItem = (idx: number) => {
  form.items.splice(idx, 1)
}

const saveInvoice = async () => {
  if (!canSave.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    const items = savedItems.value.map(item => ({ description: item.description, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), amount: lineAmount(item), ...(item.tax !== undefined ? { tax: item.tax } : {}) }))
    const body = { issueDate: form.issueDate, dueDate: form.dueDate, from: { ...form.from }, to: { ...form.to }, items, taxRate: Number(form.taxRate), status: form.status, notes: form.notes }
    if (editingInvoice.value) {
      await $fetch(`/api/invoices/${editingInvoice.value.id}`, {
        method: 'PUT',
        body,
        headers: getAuthHeaders()
      })
    } else {
      await $fetch('/api/invoices', {
        method: 'POST',
        body,
        headers: getAuthHeaders()
      })
    }
    showModal.value = false
    loadInvoices()
  } catch (error: any) {
    // A refused save shows the server's reason and keeps the screen.
    saveError.value = error?.data?.message || error?.data?.statusMessage || t('invoices.saveFailed')
  } finally {
    saving.value = false
  }
}

const deleteInvoice = async (id: string) => {
  if (!confirm(t('admin.confirmDelete'))) return
  try {
    await $fetch(`/api/invoices/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
    navi.deleted(id)
    loadInvoices()
  } catch (error) {
    console.error('Failed to delete:', error)
  }
}

// Print preview: an authenticated native request (bearer header, never a token in the URL) for the current actor and company; the
// escaped HTML opens from an owned blob URL that is revoked afterwards. A refused or stale request opens nothing.
const printError = ref('')
const viewPdf = async (id: string) => {
  printError.value = ''
  const scope = tokenClaims(userStore.token)
  const preview = window.open('', '_blank')
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(id)}/pdf`, { headers: { ...getAuthHeaders() }, cache: 'no-store' })
    const current = tokenClaims(userStore.token)
    if (!response.ok || scope?.userId !== current?.userId || scope?.organizationId !== current?.organizationId) throw new Error(String(response.status))
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/html' }))
    if (!preview || preview.closed) { URL.revokeObjectURL(url); printError.value = 'ポップアップがブロックされました。許可してからもう一度開いてください。'; return }
    preview.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch {
    if (preview && !preview.closed) preview.close()
    printError.value = 'この請求書の印刷用プレビューを開けませんでした。選択中の会社と所属を確認してください。'
  }
}

const formatCurrency = (value: number, currency?: string) => {
  const currencyLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  try {
    return new Intl.NumberFormat(currencyLocale, { style: 'currency', currency }).format(value)
  } catch {
    return `${value} ${currency || (locale.value === 'ko' ? '통화 미기록' : '通貨未記録')}`
  }
}

const formatDate = (date: string) => {
  const dateLocale = locale.value === 'ko' ? 'ko-KR' : 'ja-JP'
  return new Date(date).toLocaleDateString(dateLocale)
}

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    draft: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
    sent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    paid: 'bg-green-500/10 text-green-600 dark:text-green-400',
    overdue: 'bg-red-500/10 text-red-600 dark:text-red-400',
    cancelled: 'bg-gray-500/10 text-gray-500 dark:text-gray-500'
  }
  return classes[status] || 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
}

watch(() => assistant.companyInvoiceSavedSequence, () => {
  const saved = assistant.companyInvoiceSaved, current = tokenClaims(userStore.token)
  if (saved && current?.userId === saved.actorId && current?.organizationId === saved.organizationId) loadInvoices()
})
// Navi created or deleted an invoice of this same actor and company.
watch(() => assistant.companyResourceSequence, () => {
  const saved = assistant.companyResource, scope = tokenClaims(userStore.token)
  if (saved && saved.actorId === scope?.userId && saved.organizationId === scope?.organizationId && saved.kinds.includes('invoice') && saved.effect !== 'update') loadInvoices()
})
onBeforeUnmount(() => { loadTicket++ })
onMounted(() => loadInvoices())
</script>
