// server/utils/passwordValidator.ts

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
  strength: 'weak' | 'fair' | 'good' | 'strong'
}

export interface PasswordRequirements {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecial: boolean
}

const defaultRequirements: PasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true
}

/**
 * Validate password against security requirements
 */
export function validatePassword(
  password: string,
  requirements: Partial<PasswordRequirements> = {}
): PasswordValidationResult {
  const reqs = { ...defaultRequirements, ...requirements }
  const errors: string[] = []
  let strengthScore = 0

  // Check minimum length
  if (password.length < reqs.minLength) {
    errors.push(`Password must be at least ${reqs.minLength} characters long`)
  } else {
    strengthScore++
    if (password.length >= 12) strengthScore++
    if (password.length >= 16) strengthScore++
  }

  // Check for uppercase letter
  if (reqs.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  } else if (/[A-Z]/.test(password)) {
    strengthScore++
  }

  // Check for lowercase letter
  if (reqs.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  } else if (/[a-z]/.test(password)) {
    strengthScore++
  }

  // Check for number
  if (reqs.requireNumber && !/\d/.test(password)) {
    errors.push('Password must contain at least one number')
  } else if (/\d/.test(password)) {
    strengthScore++
  }

  // Check for special character
  if (reqs.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{};\':"|,.<>/?)')
  } else if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    strengthScore++
  }

  // Check for common patterns (optional - doesn't fail validation but affects strength)
  const commonPatterns = [
    /^123/,
    /password/i,
    /qwerty/i,
    /abc123/i,
    /letmein/i,
    /welcome/i
  ]

  const hasCommonPattern = commonPatterns.some(pattern => pattern.test(password))
  if (hasCommonPattern) {
    strengthScore = Math.max(0, strengthScore - 2)
  }

  // Determine strength
  let strength: 'weak' | 'fair' | 'good' | 'strong'
  if (strengthScore <= 2) {
    strength = 'weak'
  } else if (strengthScore <= 4) {
    strength = 'fair'
  } else if (strengthScore <= 6) {
    strength = 'good'
  } else {
    strength = 'strong'
  }

  return {
    valid: errors.length === 0,
    errors,
    strength
  }
}

/**
 * Check if password is commonly used
 */
export function isCommonPassword(password: string): boolean {
  const commonPasswords = [
    'password', 'password1', 'password123', '123456', '12345678',
    'qwerty', 'qwerty123', 'letmein', 'welcome', 'admin',
    'login', 'pass', 'test', 'guest', 'master',
    'hello', 'dragon', 'baseball', 'iloveyou', 'trustno1',
    'sunshine', 'princess', 'football', 'shadow', 'superman',
    'michael', 'jennifer', 'hunter', 'batman', 'andrew'
  ]

  return commonPasswords.includes(password.toLowerCase())
}

/**
 * Generate password requirements message
 */
export function getPasswordRequirementsMessage(requirements: Partial<PasswordRequirements> = {}): string {
  const reqs = { ...defaultRequirements, ...requirements }
  const parts: string[] = []

  parts.push(`at least ${reqs.minLength} characters`)

  if (reqs.requireUppercase) {
    parts.push('one uppercase letter')
  }

  if (reqs.requireLowercase) {
    parts.push('one lowercase letter')
  }

  if (reqs.requireNumber) {
    parts.push('one number')
  }

  if (reqs.requireSpecial) {
    parts.push('one special character')
  }

  if (parts.length <= 2) {
    return `Password must have ${parts.join(' and ')}.`
  }

  const lastPart = parts.pop()
  return `Password must have ${parts.join(', ')}, and ${lastPart}.`
}
