/**
 * UTF-8 sanitizer utility for PostgreSQL compatibility
 * Removes or replaces invalid UTF-8 characters while preserving valid Unicode
 */

/**
 * Sanitizes a string for PostgreSQL UTF-8 encoding
 * @param str - The string to sanitize
 * @param replacement - Character to replace invalid bytes with (default: empty string to remove)
 * @returns Sanitized string safe for PostgreSQL
 */
export function sanitizeUtf8(str: string | null | undefined, replacement: string = ''): string {
  if (!str) {
    return '';
  }

  // Convert to string if needed
  const input = String(str);

  // First, try to handle common problematic characters
  // Replace NULL bytes which PostgreSQL doesn't allow
  let sanitized = input.replace(/\x00/g, replacement);

  // Try to detect if the string might be in a different encoding
  // by checking for common Latin-1 characters that cause UTF-8 issues
  const hasHighBytes = /[\x80-\xFF]/.test(sanitized);
  
  if (hasHighBytes) {
    try {
      // Try to re-encode from Latin-1 to UTF-8
      // This handles cases where data comes in as Latin-1 but is treated as UTF-8
      const latin1Buffer = Buffer.from(sanitized, 'latin1');
      const utf8String = latin1Buffer.toString('utf8');
      
      // Verify it's valid UTF-8 now
      Buffer.from(utf8String, 'utf8');
      sanitized = utf8String;
    } catch (error) {
      // If conversion fails, fall back to removing high bytes
      sanitized = sanitized.replace(/[\x80-\xFF]/g, replacement);
    }
  }

  // Handle invalid UTF-8 sequences by encoding and decoding
  try {
    // Convert to buffer and back to properly handle UTF-8
    const buffer = Buffer.from(sanitized, 'utf8');
    sanitized = buffer.toString('utf8');
  } catch (error) {
    // If that fails, do character-by-character sanitization
    sanitized = sanitizeCharByChar(sanitized, replacement);
  }

  // Additional PostgreSQL-specific sanitization
  // Remove any remaining control characters except tab, newline, and carriage return
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, replacement);

  // Ensure no invalid surrogates remain
  sanitized = sanitized.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, replacement);

  // Final validation - ensure the result is valid UTF-8
  try {
    // This will throw if the string contains invalid UTF-8
    Buffer.from(sanitized, 'utf8').toString('utf8');
  } catch (error) {
    // Last resort - remove all non-ASCII characters
    sanitized = sanitized.replace(/[^\x00-\x7F]/g, replacement);
  }

  return sanitized;
}

/**
 * Character-by-character sanitization fallback
 * @param str - String to sanitize
 * @param replacement - Replacement character
 * @returns Sanitized string
 */
function sanitizeCharByChar(str: string, replacement: string): string {
  const chars: string[] = [];
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = char.charCodeAt(0);
    
    // Check if it's a valid UTF-8 character
    if (
      // Basic ASCII
      (code >= 0x20 && code <= 0x7E) ||
      // Tab, newline, carriage return
      code === 0x09 || code === 0x0A || code === 0x0D ||
      // Valid Unicode ranges
      (code >= 0x80 && code <= 0xD7FF) ||
      (code >= 0xE000 && code <= 0xFFFD)
    ) {
      chars.push(char);
    } else if (code >= 0xD800 && code <= 0xDBFF) {
      // High surrogate - check for low surrogate
      if (i + 1 < str.length) {
        const nextCode = str.charCodeAt(i + 1);
        if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
          // Valid surrogate pair
          chars.push(char);
          chars.push(str[i + 1]);
          i++; // Skip the low surrogate
          continue;
        }
      }
      // Invalid surrogate
      chars.push(replacement);
    } else {
      // Replace invalid character
      chars.push(replacement);
    }
  }
  
  return chars.join('');
}

/**
 * Sanitizes an object's string properties for PostgreSQL
 * @param obj - Object to sanitize
 * @param keys - Array of keys to sanitize (optional, sanitizes all strings if not provided)
 * @returns Object with sanitized string properties
 */
export function sanitizeObjectUtf8<T extends Record<string, any>>(
  obj: T,
  keys?: (keyof T)[]
): T {
  const result = { ...obj };
  
  const keysToSanitize = keys || Object.keys(obj);
  
  for (const key of keysToSanitize) {
    const value = result[key as keyof T];
    if (typeof value === 'string') {
      (result as any)[key] = sanitizeUtf8(value);
    }
  }
  
  return result;
}

/**
 * Batch sanitize multiple strings
 * @param strings - Array of strings to sanitize
 * @returns Array of sanitized strings
 */
export function sanitizeUtf8Batch(strings: (string | null | undefined)[]): string[] {
  return strings.map(str => sanitizeUtf8(str));
}

/**
 * Aggressive UTF-8 sanitization for problematic fields
 * Removes all non-ASCII characters and control characters
 * Use this for fields that consistently cause encoding issues
 * @param str - String to sanitize
 * @returns ASCII-only sanitized string
 */
export function sanitizeUtf8Aggressive(str: string | null | undefined): string {
  if (!str) {
    return '';
  }
  
  // Convert to string and remove all non-ASCII characters
  // Keep only printable ASCII (space through tilde) plus tab, newline, carriage return
  return String(str).replace(/[^\x20-\x7E\x09\x0A\x0D]/g, '');
}