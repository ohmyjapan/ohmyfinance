<!-- components/transaction/TransactionForm.vue -->
<template>
  <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm p-6">
    <h2 class="text-xl font-bold mb-6 text-gray-900 dark:text-white">{{ isEditing ? t('transactionForm.editTitle') : t('transactionForm.createTitle') }}</h2>

    <form @submit.prevent="submitForm" class="space-y-6">
      <!-- Basic Information Section -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- Date -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.date') }}</label>
          <input
              type="date"
              v-model="form.date"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              required
          />
        </div>

        <!-- Transaction Type -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.typeLabel') }}</label>
          <select
              v-model="form.type"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              required
          >
            <option value="支出">{{ t('transactions.expense') }}</option>
            <option value="入金">{{ t('transactions.income') }}</option>
          </select>
        </div>

        <!-- Amount -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.amount') }}</label>
          <input
              type="text"
              v-model="form.amount"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              :placeholder="t('transactionForm.amountPlaceholder')"
              required
              @input="formatAmount"
          />
        </div>
      </div>

      <!-- Customer and Account Section -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Customer -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.customer') }}</label>
          <div class="relative">
            <select
                v-model="form.customerId"
                class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
            >
              <option value="">{{ t('transactionForm.selectPlaceholder') }}</option>
              <option v-for="customer in customers" :key="customer.id" :value="customer.id">
                {{ customer.name }}
              </option>
              <option value="new">{{ t('transactionForm.addNewCustomer') }}</option>
            </select>
          </div>

          <!-- New Customer Form -->
          <div v-if="form.customerId === 'new'" class="mt-3 p-3 border border-gray-200 dark:border-white/10 rounded-md">
            <h3 class="text-sm font-semibold mb-2 text-gray-900 dark:text-white">{{ t('transactionForm.newCustomerLabel') }}</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.customerNameLabel') }}</label>
                <input
                    type="text"
                    v-model="newCustomer.name"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.customerPlaceholder')"
                />
              </div>
              <div class="flex justify-end">
                <button
                    type="button"
                    @click="addNewCustomer"
                    class="px-3 py-1 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation text-sm"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Account Category -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.accountCategory') }}</label>
          <div class="relative">
            <select
                v-model="form.accountCategoryId"
                class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                @change="handleAccountCategoryChange"
            >
              <option value="">{{ t('transactionForm.selectPlaceholder') }}</option>
              <option v-for="category in accountCategories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
              <option value="new">{{ t('transactionForm.addNewAccountCategory') }}</option>
            </select>
          </div>

          <!-- New Account Category Form -->
          <div v-if="form.accountCategoryId === 'new'" class="mt-3 p-3 border border-gray-200 dark:border-white/10 rounded-md">
            <h3 class="text-sm font-semibold mb-2 text-gray-900 dark:text-white">{{ t('transactionForm.newAccountCategoryLabel') }}</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.accountCategoryNameLabel') }}</label>
                <input
                    type="text"
                    v-model="newAccountCategory.name"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.accountNamePlaceholder')"
                />
              </div>
              <div class="flex justify-end">
                <button
                    type="button"
                    @click="addNewAccountCategory"
                    class="px-3 py-1 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation text-sm"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sub Account & Tax Section -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Sub Account Category -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.subAccountCategory') }}</label>
          <div class="relative">
            <select
                v-model="form.subAccountCategoryId"
                class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
            >
              <option value="">{{ t('transactionForm.selectPlaceholder') }}</option>
              <option v-for="category in filteredSubAccountCategories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
              <option value="new">{{ t('transactionForm.addNewSubAccountCategory') }}</option>
            </select>
          </div>

          <!-- New Sub Account Category Form -->
          <div v-if="form.subAccountCategoryId === 'new'" class="mt-3 p-3 border border-gray-200 dark:border-white/10 rounded-md">
            <h3 class="text-sm font-semibold mb-2 text-gray-900 dark:text-white">{{ t('transactionForm.newSubAccountCategoryLabel') }}</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.subAccountCategoryNameLabel') }}</label>
                <input
                    type="text"
                    v-model="newSubAccountCategory.name"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.subAccountCategoryNameLabel')"
                />
              </div>
              <!-- Credit card specific fields -->
              <div v-if="form.accountCategory === 'credit_card'">
                <div class="mb-2">
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.cardLast4') }}</label>
                  <input
                      type="text"
                      v-model="newSubAccountCategory.cardNumber"
                      maxlength="4"
                      class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                      placeholder="例: 1234"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.cardProvider') }}</label>
                  <select
                      v-model="newSubAccountCategory.cardProvider"
                      class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                  >
                    <option value="">{{ t('transactionForm.selectPlaceholder') }}</option>
                    <option value="VISA">VISA</option>
                    <option value="MasterCard">MasterCard</option>
                    <option value="American Express">American Express</option>
                    <option value="JCB">JCB</option>
                    <option value="Discover">Discover</option>
                    <option value="Other">{{ t('transactionForm.otherProvider') }}</option>
                  </select>
                </div>
              </div>
              <div class="flex justify-end">
                <button
                    type="button"
                    @click="addNewSubAccountCategory"
                    class="px-3 py-1 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation text-sm"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Tax Category -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.taxCategory') }}</label>
          <div class="relative">
            <select
                v-model="form.taxCategoryId"
                class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
            >
              <option value="">{{ t('transactionForm.selectPlaceholder') }}</option>
              <option v-for="category in taxCategories" :key="category.id" :value="category.name">
                {{ category.name }}
              </option>
              <option value="new">{{ t('transactionForm.addNewTaxCategory') }}</option>
            </select>
          </div>

          <!-- New Tax Category Form -->
          <div v-if="form.taxCategoryId === 'new'" class="mt-3 p-3 border border-gray-200 dark:border-white/10 rounded-md">
            <h3 class="text-sm font-semibold mb-2 text-gray-900 dark:text-white">{{ t('transactionForm.newTaxCategoryLabel') }}</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.taxCategoryNameLabel') }}</label>
                <input
                    type="text"
                    v-model="newTaxCategory.name"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.taxCategoryNamePlaceholder')"
                />
              </div>
              <div class="flex justify-end">
                <button
                    type="button"
                    @click="addNewTaxCategory"
                    class="px-3 py-1 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation text-sm"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Tax Rate -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.taxRate') }}</label>
          <div class="relative">
            <select
                v-model="form.taxRate"
                class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
            >
              <option value="">{{ t('transactionForm.selectPlaceholder') }}</option>
              <option v-for="rate in taxRates" :key="rate.id" :value="rate.value">
                {{ rate.value }}
              </option>
              <option value="new">{{ t('transactionForm.addNewTaxRate') }}</option>
            </select>
          </div>

          <!-- New Tax Rate Form -->
          <div v-if="form.taxRate === 'new'" class="mt-3 p-3 border border-gray-200 dark:border-white/10 rounded-md">
            <h3 class="text-sm font-semibold mb-2 text-gray-900 dark:text-white">{{ t('transactionForm.newTaxRateLabel') }}</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.taxRate') }}</label>
                <input
                    type="text"
                    v-model="newTaxRate.value"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.taxRatePlaceholder')"
                />
              </div>
              <div class="flex justify-end">
                <button
                    type="button"
                    @click="addNewTaxRate"
                    class="px-3 py-1 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation text-sm"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Supplier & Receipt Number Section -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Supplier with autocomplete -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.supplier') }}</label>
          <div class="relative">
            <input
                type="text"
                v-model="supplierSearch"
                @input="onSupplierSearchInput"
                @focus="showSupplierSuggestions = true"
                @blur="onSupplierBlur"
                class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                :placeholder="t('transactionForm.supplierPlaceholder')"
            />
            <!-- Supplier suggestions dropdown -->
            <div v-if="showSupplierSuggestions && filteredSuppliers.length > 0" class="absolute z-10 w-full mt-1 bg-white dark:bg-white/5 rounded-md shadow-lg max-h-60 overflow-auto">
              <ul class="py-1">
                <li v-for="supplier in filteredSuppliers" :key="supplier.id"
                    @mousedown="selectSupplier(supplier)"
                    class="px-4 py-2 hover:bg-gray-100 dark:hover:bg-white/[0.07] cursor-pointer text-gray-900 dark:text-gray-100">
                  {{ supplier.name }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Receipt/Order Number -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.receiptOrderNumber') }}</label>
          <input
              type="text"
              v-model="form.receiptNumber"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              :placeholder="t('transactionForm.receiptOrderNumberPlaceholder')"
          />
        </div>
      </div>

      <!-- Category & Company Info Section -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Category -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.categoryLabel') }}</label>
          <div class="relative">
            <select
                v-model="form.transactionCategoryId"
                class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
            >
              <option value="">{{ t('transactionForm.selectPlaceholder') }}</option>
              <option v-for="category in categories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
              <option value="new">{{ t('transactionForm.addNewCategory') }}</option>
            </select>
          </div>

          <!-- New Category Form -->
          <div v-if="form.transactionCategoryId === 'new'" class="mt-3 p-3 border border-gray-200 dark:border-white/10 rounded-md">
            <h3 class="text-sm font-semibold mb-2 text-gray-900 dark:text-white">{{ t('transactionForm.newCategoryLabel') }}</h3>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.categoryNameLabel') }}</label>
                <input
                    type="text"
                    v-model="newCategory.name"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.categoryNamePlaceholder')"
                />
              </div>
              <div class="flex justify-end">
                <button
                    type="button"
                    @click="addNewCategory"
                    class="px-3 py-1 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation text-sm"
                >
                  {{ t('common.add') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Company Info -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.companyInfo') }}</label>
          <input
              type="text"
              v-model="form.companyInfo"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              :placeholder="t('transactionForm.companyInfoPlaceholder')"
          />
        </div>
      </div>

      <!-- Invoice & Product Info Section -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Invoice Number -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.invoiceNumber') }}</label>
          <input
              type="text"
              v-model="form.invoiceNumber"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              :placeholder="t('transactionForm.invoiceNumberPlaceholder')"
          />
        </div>

        <!-- JAN Code -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">JAN CODE</label>
          <input
              type="text"
              v-model="form.janCode"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              :placeholder="t('transactionForm.janCodePlaceholder')"
          />
        </div>

        <!-- Product Price -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.productPrice') }}</label>
          <input
              type="text"
              v-model="form.productPrice"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              :placeholder="t('transactionForm.productPricePlaceholder')"
              @input="formatProductPrice"
          />
        </div>
      </div>

      <!-- Product Name & Receipt Section -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Product Name/Code -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.productCodeName') }}</label>
          <input
              type="text"
              v-model="form.productName"
              class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
              :placeholder="t('transactionForm.productCodePlaceholder')"
          />
        </div>

        <!-- Receipt Upload -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('transactionForm.receiptUpload') }}</label>
          <div class="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 dark:border-white/10 border-dashed rounded-md">
            <div class="space-y-1 text-center">
              <svg class="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <div class="flex text-sm text-gray-600 dark:text-gray-400">
                <label for="receipt-upload" class="relative cursor-pointer bg-white dark:bg-white/5 rounded-md font-medium text-primary-main hover:text-primary-main">
                  <span>{{ t('transactionForm.uploadFile') }}</span>
                  <input id="receipt-upload" name="receipt-upload" type="file" class="sr-only" @change="handleFileUpload">
                </label>
                <p class="pl-1">{{ t('transactionForm.orDragDrop') }}</p>
              </div>
              <p class="text-xs text-gray-500">
                {{ t('transactionForm.maxFileSize') }}
              </p>
            </div>
          </div>
          <div v-if="form.receiptFile" class="mt-2 text-sm text-green-600">
            {{ t('transactionForm.uploaded') }}: {{ form.receiptFile.name }}
          </div>
        </div>
      </div>

      <!-- Items Section -->
      <div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">{{ t('transactionForm.itemsTitle') }}</h3>

        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-white/10">
            <thead class="bg-gray-50 dark:bg-white/5">
            <tr>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('transactionForm.productNameHeader') }}
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('transactionForm.janCodeHeader') }}
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('transactionForm.productUrlHeader') }}
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('transactionForm.quantityHeader') }}
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('transactionForm.unitPriceHeader') }}
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('transactionForm.subtotalHeader') }}
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {{ t('transactionForm.actionHeader') }}
              </th>
            </tr>
            </thead>
            <tbody class="bg-white dark:bg-white/5 divide-y divide-gray-200 dark:divide-white/10">
            <tr v-for="(item, index) in items" :key="index">
              <td class="px-4 py-3 whitespace-nowrap">
                <input
                    type="text"
                    v-model="item.productName"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.productNameHeader')"
                />
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <input
                    type="text"
                    v-model="item.janCode"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.janCodeHeader')"
                />
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <input
                    type="text"
                    v-model="item.productUrl"
                    class="w-full bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.productUrlHeader')"
                />
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <input
                    type="number"
                    v-model.number="item.quantity"
                    min="1"
                    class="w-20 bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    :placeholder="t('transactionForm.quantityHeader')"
                />
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <input
                    type="text"
                    v-model="item.unitPrice"
                    @input="formatItemPrice(index)"
                    class="w-32 bg-white dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-primary-main focus:ring focus:ring-primary-light focus:ring-opacity-50"
                    placeholder="0"
                />
              </td>
              <td class="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
                {{ formatCurrency(calculateItemSubtotal(item)) }}
              </td>
              <td class="px-4 py-3 whitespace-nowrap text-right">
                <button
                    type="button"
                    @click="removeItem(index)"
                    class="text-red-600 hover:text-red-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </td>
            </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-4 flex justify-between">
          <button
              type="button"
              @click="addItem"
              class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {{ t('transactionForm.addProduct') }}
          </button>

          <div class="text-right">
            <div class="text-gray-500 dark:text-gray-400">{{ t('transactionForm.totalLabel') }}</div>
            <div class="text-xl font-bold text-gray-900 dark:text-white">{{ formatCurrency(calculateTotal()) }}</div>
          </div>
        </div>
      </div>

      <!-- Buttons -->
      <div class="flex justify-end space-x-3">
        <button
            type="button"
            @click="cancel"
            class="px-4 py-2 border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-white/[0.07]"
        >
          {{ t('common.cancel') }}
        </button>
        <button
            type="submit"
            class="px-4 py-2 bg-primary-main text-white rounded-xl hover:bg-primary-dark touch-manipulation"
            :disabled="isSubmitting"
        >
          <span v-if="isSubmitting" class="flex items-center">
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ t('transactionForm.saving') }}
          </span>
          <span v-else>{{ isEditing ? t('transactionForm.update') : t('common.save') }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const { t } = useI18n()

interface SubAccountCategory {
  id: string
  name: string
  parentId?: string
  cardNumber?: string
  cardProvider?: string
}

const props = defineProps({
  initialData: {
    type: Object,
    default: null
  },
  isEditing: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['submit', 'cancel'])
const isSubmitting = ref(false)
const isLoadingMasterData = ref(true)

// Form data
const form = ref({
  id: '',
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
  transactionCategoryId: '',
  companyInfo: '',
  invoiceNumber: '',
  janCode: '',
  productName: '',
  productPrice: '',
  receiptFile: null as File | null
})

// Items data
const items = ref([
  {
    id: crypto.randomUUID(),
    productName: '',
    janCode: '',
    productUrl: '',
    quantity: 1,
    unitPrice: ''
  }
])

// For creating new entries
const newCustomer = ref({ name: '' })
const newAccountCategory = ref({ name: '' })
const newSubAccountCategory = ref({
  name: '',
  parentId: '',
  cardNumber: '',
  cardProvider: ''
})
const newCategory = ref({ name: '' })
const newTaxCategory = ref({ name: '' })
const newTaxRate = ref({ value: '' })

// Supplier autocomplete
const supplierSearch = ref('')
const showSupplierSuggestions = ref(false)

// Master data from APIs
const customers = ref<any[]>([])
const accountCategories = ref<any[]>([])
const subAccountCategories = ref<SubAccountCategory[]>([])
const categories = ref<any[]>([])
const taxCategories = ref<any[]>([])
const suppliers = ref<any[]>([])

const taxRates = ref([
  { id: 'taxrate1', value: '10%' },
  { id: 'taxrate2', value: '8%' },
  { id: 'taxrate3', value: '0%' }
])

// Fetch master data on mount
onMounted(async () => {
  isLoadingMasterData.value = true
  try {
    const [
      customersData,
      accountCategoriesData,
      subAccountCategoriesData,
      categoriesData,
      taxCategoriesData,
      suppliersData
    ] = await Promise.all([
      $fetch<any[]>('/api/customers').catch(() => []),
      $fetch<any[]>('/api/account-categories?topLevel=true').catch(() => []),
      $fetch<any[]>('/api/account-categories').catch(() => []),
      $fetch<any[]>('/api/transaction-categories').catch(() => []),
      $fetch<any[]>('/api/tax-categories').catch(() => []),
      $fetch<any[]>('/api/suppliers').catch(() => [])
    ])

    customers.value = customersData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    accountCategories.value = accountCategoriesData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    subAccountCategories.value = subAccountCategoriesData
      .filter((c: any) => c.parentId)
      .map((c: any) => ({
        id: c.id || c._id,
        name: c.name,
        parentId: c.parentId,
        cardNumber: c.cardNumber,
        cardProvider: c.cardProvider
      }))
    categories.value = categoriesData.map((c: any) => ({ id: c.id || c._id, name: c.name }))
    taxCategories.value = taxCategoriesData.map((c: any) => ({ id: c.id || c._id, name: c.name, rate: c.rate }))
    suppliers.value = suppliersData.map((s: any) => ({ id: s.id || s._id, name: s.name }))

    // Populate form with initial data if editing
    if (props.initialData && props.isEditing) {
      const data = props.initialData
      form.value = {
        id: data.id || '',
        date: data.date || new Date().toISOString().split('T')[0],
        type: data.type || '支出',
        amount: data.amount ? formatNumberWithCommas(String(data.amount)) : '',
        customerId: data.customerId || '',
        accountCategoryId: data.accountCategoryId || '',
        subAccountCategoryId: data.subAccountCategoryId || '',
        taxCategoryId: data.taxCategoryId || '',
        taxRate: data.taxRate ? `${data.taxRate}%` : '',
        supplierId: data.supplierId || '',
        receiptNumber: data.receiptNumber || '',
        transactionCategoryId: data.transactionCategoryId || '',
        companyInfo: data.companyInfo || '',
        invoiceNumber: data.invoiceNumber || '',
        janCode: data.janCode || '',
        productName: data.productName || '',
        productPrice: data.productPrice ? formatNumberWithCommas(String(data.productPrice)) : '',
        receiptFile: null
      }

      // Set supplier search field if supplier is selected
      if (data.supplierId) {
        const supplier = suppliers.value.find(s => s.id === data.supplierId)
        if (supplier) {
          supplierSearch.value = supplier.name
        }
      }

      // Populate items if present
      if (data.items && data.items.length > 0) {
        items.value = data.items.map((item: any) => ({
          id: item.id || crypto.randomUUID(),
          productName: item.productName || '',
          janCode: item.janCode || '',
          productUrl: item.productUrl || '',
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice ? formatNumberWithCommas(String(item.unitPrice)) : ''
        }))
      }
    }
  } catch (error) {
    console.error('Failed to load master data:', error)
  } finally {
    isLoadingMasterData.value = false
  }
})

// Computed
const filteredSuppliers = computed(() => {
  if (!supplierSearch.value) return []
  const searchTerm = supplierSearch.value.toLowerCase()
  return suppliers.value.filter(
      supplier => supplier.name.toLowerCase().includes(searchTerm)
  )
})

const filteredSubAccountCategories = computed(() => {
  if (form.value.accountCategoryId && form.value.accountCategoryId !== 'new') {
    return subAccountCategories.value.filter(subCat =>
        subCat.parentId === form.value.accountCategoryId
    )
  }
  return subAccountCategories.value
})

// Methods
const onSupplierSearchInput = () => {
  showSupplierSuggestions.value = true
}

const onSupplierBlur = () => {
  setTimeout(() => {
    showSupplierSuggestions.value = false
  }, 200)
}

const selectSupplier = (supplier: any) => {
  supplierSearch.value = supplier.name
  form.value.supplierId = supplier.id
  showSupplierSuggestions.value = false
}

const handleAccountCategoryChange = () => {
  form.value.subAccountCategoryId = ''
}

const formatAmount = () => {
  form.value.amount = formatNumberWithCommas(form.value.amount)
}

const formatProductPrice = () => {
  form.value.productPrice = formatNumberWithCommas(form.value.productPrice)
}

const formatNumberWithCommas = (value: string) => {
  const plainNumber = value.replace(/,/g, '')
  if (!plainNumber || isNaN(Number(plainNumber))) {
    return plainNumber
  }
  return plainNumber.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const formatItemPrice = (index: number) => {
  if (!items.value[index]) return
  const item = items.value[index]
  if (typeof item.unitPrice !== 'string') return
  const plainNumber = item.unitPrice.replace(/,/g, '')
  if (!plainNumber || isNaN(Number(plainNumber))) return
  items.value[index].unitPrice = plainNumber.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const parseNumberWithCommas = (value: string) => {
  return Number(value.replace(/,/g, ''))
}

const calculateItemSubtotal = (item: any) => {
  const unitPrice = typeof item.unitPrice === 'string'
      ? parseNumberWithCommas(item.unitPrice)
      : (item.unitPrice || 0)
  return unitPrice * (item.quantity || 1)
}

const calculateTotal = () => {
  return items.value.reduce((sum, item) => {
    return sum + calculateItemSubtotal(item)
  }, 0)
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    currencyDisplay: 'narrowSymbol'
  }).format(amount)
}

const handleFileUpload = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    form.value.receiptFile = input.files[0]
  }
}

const addItem = () => {
  items.value.push({
    id: crypto.randomUUID(),
    productName: '',
    janCode: '',
    productUrl: '',
    quantity: 1,
    unitPrice: ''
  })
}

const removeItem = (index: number) => {
  items.value.splice(index, 1)
  if (items.value.length === 0) {
    addItem()
  }
}

const addNewCustomer = async () => {
  if (newCustomer.value.name) {
    try {
      const result = await $fetch<any>('/api/customers', {
        method: 'POST',
        body: { name: newCustomer.value.name }
      })
      const newId = result.id || result._id
      customers.value.push({ id: newId, name: newCustomer.value.name })
      form.value.customerId = newId
      newCustomer.value.name = ''
    } catch (error) {
      console.error('Failed to create customer:', error)
    }
  }
}

const addNewAccountCategory = async () => {
  if (newAccountCategory.value.name) {
    try {
      const result = await $fetch<any>('/api/account-categories', {
        method: 'POST',
        body: { name: newAccountCategory.value.name }
      })
      const newId = result.id || result._id
      accountCategories.value.push({ id: newId, name: newAccountCategory.value.name })
      form.value.accountCategoryId = newId
      newAccountCategory.value.name = ''
    } catch (error) {
      console.error('Failed to create account category:', error)
    }
  }
}

const addNewSubAccountCategory = async () => {
  if (newSubAccountCategory.value.name || newSubAccountCategory.value.cardNumber) {
    try {
      const isCreditCard = accountCategories.value.find(c => c.id === form.value.accountCategoryId)?.name === 'クレジットカード'
      const displayName = isCreditCard
          ? `${newSubAccountCategory.value.cardProvider || ''} ${newSubAccountCategory.value.cardNumber || ''}`.trim()
          : newSubAccountCategory.value.name

      const result = await $fetch<any>('/api/account-categories', {
        method: 'POST',
        body: {
          name: displayName,
          parentId: form.value.accountCategoryId,
          cardNumber: newSubAccountCategory.value.cardNumber,
          cardProvider: newSubAccountCategory.value.cardProvider
        }
      })
      const newId = result.id || result._id
      subAccountCategories.value.push({
        id: newId,
        name: displayName,
        parentId: form.value.accountCategoryId,
        cardNumber: newSubAccountCategory.value.cardNumber,
        cardProvider: newSubAccountCategory.value.cardProvider
      })
      form.value.subAccountCategoryId = newId
      newSubAccountCategory.value = { name: '', parentId: '', cardNumber: '', cardProvider: '' }
    } catch (error) {
      console.error('Failed to create sub account category:', error)
    }
  }
}

const addNewCategory = async () => {
  if (newCategory.value.name) {
    try {
      const result = await $fetch<any>('/api/transaction-categories', {
        method: 'POST',
        body: { name: newCategory.value.name }
      })
      const newId = result.id || result._id
      categories.value.push({ id: newId, name: newCategory.value.name })
      form.value.transactionCategoryId = newId
      newCategory.value.name = ''
    } catch (error) {
      console.error('Failed to create transaction category:', error)
    }
  }
}

const addNewTaxCategory = async () => {
  if (newTaxCategory.value.name) {
    try {
      const result = await $fetch<any>('/api/tax-categories', {
        method: 'POST',
        body: { name: newTaxCategory.value.name }
      })
      const newId = result.id || result._id
      taxCategories.value.push({ id: newId, name: newTaxCategory.value.name })
      form.value.taxCategoryId = newId
      newTaxCategory.value.name = ''
    } catch (error) {
      console.error('Failed to create tax category:', error)
    }
  }
}

const addNewTaxRate = () => {
  if (newTaxRate.value.value) {
    const newId = crypto.randomUUID()
    taxRates.value.push({ id: newId, value: newTaxRate.value.value })
    form.value.taxRate = newTaxRate.value.value
    newTaxRate.value.value = ''
  }
}

const submitForm = async () => {
  isSubmitting.value = true

  try {
    // Build transaction data matching the OMF model
    const transactionData: any = {
      date: new Date(form.value.date).toISOString(),
      type: form.value.type,
      amount: parseNumberWithCommas(form.value.amount),
      status: 'pending',
      hasReceipt: !!form.value.receiptFile,
      receiptNumber: form.value.receiptNumber,
      companyInfo: form.value.companyInfo,
      invoiceNumber: form.value.invoiceNumber,
      janCode: form.value.janCode,
      productName: form.value.productName,
      productPrice: form.value.productPrice ? parseNumberWithCommas(form.value.productPrice) : undefined,
      items: items.value
        .filter(item => item.productName || item.janCode)
        .map(item => ({
          productName: item.productName,
          janCode: item.janCode,
          productUrl: item.productUrl,
          quantity: item.quantity,
          unitPrice: typeof item.unitPrice === 'string' ? parseNumberWithCommas(item.unitPrice) : item.unitPrice
        }))
    }

    // Only add IDs if they are valid (not empty and not 'new')
    if (form.value.customerId && form.value.customerId !== 'new') {
      transactionData.customerId = form.value.customerId
    }
    if (form.value.accountCategoryId && form.value.accountCategoryId !== 'new') {
      transactionData.accountCategoryId = form.value.accountCategoryId
    }
    if (form.value.subAccountCategoryId && form.value.subAccountCategoryId !== 'new') {
      transactionData.subAccountCategoryId = form.value.subAccountCategoryId
    }
    if (form.value.taxCategoryId && form.value.taxCategoryId !== 'new') {
      transactionData.taxCategoryId = form.value.taxCategoryId
    }
    if (form.value.taxRate) {
      transactionData.taxRate = parseFloat(form.value.taxRate.replace('%', ''))
    }
    if (form.value.supplierId) {
      transactionData.supplierId = form.value.supplierId
    }
    if (form.value.transactionCategoryId && form.value.transactionCategoryId !== 'new') {
      transactionData.transactionCategoryId = form.value.transactionCategoryId
    }

    emit('submit', transactionData)
  } catch (error) {
    console.error('Failed to save transaction', error)
  } finally {
    isSubmitting.value = false
  }
}

const cancel = () => {
  emit('cancel')
}
</script>
