<template>
  <div class="bg-white rounded-lg shadow-sm">
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-lg font-medium text-gray-900 mb-2">Upload Receipt</h2>
        <p class="text-sm text-gray-600">
          Upload physical or digital receipts to match with your transaction records. The system will
          automatically extract information from the receipt and suggest matching transactions.
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Upload Area -->
        <div class="lg:col-span-2">
          <div
              class="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center h-64"
              :class="{ 'border-purple-400 bg-purple-50': isDragging }"
              @dragenter.prevent="isDragging = true"
              @dragover.prevent="isDragging = true"
              @dragleave.prevent="isDragging = false"
              @drop.prevent="handleDrop"
          >
            <FileText
                size="48"
                :class="isDragging ? 'text-purple-400' : 'text-gray-400'"
                class="mb-4"
            />
            <h3 class="text-lg font-medium text-gray-900 mb-2">
              {{ isDragging ? 'Drop receipts here' : 'Drag and drop receipts here' }}
            </h3>
            <p class="text-sm text-gray-500 mb-4">or click to browse from your device</p>
            <button
                @click="$refs.fileInput.click()"
                class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              <Upload size="16" class="mr-2" />
              Upload Receipt
            </button>
            <input
                ref="fileInput"
                type="file"
                class="hidden"
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
                @change="handleFileInput"
            />
            <p class="text-xs text-gray-500 mt-4">Supported formats: PDF, JPG, PNG (max 10MB)</p>
          </div>

          <!-- Upload Progress -->
          <div v-if="isUploading" class="mt-4">
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm font-medium text-gray-700">Uploading...</span>
              <span class="text-sm font-medium text-gray-700">{{ uploadProgress }}%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2.5">
              <div
                  class="bg-purple-600 h-2.5 rounded-full"
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
            <h3 class="text-base font-medium text-gray-900 mb-4">Receipt Information</h3>
            <p class="text-sm text-gray-600 mb-4">
              Review and edit the information extracted from your receipt.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6">
              <div>
                <label for="merchant" class="block text-sm font-medium text-gray-700 mb-1">
                  Merchant Name
                </label>
                <input
                    id="merchant"
                    v-model="currentReceipt.merchant"
                    type="text"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                    placeholder="Merchant Name"
                />
              </div>

              <div>
                <label for="date" class="block text-sm font-medium text-gray-700 mb-1">
                  Receipt Date
                </label>
                <input
                    id="date"
                    v-model="currentReceipt.date"
                    type="date"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                />
              </div>

              <div>
                <label for="amount" class="block text-sm font-medium text-gray-700 mb-1">
                  Amount
                </label>
                <div class="relative rounded-md shadow-sm">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span class="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input
                      id="amount"
                      v-model="currentReceipt.amount"
                      type="number"
                      step="0.01"
                      min="0"
                      class="block w-full pl-7 pr-12 border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                      placeholder="0.00"
                  />
                  <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span class="text-gray-500 sm:text-sm">USD</span>
                  </div>
                </div>
              </div>

              <div>
                <label for="category" class="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                    id="category"
                    v-model="currentReceipt.category"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                >
                  <option value="">Select a category</option>
                  <option value="office">Office Supplies</option>
                  <option value="travel">Travel</option>
                  <option value="marketing">Marketing</option>
                  <option value="software">Software</option>
                  <option value="hardware">Hardware</option>
                  <option value="services">Services</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div class="md:col-span-2">
                <label for="notes" class="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                    id="notes"
                    v-model="currentReceipt.notes"
                    rows="3"
                    class="block w-full border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                    placeholder="Add any additional notes about this receipt"
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- Instructions and Tips -->
        <div class="lg:col-span-1">
          <div class="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <h3 class="text-base font-medium text-gray-900 mb-4">Tips for Better Results</h3>

            <div class="space-y-4">
              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <Camera class="h-5 w-5 text-purple-600" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">Image Quality</h4>
                  <p class="text-xs text-gray-600">
                    Ensure receipts are well-lit, in focus, and text is clearly visible.
                  </p>
                </div>
              </div>

              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <CropIcon class="h-5 w-5 text-purple-600" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">Crop Appropriately</h4>
                  <p class="text-xs text-gray-600">
                    Include the entire receipt but remove unnecessary backgrounds.
                  </p>
                </div>
              </div>

              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <DollarSign class="h-5 w-5 text-purple-600" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">Total Amount</h4>
                  <p class="text-xs text-gray-600">
                    Make sure the total amount is clearly visible for better matching.
                  </p>
                </div>
              </div>

              <div class="flex items-start">
                <div class="flex-shrink-0">
                  <CalendarIcon class="h-5 w-5 text-purple-600" />
                </div>
                <div class="ml-3">
                  <h4 class="text-sm font-medium text-gray-900">Transaction Date</h4>
                  <p class="text-xs text-gray-600">
                    Date information helps match receipts with the correct transaction.
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-6 pt-6 border-t border-gray-200">
              <h4 class="text-sm font-medium text-gray-900 mb-2">Supported File Types</h4>
              <div class="flex flex-wrap gap-2">
                <div class="bg-white px-3 py-1 rounded-md text-xs border border-gray-200 text-gray-600">PDF files</div>
                <div class="bg-white px-3 py-1 rounded-md text-xs border border-gray-200 text-gray-600">JPG images</div>
                <div class="bg-white px-3 py-1 rounded-md text-xs border border-gray-200 text-gray-600">PNG images</div>
              </div>
              <p class="text-xs text-gray-500 mt-2">Maximum file size: 10MB per receipt</p>
            </div>
          </div>

          <!-- Linking with Transaction -->
          <div v-if="currentReceipt && transactionIdToMatch" class="mt-6 bg-blue-50 rounded-lg border border-blue-200 p-6">
            <h3 class="text-base font-medium text-blue-900 mb-2">Link with Transaction</h3>
            <p class="text-sm text-blue-700 mb-4">
              This receipt will be linked to transaction #{{ transactionIdToMatch }}
            </p>
            <div class="flex justify-end">
              <button
                  class="inline-flex items-center px-3 py-1 border border-transparent rounded text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  @click="viewTransaction"
              >
                View Transaction
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="mt-8 flex justify-between">
        <button
            class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            @click="cancelUpload"
        >
          Cancel
        </button>
        <div>
          <button
              v-if="currentReceipt"
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              @click="findMatchingTransactions"
              :disabled="isProcessing"
          >
            <span v-if="isProcessing">
              <Loader class="animate-spin mr-2 h-4 w-4" />
              Processing...
            </span>
            <span v-else>
              Find Matching Transactions
              <Search class="ml-2 h-4 w-4" />
            </span>
          </button>
          <button
              v-else
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              :disabled="!selectedFiles.length || isUploading"
              @click="uploadReceipts"
          >
            <span v-if="isUploading">
              <Loader class="animate-spin mr-2 h-4 w-4" />
              Uploading...
            </span>
            <span v-else>
              Upload {{ selectedFiles.length }} {{ selectedFiles.length === 1 ? 'Receipt' : 'Receipts' }}
              <ArrowRight class="ml-2 h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Matching Results Modal -->
    <div v-if="showMatchingResults" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen pt-4 px-4 pb-20">
        <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" @click="showMatchingResults = false"></div>

        <div class="relative bg-white rounded-lg max-w-3xl w-full mx-auto shadow-xl">
          <div class="absolute top-0 right-0 pt-4 pr-4">
            <button
                @click="showMatchingResults = false"
                class="bg-white rounded-md text-gray-400 hover:text-gray-500 focus:outline-none"
            >
              <X class="h-6 w-6" />
            </button>
          </div>

          <div class="px-6 py-5 border-b">
            <h3 class="text-lg font-medium text-gray-900">Matching Transactions</h3>
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
import { ref, watch } from 'vue';
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

const props = defineProps({
  transactionIdToMatch: {
    type: String,
    default: null
  }
});

const emit = defineEmits(['uploaded', 'matched', 'cancelled']);

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
    error.value = 'Please upload only PDF, JPG, or PNG files under 10MB.';
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
    error.value = 'Please upload only PDF, JPG, or PNG files under 10MB.';
  }
};

// Upload receipts
const uploadReceipts = async () => {
  if (selectedFiles.value.length === 0) {
    error.value = 'Please select at least one receipt to upload.';
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
    error.value = 'Failed to upload receipt. Please try again.';
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
    error.value = 'Failed to process the receipt. Please try again.';
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
    error.value = 'Failed to match receipt with transaction. Please try again.';
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
    console.log(`Ready to match receipt with transaction ${newVal}`);
  }
});
</script>