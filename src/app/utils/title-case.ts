/**
 * Title Case utility — capitalizes the first letter of each word.
 * Handles industry names, city names, and other professional text.
 * 
 * Examples:
 *   "software company"      → "Software Company"
 *   "real estate agency"    → "Real Estate Agency"
 *   "french restaurant"     → "French Restaurant"
 *   "business development"  → "Business Development"
 *   "N/A"                   → "N/A"
 *   ""                      → ""
 */

// Small words that should stay lowercase (unless they are the first word)
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in',
  'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'via',
]);

// Words that should stay uppercase
const UPPER_WORDS = new Set([
  'llc', 'inc', 'co', 'usa', 'uk', 'uae', 'eu', 'nyc', 'la', 'dc',
  'it', 'ai', 'hr', 'pr', 'crm', 'saas', 'b2b', 'b2c', 'roi', 'seo',
  'api', 'iot', 'ceo', 'cfo', 'cto', 'cmo', 'coo', 'cro', 'cio', 'cso',
  'vp', 'svp', 'evp', 'avp', 'gm', 'md', 'dba', 'mba', 'phd', 'esq',
  'rn', 'lp', 'plc', 'pe', 'dds', 'dvm', 'pa', 'np', 'cpa', 'jd',
]);

export function toTitleCase(str: string | null | undefined): string {
  if (!str || typeof str !== 'string') return '';
  
  // Already looks like an abbreviation or special format
  if (str === str.toUpperCase() && str.length <= 5) return str;

  return str
    .toLowerCase()
    .split(/(\s+|-|\/|&)/) // Split on spaces, hyphens, slashes, ampersands but keep delimiters
    .map((word, index, arr) => {
      // Keep delimiters as-is
      if (/^(\s+|-|\/|&)$/.test(word)) return word;
      
      const lower = word.toLowerCase();
      
      // Known uppercase acronyms
      if (UPPER_WORDS.has(lower)) return word.toUpperCase();
      
      // Small words stay lowercase unless they're first or after a delimiter
      if (index > 0 && SMALL_WORDS.has(lower)) {
        // Check if previous token was just whitespace (not start of string)
        const prevIdx = index - 1;
        if (prevIdx >= 0 && /^\s+$/.test(arr[prevIdx])) {
          return lower;
        }
      }
      
      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('');
}

/**
 * Title-case multiple fields on a lead object.
 * Mutates in-place for performance. Returns the same object.
 */
export function titleCaseLeadFields<T extends Record<string, any>>(lead: T): T {
  const fieldsToTitleCase = ['category', 'industry', 'city', 'state', 'country'];
  for (const field of fieldsToTitleCase) {
    if (lead[field] && typeof lead[field] === 'string') {
      (lead as any)[field] = toTitleCase(lead[field]);
    }
  }
  return lead;
}
