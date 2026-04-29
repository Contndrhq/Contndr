// ══════════════════════════════════════════════════════════════
// Client-side translation mapper for server-sent SSE messages
// Maps hardcoded English phase names and activity messages from
// the server to i18n translation keys for display in all languages.
// ══════════════════════════════════════════════════════════════

import type { TFunction } from 'react-i18next';

// ── Phase name mappings (English server string → i18n key) ──
const PHASE_MAP: [RegExp, string][] = [
  [/^Searching local database$/i, 'apolloProSearch.phaseSearchingLocalDb'],
  [/^Discovering professional profiles$/i, 'apolloProSearch.phaseDiscoveringProfiles'],
  [/^Verifying company data/i, 'apolloProSearch.phaseVerifyingCompanyData'],
  [/^Resolving company domains/i, 'apolloProSearch.phaseResolvingDomains'],
  [/^Building lead profiles/i, 'apolloProSearch.phaseBuildingProfiles'],
  [/^Finding email addresses/i, 'apolloProSearch.phaseFindingEmails'],
  [/^Advanced email search/i, 'apolloProSearch.phaseAdvancedEmailSearch'],
  [/^Deep email search/i, 'apolloProSearch.phaseDeepEmailSearch'],
  [/^Enriching company data/i, 'apolloProSearch.phaseEnrichingCompanyData'],
  [/^Verifying deliverability/i, 'apolloProSearch.phaseVerifyingDeliverability'],
  [/^Cache hit/i, 'apolloProSearch.phaseCacheHit'],
  [/^CRM dedup check$/i, 'apolloProSearch.phaseCrmDedupCheck'],
  [/^Enriching contacts$/i, 'apolloProSearch.phaseEnrichingContacts'],
  [/^External search$/i, 'apolloProSearch.phaseExternalSearch'],
  [/^Revealing \d+ contacts$/i, 'apolloProSearch.phaseRevealingContacts'],
  [/^Collecting phone data/i, 'apolloProSearch.phaseCollectingPhones'],
  [/^Verifying emails/i, 'apolloProSearch.phaseVerifyingEmails'],
  [/^Finding phone numbers/i, 'apolloProSearch.phaseFindingPhones'],
  [/^Deep phone discovery/i, 'apolloProSearch.phaseDeepPhoneDiscovery'],
  [/^Verifying phone numbers/i, 'apolloProSearch.phaseVerifyingPhoneNumbers'],
  [/^Saving to database$/i, 'apolloProSearch.phaseSavingToDatabase'],
  // CompanySearch bulk find phases
  [/^Profile Search$/i, 'apolloProSearch.phaseProfileSearch'],
  [/^Contact Discovery$/i, 'apolloProSearch.phaseContactDiscovery'],
  [/^Email Enrichment$/i, 'apolloProSearch.phaseEmailEnrichment'],
  [/^Finalizing$/i, 'apolloProSearch.phaseFinalizing'],
];

// ── Activity message mappings (English pattern → i18n key + param extractor) ──
interface ActivityMapping {
  pattern: RegExp;
  key: string;
  extract?: (match: RegExpMatchArray) => Record<string, string>;
}

const ACTIVITY_MAP: ActivityMapping[] = [
  {
    pattern: /^Checking CRM and local network for existing matches/i,
    key: 'apolloProSearch.actCheckingCrm',
  },
  {
    pattern: /^Scanning professional networks/i,
    key: 'apolloProSearch.actScanningNetworks',
  },
  {
    pattern: /^Scanning local lead database for matching contacts/i,
    key: 'apolloProSearch.actScanningLocalDb',
  },
  {
    pattern: /^Discovered profile:\s*(.+?)\s+at\s+(.+)$/i,
    key: 'apolloProSearch.actDiscoveredProfile',
    extract: (m) => ({ name: m[1], company: m[2] }),
  },
  {
    pattern: /^Cross-referencing (\d+) prospects against business records$/i,
    key: 'apolloProSearch.actCrossReferencing',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Found contact details for (.+)$/i,
    key: 'apolloProSearch.actFoundContact',
    extract: (m) => ({ name: m[1] }),
  },
  {
    pattern: /^Located email for (.+)$/i,
    key: 'apolloProSearch.actLocatedEmail',
    extract: (m) => ({ name: m[1] }),
  },
  {
    pattern: /^Connecting to Apollo API to reveal (\d+) contacts/i,
    key: 'apolloProSearch.actConnectingApollo',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Apollo revealed (\d+) contacts with full profiles$/i,
    key: 'apolloProSearch.actApolloRevealed',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Waiting for phone number webhooks from Apollo/i,
    key: 'apolloProSearch.actWaitingPhoneWebhooks',
  },
  {
    pattern: /^Contact reveal complete — (\d+) emails, (\d+) phone numbers found$/i,
    key: 'apolloProSearch.actContactRevealComplete',
    extract: (m) => ({ withEmail: m[1], withPhone: m[2] }),
  },
  {
    pattern: /^Querying Hunter\.io for (\d+) leads missing email/i,
    key: 'apolloProSearch.actQueryingHunter',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Hunter\.io found (\d+) additional emails/i,
    key: 'apolloProSearch.actHunterFound',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Hunter\.io scan complete — no additional emails found$/i,
    key: 'apolloProSearch.actHunterNoResults',
  },
  {
    pattern: /^Querying Findymail for (\d+) leads still missing email/i,
    key: 'apolloProSearch.actQueryingFindymail',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Findymail discovered (\d+) additional email addresses$/i,
    key: 'apolloProSearch.actFindymailFound',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Searching for direct phone numbers for (\d+) leads/i,
    key: 'apolloProSearch.actSearchingPhones',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Phone enrichment found (\d+) direct phone numbers$/i,
    key: 'apolloProSearch.actPhoneEnrichFound',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Verifying deliverability for (\d+) email addresses/i,
    key: 'apolloProSearch.actVerifyingDeliverability',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Email verification complete — (\d+) safe to send, (\d+) risky, (\d+) invalid$/i,
    key: 'apolloProSearch.actEmailVerificationComplete',
    extract: (m) => ({ valid: m[1], risky: m[2], invalid: m[3] }),
  },
  {
    pattern: /^Cross-checking (\d+) contacts against your CRM to remove duplicates/i,
    key: 'apolloProSearch.actCrosscheckingCrm',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^CRM dedup found (\d+) existing contacts/i,
    key: 'apolloProSearch.actCrmDedupFound',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Starting multi-source enrichment for (\d+) contacts/i,
    key: 'apolloProSearch.actStartingEnrichment',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Cache hit — loading (\d+) previously enriched leads$/i,
    key: 'apolloProSearch.actCacheHitLoading',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Local database satisfied request — skipping external API calls$/i,
    key: 'apolloProSearch.actLocalDbSatisfied',
  },
  {
    pattern: /^Found (\d+) matching leads in local database$/i,
    key: 'apolloProSearch.actFoundInLocalDb',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Querying Apollo external database for matching decision-makers/i,
    key: 'apolloProSearch.actQueryingApolloDb',
  },
  {
    pattern: /^Apollo found ([\d,]+) matching contacts — fetching (\d+) across (\d+) page/i,
    key: 'apolloProSearch.actApolloFoundContacts',
    extract: (m) => ({ total: m[1], count: m[2], pages: m[3] }),
  },
  {
    pattern: /^Paginating through (\d+) additional search result pages/i,
    key: 'apolloProSearch.actPaginating',
    extract: (m) => ({ count: m[1] }),
  },
  {
    pattern: /^Apollo credits exhausted/i,
    key: 'apolloProSearch.actCreditsExhausted',
  },
];

/**
 * Translate a server-sent phase name to the user's language.
 * Strips parenthetical counts like "(25 leads)" and maps to i18n key.
 * Falls back to the original English string if no mapping found.
 */
export function translatePhaseName(t: TFunction, name: string): string {
  if (!name) return '';
  // Strip parenthetical counts: "Verifying company data (25)" → "Verifying company data"
  const stripped = name.replace(/\s*\(.*?\)\s*/g, '').trim();
  
  for (const [pattern, key] of PHASE_MAP) {
    if (pattern.test(stripped)) {
      const translated = t(key);
      // If translation returns the key itself, fall back to original
      if (translated === key) return stripped;
      return translated;
    }
  }
  return stripped;
}

/**
 * Translate a server-sent activity message to the user's language.
 * Extracts dynamic parameters and uses i18n interpolation.
 * Falls back to the original English string if no mapping found.
 */
export function translateActivityMessage(t: TFunction, message: string): string {
  if (!message) return '';
  
  for (const { pattern, key, extract } of ACTIVITY_MAP) {
    const match = message.match(pattern);
    if (match) {
      const params = extract ? extract(match) : {};
      const translated = t(key, params);
      // If translation returns the key itself, fall back to original
      if (translated === key) return message;
      return translated;
    }
  }
  return message;
}
