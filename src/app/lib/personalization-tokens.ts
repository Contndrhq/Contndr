/**
 * Personalization Token System
 *
 * Supports merge-tag syntax with optional pipe-delimited fallbacks:
 *   {{first_name}}           → lead's first name or empty
 *   {{first_name|there}}     → lead's first name or "there"
 *   {{company|your company}} → lead's company or "your company"
 *
 * Tokens are resolved against a flat Record<string, string> of lead data.
 */

// ── Available tokens ─────────────────────────────────────────────────

export interface TokenDef {
  token: string;       // e.g. "first_name"
  label: string;       // e.g. "First Name"
  example: string;     // e.g. "Jane"
  category: 'contact' | 'company' | 'location' | 'custom';
  defaultFallback: string; // suggested fallback
}

export const TOKEN_DEFS: TokenDef[] = [
  // Contact
  { token: 'first_name',  label: 'First Name',   example: 'Jane',                category: 'contact',  defaultFallback: 'there' },
  { token: 'last_name',   label: 'Last Name',    example: 'Smith',               category: 'contact',  defaultFallback: '' },
  { token: 'full_name',   label: 'Full Name',    example: 'Jane Smith',          category: 'contact',  defaultFallback: '' },
  { token: 'email',       label: 'Email',        example: 'jane@acme.com',       category: 'contact',  defaultFallback: '' },
  { token: 'phone',       label: 'Phone',        example: '+1 555-1234',         category: 'contact',  defaultFallback: '' },
  { token: 'title',       label: 'Job Title',    example: 'VP of Marketing',     category: 'contact',  defaultFallback: '' },
  { token: 'linkedin',    label: 'LinkedIn URL',  example: 'linkedin.com/in/..', category: 'contact',  defaultFallback: '' },

  // Company
  { token: 'company',     label: 'Company',      example: 'Acme Corp',           category: 'company',  defaultFallback: 'your company' },
  { token: 'industry',    label: 'Industry',     example: 'SaaS',                category: 'company',  defaultFallback: 'your industry' },
  { token: 'website',     label: 'Website',      example: 'acme.com',            category: 'company',  defaultFallback: '' },

  // Location
  { token: 'city',        label: 'City',         example: 'San Francisco',       category: 'location', defaultFallback: 'your city' },
  { token: 'state',       label: 'State',        example: 'California',          category: 'location', defaultFallback: '' },
  { token: 'country',     label: 'Country',      example: 'United States',       category: 'location', defaultFallback: '' },

  // Custom / dynamic
  { token: 'unsubscribe_link', label: 'Unsubscribe Link', example: '[unsubscribe]', category: 'custom', defaultFallback: '' },
  { token: 'sender_name',     label: 'Sender Name',      example: 'Or Cohen',      category: 'custom', defaultFallback: '' },
  { token: 'sender_company',  label: 'Sender Company',   example: 'Contndr',       category: 'custom', defaultFallback: '' },
];

export const TOKEN_MAP = new Map(TOKEN_DEFS.map(t => [t.token, t]));

// ── Regex ────────────────────────────────────────────────────────────

// Matches {{token}} or {{token|fallback}} — non-greedy, supports whitespace
const TOKEN_RE = /\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi;

// ── Resolve tokens in a string ──────────────────────────────────────

export function resolveTokens(
  template: string,
  data: Record<string, string | undefined | null>,
  options?: { highlightMissing?: boolean }
): string {
  return template.replace(TOKEN_RE, (_match, token: string, fallback?: string) => {
    const key = token.toLowerCase();
    const value = data[key]?.trim();
    if (value) return value;
    if (fallback !== undefined) return fallback;
    if (options?.highlightMissing) return `[missing: ${key}]`;
    return '';
  });
}

// ── Build a preview string with example data ────────────────────────

export function previewTokens(template: string): string {
  const exampleData: Record<string, string> = {};
  for (const def of TOKEN_DEFS) {
    exampleData[def.token] = def.example;
  }
  return resolveTokens(template, exampleData);
}

// ── Insert a token at cursor position ───────────────────────────────

export function insertToken(
  currentText: string,
  cursorPos: number,
  token: string,
  withFallback?: string
): { text: string; newCursorPos: number } {
  const tag = withFallback ? `{{${token}|${withFallback}}}` : `{{${token}}}`;
  const before = currentText.slice(0, cursorPos);
  const after = currentText.slice(cursorPos);
  return {
    text: before + tag + after,
    newCursorPos: cursorPos + tag.length,
  };
}

// ── Extract all tokens used in a template ───────────────────────────

export function extractTokens(template: string): Array<{ token: string; fallback?: string }> {
  const results: Array<{ token: string; fallback?: string }> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE.source, 'gi');
  while ((match = re.exec(template)) !== null) {
    results.push({ token: match[1].toLowerCase(), fallback: match[2] });
  }
  return results;
}

// ── Validate tokens (check for unknown tokens) ─────────────────────

export function validateTokens(template: string): { valid: boolean; unknown: string[] } {
  const used = extractTokens(template);
  const unknown = used.filter(t => !TOKEN_MAP.has(t.token)).map(t => t.token);
  return { valid: unknown.length === 0, unknown: [...new Set(unknown)] };
}
