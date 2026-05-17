/**
 * Email body rendering utilities.
 *
 * Incoming replies arrive in two flavors:
 *   - HTML (Gmail/Outlook multipart) — usually preferred for fidelity
 *   - Plain text — fallback when no HTML part exists
 *
 * Until now the inbox rendered ONLY the plain `body` field via
 * `whitespace-pre-wrap`. That made HTML-only senders show as ugly raw
 * text with collapsed lists, lost paragraph breaks, and stray entities.
 *
 * This module:
 *  1. Picks the best representation (htmlBody if present, plain otherwise)
 *  2. Sanitizes HTML to a safe subset (no scripts, no event handlers,
 *     no remote stylesheets, no iframes)
 *  3. Separates the FRESH content from the QUOTED previous-message
 *     thread (everything below "On <date>, X wrote:" or `>` prefixes),
 *     so the UI can collapse the quoted block behind a toggle.
 *  4. Normalizes plain text into safe HTML (links auto-linked,
 *     paragraphs preserved, blockquotes for > prefixes).
 */

import { decodeHtmlEntities } from './html-decode';

/** Markers that typically begin a quoted reply tail. */
const QUOTE_HEADER_PATTERNS: RegExp[] = [
  // Gmail / generic: "On Mon, Jan 1, 2026 at 9:00 AM, Foo <foo@bar.com> wrote:"
  /^[ \s>]*On\s.{5,150}\s+wrote:\s*$/im,
  // Outlook: "From: ... Sent: ... To: ... Subject:"
  /^[ \s>]*From:\s.{1,200}$/im,
  // Apple Mail / generic: "Begin forwarded message:"
  /^[ \s>]*Begin forwarded message:\s*$/im,
  // Generic divider lines
  /^[ \s>]*-{3,}\s*Original Message\s*-{3,}\s*$/im,
];

/** Splits a plain-text body into { fresh, quoted }. */
export function splitQuotedPlain(text: string): { fresh: string; quoted: string } {
  if (!text) return { fresh: '', quoted: '' };

  // 1) Header patterns
  let cutIndex = -1;
  for (const re of QUOTE_HEADER_PATTERNS) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      if (cutIndex === -1 || m.index < cutIndex) cutIndex = m.index;
    }
  }

  // 2) Bare `>` quoted block: look for the first run of >=2 consecutive
  //    lines starting with `>` and cut from the line ABOVE if that line
  //    looks like an attribution.
  if (cutIndex === -1) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\s*>/.test(lines[i]) && /^\s*>/.test(lines[i + 1])) {
        // Walk back over blank lines + one optional attribution line
        let start = i;
        while (start > 0 && lines[start - 1].trim() === '') start--;
        cutIndex = lines.slice(0, start).join('\n').length;
        break;
      }
    }
  }

  if (cutIndex <= 0) return { fresh: text.trim(), quoted: '' };

  return {
    fresh: text.slice(0, cutIndex).trim(),
    quoted: text.slice(cutIndex).trim(),
  };
}

/** Splits an HTML body into { fresh, quoted } by finding common
 *  quote containers Gmail/Outlook produce. */
export function splitQuotedHtml(html: string): { fresh: string; quoted: string } {
  if (!html) return { fresh: '', quoted: '' };

  // Gmail wraps quoted replies in <div class="gmail_quote"> ... </div>
  // Outlook uses <div id="appendonsend"> / <blockquote type="cite">
  // Apple Mail uses <blockquote type="cite">
  const markers = [
    /<div[^>]*class="?gmail_quote"?[^>]*>/i,
    /<div[^>]*id="?appendonsend"?[^>]*>/i,
    /<div[^>]*id="?divRplyFwdMsg"?[^>]*>/i,
    /<blockquote[^>]*type="?cite"?[^>]*>/i,
    /<div[^>]*class="?yahoo_quoted"?[^>]*>/i,
    /<hr[^>]*id="?stopSpelling"?[^>]*>/i,
  ];

  let cut = -1;
  for (const re of markers) {
    const m = html.match(re);
    if (m && m.index !== undefined) {
      if (cut === -1 || m.index < cut) cut = m.index;
    }
  }

  if (cut <= 0) return { fresh: html, quoted: '' };

  return {
    fresh: html.slice(0, cut),
    quoted: html.slice(cut),
  };
}

/**
 * Sanitize HTML to a safe subset. NOT a security boundary — the
 * server should also strip dangerous content — but a defense-in-depth
 * layer that removes the obvious attack vectors so we can render
 * incoming email HTML without `dangerouslySetInnerHTML` worrying us.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  let out = html;

  // Strip <script>, <style>, <iframe>, <object>, <embed>, <link>, <meta>
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  // Strip self-closing dangerous tags
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input|button|textarea|select)\b[^>]*\/?\s*>/gi, '');

  // Strip ALL on* event handlers (onclick, onerror, onload, etc.)
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // Strip javascript:, data:, vbscript: URLs in href/src
  out = out.replace(/(href|src)\s*=\s*"(\s*(?:javascript|data|vbscript):[^"]*)"/gi, '$1="#"');
  out = out.replace(/(href|src)\s*=\s*'(\s*(?:javascript|data|vbscript):[^']*)'/gi, "$1='#'");

  // Force all links to open in new tab safely
  out = out.replace(/<a\b([^>]*)>/gi, (_m, attrs) => {
    let a = attrs as string;
    if (!/target\s*=/i.test(a)) a += ' target="_blank"';
    if (!/rel\s*=/i.test(a)) a += ' rel="noopener noreferrer"';
    return `<a${a}>`;
  });

  return out;
}

/** Turn plain text into safe HTML: escape, linkify, preserve paragraphs. */
export function plainToSafeHtml(text: string): string {
  if (!text) return '';

  // Escape HTML
  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Linkify URLs
  safe = safe.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Linkify bare emails
  safe = safe.replace(
    /(\b[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}\b)/g,
    '<a href="mailto:$1">$1</a>'
  );

  // Preserve paragraphs (double newline) and line breaks (single newline)
  const paragraphs = safe.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * Top-level: take a message and return ready-to-render { freshHtml, quotedHtml }.
 * Prefers HTML body when available, falls back to formatted plain text.
 */
export function renderEmailBody(opts: {
  body?: string | null;
  htmlBody?: string | null;
}): { freshHtml: string; quotedHtml: string; hasQuoted: boolean } {
  const { body, htmlBody } = opts;

  if (htmlBody && htmlBody.trim()) {
    const { fresh, quoted } = splitQuotedHtml(htmlBody);
    return {
      freshHtml: sanitizeEmailHtml(fresh),
      quotedHtml: sanitizeEmailHtml(quoted),
      hasQuoted: !!quoted,
    };
  }

  const text = decodeHtmlEntities(body || '');
  const { fresh, quoted } = splitQuotedPlain(text);
  return {
    freshHtml: plainToSafeHtml(fresh),
    quotedHtml: plainToSafeHtml(quoted),
    hasQuoted: !!quoted,
  };
}
