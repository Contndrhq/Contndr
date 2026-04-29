// ─── Shared Number & Currency Formatting ─────────────────────────────
// Use these everywhere to ensure consistent, professional number display.

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const currencyFormatterCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-US');

/**
 * Format a dollar amount (whole dollars) — e.g. $1,000,000
 */
export function fmtUSD(value: number): string {
  return currencyFormatter.format(value);
}

/**
 * Format a dollar amount with cents — e.g. $1,234.56
 */
export function fmtUSDCents(value: number): string {
  return currencyFormatterCents.format(value);
}

/**
 * Format cents (Stripe-style) to dollars with cents — e.g. 100000 => $1,000.00
 */
export function fmtCentsToUSD(cents: number): string {
  return currencyFormatterCents.format(cents / 100);
}

/**
 * Compact currency — e.g. $1.2M, $45.3K, $900
 */
export function fmtCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return currencyFormatter.format(value);
}

/**
 * Format a plain number with commas — e.g. 1,234,567
 */
export function fmtNum(value: number): string {
  return numberFormatter.format(value);
}

/**
 * Format a percentage — e.g. 45.3%
 */
export function fmtPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}
