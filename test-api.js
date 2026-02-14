const http = require('http');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'test-upload.csv');
const fileContent = fs.readFileSync(filePath);
const fileName = 'test-upload.csv';

const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);

let body = '';
body += `--${boundary}\r\n`;
body += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
body += `Content-Type: text/csv\r\n\r\n`;

const bodyEnd = `\r\n--${boundary}--\r\n`;

const bodyBuffer = Buffer.concat([
  Buffer.from(body, 'utf8'),
  fileContent,
  Buffer.from(bodyEnd, 'utf8')
]);

const options = {
  hostname: 'localhost',
  port: 8080,
  path: '/api/excel-processor',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': bodyBuffer.length
  }
};

console.log('Testing file upload to /api/excel-processor...');
console.log('File:', fileName, 'Size:', fileContent.length, 'bytes');

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('\nStatus:', res.statusCode);
    try {
      const json = JSON.parse(data);
      console.log('Response:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Raw response:', data.substring(0, 500));
    }
  });
});

req.on('error', e => {
  console.error('Request error:', e.message);
});

req.write(bodyBuffer);
req.end();
