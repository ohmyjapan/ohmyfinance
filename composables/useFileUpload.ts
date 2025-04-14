import { ref, computed } from 'vue'

/**
 * Composable for handling file uploads
 * Manages file selection, validation, and upload state
 */
export function useFileUpload() {
    // State
    const selectedFiles = ref<File[]>([])
    const uploadProgress = ref<number>(0)
    const isUploading = ref<boolean>(false)
    const isDragging = ref<boolean>(false)
    const error = ref<string | null>(null)
    const uploadedFiles = ref<any[]>([])

    // Computed properties
    const hasFiles = computed(() => selectedFiles.value.length > 0)
    const canUpload = computed(() => hasFiles.value && !isUploading.value)

    // Max file size (10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024

    // Supported file types
    const SUPPORTED_TYPES = {
        csv: ['text/csv'],
        excel: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        images: ['image/jpeg', 'image/png'],
        pdf: ['application/pdf'],
        all: [] as string[]
    }

    // Initialize supported types for 'all'
    SUPPORTED_TYPES.all = [
        ...SUPPORTED_TYPES.csv,
        ...SUPPORTED_TYPES.excel,
        ...SUPPORTED_TYPES.images,
        ...SUPPORTED_TYPES.pdf
    ]

    /**
     * Get supported file extensions based on type
     */
    const getSupportedExtensions = (type: keyof typeof SUPPORTED_TYPES = 'all') => {
        switch (type) {
            case 'csv':
                return '.csv'
            case 'excel':
                return '.xls, .xlsx'
            case 'images':
                return '.jpg, .jpeg, .png'
            case 'pdf':
                return '.pdf'
            case 'all':
            default:
                return '.csv, .xls, .xlsx, .jpg, .jpeg, .png, .pdf'
        }
    }

    /**
     * Reset the file upload state
     */
    const resetUpload = () => {
        selectedFiles.value = []
        uploadProgress.value = 0
        isUploading.value = false
        error.value = null
    }

    /**
     * Validate files based on size and type
     */
    const validateFiles = (files: File[], allowedTypes: keyof typeof SUPPORTED_TYPES = 'all') => {
        const supportedTypes = SUPPORTED_TYPES[allowedTypes]
        error.value = null

        // Check if there are files to validate
        if (!files || files.length === 0) {
            error.value = 'No files selected'
            return false
        }

        // Check file types
        const invalidTypeFiles = files.filter(file => {
            // If we're checking specific types
            if (supportedTypes.length > 0) {
                return !supportedTypes.includes(file.type)
            }
            // Otherwise, any file is valid
            return false
        })

        if (invalidTypeFiles.length > 0) {
            error.value = `Some files have invalid formats. Please upload only ${getSupportedExtensions(allowedTypes)} files.`
            return false
        }

        // Check file sizes
        const oversizedFiles = files.filter(file => file.size > MAX_FILE_SIZE)

        if (oversizedFiles.length > 0) {
            error.value = 'Some files exceed the 10MB size limit.'
            return false
        }

        return true
    }

    /**
     * Handle file selection from input
     */
    const handleFileInput = (event: Event, allowedTypes: keyof typeof SUPPORTED_TYPES = 'all') => {
        const input = event.target as HTMLInputElement
        const files = Array.from(input.files || [])

        if (validateFiles(files, allowedTypes)) {
            selectedFiles.value = files
        }

        // Reset the input so the same file can be uploaded again if needed
        input.value = ''
    }

    /**
     * Handle file drop
     */
    const handleFileDrop = (event: DragEvent, allowedTypes: keyof typeof SUPPORTED_TYPES = 'all') => {
        isDragging.value = false
        event.preventDefault()

        if (!event.dataTransfer) return

        const files = Array.from(event.dataTransfer.files)

        if (validateFiles(files, allowedTypes)) {
            selectedFiles.value = files
        }
    }

    /**
     * Remove a file from the selection
     */
    const removeFile = (index: number) => {
        selectedFiles.value = selectedFiles.value.filter((_, i) => i !== index)
    }

    /**
     * Get file type from filename
     */
    const getFileType = (filename: string) => {
        const extension = filename.split('.').pop()?.toLowerCase() || ''

        switch (extension) {
            case 'csv':
                return 'CSV'
            case 'xls':
                return 'Excel (XLS)'
            case 'xlsx':
                return 'Excel (XLSX)'
            case 'jpg':
            case 'jpeg':
                return 'Image (JPEG)'
            case 'png':
                return 'Image (PNG)'
            case 'pdf':
                return 'PDF'
            default:
                return 'Unknown'
        }
    }

    /**
     * Format file size for display
     */
    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) {
            return bytes + ' B'
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(1) + ' KB'
        } else {
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
        }
    }

    /**
     * Upload files to the server
     */
    const uploadFiles = async (endpoint: string, additionalData?: Record<string, any>) => {
        if (selectedFiles.value.length === 0) {
            error.value = 'No files selected for upload'
            return null
        }

        isUploading.value = true
        uploadProgress.value = 0
        error.value = null

        try {
            const formData = new FormData()

            // Append files to form data
            selectedFiles.value.forEach((file, index) => {
                formData.append(`file${index}`, file)
            })

            // Append additional data if provided
            if (additionalData) {
                Object.entries(additionalData).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        formData.append(key, String(value))
                    }
                })
            }

            // Set up upload with progress tracking
            const xhr = new XMLHttpRequest()

            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    uploadProgress.value = Math.round((event.loaded / event.total) * 100)
                }
            })

            // Return a promise that resolves when the upload is complete
            return new Promise((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            const response = JSON.parse(xhr.responseText)
                            uploadedFiles.value.push(...response.files || [])
                            resolve(response)
                        } catch (e) {
                            resolve({ success: true, message: 'Files uploaded successfully' })
                        }
                    } else {
                        try {
                            const errorResponse = JSON.parse(xhr.responseText)
                            error.value = errorResponse.message || 'Upload failed'
                        } catch (e) {
                            error.value = 'Upload failed'
                        }
                        reject(new Error(error.value))
                    }
                    isUploading.value = false
                }

                xhr.onerror = () => {
                    error.value = 'Network error occurred during upload'
                    isUploading.value = false
                    reject(new Error(error.value))
                }

                xhr.open('POST', endpoint, true)
                xhr.send(formData)
            })
        } catch (err: any) {
            error.value = err.message || 'An unexpected error occurred'
            isUploading.value = false
            return null
        }
    }

    // For simulated uploads (development/testing)
    const simulateUpload = async () => {
        if (selectedFiles.value.length === 0) {
            error.value = 'No files selected for upload'
            return null
        }

        isUploading.value = true
        uploadProgress.value = 0
        error.value = null

        // Simulate upload progress
        const interval = setInterval(() => {
            uploadProgress.value += 10
            if (uploadProgress.value >= 100) {
                clearInterval(interval)
                isUploading.value = false

                // Add simulated processed files
                const processedFiles = selectedFiles.value.map(file => ({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    uploadedAt: new Date().toISOString(),
                    url: URL.createObjectURL(file), // Create a temporary URL for preview
                    processingStatus: 'completed'
                }))

                uploadedFiles.value.push(...processedFiles)
            }
        }, 300)

        // Wait for the simulation to complete
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({
                    success: true,
                    files: selectedFiles.value.map(file => ({
                        name: file.name,
                        size: file.size,
                        type: file.type
                    }))
                })
            }, 3000)
        })
    }

    return {
        // State
        selectedFiles,
        uploadProgress,
        isUploading,
        isDragging,
        error,
        uploadedFiles,

        // Computed
        hasFiles,
        canUpload,

        // Constants
        MAX_FILE_SIZE,
        SUPPORTED_TYPES,

        // Methods
        resetUpload,
        validateFiles,
        handleFileInput,
        handleFileDrop,
        removeFile,
        getFileType,
        formatFileSize,
        uploadFiles,
        simulateUpload,
        getSupportedExtensions
    }
}