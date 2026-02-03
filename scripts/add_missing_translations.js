const fs = require('fs');

const missingTranslationsJa = {
  "analytics": {
    "change": "変動",
    "customizeDashboard": "ダッシュボードをカスタマイズ",
    "customRange": "カスタム範囲",
    "last30Days": "過去30日間",
    "last7Days": "過去7日間",
    "last90Days": "過去90日間",
    "lastYear": "過去1年間",
    "metric": "指標",
    "recentTrends": "最近のトレンド",
    "resetDefault": "デフォルトにリセット",
    "saveChanges": "変更を保存",
    "selectWidgets": "ウィジェットを選択",
    "transactionsOverTime": "取引推移",
    "trend": "トレンド",
    "value": "値"
  },
  "audit": {
    "backup": "バックアップ",
    "restore": "復元",
    "templates": "テンプレート",
    "update": "更新"
  },
  "budgets": {
    "allCategories": "すべてのカテゴリ"
  },
  "calendar": {
    "clickToAdd": "クリックして追加",
    "markComplete": "完了にする"
  },
  "calendarStats": {
    "expectedExpenses": "予定支出",
    "expectedIncome": "予定収入",
    "overdue": "期限超過",
    "pending": "保留中"
  },
  "categories": {
    "hardware": "ハードウェア",
    "marketing": "マーケティング",
    "office": "オフィス",
    "other": "その他",
    "services": "サービス",
    "software": "ソフトウェア",
    "travel": "旅費"
  },
  "common": {
    "confirmDelete": "本当に削除しますか？",
    "saved": "保存しました",
    "unknown": "不明"
  },
  "dashboard": {
    "actions": "アクション",
    "amount": "金額",
    "date": "日付",
    "source": "ソース",
    "status": "ステータス",
    "transactionId": "取引ID"
  },
  "dataPreview": {
    "allDates": "すべての日付",
    "allRecords": "すべてのレコード",
    "amountRange": "金額範囲",
    "backToMapping": "マッピングに戻る",
    "continueToImport": "インポートに進む",
    "dateRange": "日付範囲",
    "description": "インポート前にデータをプレビューして確認",
    "exportPreview": "プレビューをエクスポート",
    "invalidOnly": "無効のみ",
    "invalidRecords": "無効なレコード",
    "last30Days": "過去30日",
    "last90Days": "過去90日",
    "max": "最大",
    "min": "最小",
    "noRecordsFound": "レコードが見つかりません",
    "refreshPreview": "プレビューを更新",
    "resetFilters": "フィルターをリセット",
    "thisYear": "今年",
    "title": "データプレビュー",
    "totalRecords": "総レコード数",
    "validationWarnings": "検証警告",
    "validOnly": "有効のみ",
    "validRecords": "有効なレコード",
    "warningOnly": "警告のみ",
    "warningRecords": "警告レコード"
  },
  "fieldMapper": {
    "backToUpload": "アップロードに戻る",
    "continueToPreview": "プレビューに進む",
    "dataFormat": "データ形式",
    "description": "ソースフィールドをターゲットフィールドにマッピング",
    "doNotImport": "インポートしない",
    "formatOptions": {
      "address": "住所",
      "currency": "通貨",
      "dateEu": "日付 (EU形式)",
      "dateIso": "日付 (ISO形式)",
      "datetime": "日時",
      "dateUs": "日付 (US形式)",
      "decimal": "小数",
      "email": "メール",
      "number": "数値",
      "percentage": "パーセント",
      "phone": "電話番号",
      "statusCode": "ステータスコード",
      "text": "テキスト"
    },
    "hideSampleData": "サンプルデータを隠す",
    "mapped": "マッピング済み",
    "mapsTo": "マッピング先",
    "needsMapping": "マッピング必要",
    "sampleData": "サンプルデータ",
    "saveAsTemplate": "テンプレートとして保存",
    "saveTemplate": "テンプレートを保存",
    "saveTemplateDescription": "このマッピングをテンプレートとして保存",
    "selectField": "フィールドを選択",
    "selectFile": "ファイルを選択",
    "sourceField": "ソースフィールド",
    "targetFields": {
      "amount": "金額",
      "country": "国",
      "currencyCode": "通貨コード",
      "customerEmail": "顧客メール",
      "customerName": "顧客名",
      "notes": "メモ",
      "orderNumber": "注文番号",
      "paymentMethod": "支払い方法",
      "referenceNumber": "参照番号",
      "transactionDate": "取引日",
      "transactionId": "取引ID",
      "transactionStatus": "取引ステータス"
    },
    "templateName": "テンプレート名",
    "title": "フィールドマッピング",
    "viewSampleData": "サンプルデータを表示"
  },
  "fileUploader": {
    "browseFiles": "ファイルを参照",
    "dragDropExcel": "Excelファイルをドラッグ＆ドロップ",
    "dragDropFile": "ファイルをドラッグ＆ドロップ",
    "errorProcessing": "処理エラー",
    "or": "または",
    "originalFilename": "元のファイル名",
    "originalName": "元の名前",
    "processedAt": "処理日時",
    "processedPath": "処理済みパス",
    "processedSuccess": "処理成功",
    "processingFile": "ファイル処理中",
    "sampleData": "サンプルデータ",
    "savedAs": "保存名",
    "savedAt": "保存日時",
    "selectFile": "ファイルを選択",
    "supportedFormats": "対応形式",
    "uploadExcelFile": "Excelファイルをアップロード"
  },
  "header": {
    "adminUser": "管理者"
  },
  "importConfirmation": {
    "allowDuplicates": "重複を許可",
    "backToPreview": "プレビューに戻る",
    "creditCardFiles": "クレジットカードファイル",
    "dataQuality": "データ品質",
    "duplicates": "重複",
    "emailNotify": "メール通知",
    "emailNotifyDesc": "インポート完了時にメールで通知",
    "excellent": "優秀",
    "fair": "普通",
    "filesToImport": "インポートするファイル",
    "good": "良好",
    "importing": "インポート中",
    "importOptions": "インポートオプション",
    "importSettings": "インポート設定",
    "importSummary": "インポート概要",
    "overseasOrders": "海外注文",
    "paymentGateway": "決済ゲートウェイ",
    "poor": "不良",
    "recordsToImport": "インポートするレコード",
    "saveTemplate": "テンプレートを保存",
    "saveTemplateDesc": "このマッピングをテンプレートとして保存",
    "skipDuplicates": "重複をスキップ",
    "skipDuplicatesDesc": "既存の取引と重複するレコードをスキップ",
    "skipDuplicatesOption": "重複スキップ",
    "sourceType": "ソースタイプ",
    "startImport": "インポート開始",
    "title": "インポート確認",
    "transactionFiles": "取引ファイル",
    "updateMatches": "マッチを更新",
    "updateMatchesDesc": "既存の取引とマッチするレコードを更新"
  },
  "loginPage": {
    "emailPlaceholder": "メールアドレスを入力",
    "help": "ヘルプ",
    "invalidEmail": "有効なメールアドレスを入力してください"
  },
  "notifications": {
    "noNotifications": "通知はありません",
    "title": "通知",
    "viewAll": "すべて表示"
  },
  "paymentModal": {
    "statuses": {
      "completed": "完了"
    }
  },
  "receiptCard": {
    "merchant": "販売店",
    "noReceipt": "領収書なし",
    "receiptInfo": "領収書情報",
    "supportedFormats": "対応形式: JPG, PNG, PDF",
    "title": "領収書",
    "uploadHint": "クリックまたはドラッグしてアップロード",
    "uploadReceipt": "領収書をアップロード",
    "verified": "確認済み",
    "viewFull": "拡大表示"
  },
  "receiptMatchDialog": {
    "confirmMatch": "マッチを確認",
    "description": "この領収書にマッチする取引を選択",
    "highMatchConfidence": "高信頼度マッチ",
    "merchant": "販売店",
    "noMatchingTransactions": "マッチする取引がありません",
    "notDetected": "未検出",
    "receiptDetails": "領収書詳細",
    "receiptPreview": "領収書プレビュー",
    "searchTransactions": "取引を検索",
    "selectedReceipt": "選択した領収書",
    "selectTransaction": "取引を選択",
    "title": "領収書マッチング",
    "unmatched": "未マッチ",
    "viewFullSize": "フルサイズで表示"
  },
  "receiptMatcher": {
    "allDates": "すべての日付",
    "anyAmount": "すべての金額",
    "closeMatch": "近いマッチ",
    "description": "領収書と取引をマッチング",
    "exactMatch": "完全マッチ",
    "finding": "検索中",
    "goodConfidence": "良好な信頼度",
    "highConfidence": "高信頼度",
    "higherThan": "以上",
    "linkTransaction": "取引をリンク",
    "lowerThan": "以下",
    "merchant": "販売店",
    "notDetected": "未検出",
    "noTransactions": "取引がありません",
    "noTransactionsHint": "まず取引をインポートしてください",
    "otherTransactions": "その他の取引",
    "possibleMatchAmount": "可能なマッチ金額",
    "possibleMatchDate": "可能なマッチ日付",
    "receiptInfo": "領収書情報",
    "searchPlaceholder": "取引を検索...",
    "suggestedMatches": "推奨マッチ",
    "title": "領収書マッチャー",
    "transactions": "取引"
  },
  "receiptsList": {
    "adjustFilters": "フィルターを調整",
    "allStatuses": "すべてのステータス",
    "allTypes": "すべてのタイプ",
    "deleteConfirm": "この領収書を削除しますか？",
    "deleteReceipt": "領収書を削除",
    "getStarted": "最初の領収書をアップロード",
    "loading": "読み込み中...",
    "merchantPlaceholder": "販売店名を入力",
    "noReceipts": "領収書がありません",
    "receipts": "領収書",
    "searchPlaceholder": "領収書を検索...",
    "uploadDateRange": "アップロード日範囲"
  },
  "receiptTable": {
    "actions": "アクション",
    "amount": "金額",
    "confirmDelete": "この領収書を削除しますか？",
    "dateUploaded": "アップロード日",
    "match": "マッチ",
    "matched": "マッチ済み",
    "merchant": "販売店",
    "noReceipts": "領収書がありません",
    "receipt": "領収書",
    "status": "ステータス",
    "unmatched": "未マッチ"
  },
  "receiptUpload": {
    "dragAndDrop": "ドラッグ＆ドロップ",
    "dropHere": "ここにドロップ",
    "fileTypes": "ファイル形式",
    "findMatching": "マッチを検索",
    "invalidFileError": "無効なファイル形式",
    "jpgFiles": "JPGファイル",
    "linkWithTransaction": "取引にリンク",
    "matchError": "マッチエラー",
    "matchingTransactions": "マッチする取引",
    "maxSize": "最大サイズ",
    "merchantName": "販売店名",
    "merchantPlaceholder": "販売店名を入力",
    "notesPlaceholder": "メモを入力",
    "orClickBrowse": "またはクリックして参照",
    "pdfFiles": "PDFファイル",
    "pngFiles": "PNGファイル",
    "processError": "処理エラー",
    "receiptDate": "領収書日付",
    "receiptInfo": "領収書情報",
    "reviewInfo": "情報を確認",
    "selectCategory": "カテゴリを選択",
    "selectFileError": "ファイルを選択してください",
    "supportedFormats": "対応形式: JPG, PNG, PDF",
    "tips": {
      "cropDesc": "領収書の重要な部分のみを撮影",
      "cropTitle": "不要な部分をトリミング",
      "imageQuality": "画像品質",
      "imageQualityDesc": "鮮明で読みやすい画像を使用",
      "title": "領収書アップロードのヒント",
      "totalAmount": "合計金額",
      "totalAmountDesc": "合計金額が明確に見えるようにする",
      "transactionDate": "取引日",
      "transactionDateDesc": "日付が読み取れることを確認"
    },
    "uploadButton": "アップロード",
    "uploadError": "アップロードエラー",
    "uploading": "アップロード中",
    "viewTransaction": "取引を表示"
  },
  "recurring": {
    "allFrequencies": "すべての頻度",
    "allStatus": "すべてのステータス",
    "autoGenerate": "自動生成",
    "biweekly": "隔週",
    "categoryPlaceholder": "カテゴリを選択",
    "customerPayee": "顧客/支払先",
    "daily": "毎日",
    "editRecurring": "定期支払いを編集",
    "monthly": "毎月",
    "newRecurring": "新規定期支払い",
    "nextDue": "次回期日",
    "noPayments": "定期支払いがありません",
    "quarterly": "四半期ごと",
    "statusActive": "有効",
    "statusCancelled": "キャンセル",
    "statusCompleted": "完了",
    "statusPaused": "一時停止",
    "upcoming30days": "30日以内に予定",
    "weekly": "毎週",
    "yearly": "毎年"
  },
  "relatedTransactions": {
    "viewAll": "すべて表示"
  },
  "search": {
    "placeholder": "検索..."
  },
  "settingsPage": {
    "addCategory": "カテゴリを追加",
    "backupRestore": "バックアップと復元",
    "categories": "カテゴリ",
    "categoryName": "カテゴリ名",
    "clearExisting": "既存データを削除",
    "darkMode": "ダークモード",
    "darkModeDesc": "ダークテーマを有効にする",
    "dataManagement": "データ管理",
    "defaultCurrency": "デフォルト通貨",
    "defaultCurrencyDesc": "取引のデフォルト通貨",
    "downloadBackup": "バックアップをダウンロード",
    "downloading": "ダウンロード中",
    "exportAllData": "すべてのデータをエクスポート",
    "exportAllDataDesc": "すべてのデータをJSON形式でエクスポート",
    "exportCsv": "CSVエクスポート",
    "exportReceipts": "領収書をエクスポート",
    "exportReceiptsDesc": "すべての領収書をエクスポート",
    "exportTransactions": "取引をエクスポート",
    "exportTransactionsDesc": "すべての取引をCSV形式でエクスポート",
    "multiCurrencyDesc": "複数通貨の取引を有効にする",
    "multiCurrencyMode": "複数通貨モード",
    "noCategories": "カテゴリがありません",
    "notifications": "通知",
    "paymentReminders": "支払いリマインダー",
    "paymentRemindersDesc": "支払い期限前にリマインダーを送信",
    "reminderDays": "リマインダー日数",
    "reminderDaysDesc": "期限の何日前にリマインドするか",
    "restored": "復元しました",
    "restoreData": "データを復元",
    "restoreDesc": "バックアップファイルからデータを復元",
    "restoreFromBackup": "バックアップから復元",
    "restoreOptions": "復元オプション",
    "restoreResult": "復元結果",
    "restoring": "復元中",
    "skipDuplicates": "重複をスキップ",
    "skipped": "スキップ"
  },
  "shipmentInfo": {
    "carrier": "配送業者",
    "estimatedDelivery": "配達予定日",
    "noShipment": "配送情報なし",
    "shipDate": "発送日",
    "title": "配送情報",
    "trackingNumber": "追跡番号"
  },
  "shipmentPage": {
    "actions": "アクション",
    "additionalMessage": "追加メッセージ",
    "additionalNotes": "追加メモ",
    "additionalRecipients": "追加受信者",
    "cancelShipment": "配送をキャンセル",
    "currentLocation": "現在地",
    "customerInfo": "顧客情報",
    "details": "詳細",
    "dimensions": "サイズ",
    "downloadPod": "配達証明をダウンロード",
    "emailSentSuccess": "メール送信成功",
    "emailTracking": "追跡情報をメール",
    "emailTrackingDesc": "顧客に追跡情報をメールで送信",
    "emailTrackingTitle": "追跡情報メール",
    "estimatedDelivery": "配達予定日",
    "etaDelivered": "配達済み",
    "etaOverdue": "遅延",
    "etaToday": "本日配達予定",
    "etaTomorrow": "明日配達予定",
    "includeEta": "配達予定を含める",
    "includeInEmail": "メールに含める",
    "includeOrder": "注文情報を含める",
    "includeTracking": "追跡情報を含める",
    "insurance": "保険",
    "leaveBlankForCustomer": "空白の場合は顧客メールを使用",
    "linkedOrder": "関連注文",
    "locationPlaceholder": "現在地を入力",
    "messagePlaceholder": "メッセージを入力",
    "noInsurance": "保険なし",
    "notesPlaceholder": "メモを入力",
    "notifyCustomer": "顧客に通知",
    "notifyCustomerDesc": "ステータス更新時に顧客にメール通知",
    "noTrackingUrl": "追跡URLなし",
    "packageType": "梱包タイプ",
    "printLabel": "ラベルを印刷",
    "recipientEmail": "受信者メール",
    "sendEmail": "メールを送信",
    "separateEmails": "個別メール送信",
    "serviceType": "サービスタイプ",
    "shippingAddress": "配送先住所",
    "signatureRequired": "署名必要",
    "statusDelayed": "遅延",
    "statusDelivered": "配達済み",
    "statusException": "例外",
    "statusInTransit": "輸送中",
    "statusLabel": "ステータス",
    "statusOutForDelivery": "配達中",
    "statusPending": "保留中",
    "statusProcessing": "処理中",
    "statusUpdated": "ステータス更新済み",
    "statusUpdateSuccess": "ステータス更新成功",
    "timeline": "タイムライン",
    "track": "追跡",
    "trackingNumber": "追跡番号",
    "updateStatus": "ステータスを更新",
    "updateStatusDesc": "配送ステータスを更新",
    "updateStatusTitle": "ステータス更新",
    "viewCustomer": "顧客を表示",
    "viewOrder": "注文を表示",
    "weight": "重量"
  },
  "time": {
    "tomorrow": "明日"
  },
  "transactionForm": {
    "createTitle": "新規取引"
  },
  "transactionImport": {
    "browseFiles": "ファイルを参照",
    "clearAll": "すべてクリア",
    "continueToMapping": "マッピングに進む",
    "creditCardDesc": "クレジットカード明細をインポート",
    "creditCardFiles": "クレジットカードファイル",
    "description": "取引データをインポート",
    "dragDropFiles": "ファイルをドラッグ＆ドロップ",
    "dropFilesHere": "ここにファイルをドロップ",
    "fileSizeError": "ファイルサイズエラー",
    "invalid": "無効",
    "invalidFormatError": "無効なファイル形式",
    "overseasDesc": "海外取引をインポート",
    "overseasTransactions": "海外取引",
    "paymentGateway": "決済ゲートウェイ",
    "paymentGatewayDesc": "決済ゲートウェイからインポート",
    "processing": "処理中",
    "selectedFiles": "選択したファイル",
    "selectSource": "ソースを選択",
    "supportedFormats": "対応形式: CSV, Excel",
    "title": "取引インポート",
    "uploadFiles": "ファイルをアップロード",
    "valid": "有効"
  },
  "transactionItems": {
    "item": "アイテム",
    "price": "価格",
    "quantity": "数量",
    "subtotal": "小計",
    "tax": "税金",
    "title": "取引アイテム",
    "total": "合計"
  },
  "transactionsList": {
    "adjustFilters": "フィルターを調整",
    "advancedFilters": "詳細フィルター",
    "allStatuses": "すべてのステータス",
    "amountRange": "金額範囲",
    "clearFilters": "フィルターをクリア",
    "dateRange": "日付範囲",
    "getStarted": "最初の取引をインポート",
    "hideFilters": "フィルターを隠す",
    "importTransactions": "取引をインポート",
    "loading": "読み込み中...",
    "max": "最大",
    "min": "最小",
    "noTransactions": "取引がありません",
    "searchPlaceholder": "取引を検索...",
    "transactions": "取引"
  },
  "transactionSummary": {
    "amount": "金額",
    "customer": "顧客",
    "paymentMethod": "支払い方法",
    "processedBy": "処理者",
    "source": "ソース",
    "transactionId": "取引ID"
  },
  "upcomingPayments": {
    "noPayments": "予定の支払いはありません",
    "title": "今後の支払い"
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
const jaPath = 'C:/Users/Jun/Documents/ohmyfinance/locales/ja.json';
const jaLocale = JSON.parse(fs.readFileSync(jaPath, 'utf8'));

// Merge missing translations
deepMerge(jaLocale, missingTranslationsJa);

// Write back
fs.writeFileSync(jaPath, JSON.stringify(jaLocale, null, 2), 'utf8');
console.log('Updated ja.json with missing translations');

// Copy to i18n/locales
fs.copyFileSync(jaPath, 'C:/Users/Jun/Documents/ohmyfinance/i18n/locales/ja.json');
console.log('Copied to i18n/locales/ja.json');
