const fs = require('fs');
const path = require('path');

// Function to recursively get all .vue files
function getVueFiles(dir, files = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      getVueFiles(fullPath, files);
    } else if (item.endsWith('.vue')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Extract translation keys from Vue files
function extractKeys(content) {
  const keys = new Set();

  // Match $t('key') or $t("key") or t('key') or t("key")
  const patterns = [
    /\$t\(['"]([^'"]+)['"]/g,
    /\bt\(['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      keys.add(match[1]);
    }
  }

  return keys;
}

// Check if a key exists in locale object
function keyExists(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return false;
    }
    current = current[part];
  }
  return current !== undefined;
}

// Main
const componentsDir = path.join(__dirname, '..', 'components');
const pagesDir = path.join(__dirname, '..', 'pages');
const jaLocalePath = path.join(__dirname, '..', 'i18n', 'locales', 'ja.json');
const koLocalePath = path.join(__dirname, '..', 'i18n', 'locales', 'ko.json');

const allKeys = new Set();

// Get all Vue files
const vueFiles = [...getVueFiles(componentsDir), ...getVueFiles(pagesDir)];

for (const file of vueFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const keys = extractKeys(content);
  keys.forEach(k => allKeys.add(k));
}

console.log(`Found ${allKeys.size} unique translation keys in Vue files\n`);

// Load locales
const jaLocale = JSON.parse(fs.readFileSync(jaLocalePath, 'utf8'));
const koLocale = JSON.parse(fs.readFileSync(koLocalePath, 'utf8'));

// Find missing keys
const missingInJa = [];
const missingInKo = [];

for (const key of allKeys) {
  if (!keyExists(jaLocale, key)) {
    missingInJa.push(key);
  }
  if (!keyExists(koLocale, key)) {
    missingInKo.push(key);
  }
}

console.log(`Missing in Japanese (ja.json): ${missingInJa.length}`);
if (missingInJa.length > 0) {
  missingInJa.sort().forEach(k => console.log(`  - ${k}`));
}

console.log(`\nMissing in Korean (ko.json): ${missingInKo.length}`);
if (missingInKo.length > 0) {
  missingInKo.sort().forEach(k => console.log(`  - ${k}`));
}

if (missingInJa.length === 0 && missingInKo.length === 0) {
  console.log('\n✓ All translation keys are present in both locale files!');
}
