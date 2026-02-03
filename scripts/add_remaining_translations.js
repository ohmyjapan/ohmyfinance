const fs = require('fs');

const additionalJa = {
  "calendarGrid": {
    "morePayments": "件以上"
  },
  "dataPreview": {
    "missingEmails": "メールなし",
    "missingStatus": "ステータスなし",
    "outOfRangeDates": "範囲外の日付"
  },
  "fieldMapper": {
    "detectedRows": "検出された行"
  },
  "fileUploader": {
    "uploading": "アップロード中..."
  },
  "importConfirmation": {
    "description": "インポート内容を確認してください",
    "records": "レコード",
    "warningRecords": "警告レコード"
  },
  "receiptMatchDialog": {
    "uploaded": "アップロード日"
  },
  "receiptMatcher": {
    "uploaded": "アップロード日"
  },
  "receiptUpload": {
    "linkingTo": "リンク先",
    "uploadCount": "アップロード数"
  },
  "search": {
    "noResults": "結果が見つかりません",
    "showingResults": "{count}件の結果を表示"
  },
  "settingsPage": {
    "day": "日",
    "days": "日間"
  },
  "shipmentPage": {
    "copiedToClipboard": "クリップボードにコピーしました",
    "createdOn": "作成日",
    "etaInDays": "{days}日後到着予定",
    "orderNumber": "注文番号"
  },
  "transactionImport": {
    "rowCount": "{count}行"
  },
  "transactionSummary": {
    "cardEndingIn": "下4桁",
    "createdOn": "作成日",
    "expires": "有効期限",
    "gatewayId": "ゲートウェイID"
  }
};

const additionalKo = {
  "calendarGrid": {
    "morePayments": "건 이상"
  },
  "dataPreview": {
    "missingEmails": "이메일 없음",
    "missingStatus": "상태 없음",
    "outOfRangeDates": "범위를 벗어난 날짜"
  },
  "fieldMapper": {
    "detectedRows": "감지된 행"
  },
  "fileUploader": {
    "uploading": "업로드 중..."
  },
  "importConfirmation": {
    "description": "가져오기 내용을 확인하세요",
    "records": "레코드",
    "warningRecords": "경고 레코드"
  },
  "receiptMatchDialog": {
    "uploaded": "업로드 날짜"
  },
  "receiptMatcher": {
    "uploaded": "업로드 날짜"
  },
  "receiptUpload": {
    "linkingTo": "연결 대상",
    "uploadCount": "업로드 수"
  },
  "search": {
    "noResults": "결과를 찾을 수 없습니다",
    "showingResults": "{count}개의 결과 표시"
  },
  "settingsPage": {
    "day": "일",
    "days": "일"
  },
  "shipmentPage": {
    "copiedToClipboard": "클립보드에 복사되었습니다",
    "createdOn": "생성일",
    "etaInDays": "{days}일 후 도착 예정",
    "orderNumber": "주문 번호"
  },
  "transactionImport": {
    "rowCount": "{count}행"
  },
  "transactionSummary": {
    "cardEndingIn": "끝자리",
    "createdOn": "생성일",
    "expires": "만료일",
    "gatewayId": "게이트웨이 ID"
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

// Update Japanese
const jaPath = 'C:/Users/Jun/Documents/ohmyfinance/locales/ja.json';
const jaLocale = JSON.parse(fs.readFileSync(jaPath, 'utf8'));
deepMerge(jaLocale, additionalJa);
fs.writeFileSync(jaPath, JSON.stringify(jaLocale, null, 2), 'utf8');
console.log('Updated ja.json');
fs.copyFileSync(jaPath, 'C:/Users/Jun/Documents/ohmyfinance/i18n/locales/ja.json');
console.log('Copied to i18n/locales/ja.json');

// Update Korean
const koPath = 'C:/Users/Jun/Documents/ohmyfinance/locales/ko.json';
const koLocale = JSON.parse(fs.readFileSync(koPath, 'utf8'));
deepMerge(koLocale, additionalKo);
fs.writeFileSync(koPath, JSON.stringify(koLocale, null, 2), 'utf8');
console.log('Updated ko.json');
fs.copyFileSync(koPath, 'C:/Users/Jun/Documents/ohmyfinance/i18n/locales/ko.json');
console.log('Copied to i18n/locales/ko.json');

console.log('\nDone! Added remaining translations.');
