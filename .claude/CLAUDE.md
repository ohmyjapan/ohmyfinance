# OhMyFinance Project Guidelines

## Conversation Startup Protocol

At the start of each conversation, Claude should:

1. **Check if dev server is running** on the configured port (default: 8080)
2. **If not running**, start the dev server with `npm run dev`
3. **Check for port conflicts** - if another project is using the port, note it
4. **Verify frontend loads** - check for HTTP 200 on the root URL
5. **Verify API health** - check a basic API endpoint returns 200

**CRITICAL: ALWAYS use port 8080.** Never switch to another port. If port 8080 is already in use, that means the server is running - just use it. Do NOT restart the server unnecessarily.

```bash
# Quick health check
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
```

If already running and healthy, don't restart. Always report the status to the user.

## Version Control Rules

- Before starting any task, create a new branch from master: `git checkout -b claude/<short-task-description>`
- Commit after every meaningful change with a clear message (don't ask the user for commit messages — write your own descriptive ones)
- Committer name: "Claude Code"
- When the task is complete and confirmed by the user, merge the branch into master:
  - `git checkout master && git merge claude/<branch-name>`
- Never commit directly to master

## Server Restart Rules (CRITICAL)

**NEVER use `taskkill /F /IM node.exe`** - this kills ALL Node processes including other projects, tools, and npm itself.

### When to Restart
- **DO NOT restart** for component, page, or composable changes (HMR handles these)
- **DO restart** only for:
  - `nuxt.config.ts` changes
  - `.env` file changes
  - Server middleware changes
  - When the server is unresponsive (HTTP check fails)
  - When the user explicitly asks

### How to Restart (if truly needed)
```bash
# 1. Find the specific process on port 8080
netstat -ano | findstr :8080 | findstr LISTENING
# Example output: TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    12345

# 2. Kill ONLY that specific PID
taskkill /F /PID 12345

# 3. Start fresh
npm run dev
```

### Default Behavior
Trust HMR. After making code changes, just verify the server is still responding - don't restart it.

## Post-Fix Verification (MANDATORY)

**After EVERY fix is applied**, Claude must automatically:

1. **Check if server is responding** (do NOT restart unless it's down)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
   ```
   If 200, HMR worked - no restart needed.

2. **Frontend visibility test**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
   ```
   Expected: HTTP 200

3. **API endpoint test** (for the affected functionality)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/health
   # Or test the specific endpoint that was fixed
   ```

4. **Check server logs** for errors
   ```bash
   # Read the background task output
   tail -20 <task_output_file>
   ```

5. **Report results** to the user before moving on

Do NOT wait for user to ask - run these checks proactively after each fix.

## Post-Implementation Test Protocol

After completing any significant code changes, always run through this verification protocol:

### 1. Check Server Health (DO NOT restart blindly)
```bash
# Check if server is still responding
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
```

If HTTP 200, the server is fine - HMR handled the changes. Skip to step 2.

**Only if server is unresponsive**, use targeted restart:
```bash
# Find PID on port 8080
for /f "tokens=5" %a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do taskkill /F /PID %a
npm run dev
```

Wait for the server to fully start (look for "Nitro server built" message).

### 2. Frontend Check
```bash
# Verify frontend loads
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
```
Expected: HTTP 200

### 3. API Endpoint Tests

**Note:** On Windows, `curl` has JSON encoding issues. Use Node.js for reliable testing:

```javascript
// Test template - save as test.js and run with: node test.js
const http = require('http');
const data = JSON.stringify({/* your payload */});
const options = {
  hostname: 'localhost',
  port: 3003,
  path: '/api/your-endpoint',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Authorization': 'Bearer YOUR_TOKEN' // if needed
  }
};
const req = http.request(options, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log(res.statusCode, body));
});
req.write(data);
req.end();
```

### 4. Core Functionality Tests

| Test | Endpoint | Expected |
|------|----------|----------|
| Login (invalid) | POST /api/auth/login | 401 |
| Login (valid) | POST /api/auth/login | 200 + tokens |
| Register (weak password) | POST /api/auth/register | 400 + error message |
| Register (valid) | POST /api/auth/register | 200 + user data |
| Rate limiting | 11+ rapid requests to /api/auth/login | 429 on 11th+ |
| 2FA Setup | POST /api/auth/2fa/setup (with auth) | 200 + QR code |

### 5. Check Server Logs

Always check server logs for errors after testing:
```bash
# If running in background, check the output file
cat /path/to/task/output | tail -50
```

Look for:
- MongoDB connection success
- Any error stack traces
- Rate limit activations
- Authentication failures

## Security Implementation Notes

### Token Configuration
- Access token: 15 minutes
- Refresh token: 7 days
- Auto-refresh: 1 minute before expiry

### Rate Limits
- Login: 10 requests/minute
- Register: 5 requests/minute
- 2FA verify: 10 requests/minute
- PIN verify: 10 requests/minute

### Account Lockout
- 5 failed login attempts → 15 minute lockout
- Only applies to existing users (prevents enumeration)

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### Screen Lock
- Default inactivity timeout: 15 minutes
- Force logout after: 8 hours of being locked
- Unlock via: Password or PIN (if enabled)

## Common Issues

### "Invalid JSON body" with curl on Windows
Use Node.js http client instead of curl for JSON POST requests.

### otplib import errors
Use v13 API:
```typescript
import { generateSecret, generateURI, verifySync } from 'otplib'
```
NOT:
```typescript
import { authenticator } from 'otplib' // This doesn't work in v13
```

### Port already in use
If port 8080 is in use, it's probably already running - just use it. Do NOT start another server.
```bash
# Verify it's our server
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/
```
If HTTP 200, you're good. If not responding, then kill the specific process and restart.

### i18n Translations
**Locale files path:** `i18n/locales/ja.json` and `i18n/locales/ko.json`

Always add new translations to the `i18n/locales/` directory.
