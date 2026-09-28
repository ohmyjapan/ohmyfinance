import { ref } from 'vue'
import { useUserStore } from '~/stores/user'

export function useReceiptFiles() {
  const user = useUserStore(), { t } = useI18n()
  const isDownloading = ref(false), downloadError = ref('')
  async function downloadReceipt(id: string, name = 'receipt') {
    if (isDownloading.value) return false
    const headers = user.authHeader
    isDownloading.value = true; downloadError.value = ''
    try {
      if (!/^[a-f\d]{24}$/i.test(id)) throw Error('Invalid receipt ID')
      const blob = await $fetch<Blob>(`/api/receipts/${id}/file`, { headers, responseType: 'blob' })
      if (headers.Authorization !== user.authHeader.Authorization) return false
      const objectUrl = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = objectUrl; link.download = name; link.click()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      return true
    } catch {
      if (headers.Authorization === user.authHeader.Authorization) downloadError.value = t('receiptUpload.downloadError')
      return false
    } finally { isDownloading.value = false }
  }
  return { downloadReceipt, downloadError, isDownloading }
}
