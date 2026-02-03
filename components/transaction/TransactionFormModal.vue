<!-- components/transaction/TransactionFormModal.vue -->
<template>
  <Teleport to="body">
    <Transition name="slide-panel">
      <div v-if="modelValue" class="fixed inset-0 z-50 overflow-hidden">
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/50 transition-opacity"
          @click="close"
        />

        <!-- Panel -->
        <div class="absolute inset-y-0 right-0 w-full sm:w-3/4 lg:w-1/2 flex flex-col bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700">

              <!-- Header -->
              <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <div class="px-6 py-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <div class="p-2 rounded-lg" :class="form.type === '入金' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'">
                        <TrendingUp v-if="form.type === '入金'" class="w-5 h-5 text-green-600 dark:text-green-400" />
                        <TrendingDown v-else class="w-5 h-5 text-red-600 dark:text-red-400" />
                      </div>
                      <div>
                        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                          {{ isEditing ? t('transactionForm.editTitle') : t('transactionForm.createTitle') }}
                        </h2>
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                          {{ form.type === '入金' ? t('transactions.income') : t('transactions.expense') }}
                        </p>
                      </div>
                    </div>
                    <button
                      @click="close"
                      class="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <X class="w-5 h-5" />
                    </button>
                  </div>

                  <!-- Quick Type Toggle -->
                  <div class="mt-4 flex gap-2">
                    <button
                      type="button"
                      @click="form.type = '支出'"
                      :class="[
                        'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
                        form.type === '支出'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-2 ring-red-500'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      ]"
                    >
                      <TrendingDown class="w-4 h-4 inline mr-2" />
                      {{ t('transactions.expense') }}
                    </button>
                    <button
                      type="button"
                      @click="form.type = '入金'"
                      :class="[
                        'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all',
                        form.type === '入金'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 ring-2 ring-green-500'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      ]"
                    >
                      <TrendingUp class="w-4 h-4 inline mr-2" />
                      {{ t('transactions.income') }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Form Content -->
              <div class="flex-1 overflow-y-auto">
                <form @submit.prevent="submitForm" class="p-6 space-y-6 pb-32">

                  <!-- Essential Info Section -->
                  <section class="space-y-4">
                    <div class="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                      <Info class="w-4 h-4" />
                      {{ t('transactionForm.essentialInfo') }}
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                      <!-- Date -->
                      <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          {{ t('transactionForm.date') }}
                        </label>
                        <CustomDatePicker
                          v-model="form.date"
                          :placeholder="t('transactionForm.date')"
                        />
                      </div>

                      <!-- Amount -->
                      <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          <Coins class="w-4 h-4 inline mr-1" />
                          {{ t('transactionForm.amount') }}
                        </label>
                        <div class="relative">
                          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">¥</span>
                          <input
                            type="text"
                            v-model="form.amount"
                            required
                            @input="formatAmount"
                            placeholder="10,000"
                            class="w-full h-11 pl-8 pr-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent transition-shadow text-right font-medium"
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  <!-- Categories Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.categories = !sections.categories"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <FolderOpen class="w-4 h-4" />
                        {{ t('transactionForm.categoriesSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.categories ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.categories" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                          <!-- Account Category -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.accountCategory') }}
                            </label>
                            <select
                              v-model="form.accountCategoryId"
                              @change="handleAccountCategoryChange"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option v-for="cat in accountCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                            </select>
                          </div>

                          <!-- Sub Account Category -->
                          <div class="relative">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.subAccountCategory') }}
                            </label>
                            <input
                              type="text"
                              v-model="subAccountSearch"
                              @focus="showSubAccountSuggestions = true"
                              @blur="onSubAccountBlur"
                              :placeholder="t('transactionForm.searchSubAccount')"
                              :disabled="!form.accountCategoryId"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent disabled:opacity-50"
                            />
                            <!-- Dropdown -->
                            <div v-show="showSubAccountSuggestions && form.accountCategoryId" class="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              <!-- Create new option -->
                              <button
                                v-if="canCreateNewSubAccount"
                                type="button"
                                @mousedown="openSubAccountModal()"
                                class="w-full px-4 py-2 text-left hover:bg-primary-light dark:hover:bg-primary-dark/30 text-primary-main dark:text-primary-light flex items-center gap-2 border-b border-gray-200 dark:border-gray-700"
                              >
                                <Plus class="w-4 h-4" />
                                <span>{{ t('common.createNew') }}: <strong>{{ subAccountSearch }}</strong></span>
                              </button>
                              <!-- Existing sub-accounts -->
                              <button
                                v-for="cat in filteredSubAccountSuggestions"
                                :key="cat.id"
                                type="button"
                                @mousedown="selectSubAccount(cat)"
                                class="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                              >
                                {{ cat.name }}
                              </button>
                              <div v-if="filteredSubAccountSuggestions.length === 0 && !canCreateNewSubAccount" class="px-4 py-2 text-gray-500 text-sm">
                                {{ t('common.noResults') }}
                              </div>
                            </div>
                            <!-- Selected sub-account display -->
                            <div v-if="selectedSubAccount && !showSubAccountSuggestions" class="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-center justify-between">
                              <div class="flex items-center gap-2">
                                <FolderOpen class="w-4 h-4 text-gray-400" />
                                <span class="text-sm text-gray-700 dark:text-gray-300">{{ selectedSubAccount.name }}</span>
                              </div>
                              <button type="button" @click="openSubAccountModal(selectedSubAccount)" class="text-gray-400 hover:text-primary-main">
                                <Edit3 class="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                          <!-- Tax Category -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.taxCategory') }}
                            </label>
                            <select
                              v-model="form.taxCategoryId"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option v-for="cat in taxCategories" :key="cat._id || cat.id" :value="cat._id || cat.id">{{ cat.name }}</option>
                            </select>
                          </div>

                          <!-- Tax Rate -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.taxRate') }}
                            </label>
                            <select
                              v-model="form.taxRate"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option value="10%">10%</option>
                              <option value="8%">8%</option>
                              <option value="0%">0%</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </Transition>
                  </section>

                  <!-- Parties Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.parties = !sections.parties"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <Users class="w-4 h-4" />
                        {{ t('transactionForm.partiesSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.parties ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.parties" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                          <!-- Customer (顧客) -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.customer') }}
                            </label>
                            <div class="relative">
                              <input
                                type="text"
                                v-model="customerSearch"
                                @focus="showCustomerSuggestions = true"
                                @blur="onCustomerBlur"
                                :placeholder="t('transactionForm.searchCustomer')"
                                class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                              />
                              <div
                                v-if="showCustomerSuggestions && (filteredCustomers.length > 0 || canCreateNewCustomer)"
                                class="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-auto"
                              >
                                <!-- Create new option -->
                                <button
                                  v-if="canCreateNewCustomer"
                                  type="button"
                                  @mousedown="openCustomerModal()"
                                  class="w-full px-4 py-2 text-left hover:bg-primary-light dark:hover:bg-primary-dark/30 text-primary-main dark:text-primary-light flex items-center gap-2 border-b border-gray-200 dark:border-gray-700"
                                >
                                  <Plus class="w-4 h-4" />
                                  <span>{{ t('common.createNew') }}: <strong>{{ customerSearch }}</strong></span>
                                </button>
                                <!-- Existing customers -->
                                <button
                                  v-for="cust in filteredCustomers"
                                  :key="cust.id"
                                  type="button"
                                  @mousedown="selectCustomer(cust)"
                                  class="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                                >
                                  <div class="font-medium text-gray-900 dark:text-gray-100">{{ cust.name }}</div>
                                  <div v-if="cust.invoiceNumber" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    {{ t('customer.invoiceNumber') }}: {{ cust.invoiceNumber }}
                                  </div>
                                </button>
                              </div>
                            </div>
                            <!-- Selected customer card -->
                            <div v-if="selectedCustomer" class="mt-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                              <div class="flex items-start justify-between">
                                <div>
                                  <div class="font-medium text-gray-900 dark:text-gray-100">{{ selectedCustomer.name }}</div>
                                  <div v-if="selectedCustomer.invoiceNumber" class="text-xs text-primary-main mt-1">
                                    T{{ selectedCustomer.invoiceNumber.replace('T', '') }}
                                  </div>
                                  <div v-if="selectedCustomer.email" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {{ selectedCustomer.email }}
                                  </div>
                                </div>
                                <button type="button" @click="openCustomerModal(selectedCustomer)" class="text-gray-400 hover:text-primary-main">
                                  <Edit3 class="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>

                          <!-- Supplier (仕入れ先) -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.supplier') }}
                            </label>
                            <div class="relative">
                              <input
                                type="text"
                                v-model="supplierSearch"
                                @focus="showSupplierSuggestions = true"
                                @blur="onSupplierBlur"
                                :placeholder="t('transactionForm.searchSupplier')"
                                class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                              />
                              <div
                                v-if="showSupplierSuggestions && (filteredSuppliers.length > 0 || canCreateNewSupplier)"
                                class="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-auto"
                              >
                                <!-- Create new option -->
                                <button
                                  v-if="canCreateNewSupplier"
                                  type="button"
                                  @mousedown="openSupplierModal()"
                                  class="w-full px-4 py-2 text-left hover:bg-primary-light dark:hover:bg-primary-dark/30 text-primary-main dark:text-primary-light flex items-center gap-2 border-b border-gray-200 dark:border-gray-700"
                                >
                                  <Plus class="w-4 h-4" />
                                  <span>{{ t('common.createNew') }}: <strong>{{ supplierSearch }}</strong></span>
                                </button>
                                <!-- Existing suppliers -->
                                <button
                                  v-for="supplier in filteredSuppliers"
                                  :key="supplier.id"
                                  type="button"
                                  @mousedown="selectSupplier(supplier)"
                                  class="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                                >
                                  <div class="font-medium text-gray-900 dark:text-gray-100">{{ supplier.name }}</div>
                                  <div v-if="supplier.companyName || supplier.serviceName" class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    {{ supplier.companyName }}{{ supplier.companyName && supplier.serviceName ? ' / ' : '' }}{{ supplier.serviceName }}
                                  </div>
                                </button>
                              </div>
                            </div>
                            <!-- Selected supplier card -->
                            <div v-if="selectedSupplier" class="mt-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                              <div class="flex items-start justify-between">
                                <div>
                                  <div class="font-medium text-gray-900 dark:text-gray-100">{{ selectedSupplier.name }}</div>
                                  <div v-if="selectedSupplier.companyName" class="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                    {{ selectedSupplier.companyName }}
                                  </div>
                                  <div v-if="selectedSupplier.invoiceNumber" class="text-xs text-primary-main mt-1">
                                    T{{ selectedSupplier.invoiceNumber.replace('T', '') }}
                                  </div>
                                  <div v-if="selectedSupplier.website" class="text-xs text-blue-500 mt-1">
                                    {{ selectedSupplier.website }}
                                  </div>
                                </div>
                                <button type="button" @click="openSupplierModal(selectedSupplier)" class="text-gray-400 hover:text-primary-main">
                                  <Edit3 class="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Transition>
                  </section>

                  <!-- Details Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.details = !sections.details"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <FileText class="w-4 h-4" />
                        {{ t('transactionForm.detailsSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.details ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.details" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                          <!-- Receipt Number -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.receiptNumber') }}
                            </label>
                            <input
                              type="text"
                              v-model="form.receiptNumber"
                              :placeholder="t('transactionForm.receiptNumberPlaceholder')"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            />
                          </div>

                          <!-- Invoice Number -->
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.invoiceNumber') }}
                            </label>
                            <input
                              type="text"
                              v-model="form.invoiceNumber"
                              placeholder="INV-12345"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            />
                          </div>
                        </div>

                        <!-- Tracking Number -->
                        <div>
                          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {{ t('transactionForm.trackingNumber') }}
                          </label>
                          <input
                            type="text"
                            v-model="form.trackingNumber"
                            :placeholder="t('transactionForm.trackingNumberPlaceholder')"
                            class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                          />
                        </div>

                        <!-- Payment Method -->
                        <div class="grid grid-cols-2 gap-4">
                          <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.paymentMethod') }}
                            </label>
                            <select
                              v-model="form.paymentMethod"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            >
                              <option value="">{{ t('common.select') }}</option>
                              <option value="現金">{{ t('transactionForm.paymentMethods.cash') }}</option>
                              <option value="クレジットカード">{{ t('transactionForm.paymentMethods.creditCard') }}</option>
                              <option value="銀行振込">{{ t('transactionForm.paymentMethods.bankTransfer') }}</option>
                              <option value="電子マネー">{{ t('transactionForm.paymentMethods.electronicMoney') }}</option>
                              <option value="その他">{{ t('transactionForm.paymentMethods.other') }}</option>
                            </select>
                          </div>

                          <!-- Card Number (shown when credit card selected) -->
                          <div v-if="form.paymentMethod === 'クレジットカード'">
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              {{ t('transactionForm.cardNumber') }}
                            </label>
                            <input
                              type="text"
                              v-model="form.cardNumber"
                              :placeholder="t('transactionForm.cardNumberPlaceholder')"
                              maxlength="4"
                              class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                            />
                          </div>
                        </div>

                        <!-- Product Name -->
                        <div>
                          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {{ t('transactionForm.productName') }}
                          </label>
                          <input
                            type="text"
                            v-model="form.productName"
                            :placeholder="t('transactionForm.productNamePlaceholder')"
                            class="w-full h-11 px-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                          />
                        </div>

                        <!-- Notes -->
                        <div>
                          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {{ t('transactionForm.notes') }}
                          </label>
                          <textarea
                            v-model="form.notes"
                            rows="3"
                            :placeholder="t('transactionForm.notesPlaceholder')"
                            class="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent resize-none"
                          />
                        </div>
                      </div>
                    </Transition>
                  </section>

                  <!-- Receipt Upload Section -->
                  <section class="space-y-4">
                    <button
                      type="button"
                      @click="sections.receipt = !sections.receipt"
                      class="w-full flex items-center justify-between text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <div class="flex items-center gap-2">
                        <Receipt class="w-4 h-4" />
                        {{ t('transactionForm.receiptSection') }}
                      </div>
                      <ChevronDown :class="['w-4 h-4 transition-transform', sections.receipt ? 'rotate-180' : '']" />
                    </button>

                    <Transition name="collapse">
                      <div v-show="sections.receipt">
                        <div
                          class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:border-primary-main dark:hover:border-primary-main transition-colors cursor-pointer"
                          @click="triggerFileUpload"
                          @dragover.prevent="isDragging = true"
                          @dragleave="isDragging = false"
                          @drop.prevent="handleDrop"
                          :class="{ 'border-primary-main bg-primary-light dark:bg-primary-dark/20': isDragging }"
                        >
                          <input
                            ref="fileInput"
                            type="file"
                            accept="image/*,.pdf"
                            class="hidden"
                            @change="handleFileUpload"
                          />
                          <Upload class="w-10 h-10 mx-auto text-gray-400 dark:text-gray-500 mb-2" />
                          <p class="text-sm text-gray-600 dark:text-gray-400">
                            {{ t('transactionForm.dropOrClick') }}
                          </p>
                          <p class="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            PNG, JPG, PDF ({{ t('transactionForm.maxSize') }})
                          </p>
                        </div>

                        <div v-if="form.receiptFile" class="mt-3 flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                          <CheckCircle class="w-5 h-5 text-green-600 dark:text-green-400" />
                          <span class="text-sm text-green-700 dark:text-green-300 flex-1 truncate">{{ form.receiptFile.name }}</span>
                          <button type="button" @click="form.receiptFile = null" class="text-gray-400 hover:text-red-500">
                            <X class="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </Transition>
                  </section>

                </form>
              </div>

          <!-- Floating Actions -->
          <div class="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-6 py-4">
            <div class="flex items-center justify-between">
              <div class="text-sm text-gray-500 dark:text-gray-400">
                <span v-if="form.amount" class="font-medium text-gray-900 dark:text-white">
                  ¥{{ form.amount }}
                </span>
              </div>
              <div class="flex gap-3">
                <button
                  type="button"
                  @click="close"
                  class="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  type="button"
                  @click="submitForm"
                  :disabled="isSubmitting || !form.amount || !form.date"
                  class="px-5 py-2.5 text-sm font-medium text-white bg-primary-main rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Loader v-if="isSubmitting" class="w-4 h-4 animate-spin" />
                  <Save v-else class="w-4 h-4" />
                  {{ isEditing ? t('common.update') : t('common.save') }}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </Transition>

    <!-- Customer Modal -->
    <Transition name="modal">
      <div v-if="showCustomerModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="showCustomerModal = false"></div>
        <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
          <!-- Modal Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ editingCustomer ? t('customer.edit') : t('customer.create') }}
            </h3>
            <button @click="showCustomerModal = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Modal Body -->
          <div class="p-6 space-y-4">
            <!-- Name -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('customer.name') }} <span class="text-red-500">*</span>
              </label>
              <input
                v-model="customerForm.name"
                type="text"
                required
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>

            <!-- T Invoice Number -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('customer.invoiceNumber') }}
                <span class="text-xs text-gray-500 ml-1">(T + 13桁)</span>
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">T</span>
                <input
                  v-model="customerForm.invoiceNumber"
                  type="text"
                  maxlength="14"
                  placeholder="1234567890123"
                  class="w-full h-11 pl-8 pr-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent font-mono"
                />
              </div>
            </div>

            <!-- Company -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('customer.company') }}
              </label>
              <input
                v-model="customerForm.company"
                type="text"
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>

            <!-- Email & Phone -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {{ t('common.email') }}
                </label>
                <input
                  v-model="customerForm.email"
                  type="email"
                  class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {{ t('common.phone') }}
                </label>
                <input
                  v-model="customerForm.phone"
                  type="tel"
                  class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
                />
              </div>
            </div>

            <!-- Foreign Company Checkbox -->
            <div class="flex items-center gap-3 pt-2">
              <input
                id="isForeign"
                v-model="customerForm.isForeign"
                type="checkbox"
                class="w-4 h-4 text-primary-main bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-primary-main"
              />
              <label for="isForeign" class="text-sm text-gray-700 dark:text-gray-300">
                {{ t('customer.isForeign') }}
              </label>
            </div>
          </div>

          <!-- Modal Footer -->
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl">
            <button
              @click="showCustomerModal = false"
              class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="saveCustomer"
              :disabled="!customerForm.name.trim()"
              class="px-4 py-2 text-sm font-medium text-white bg-primary-main hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Supplier Modal -->
    <Transition name="modal">
      <div v-if="showSupplierModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="showSupplierModal = false"></div>
        <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
          <!-- Modal Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ editingSupplier ? t('supplier.edit') : t('supplier.create') }}
            </h3>
            <button @click="showSupplierModal = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Modal Body -->
          <div class="p-6 space-y-4">
            <!-- Name -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('supplier.name') }} <span class="text-red-500">*</span>
              </label>
              <input
                v-model="supplierForm.name"
                type="text"
                required
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>

            <!-- Company Name -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('supplier.companyName') }}
              </label>
              <input
                v-model="supplierForm.companyName"
                type="text"
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>

            <!-- Service Name -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('supplier.serviceName') }}
              </label>
              <input
                v-model="supplierForm.serviceName"
                type="text"
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>

            <!-- T Invoice Number -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('supplier.invoiceNumber') }}
                <span class="text-xs text-gray-500 ml-1">(T + 13桁)</span>
              </label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">T</span>
                <input
                  v-model="supplierForm.invoiceNumber"
                  type="text"
                  maxlength="14"
                  placeholder="1234567890123"
                  class="w-full h-11 pl-8 pr-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent font-mono"
                />
              </div>
            </div>

            <!-- Website -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('supplier.website') }}
              </label>
              <input
                v-model="supplierForm.website"
                type="url"
                placeholder="https://"
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>
          </div>

          <!-- Modal Footer -->
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl">
            <button
              @click="showSupplierModal = false"
              class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="saveSupplier"
              :disabled="!supplierForm.name.trim()"
              class="px-4 py-2 text-sm font-medium text-white bg-primary-main hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Sub-Account Category Modal -->
    <Transition name="modal">
      <div v-if="showSubAccountModal" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="showSubAccountModal = false"></div>
        <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
          <!-- Modal Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ editingSubAccount ? t('subAccount.edit') : t('subAccount.create') }}
            </h3>
            <button @click="showSubAccountModal = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Modal Body -->
          <div class="p-6 space-y-4">
            <!-- Name -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('subAccount.name') }} <span class="text-red-500">*</span>
              </label>
              <input
                v-model="subAccountForm.name"
                type="text"
                required
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>

            <!-- Code -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('subAccount.code') }}
              </label>
              <input
                v-model="subAccountForm.code"
                type="text"
                placeholder="001"
                class="w-full h-11 px-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent"
              />
            </div>

            <!-- Description -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ t('subAccount.description') }}
              </label>
              <textarea
                v-model="subAccountForm.description"
                rows="2"
                class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-primary-main focus:border-transparent resize-none"
              />
            </div>
          </div>

          <!-- Modal Footer -->
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-xl">
            <button
              @click="showSubAccountModal = false"
              class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="saveSubAccount"
              :disabled="!subAccountForm.name.trim()"
              class="px-4 py-2 text-sm font-medium text-white bg-primary-main hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  X, TrendingUp, TrendingDown, Coins, FolderOpen, Users, FileText,
  Receipt, Upload, ChevronDown, Info, Save, Loader, CheckCircle, Plus, Edit3
} from 'lucide-vue-next'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const userStore = useUserStore()

// Check dark mode from document class
const isDark = computed(() => {
  if (process.client) {
    return document.documentElement.classList.contains('dark')
  }
  return false
})

const props = defineProps<{
  modelValue: boolean
  initialData?: any
  isEditing?: boolean
}>()

const emit = defineEmits(['update:modelValue', 'submit'])

const isSubmitting = ref(false)
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const showSupplierSuggestions = ref(false)
const supplierSearch = ref('')
const showCustomerSuggestions = ref(false)
const customerSearch = ref('')
const showCustomerModal = ref(false)
const editingCustomer = ref<any>(null)
const showSupplierModal = ref(false)
const editingSupplier = ref<any>(null)
const showSubAccountSuggestions = ref(false)
const subAccountSearch = ref('')
const showSubAccountModal = ref(false)
const editingSubAccount = ref<any>(null)
const datePickerValue = ref<Date | null>(null)

const sections = ref({
  categories: true,
  parties: true,  // 取引先 - open by default
  details: false,
  receipt: false
})

const form = ref({
  date: new Date().toISOString().split('T')[0],
  type: '支出',
  amount: '',
  customerId: '',
  accountCategoryId: '',
  subAccountCategoryId: '',
  taxCategoryId: '',
  taxRate: '',
  supplierId: '',
  receiptNumber: '',
  invoiceNumber: '',
  trackingNumber: '',
  paymentMethod: '',
  cardNumber: '',
  productName: '',
  notes: '',
  receiptFile: null as File | null
})

// Master data
const customers = ref<any[]>([])
const accountCategories = ref<any[]>([])
const subAccountCategories = ref<any[]>([])
const taxCategories = ref<any[]>([])
const suppliers = ref<any[]>([])

// Load master data
onMounted(async () => {
  userStore.initAuth()
  const headers = userStore.authHeader

  try {
    const [custData, acctData, subAcctData, taxData, supplierData] = await Promise.all([
      $fetch<any[]>('/api/customers', { headers }).catch(() => []),
      $fetch<any[]>('/api/account-categories?topLevel=true', { headers }).catch(() => []),
      $fetch<any[]>('/api/account-categories', { headers }).catch(() => []),
      $fetch<any[]>('/api/tax-categories', { headers }).catch(() => []),
      $fetch<any[]>('/api/suppliers', { headers }).catch(() => [])
    ])

    customers.value = custData.map((c: any) => ({
      id: c.id || c._id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      invoiceNumber: c.invoiceNumber,
      isForeign: c.isForeign
    }))
    accountCategories.value = acctData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    subAccountCategories.value = subAcctData.filter((c: any) => c.parentId).map((c: any) => ({ id: c.id || c._id, name: c.name, parentId: c.parentId }))
    taxCategories.value = taxData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    suppliers.value = supplierData.map((s: any) => ({
      id: s.id || s._id,
      name: s.name,
      companyName: s.companyName,
      serviceName: s.serviceName,
      invoiceNumber: s.invoiceNumber,
      website: s.website
    }))
  } catch (e) {
    console.error('Failed to load master data:', e)
  }
})

// Watch for initial data
watch(() => props.initialData, (data) => {
  if (data && props.isEditing) {
    const dateValue = data.date ? new Date(data.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    form.value = {
      date: dateValue,
      type: data.type || '支出',
      amount: data.amount ? formatNumberWithCommas(String(data.amount)) : '',
      customerId: data.customerId || '',
      accountCategoryId: data.accountCategoryId || '',
      subAccountCategoryId: data.subAccountCategoryId || '',
      taxCategoryId: data.taxCategoryId || '',
      taxRate: data.taxRate ? `${data.taxRate}%` : '',
      supplierId: data.supplierId || '',
      receiptNumber: data.receiptNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      productName: data.productName || '',
      notes: data.notes || '',
      receiptFile: null
    }
    // Sync date picker value
    datePickerValue.value = new Date(dateValue)
    if (data.supplierId) {
      const supplier = suppliers.value.find(s => s.id === data.supplierId)
      if (supplier) supplierSearch.value = supplier.name
    }
    if (data.customerId) {
      const customer = customers.value.find(c => c.id === data.customerId)
      if (customer) customerSearch.value = customer.name
    }
  }
}, { immediate: true })

// Initialize datePickerValue from form.date on mount
watch(() => form.value.date, (newDate) => {
  if (newDate && !datePickerValue.value) {
    datePickerValue.value = new Date(newDate)
  }
}, { immediate: true })

const filteredSubAccountCategories = computed(() => {
  if (form.value.accountCategoryId) {
    return subAccountCategories.value.filter(s => s.parentId === form.value.accountCategoryId)
  }
  return subAccountCategories.value
})

// Sub-account suggestions (filtered by search and parent)
const filteredSubAccountSuggestions = computed(() => {
  const cats = filteredSubAccountCategories.value
  if (!subAccountSearch.value) return cats.slice(0, 10)
  return cats.filter(c => c.name.toLowerCase().includes(subAccountSearch.value.toLowerCase()))
})

// Check if we can create a new sub-account
const canCreateNewSubAccount = computed(() => {
  if (!subAccountSearch.value || subAccountSearch.value.trim().length < 1) return false
  if (!form.value.accountCategoryId) return false
  const searchLower = subAccountSearch.value.toLowerCase().trim()
  return !filteredSubAccountCategories.value.some(c => c.name.toLowerCase() === searchLower)
})

// Selected sub-account display
const selectedSubAccount = computed(() => {
  if (!form.value.subAccountCategoryId) return null
  return subAccountCategories.value.find(c => c.id === form.value.subAccountCategoryId || c._id === form.value.subAccountCategoryId)
})

const filteredSuppliers = computed(() => {
  if (!supplierSearch.value) return suppliers.value.slice(0, 10)
  return suppliers.value.filter(s => s.name.toLowerCase().includes(supplierSearch.value.toLowerCase()))
})

// Check if we can create a new supplier (typed name doesn't exist)
const canCreateNewSupplier = computed(() => {
  if (!supplierSearch.value || supplierSearch.value.trim().length < 1) return false
  const searchLower = supplierSearch.value.toLowerCase().trim()
  return !suppliers.value.some(s => s.name.toLowerCase() === searchLower)
})

// Customer computed properties
const filteredCustomers = computed(() => {
  if (!customerSearch.value) return customers.value.slice(0, 10)
  return customers.value.filter(c => c.name.toLowerCase().includes(customerSearch.value.toLowerCase()))
})

const canCreateNewCustomer = computed(() => {
  if (!customerSearch.value || customerSearch.value.trim().length < 1) return false
  const searchLower = customerSearch.value.toLowerCase().trim()
  return !customers.value.some(c => c.name.toLowerCase() === searchLower)
})

const selectedCustomer = computed(() => {
  if (!form.value.customerId) return null
  return customers.value.find(c => c.id === form.value.customerId)
})

const selectedSupplier = computed(() => {
  if (!form.value.supplierId) return null
  return suppliers.value.find(s => s.id === form.value.supplierId)
})

const close = () => emit('update:modelValue', false)

// Handle date picker update
const handleDateUpdate = (value: Date | null) => {
  if (value) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    form.value.date = `${year}-${month}-${day}`
  } else {
    form.value.date = ''
  }
}

const handleAccountCategoryChange = () => {
  form.value.subAccountCategoryId = ''
  subAccountSearch.value = ''
}

// Sub-account functions
const selectSubAccount = (cat: any) => {
  subAccountSearch.value = cat.name
  form.value.subAccountCategoryId = cat.id || cat._id
  showSubAccountSuggestions.value = false
}

const onSubAccountBlur = () => {
  setTimeout(() => { showSubAccountSuggestions.value = false }, 200)
}

const formatAmount = () => {
  form.value.amount = formatNumberWithCommas(form.value.amount)
}

const formatNumberWithCommas = (value: string) => {
  const plain = value.replace(/,/g, '')
  if (!plain || isNaN(Number(plain))) return plain
  return plain.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const parseNumber = (value: string) => Number(value.replace(/,/g, ''))

const selectSupplier = (supplier: any) => {
  supplierSearch.value = supplier.name
  form.value.supplierId = supplier.id
  showSupplierSuggestions.value = false
}

const onSupplierBlur = () => {
  setTimeout(() => { showSupplierSuggestions.value = false }, 200)
}

// Customer functions
const selectCustomer = (customer: any) => {
  customerSearch.value = customer.name
  form.value.customerId = customer.id
  showCustomerSuggestions.value = false
}

const onCustomerBlur = () => {
  setTimeout(() => { showCustomerSuggestions.value = false }, 200)
}

// Customer modal form
const customerForm = ref({
  name: '',
  email: '',
  phone: '',
  company: '',
  invoiceNumber: '',
  isForeign: false
})

const openCustomerModal = (customer?: any) => {
  if (customer) {
    editingCustomer.value = customer
    customerForm.value = {
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      company: customer.company || '',
      invoiceNumber: customer.invoiceNumber || '',
      isForeign: customer.isForeign || false
    }
  } else {
    editingCustomer.value = null
    customerForm.value = {
      name: customerSearch.value.trim(),
      email: '',
      phone: '',
      company: '',
      invoiceNumber: '',
      isForeign: false
    }
  }
  showCustomerSuggestions.value = false
  showCustomerModal.value = true
}

// Supplier modal form
const supplierForm = ref({
  name: '',
  companyName: '',
  serviceName: '',
  invoiceNumber: '',
  website: ''
})

const subAccountForm = ref({
  name: '',
  code: '',
  description: ''
})

const openSubAccountModal = (subAccount?: any) => {
  if (subAccount) {
    editingSubAccount.value = subAccount
    subAccountForm.value = {
      name: subAccount.name || '',
      code: subAccount.code || '',
      description: subAccount.description || ''
    }
  } else {
    editingSubAccount.value = null
    subAccountForm.value = {
      name: subAccountSearch.value.trim(),
      code: '',
      description: ''
    }
  }
  showSubAccountSuggestions.value = false
  showSubAccountModal.value = true
}

const saveSubAccount = async () => {
  try {
    const data = {
      name: subAccountForm.value.name,
      code: subAccountForm.value.code,
      description: subAccountForm.value.description,
      parentId: form.value.accountCategoryId,
      isActive: true
    }

    let result
    if (editingSubAccount.value) {
      result = await $fetch(`/api/account-categories/${editingSubAccount.value.id || editingSubAccount.value._id}`, {
        method: 'PUT',
        headers: userStore.authHeader,
        body: data
      })
    } else {
      result = await $fetch('/api/account-categories', {
        method: 'POST',
        headers: userStore.authHeader,
        body: data
      })
    }

    // Refresh sub-account categories
    const allCats = await $fetch<any[]>('/api/account-categories', {
      headers: userStore.authHeader
    })
    subAccountCategories.value = allCats.filter((c: any) => c.parentId)

    // Select the new/updated sub-account
    const newId = result._id || result.id
    form.value.subAccountCategoryId = newId
    subAccountSearch.value = result.name

    showSubAccountModal.value = false
  } catch (e) {
    console.error('Failed to save sub-account:', e)
  }
}

const openSupplierModal = (supplier?: any) => {
  if (supplier) {
    editingSupplier.value = supplier
    supplierForm.value = {
      name: supplier.name || '',
      companyName: supplier.companyName || '',
      serviceName: supplier.serviceName || '',
      invoiceNumber: supplier.invoiceNumber || '',
      website: supplier.website || ''
    }
  } else {
    editingSupplier.value = null
    supplierForm.value = {
      name: supplierSearch.value.trim(),
      companyName: '',
      serviceName: '',
      invoiceNumber: '',
      website: ''
    }
  }
  showSupplierSuggestions.value = false
  showSupplierModal.value = true
}

const saveCustomer = async () => {
  if (!customerForm.value.name.trim()) return

  try {
    let savedCustomer: any
    if (editingCustomer.value) {
      // Update existing customer
      savedCustomer = await $fetch<any>(`/api/customers/${editingCustomer.value.id}`, {
        method: 'PUT',
        body: customerForm.value,
        headers: userStore.authHeader
      })
      // Update in local list
      const idx = customers.value.findIndex(c => c.id === editingCustomer.value.id)
      if (idx !== -1) {
        customers.value[idx] = {
          id: savedCustomer._id || savedCustomer.id,
          name: savedCustomer.name,
          email: savedCustomer.email,
          phone: savedCustomer.phone,
          company: savedCustomer.company,
          invoiceNumber: savedCustomer.invoiceNumber,
          isForeign: savedCustomer.isForeign
        }
      }
    } else {
      // Create new customer
      savedCustomer = await $fetch<any>('/api/customers', {
        method: 'POST',
        body: customerForm.value,
        headers: userStore.authHeader
      })
      // Add to local list
      customers.value.push({
        id: savedCustomer._id || savedCustomer.id,
        name: savedCustomer.name,
        email: savedCustomer.email,
        phone: savedCustomer.phone,
        company: savedCustomer.company,
        invoiceNumber: savedCustomer.invoiceNumber,
        isForeign: savedCustomer.isForeign
      })
    }

    // Select the customer
    selectCustomer({
      id: savedCustomer._id || savedCustomer.id,
      name: savedCustomer.name,
      email: savedCustomer.email,
      phone: savedCustomer.phone,
      company: savedCustomer.company,
      invoiceNumber: savedCustomer.invoiceNumber,
      isForeign: savedCustomer.isForeign
    })
    showCustomerModal.value = false
  } catch (e) {
    console.error('Failed to save customer:', e)
  }
}

const saveSupplier = async () => {
  if (!supplierForm.value.name.trim()) return

  try {
    let savedSupplier: any
    if (editingSupplier.value) {
      // Update existing supplier
      savedSupplier = await $fetch<any>(`/api/suppliers/${editingSupplier.value.id}`, {
        method: 'PUT',
        body: supplierForm.value,
        headers: userStore.authHeader
      })
      // Update in local list
      const idx = suppliers.value.findIndex(s => s.id === editingSupplier.value.id)
      if (idx !== -1) {
        suppliers.value[idx] = {
          id: savedSupplier._id || savedSupplier.id,
          name: savedSupplier.name,
          companyName: savedSupplier.companyName,
          serviceName: savedSupplier.serviceName,
          invoiceNumber: savedSupplier.invoiceNumber,
          website: savedSupplier.website
        }
      }
    } else {
      // Create new supplier
      savedSupplier = await $fetch<any>('/api/suppliers', {
        method: 'POST',
        body: supplierForm.value,
        headers: userStore.authHeader
      })
      // Add to local list
      suppliers.value.push({
        id: savedSupplier._id || savedSupplier.id,
        name: savedSupplier.name,
        companyName: savedSupplier.companyName,
        serviceName: savedSupplier.serviceName,
        invoiceNumber: savedSupplier.invoiceNumber,
        website: savedSupplier.website
      })
    }

    // Select the supplier
    selectSupplier({
      id: savedSupplier._id || savedSupplier.id,
      name: savedSupplier.name,
      companyName: savedSupplier.companyName,
      serviceName: savedSupplier.serviceName,
      invoiceNumber: savedSupplier.invoiceNumber,
      website: savedSupplier.website
    })
    showSupplierModal.value = false
  } catch (e) {
    console.error('Failed to save supplier:', e)
  }
}

const triggerFileUpload = () => {
  fileInput.value?.click()
}

const handleFileUpload = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    form.value.receiptFile = input.files[0]
  }
}

const handleDrop = (e: DragEvent) => {
  isDragging.value = false
  if (e.dataTransfer?.files?.[0]) {
    form.value.receiptFile = e.dataTransfer.files[0]
  }
}

const submitForm = async () => {
  isSubmitting.value = true
  try {
    const data: any = {
      date: new Date(form.value.date).toISOString(),
      type: form.value.type,
      amount: parseNumber(form.value.amount),
      status: 'pending',
      receiptNumber: form.value.receiptNumber,
      invoiceNumber: form.value.invoiceNumber,
      trackingNumber: form.value.trackingNumber,
      paymentMethod: form.value.paymentMethod,
      cardNumber: form.value.cardNumber,
      productName: form.value.productName,
      notes: form.value.notes,
      hasReceipt: !!form.value.receiptFile
    }

    if (form.value.customerId) data.customerId = form.value.customerId
    if (form.value.accountCategoryId) data.accountCategoryId = form.value.accountCategoryId
    if (form.value.subAccountCategoryId) data.subAccountCategoryId = form.value.subAccountCategoryId
    if (form.value.taxCategoryId) data.taxCategoryId = form.value.taxCategoryId
    if (form.value.taxRate) data.taxRate = parseFloat(form.value.taxRate.replace('%', ''))
    if (form.value.supplierId) data.supplierId = form.value.supplierId

    emit('submit', data)
    // Don't close here - parent will close after successful save
  } catch (err) {
    console.error('Error in submitForm:', err)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
.slide-panel-enter-active,
.slide-panel-leave-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-panel-enter-active > div:first-child,
.slide-panel-leave-active > div:first-child {
  transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-panel-enter-active > div:nth-child(2),
.slide-panel-leave-active > div:nth-child(2) {
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-panel-enter-from > div:first-child,
.slide-panel-leave-to > div:first-child {
  opacity: 0;
}

.slide-panel-enter-from > div:nth-child(2),
.slide-panel-leave-to > div:nth-child(2) {
  transform: translateX(100%);
}

.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
  max-height: 500px;
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: scale(0.95);
}
</style>
