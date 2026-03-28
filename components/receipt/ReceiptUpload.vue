<template>
  <div class="rounded-2xl border bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 backdrop-blur-sm">
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-lg font-medium text-gray-900 mb-2">{{ t('receiptUpload.title') }}</h2>
        <p class="text-sm text-gray-600">
          {{ t('receiptUpload.description') }}
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Upload Area -->
        <div class="lg:col-span-2">
          <div
              class="border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center h-64"
              :class="{ 'border-primary-main bg-primary-main/10': isDragging }"
              @dragenter.prevent="isDragging = true"
              @dragover.prevent="isDragging = true"
              @dragleave.prevent="isDragging = false"
              @drop.prevent="handleDrop"
          >
            <FileText
                size="48"
                :class="isDragging ? 'text-primary-main' : 'text-gray-400'"
                class="mb-4"
            />
            <h3 class="text-lg font-medium text-gray-900 mb-2">
              {{ isDragging ? t('receiptUpload.dropHere') : t('receiptUpload.dragAndDrop') }}
            </h3>
            <p class="text-sm text-gray-500 mb-4">{{ t('receiptUpload.orClickBrowse') }}</p>
            <button
                @click="$refs.fileInput.click()"
                class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            >
              <Upload size="16" class="mr-2" />
              {{ t('receiptUpload.uploadButton') }}
            </button>
            <input
                ref="fileInput"
                type="file"
                class="hidden"
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
                @change="handleFileInput"
            />
            <p class="text-xs text-gray-500 mt-4">{{ t('receiptUpload.supportedFormats') }}</p>
          </div>

          <!-- Upload Progress -->
          <div v-if="isUploading" class="mt-4">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-medium text-gray-700">{{ t('receiptUpload.uploading') }}</span>
              <span class="text-sm font-medium text-gray-700">{{ uploadProgress }}%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2.5">
              <div
                  class="bg-primary-main h-2.5 rounded-full"
                  :style="{ width: `${uploadProgress}%` }"
              ></div>
            </div>
          </div>

          <!-- Error message -->
          <div v-if="error" class="mt-4 bg-red-50 border-l-4 border-red-400 p-4">
            <div class="flex">
              <div class="flex-shrink-0">
                <AlertCircle class="h-5 w-5 text-red-400" />
              </div>
              <div class="ml-3">
                <p class="text-sm text-red-700">{{ error }}</p>
              </div>
            </div>
          </div>

          <!-- Receipt Metadata Form (shown after upload) -->
          <div v-if="currentReceipt" class="mt-6 border border-gray-200 rounded-lg p-6">
            <h3 class="text-base font-medium text-gray-900 mb-4">{{ t('receiptUpload.receiptInfo') }}</h3>
            <p class="text-sm text-gray-600 mb-4">
              {{ t('receiptUpload.reviewInfo') }}
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6">
              <div>
                <label for="merchant" class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('receiptUpload.merchantName') }}
                </label>
                <input
                    id="merchant"
                    v-model="currentReceipt.merchant"
                    type="text"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
                    :placeholder="t('receiptUpload.merchantPlaceholder')"
                />
              </div>

              <div>
                <label for="date" class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('receiptUpload.receiptDate') }}
                </label>
                <input
                    id="date"
                    v-model="currentReceipt.date"
                    type="date"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
                />
              </div>

              <div>
                <label for="amount" class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('common.amount') }}
                </label>
                <div class="relative rounded-md shadow-sm">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span class="text-gray-500 sm:text-sm">{{ currencySymbol }}</span>
                  </div>
                  <input
                      id="amount"
                      v-model="currentReceipt.amount"
                      type="number"
                      step="0.01"
                      min="0"
                      class="block w-full pl-7 pr-12 border-gray-300 rounded-md focus:ring-primary-main focus:border-primary-main sm:text-sm"
                      placeholder="0.00"
                  />
                  <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span class="text-gray-500 sm:text-sm">{{ currencyCode }}</span>
                  </div>
                </div>
              </div>

              <div>
                <label for="category" class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('common.category') }}
                </label>
                <select
                    id="category"
                    v-model="currentReceipt.category"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
                >
                  <option value="">{{ t('receiptUpload.selectCategory') }}</option>
                  <option value="office">{{ t('categories.office') }}</option>
                  <option value="travel">{{ t('categories.travel') }}</option>
                  <option value="marketing">{{ t('categories.marketing') }}</option>
                  <option value="software">{{ t('categories.software') }}</option>
                  <option value="hardware">{{ t('categories.hardware') }}</option>
                  <option value="services">{{ t('categories.services') }}</option>
                  <option value="other">{{ t('categories.other') }}</option>
                </select>
              </div>

              <div class="md:col-span-2">
                <label for="notes" class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('common.notes') }}
                </label>
                <textarea
                    id="notes"
                    v-model="currentReceipt.notes"
                    rows="3"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-main focus:border-primary-main sm:text-sm"
                    :placeholder="t('receiptUpload.notesPlaceholder')"
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- Instructions and Tips -->
        <div class="lg:col-span-1">
          <div class="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <h3 class="text-base font-medium text-gray-900 mb-4">{{ t('receiptUpload.tips.title') }}</h3>

            <div class="space-y-4">
              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <Camera class="h-5 w-5 text-primary-main" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">{{ t('receiptUpload.tips.imageQuality') }}</h4>
                  <p class="text-xs text-gray-600">
                    {{ t('receiptUpload.tips.imageQualityDesc') }}
                  </p>
                </div>
              </div>

              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <CropIcon class="h-5 w-5 text-primary-main" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">{{ t('receiptUpload.tips.cropTitle') }}</h4>
                  <p class="text-xs text-gray-600">
                    {{ t('receiptUpload.tips.cropDesc') }}
                  </p>
                </div>
              </div>

              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <DollarSign class="h-5 w-5 text-primary-main" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">{{ t('receiptUpload.tips.totalAmount') }}</h4>
                  <p class="text-xs text-gray-600">
                    {{ t('receiptUpload.tips.totalAmountDesc') }}
                  </p>
                </div>
              </div>

              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <CalendarIcon class="h-5 w-5 text-primary-main" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">{{ t('receiptUpload.tips.transactionDate') }}</h4>
                  <p class="text-xs text-gray-600">
                    {{ t('receiptUpload.tips.transactionDateDesc') }}
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-6 pt-6 border-t border-gray-200">
              <h4 class="text-sm font-medium text-gray-900 mb-2">{{ t('receiptUpload.fileTypes') }}</h4>
              <div class="flex flex-wrap gap-2">
                <div class="bg-white px-3 py-1 rounded-md text-xs border border-gray-200 text-gray-600">{{ t('receiptUpload.pdfFiles') }}</div>
                <div class="bg-white px-3 py-1 rounded-md text-xs border border-gray-200 text-gray-600">{{ t('receiptUpload.jpgFiles') }}</div>
                <div class="bg-white px-3 py-1 rounded-md text-xs border border-gray-200 text-gray-600">{{ t('receiptUpload.pngFiles') }}</div>
              </div>
              <p class="text-xs text-gray-500 mt-2">{{ t('receiptUpload.maxSize') }}</p>
            </div>
          </div>

          <!-- Linking with Transaction -->
          <div v-if="currentReceipt && transactionIdToMatch" class="mt-6 bg-blue-50 rounded-lg border border-blue-200 p-6">
            <h3 class="text-base font-medium text-blue-900 mb-2">{{ t('receiptUpload.linkWithTransaction') }}</h3>
            <p class="text-sm text-blue-700 mb-4">
              {{ t('receiptUpload.linkingTo', { id: transactionIdToMatch }) }}
            </p>
            <div class="flex justify-end">
              <button
                  class="inline-flex items-center px-3 py-1 border border-transparent rounded text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
                  @click="viewTransaction"
              >
                {{ t('receiptUpload.viewTransaction') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="mt-8 flex justify-between">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
            @click="cancelUpload"
        >
          {{ t('common.cancel') }}
        </button>
        <div>
          <button
              v-if="currentReceipt"
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              @click="findMatchingTransactions"
              :disabled="isProcessing"
          >
            <span v-if="isProcessing">
              <Loader class="animate-spin mr-2 h-4 w-4" />
              {{ t('receiptUpload.processing') }}
            </span>
            <span v-else>
              {{ t('receiptUpload.findMatching') }}
              <Search class="ml-2 h-4 w-4" />
            </span>
          </button>
          <button
              v-else
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-main hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-main"
              :disabled="!selectedFiles.length || isUploading"
              @click="uploadReceipts"
          >
            <span v-if="isUploading">
              <Loader class="animate-spin mr-2 h-4 w-4" />
              {{ t('receiptUpload.uploading') }}
            </span>
            <span v-else>
              {{ t('receiptUpload.uploadCount', { count: selectedFiles.length }) }}
              <ArrowRight class="ml-2 h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Matching Results Modal -->
    <div v-if="showMatchingResults" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen pt-4 px-4 pb-20">
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" @click="showMatchingResults = false"></div>

        <div class="relative bg-white dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 max-w-3xl w-full mx-auto shadow-2xl">
          <div class="absolute top-0 right-0 pt-4 pr-4">
            <button
                @click="showMatchingResults = false"
                class="rounded-xl text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 focus:outline-none"
            >
              <X class="h-6 w-6" />
            </button>
          </div>

          <div class="px-6 py-5 border-b">
            <h3 class="text-lg font-medium text-gray-900">{{ t('receiptUpload.matchingTransactions') }}</h3>
          </div>

          <div class="px-6 py-4">
            <ReceiptMatcher
                :receipt="currentReceipt"
                @cancel="showMatchingResults = false"
                @match="handleMatch"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import {
  FileText,
  Upload,
  AlertCircle,
  Camera,
  Crop as CropIcon,
  DollarSign,
  Calendar as CalendarIcon,
  ArrowRight,
  Loader,
  Search,
  X
} from 'lucide-vue-next';
import { useFileUpload } from '~/composables/useFileUpload';
import { useReceipts } from '~/composables/useReceipts';
import ReceiptMatcher from './ReceiptMatcher.vue';

const { t, locale } = useI18n()

const props = defineProps({
  transactionIdToMatch: {
    type: String,
    default: null
  }
});

const emit = defineEmits(['uploaded', 'matched', 'cancelled']);

// Currency based on locale
const currencySymbol = computed(() => locale.value === 'ko' ? '₩' : '¥')
const currencyCode = computed(() => locale.value === 'ko' ? 'KRW' : 'JPY')

// State
const isDragging = ref(false);
const error = ref('');
const isProcessing = ref(false);
const showMatchingResults = ref(false);
const currentReceipt = ref(null);
const fileInput = ref(null);

// Use composables
const {
  selectedFiles,
  isUploading,
  uploadProgress,
  handleFileInput: handleFiles,
  handleFileDrop,
  removeFile,
  validateFiles,
  formatFileSize
} = useFileUpload();

const { uploadReceipt, matchWithTransaction } = useReceipts();

// Router for navigation
const router = useRouter();

// Handle file input change
const handleFileInput = (event) => {
  error.value = '';
  const files = event.target.files;

  if (validateFiles(Array.from(files), 'images')) {
    handleFiles(event, 'images');
  } else {
    error.value = t('receiptUpload.invalidFileError');
  }
};

// Handle file drop
const handleDrop = (event) => {
  isDragging.value = false;
  error.value = '';

  if (!event.dataTransfer) return;

  const files = Array.from(event.dataTransfer.files);

  if (validateFiles(files, 'images')) {
    // Reset the input
    if (fileInput.value) fileInput.value.value = '';

    // Process the files
    selectedFiles.value = [...selectedFiles.value, ...files];
  } else {
    error.value = t('receiptUpload.invalidFileError');
  }
};

// Upload receipts
const uploadReceipts = async () => {
  if (selectedFiles.value.length === 0) {
    error.value = t('receiptUpload.selectFileError');
    return;
  }

  try {
    isUploading.value = true;

    // Upload the first receipt (for simplicity in this demo)
    // In a real app, you might handle multiple receipts differently
    const receipt = await uploadReceipt(selectedFiles.value[0]);

    // Update current receipt with any OCR data that might have been extracted
    currentReceipt.value = {
      ...receipt,
      date: receipt.date || new Date().toISOString().split('T')[0], // Default to today if not detected
      amount: receipt.amount || null,
      merchant: receipt.merchant || '',
      category: '',
      notes: ''
    };

    // Emit uploaded event
    emit('uploaded', receipt);
  } catch (err) {
    error.value = t('receiptUpload.uploadError');
    console.error(err);
  } finally {
    isUploading.value = false;
  }
};

// Find matching transactions
const findMatchingTransactions = async () => {
  if (!currentReceipt.value) return;

  try {
    isProcessing.value = true;

    // If there's a transaction ID provided to match with, directly match it
    if (props.transactionIdToMatch) {
      await matchWithTransaction(currentReceipt.value.id, props.transactionIdToMatch);

      // Emit matched event
      emit('matched', currentReceipt.value.id, props.transactionIdToMatch);

      // Navigate to transaction details or receipt list
      router.push('/receipts');
    } else {
      // Show the matching results modal
      showMatchingResults.value = true;
    }
  } catch (err) {
    error.value = t('receiptUpload.processError');
    console.error(err);
  } finally {
    isProcessing.value = false;
  }
};

// Handle match selection
const handleMatch = async (receiptId, transactionId) => {
  try {
    isProcessing.value = true;

    // Match receipt with transaction
    await matchWithTransaction(receiptId, transactionId);

    // Close the modal
    showMatchingResults.value = false;

    // Emit matched event
    emit('matched', receiptId, transactionId);

    // Navigate to receipt list
    router.push('/receipts');
  } catch (err) {
    error.value = t('receiptUpload.matchError');
    console.error(err);
  } finally {
    isProcessing.value = false;
  }
};

// View transaction
const viewTransaction = () => {
  if (props.transactionIdToMatch) {
    router.push(`/transactions/${props.transactionIdToMatch}`);
  }
};

// Cancel upload
const cancelUpload = () => {
  // Reset state
  selectedFiles.value = [];
  currentReceipt.value = null;
  error.value = '';

  // Emit cancelled event
  emit('cancelled');

  // Navigate back or to receipt list
  router.push('/receipts');
};

// Watch for props change
watch(() => props.transactionIdToMatch, (newVal) => {
  if (newVal && currentReceipt.value) {
    // If we have both a transaction ID and a receipt, we can enable direct matching
    // Ready to match - no action needed, UI will show match button
  }
});
</script>
