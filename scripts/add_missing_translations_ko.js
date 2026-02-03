const fs = require('fs');

const missingTranslationsKo = {
  "analytics": {
    "change": "변화",
    "customizeDashboard": "대시보드 맞춤설정",
    "customRange": "사용자 지정 기간",
    "last30Days": "최근 30일",
    "last7Days": "최근 7일",
    "last90Days": "최근 90일",
    "lastYear": "최근 1년",
    "metric": "지표",
    "recentTrends": "최근 트렌드",
    "resetDefault": "기본값으로 재설정",
    "saveChanges": "변경사항 저장",
    "selectWidgets": "위젯 선택",
    "transactionsOverTime": "시간별 거래",
    "trend": "트렌드",
    "value": "값"
  },
  "audit": {
    "backup": "백업",
    "restore": "복원",
    "templates": "템플릿",
    "update": "업데이트"
  },
  "budgets": {
    "allCategories": "모든 카테고리"
  },
  "calendar": {
    "clickToAdd": "클릭하여 추가",
    "markComplete": "완료 처리"
  },
  "calendarStats": {
    "expectedExpenses": "예정 지출",
    "expectedIncome": "예정 수입",
    "overdue": "연체",
    "pending": "대기중"
  },
  "categories": {
    "hardware": "하드웨어",
    "marketing": "마케팅",
    "office": "사무용품",
    "other": "기타",
    "services": "서비스",
    "software": "소프트웨어",
    "travel": "여비"
  },
  "common": {
    "confirmDelete": "정말 삭제하시겠습니까?",
    "saved": "저장되었습니다",
    "unknown": "알 수 없음"
  },
  "dashboard": {
    "actions": "작업",
    "amount": "금액",
    "date": "날짜",
    "source": "소스",
    "status": "상태",
    "transactionId": "거래 ID"
  },
  "dataPreview": {
    "allDates": "모든 날짜",
    "allRecords": "모든 레코드",
    "amountRange": "금액 범위",
    "backToMapping": "매핑으로 돌아가기",
    "continueToImport": "가져오기 진행",
    "dateRange": "날짜 범위",
    "description": "가져오기 전 데이터 미리보기 및 확인",
    "exportPreview": "미리보기 내보내기",
    "invalidOnly": "유효하지 않은 항목만",
    "invalidRecords": "유효하지 않은 레코드",
    "last30Days": "최근 30일",
    "last90Days": "최근 90일",
    "max": "최대",
    "min": "최소",
    "noRecordsFound": "레코드를 찾을 수 없습니다",
    "refreshPreview": "미리보기 새로고침",
    "resetFilters": "필터 초기화",
    "thisYear": "올해",
    "title": "데이터 미리보기",
    "totalRecords": "총 레코드 수",
    "validationWarnings": "검증 경고",
    "validOnly": "유효한 항목만",
    "validRecords": "유효한 레코드",
    "warningOnly": "경고만",
    "warningRecords": "경고 레코드"
  },
  "fieldMapper": {
    "backToUpload": "업로드로 돌아가기",
    "continueToPreview": "미리보기로 진행",
    "dataFormat": "데이터 형식",
    "description": "소스 필드를 대상 필드에 매핑",
    "doNotImport": "가져오지 않음",
    "formatOptions": {
      "address": "주소",
      "currency": "통화",
      "dateEu": "날짜 (EU 형식)",
      "dateIso": "날짜 (ISO 형식)",
      "datetime": "날짜/시간",
      "dateUs": "날짜 (US 형식)",
      "decimal": "소수",
      "email": "이메일",
      "number": "숫자",
      "percentage": "퍼센트",
      "phone": "전화번호",
      "statusCode": "상태 코드",
      "text": "텍스트"
    },
    "hideSampleData": "샘플 데이터 숨기기",
    "mapped": "매핑됨",
    "mapsTo": "매핑 대상",
    "needsMapping": "매핑 필요",
    "sampleData": "샘플 데이터",
    "saveAsTemplate": "템플릿으로 저장",
    "saveTemplate": "템플릿 저장",
    "saveTemplateDescription": "이 매핑을 템플릿으로 저장",
    "selectField": "필드 선택",
    "selectFile": "파일 선택",
    "sourceField": "소스 필드",
    "targetFields": {
      "amount": "금액",
      "country": "국가",
      "currencyCode": "통화 코드",
      "customerEmail": "고객 이메일",
      "customerName": "고객명",
      "notes": "메모",
      "orderNumber": "주문 번호",
      "paymentMethod": "결제 수단",
      "referenceNumber": "참조 번호",
      "transactionDate": "거래일",
      "transactionId": "거래 ID",
      "transactionStatus": "거래 상태"
    },
    "templateName": "템플릿 이름",
    "title": "필드 매핑",
    "viewSampleData": "샘플 데이터 보기"
  },
  "fileUploader": {
    "browseFiles": "파일 찾아보기",
    "dragDropExcel": "Excel 파일을 드래그 앤 드롭",
    "dragDropFile": "파일을 드래그 앤 드롭",
    "errorProcessing": "처리 오류",
    "or": "또는",
    "originalFilename": "원본 파일명",
    "originalName": "원본 이름",
    "processedAt": "처리 일시",
    "processedPath": "처리된 경로",
    "processedSuccess": "처리 성공",
    "processingFile": "파일 처리 중",
    "sampleData": "샘플 데이터",
    "savedAs": "저장된 이름",
    "savedAt": "저장 일시",
    "selectFile": "파일 선택",
    "supportedFormats": "지원 형식",
    "uploadExcelFile": "Excel 파일 업로드"
  },
  "header": {
    "adminUser": "관리자"
  },
  "importConfirmation": {
    "allowDuplicates": "중복 허용",
    "backToPreview": "미리보기로 돌아가기",
    "creditCardFiles": "신용카드 파일",
    "dataQuality": "데이터 품질",
    "duplicates": "중복",
    "emailNotify": "이메일 알림",
    "emailNotifyDesc": "가져오기 완료 시 이메일로 알림",
    "excellent": "우수",
    "fair": "보통",
    "filesToImport": "가져올 파일",
    "good": "양호",
    "importing": "가져오는 중",
    "importOptions": "가져오기 옵션",
    "importSettings": "가져오기 설정",
    "importSummary": "가져오기 요약",
    "overseasOrders": "해외 주문",
    "paymentGateway": "결제 게이트웨이",
    "poor": "불량",
    "recordsToImport": "가져올 레코드",
    "saveTemplate": "템플릿 저장",
    "saveTemplateDesc": "이 매핑을 템플릿으로 저장",
    "skipDuplicates": "중복 건너뛰기",
    "skipDuplicatesDesc": "기존 거래와 중복되는 레코드 건너뛰기",
    "skipDuplicatesOption": "중복 건너뛰기",
    "sourceType": "소스 유형",
    "startImport": "가져오기 시작",
    "title": "가져오기 확인",
    "transactionFiles": "거래 파일",
    "updateMatches": "일치 항목 업데이트",
    "updateMatchesDesc": "기존 거래와 일치하는 레코드 업데이트"
  },
  "loginPage": {
    "emailPlaceholder": "이메일 주소 입력",
    "help": "도움말",
    "invalidEmail": "유효한 이메일 주소를 입력하세요"
  },
  "notifications": {
    "noNotifications": "알림이 없습니다",
    "title": "알림",
    "viewAll": "모두 보기"
  },
  "paymentModal": {
    "statuses": {
      "completed": "완료"
    }
  },
  "receiptCard": {
    "merchant": "가맹점",
    "noReceipt": "영수증 없음",
    "receiptInfo": "영수증 정보",
    "supportedFormats": "지원 형식: JPG, PNG, PDF",
    "title": "영수증",
    "uploadHint": "클릭 또는 드래그하여 업로드",
    "uploadReceipt": "영수증 업로드",
    "verified": "확인됨",
    "viewFull": "전체 보기"
  },
  "receiptMatchDialog": {
    "confirmMatch": "매칭 확인",
    "description": "이 영수증과 매칭할 거래를 선택하세요",
    "highMatchConfidence": "높은 신뢰도 매칭",
    "merchant": "가맹점",
    "noMatchingTransactions": "매칭되는 거래가 없습니다",
    "notDetected": "감지되지 않음",
    "receiptDetails": "영수증 상세",
    "receiptPreview": "영수증 미리보기",
    "searchTransactions": "거래 검색",
    "selectedReceipt": "선택한 영수증",
    "selectTransaction": "거래 선택",
    "title": "영수증 매칭",
    "unmatched": "미매칭",
    "viewFullSize": "전체 크기로 보기"
  },
  "receiptMatcher": {
    "allDates": "모든 날짜",
    "anyAmount": "모든 금액",
    "closeMatch": "유사 매칭",
    "description": "영수증과 거래 매칭",
    "exactMatch": "정확히 일치",
    "finding": "검색 중",
    "goodConfidence": "양호한 신뢰도",
    "highConfidence": "높은 신뢰도",
    "higherThan": "이상",
    "linkTransaction": "거래 연결",
    "lowerThan": "이하",
    "merchant": "가맹점",
    "notDetected": "감지되지 않음",
    "noTransactions": "거래가 없습니다",
    "noTransactionsHint": "먼저 거래를 가져오세요",
    "otherTransactions": "다른 거래",
    "possibleMatchAmount": "가능한 매칭 금액",
    "possibleMatchDate": "가능한 매칭 날짜",
    "receiptInfo": "영수증 정보",
    "searchPlaceholder": "거래 검색...",
    "suggestedMatches": "추천 매칭",
    "title": "영수증 매처",
    "transactions": "거래"
  },
  "receiptsList": {
    "adjustFilters": "필터 조정",
    "allStatuses": "모든 상태",
    "allTypes": "모든 유형",
    "deleteConfirm": "이 영수증을 삭제하시겠습니까?",
    "deleteReceipt": "영수증 삭제",
    "getStarted": "첫 영수증 업로드하기",
    "loading": "로딩 중...",
    "merchantPlaceholder": "가맹점 이름 입력",
    "noReceipts": "영수증이 없습니다",
    "receipts": "영수증",
    "searchPlaceholder": "영수증 검색...",
    "uploadDateRange": "업로드 날짜 범위"
  },
  "receiptTable": {
    "actions": "작업",
    "amount": "금액",
    "confirmDelete": "이 영수증을 삭제하시겠습니까?",
    "dateUploaded": "업로드 날짜",
    "match": "매칭",
    "matched": "매칭됨",
    "merchant": "가맹점",
    "noReceipts": "영수증이 없습니다",
    "receipt": "영수증",
    "status": "상태",
    "unmatched": "미매칭"
  },
  "receiptUpload": {
    "dragAndDrop": "드래그 앤 드롭",
    "dropHere": "여기에 드롭",
    "fileTypes": "파일 형식",
    "findMatching": "매칭 찾기",
    "invalidFileError": "유효하지 않은 파일 형식",
    "jpgFiles": "JPG 파일",
    "linkWithTransaction": "거래와 연결",
    "matchError": "매칭 오류",
    "matchingTransactions": "매칭되는 거래",
    "maxSize": "최대 크기",
    "merchantName": "가맹점명",
    "merchantPlaceholder": "가맹점 이름 입력",
    "notesPlaceholder": "메모 입력",
    "orClickBrowse": "또는 클릭하여 찾아보기",
    "pdfFiles": "PDF 파일",
    "pngFiles": "PNG 파일",
    "processError": "처리 오류",
    "receiptDate": "영수증 날짜",
    "receiptInfo": "영수증 정보",
    "reviewInfo": "정보 검토",
    "selectCategory": "카테고리 선택",
    "selectFileError": "파일을 선택하세요",
    "supportedFormats": "지원 형식: JPG, PNG, PDF",
    "tips": {
      "cropDesc": "영수증의 중요한 부분만 촬영하세요",
      "cropTitle": "불필요한 부분 제거",
      "imageQuality": "이미지 품질",
      "imageQualityDesc": "선명하고 읽기 쉬운 이미지를 사용하세요",
      "title": "영수증 업로드 팁",
      "totalAmount": "총 금액",
      "totalAmountDesc": "총 금액이 명확하게 보이도록 하세요",
      "transactionDate": "거래일",
      "transactionDateDesc": "날짜가 읽을 수 있는지 확인하세요"
    },
    "uploadButton": "업로드",
    "uploadError": "업로드 오류",
    "uploading": "업로드 중",
    "viewTransaction": "거래 보기"
  },
  "recurring": {
    "allFrequencies": "모든 빈도",
    "allStatus": "모든 상태",
    "autoGenerate": "자동 생성",
    "biweekly": "격주",
    "categoryPlaceholder": "카테고리 선택",
    "customerPayee": "고객/수취인",
    "daily": "매일",
    "editRecurring": "정기 결제 편집",
    "monthly": "매월",
    "newRecurring": "새 정기 결제",
    "nextDue": "다음 기한",
    "noPayments": "정기 결제가 없습니다",
    "quarterly": "분기별",
    "statusActive": "활성",
    "statusCancelled": "취소됨",
    "statusCompleted": "완료됨",
    "statusPaused": "일시중지",
    "upcoming30days": "30일 이내 예정",
    "weekly": "매주",
    "yearly": "매년"
  },
  "relatedTransactions": {
    "viewAll": "모두 보기"
  },
  "search": {
    "placeholder": "검색..."
  },
  "settingsPage": {
    "addCategory": "카테고리 추가",
    "backupRestore": "백업 및 복원",
    "categories": "카테고리",
    "categoryName": "카테고리 이름",
    "clearExisting": "기존 데이터 삭제",
    "darkMode": "다크 모드",
    "darkModeDesc": "다크 테마 활성화",
    "dataManagement": "데이터 관리",
    "defaultCurrency": "기본 통화",
    "defaultCurrencyDesc": "거래의 기본 통화",
    "downloadBackup": "백업 다운로드",
    "downloading": "다운로드 중",
    "exportAllData": "모든 데이터 내보내기",
    "exportAllDataDesc": "모든 데이터를 JSON 형식으로 내보내기",
    "exportCsv": "CSV 내보내기",
    "exportReceipts": "영수증 내보내기",
    "exportReceiptsDesc": "모든 영수증 내보내기",
    "exportTransactions": "거래 내보내기",
    "exportTransactionsDesc": "모든 거래를 CSV 형식으로 내보내기",
    "multiCurrencyDesc": "다중 통화 거래 활성화",
    "multiCurrencyMode": "다중 통화 모드",
    "noCategories": "카테고리가 없습니다",
    "notifications": "알림",
    "paymentReminders": "결제 알림",
    "paymentRemindersDesc": "결제 기한 전에 알림 보내기",
    "reminderDays": "알림 일수",
    "reminderDaysDesc": "기한 며칠 전에 알림을 받을지",
    "restored": "복원되었습니다",
    "restoreData": "데이터 복원",
    "restoreDesc": "백업 파일에서 데이터 복원",
    "restoreFromBackup": "백업에서 복원",
    "restoreOptions": "복원 옵션",
    "restoreResult": "복원 결과",
    "restoring": "복원 중",
    "skipDuplicates": "중복 건너뛰기",
    "skipped": "건너뜀"
  },
  "shipmentInfo": {
    "carrier": "배송업체",
    "estimatedDelivery": "예상 배송일",
    "noShipment": "배송 정보 없음",
    "shipDate": "발송일",
    "title": "배송 정보",
    "trackingNumber": "운송장 번호"
  },
  "shipmentPage": {
    "actions": "작업",
    "additionalMessage": "추가 메시지",
    "additionalNotes": "추가 메모",
    "additionalRecipients": "추가 수신자",
    "cancelShipment": "배송 취소",
    "currentLocation": "현재 위치",
    "customerInfo": "고객 정보",
    "details": "상세",
    "dimensions": "크기",
    "downloadPod": "배송 증명 다운로드",
    "emailSentSuccess": "이메일 발송 성공",
    "emailTracking": "추적 정보 이메일",
    "emailTrackingDesc": "고객에게 추적 정보 이메일 발송",
    "emailTrackingTitle": "추적 정보 이메일",
    "estimatedDelivery": "예상 배송일",
    "etaDelivered": "배송 완료",
    "etaOverdue": "지연",
    "etaToday": "오늘 배송 예정",
    "etaTomorrow": "내일 배송 예정",
    "includeEta": "예상 배송일 포함",
    "includeInEmail": "이메일에 포함",
    "includeOrder": "주문 정보 포함",
    "includeTracking": "추적 정보 포함",
    "insurance": "보험",
    "leaveBlankForCustomer": "비워두면 고객 이메일 사용",
    "linkedOrder": "연결된 주문",
    "locationPlaceholder": "현재 위치 입력",
    "messagePlaceholder": "메시지 입력",
    "noInsurance": "보험 없음",
    "notesPlaceholder": "메모 입력",
    "notifyCustomer": "고객에게 알림",
    "notifyCustomerDesc": "상태 업데이트 시 고객에게 이메일 알림",
    "noTrackingUrl": "추적 URL 없음",
    "packageType": "포장 유형",
    "printLabel": "라벨 인쇄",
    "recipientEmail": "수신자 이메일",
    "sendEmail": "이메일 보내기",
    "separateEmails": "개별 이메일 발송",
    "serviceType": "서비스 유형",
    "shippingAddress": "배송 주소",
    "signatureRequired": "서명 필요",
    "statusDelayed": "지연됨",
    "statusDelivered": "배송 완료",
    "statusException": "예외",
    "statusInTransit": "운송 중",
    "statusLabel": "상태",
    "statusOutForDelivery": "배달 중",
    "statusPending": "대기 중",
    "statusProcessing": "처리 중",
    "statusUpdated": "상태 업데이트됨",
    "statusUpdateSuccess": "상태 업데이트 성공",
    "timeline": "타임라인",
    "track": "추적",
    "trackingNumber": "운송장 번호",
    "updateStatus": "상태 업데이트",
    "updateStatusDesc": "배송 상태 업데이트",
    "updateStatusTitle": "상태 업데이트",
    "viewCustomer": "고객 보기",
    "viewOrder": "주문 보기",
    "weight": "무게"
  },
  "time": {
    "tomorrow": "내일"
  },
  "transactionForm": {
    "createTitle": "새 거래"
  },
  "transactionImport": {
    "browseFiles": "파일 찾아보기",
    "clearAll": "모두 지우기",
    "continueToMapping": "매핑으로 진행",
    "creditCardDesc": "신용카드 명세서 가져오기",
    "creditCardFiles": "신용카드 파일",
    "description": "거래 데이터 가져오기",
    "dragDropFiles": "파일을 드래그 앤 드롭",
    "dropFilesHere": "여기에 파일을 드롭하세요",
    "fileSizeError": "파일 크기 오류",
    "invalid": "유효하지 않음",
    "invalidFormatError": "유효하지 않은 파일 형식",
    "overseasDesc": "해외 거래 가져오기",
    "overseasTransactions": "해외 거래",
    "paymentGateway": "결제 게이트웨이",
    "paymentGatewayDesc": "결제 게이트웨이에서 가져오기",
    "processing": "처리 중",
    "selectedFiles": "선택한 파일",
    "selectSource": "소스 선택",
    "supportedFormats": "지원 형식: CSV, Excel",
    "title": "거래 가져오기",
    "uploadFiles": "파일 업로드",
    "valid": "유효함"
  },
  "transactionItems": {
    "item": "항목",
    "price": "가격",
    "quantity": "수량",
    "subtotal": "소계",
    "tax": "세금",
    "title": "거래 항목",
    "total": "합계"
  },
  "transactionsList": {
    "adjustFilters": "필터 조정",
    "advancedFilters": "고급 필터",
    "allStatuses": "모든 상태",
    "amountRange": "금액 범위",
    "clearFilters": "필터 지우기",
    "dateRange": "날짜 범위",
    "getStarted": "첫 거래 가져오기",
    "hideFilters": "필터 숨기기",
    "importTransactions": "거래 가져오기",
    "loading": "로딩 중...",
    "max": "최대",
    "min": "최소",
    "noTransactions": "거래가 없습니다",
    "searchPlaceholder": "거래 검색...",
    "transactions": "거래"
  },
  "transactionSummary": {
    "amount": "금액",
    "customer": "고객",
    "paymentMethod": "결제 수단",
    "processedBy": "처리자",
    "source": "소스",
    "transactionId": "거래 ID"
  },
  "upcomingPayments": {
    "noPayments": "예정된 결제가 없습니다",
    "title": "예정된 결제"
  }
};

// Deep merge function
function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// Read existing locale file
const koPath = 'C:/Users/Jun/Documents/ohmyfinance/locales/ko.json';
const koLocale = JSON.parse(fs.readFileSync(koPath, 'utf8'));

// Merge missing translations
deepMerge(koLocale, missingTranslationsKo);

// Write back
fs.writeFileSync(koPath, JSON.stringify(koLocale, null, 2), 'utf8');
console.log('Updated ko.json with missing translations');

// Copy to i18n/locales
fs.copyFileSync(koPath, 'C:/Users/Jun/Documents/ohmyfinance/i18n/locales/ko.json');
console.log('Copied to i18n/locales/ko.json');
