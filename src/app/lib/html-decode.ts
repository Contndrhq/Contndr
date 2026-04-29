/**
 * Decode HTML entities in a string
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  
  // Create a temporary element to leverage browser's HTML decoding
  // Use textContent instead of innerHTML to preserve newlines
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }
  
  // Fallback for SSR or environments without DOM
  return decodeHtmlEntitiesManual(text);
}

/**
 * Manual HTML entity decoder (fallback for SSR)
 */
function decodeHtmlEntitiesManual(text: string): string {
  if (!text) return '';
  
  let decoded = text;
  
  // Decode common named HTML entities
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&apos;': "'",
    '&ldquo;': '\u201C',
    '&rdquo;': '\u201D',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019',
    '&ndash;': '\u2013',
    '&mdash;': '\u2014',
    '&hellip;': '\u2026',
    '&copy;': '\u00A9',
    '&reg;': '\u00AE',
    '&trade;': '\u2122',
    '&cent;': '\u00A2',
    '&pound;': '\u00A3',
    '&yen;': '\u00A5',
    '&euro;': '\u20AC',
  };
  
  // Replace named entities
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }
  
  // Decode numeric HTML entities (&#xxx; and &#xXX;)
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
    return String.fromCharCode(parseInt(dec, 10));
  });
  
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  
  return decoded;
}

/**
 * Strip HTML tags and decode entities
 */
export function stripHtmlAndDecode(html: string): string {
  if (!html) return '';

  let text = html
    // Block-level opening tags → newline (div, p, li, tr, headings)
    .replace(/<(div|p|li|tr|h[1-6])[^>]*>/gi, '\n')
    // Block-level closing tags that warrant double newlines
    .replace(/<\/(p|h[1-6])>/gi, '\n')
    // <br> variants → newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove all remaining tags with empty string (not a space)
    .replace(/<[^>]*>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Normalize line endings (\r\n and \r → \n)
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Clean up whitespace
  text = text
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ')      // Collapse multiple spaces/tabs
    .replace(/\n[ \t]+/g, '\n')   // Trim leading spaces on each line
    .replace(/[ \t]+\n/g, '\n')   // Trim trailing spaces on each line
    .trim();

  return text;
}