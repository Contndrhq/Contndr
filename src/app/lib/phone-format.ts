/**
 * International phone number formatting utility.
 * Formats raw digit strings and partially formatted numbers into
 * a consistent international display format.
 */

/**
 * Strip everything except digits and leading +
 */
function stripPhone(raw: string): string {
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Format a phone number for display in international format.
 * - 10-digit US numbers → +1 (XXX) XXX-XXXX
 * - 11-digit starting with 1 → +1 (XXX) XXX-XXXX
 * - Other lengths → +{country code} grouped digits
 * Returns the original string if it can't be parsed.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  
  const cleaned = stripPhone(phone.trim());
  if (!cleaned) return phone;

  // Extract digits (remove leading +)
  let digits = cleaned.replace(/^\+/, '');
  
  // US/Canada: 10 digits or 11 starting with 1
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const mid = digits.slice(3, 6);
    const last = digits.slice(6);
    return `+1 (${area}) ${mid}-${last}`;
  }
  
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const mid = digits.slice(4, 7);
    const last = digits.slice(7);
    return `+1 (${area}) ${mid}-${last}`;
  }
  
  // UK: 44 + 10 digits
  if (digits.length >= 11 && digits.startsWith('44')) {
    const rest = digits.slice(2);
    // Group as +44 XXXX XXX XXX
    return `+44 ${rest.slice(0, 4)} ${rest.slice(4, 7)} ${rest.slice(7)}`.trim();
  }
  
  // Israel: 972 + 9 digits
  if (digits.startsWith('972')) {
    const rest = digits.slice(3);
    return `+972 ${rest.slice(0, 2)}-${rest.slice(2, 5)}-${rest.slice(5)}`.trim();
  }
  
  // Generic international: +CC XXXX XXXX...
  if (digits.length > 10) {
    // Try to identify country code (1-3 digits)
    // Group remaining digits in blocks of 3-4
    let cc = '';
    let rest = '';
    if (digits.startsWith('1')) {
      cc = '1';
      rest = digits.slice(1);
    } else if (['20','27','30','31','32','33','34','36','39','40','41','43','45','46','47','48','49','51','52','53','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98'].includes(digits.slice(0, 2))) {
      cc = digits.slice(0, 2);
      rest = digits.slice(2);
    } else if (digits.length >= 3) {
      cc = digits.slice(0, 3);
      rest = digits.slice(3);
    }
    
    if (cc && rest) {
      // Group in chunks of 3-4
      const groups: string[] = [];
      for (let i = 0; i < rest.length; i += 4) {
        groups.push(rest.slice(i, i + 4));
      }
      return `+${cc} ${groups.join(' ')}`.trim();
    }
  }
  
  // Short numbers or already formatted — just ensure + prefix if digits only
  if (/^\d+$/.test(cleaned) && digits.length >= 7) {
    return `+${digits}`;
  }
  
  // Fallback: return original
  return phone;
}

/**
 * Format phone number as the user types (for input fields).
 * Formats US numbers progressively: +1 (XXX) XXX-XXXX
 * Returns the formatted string for display in the input.
 */
export function formatPhoneInput(value: string): string {
  // If the value already has our "+1" prefix, strip it first so the
  // country-code "1" doesn't get counted as part of the area code.
  let raw = value;
  if (raw.startsWith('+1')) {
    raw = raw.slice(2);
  }

  // Strip to digits only
  let digits = raw.replace(/\D/g, '');

  if (!digits) return '';

  // Handle pasted 11-digit numbers with leading country code 1
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  // Take only first 10 digits (US number without country code)
  const d = digits.slice(0, 10);

  // Format progressively as user types
  if (d.length <= 3) {
    return `+1 (${d}`;
  }
  if (d.length <= 6) {
    return `+1 (${d.slice(0, 3)}) ${d.slice(3)}`;
  }
  return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Extract raw digits from a formatted phone string (for storage/API calls).
 */
export function phoneToDigits(formatted: string): string {
  return formatted.replace(/\D/g, '');
}