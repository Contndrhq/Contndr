/**
 * Industry Normalizer — Contndr Data Intelligence Layer
 *
 * Maps arbitrary raw industry strings (Apollo, LinkedIn, HubSpot, Salesforce,
 * generic CSVs, etc.) to a clean, canonical 40-entry professional taxonomy.
 *
 * Used server-side during lead/company import so ALL data in the database
 * is consistent, properly cased, and filterable.
 *
 * Export: normalizeIndustry(raw) → canonical string
 * Export: CANONICAL_INDUSTRIES → readonly tuple (source of truth)
 */

// ─── Canonical Taxonomy (source of truth) ────────────────────────────────────

export const CANONICAL_INDUSTRIES = [
  "Accounting & Finance",
  "Advertising & Marketing",
  "Aerospace & Defense",
  "Agriculture",
  "Automotive",
  "Banking & Financial Services",
  "Biotechnology & Pharmaceuticals",
  "Construction & Engineering",
  "Consulting",
  "Consumer Goods",
  "Cybersecurity",
  "Data & Analytics",
  "E-Commerce",
  "Education",
  "Energy & Utilities",
  "Environmental & Sustainability",
  "Events & Entertainment",
  "Food & Beverage",
  "Gaming",
  "Government & Public Sector",
  "Healthcare & Medical",
  "Hospitality & Travel",
  "Human Resources & Recruiting",
  "Information Technology",
  "Insurance",
  "Investment & Private Equity",
  "Legal Services",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Media & Publishing",
  "Medical Devices",
  "Non-Profit & NGO",
  "Oil & Gas",
  "Real Estate",
  "Retail",
  "Software & SaaS",
  "Sports & Fitness",
  "Telecommunications",
  "Transportation",
  "Other",
] as const;

export type CanonicalIndustry = typeof CANONICAL_INDUSTRIES[number];

// ─── Mapping Rules ────────────────────────────────────────────────────────────
// Ordered from most-specific to least-specific within each group.
// Patterns are matched against a prep'd (lowercase, stripped) version of the raw string.

const RULES: Array<{ canonical: CanonicalIndustry; patterns: string[] }> = [
  // ── Software & SaaS ───────────────────────────────────────────────────────
  {
    canonical: "Software & SaaS",
    patterns: [
      "computer software", "software as a service", "saas",
      "enterprise software", "productivity software", "mobile software",
      "web software", "internet software", "application software",
      "software development", "software engineering", "software services",
      "software solutions", "software product", "open source",
      "low code", "no code", "devops", "platform as a service", "paas",
      "infrastructure as a service", "iaas", "software",
    ],
  },
  // ── Cybersecurity ─────────────────────────────────────────────────────────
  {
    canonical: "Cybersecurity",
    patterns: [
      "computer & network security", "computer and network security",
      "cybersecurity", "cyber security", "network security",
      "information security", "data security", "it security",
      "security software", "endpoint security", "identity and access",
      "fraud prevention", "zero trust",
    ],
  },
  // ── Data & Analytics ──────────────────────────────────────────────────────
  {
    canonical: "Data & Analytics",
    patterns: [
      "data analytics", "big data", "business intelligence",
      "data science", "data management", "market research",
      "business analytics", "data services", "analytics platform",
      "data infrastructure", "data engineering",
    ],
  },
  // ── Information Technology ────────────────────────────────────────────────
  {
    canonical: "Information Technology",
    patterns: [
      "information technology and services", "information technology",
      "it services", "it consulting", "managed services", "msp",
      "technology services", "tech services", "computer services",
      "computer networking", "network services", "it infrastructure",
      "systems integration", "system integration", "technical support",
      "computer hardware", "consumer electronics", "semiconductors",
      "electrical/electronic manufacturing",
      "electrical and electronic manufacturing",
    ],
  },
  // ── Advertising & Marketing ───────────────────────────────────────────────
  {
    canonical: "Advertising & Marketing",
    patterns: [
      "marketing and advertising", "marketing & advertising",
      "digital marketing", "online marketing", "content marketing",
      "social media marketing", "email marketing", "search engine marketing",
      "performance marketing", "growth marketing", "brand management",
      "media buying", "programmatic advertising", "advertising",
      "marketing agency", "marketing services", "marketing",
    ],
  },
  // ── Public Relations ─ (fold into Advertising & Marketing) ───────────────
  {
    canonical: "Advertising & Marketing",
    patterns: [
      "public relations", "pr agency", "communications agency",
      "communications", "brand strategy",
    ],
  },
  // ── Banking & Financial Services ──────────────────────────────────────────
  {
    canonical: "Banking & Financial Services",
    patterns: [
      "financial services", "banking", "commercial banking", "retail banking",
      "mortgage", "lending", "consumer finance", "financial technology",
      "fintech", "payments", "payment processing", "credit services",
      "debt collection", "capital markets", "securities", "brokerage",
      "credit union", "neobank",
    ],
  },
  // ── Investment & Private Equity ───────────────────────────────────────────
  {
    canonical: "Investment & Private Equity",
    patterns: [
      "venture capital & private equity", "venture capital", "private equity",
      "investment management", "asset management", "wealth management",
      "hedge fund", "fund management", "investment banking",
      "portfolio management", "angel investing", "family office",
      "endowment management", "alternative investments",
    ],
  },
  // ── Accounting & Finance ──────────────────────────────────────────────────
  {
    canonical: "Accounting & Finance",
    patterns: [
      "accounting", "bookkeeping", "tax services", "tax", "audit",
      "financial planning", "payroll", "cpa", "chartered accountant",
      "financial advisory", "financial consulting",
    ],
  },
  // ── Insurance ─────────────────────────────────────────────────────────────
  {
    canonical: "Insurance",
    patterns: [
      "insurance", "reinsurance", "life insurance", "health insurance",
      "property insurance", "casualty insurance", "underwriting", "insurtech",
    ],
  },
  // ── Real Estate ───────────────────────────────────────────────────────────
  {
    canonical: "Real Estate",
    patterns: [
      "commercial real estate", "residential real estate", "real estate",
      "property management", "property development", "leasing", "reit",
      "real estate investment", "real estate services", "realty",
      "realtor", "proptech",
    ],
  },
  // ── Construction & Engineering ────────────────────────────────────────────
  {
    canonical: "Construction & Engineering",
    patterns: [
      "architecture & planning", "architecture and planning", "architectural",
      "civil engineering", "structural engineering",
      "mechanical or industrial engineering",
      "mechanical and industrial engineering",
      "general contracting", "specialty construction", "construction",
      "engineering", "building materials", "facilities services",
      "facilities management",
    ],
  },
  // ── Healthcare & Medical ──────────────────────────────────────────────────
  {
    canonical: "Healthcare & Medical",
    patterns: [
      "hospital & health care", "hospital and health care",
      "hospitals and health care", "health care", "healthcare",
      "medical practice", "clinical research", "telemedicine", "telehealth",
      "home health care", "mental health care", "physical therapy",
      "veterinary", "health information technology", "health it",
      "health tech", "individual & family services",
    ],
  },
  // ── Medical Devices ───────────────────────────────────────────────────────
  {
    canonical: "Medical Devices",
    patterns: [
      "medical devices", "medical device", "medical equipment",
      "surgical instruments", "diagnostics", "imaging equipment",
    ],
  },
  // ── Biotechnology & Pharmaceuticals ──────────────────────────────────────
  {
    canonical: "Biotechnology & Pharmaceuticals",
    patterns: [
      "biotechnology", "pharmaceuticals", "biotech", "pharma",
      "life sciences", "drug discovery", "clinical trials",
      "genomics", "bioinformatics", "biopharmaceuticals",
    ],
  },
  // ── Sports & Fitness ──────────────────────────────────────────────────────
  {
    canonical: "Sports & Fitness",
    patterns: [
      "sporting goods", "health, wellness and fitness",
      "health wellness and fitness", "recreational facilities",
      "recreational facilities and services", "wellness", "fitness",
      "gyms", "athletics", "sports",
    ],
  },
  // ── Education ─────────────────────────────────────────────────────────────
  {
    canonical: "Education",
    patterns: [
      "education management", "higher education", "e-learning", "e learning",
      "edtech", "ed tech", "primary/secondary education",
      "primary secondary education",
      "professional training & coaching",
      "professional training and coaching", "online education",
      "vocational training", "tutoring", "training", "education",
    ],
  },
  // ── Non-Profit & NGO ──────────────────────────────────────────────────────
  {
    canonical: "Non-Profit & NGO",
    patterns: [
      "non-profit organization management", "nonprofit organization management",
      "non-profit", "nonprofit", "ngo", "charity",
      "civic & social organization", "civic and social organization",
      "think tanks", "political organization", "religious institutions",
      "philanthropy", "foundation",
    ],
  },
  // ── Government & Public Sector ────────────────────────────────────────────
  {
    canonical: "Government & Public Sector",
    patterns: [
      "government administration", "public sector", "government relations",
      "defense & space", "defense and space", "military", "law enforcement",
      "judiciary", "government", "public administration",
    ],
  },
  // ── Legal Services ────────────────────────────────────────────────────────
  {
    canonical: "Legal Services",
    patterns: [
      "law practice", "legal services", "law firm", "attorney",
      "paralegal", "alternative dispute resolution", "legal tech",
      "legaltech", "legal",
    ],
  },
  // ── Human Resources & Recruiting ─────────────────────────────────────────
  {
    canonical: "Human Resources & Recruiting",
    patterns: [
      "staffing and recruiting", "staffing & recruiting",
      "human resources", "recruiting", "recruitment", "talent acquisition",
      "hr tech", "hrtech", "executive search", "outsourcing/offshoring",
      "outsourcing", "employer of record", "eor", "peo", "staffing",
    ],
  },
  // ── Consulting ────────────────────────────────────────────────────────────
  {
    canonical: "Consulting",
    patterns: [
      "management consulting", "business consulting", "strategy consulting",
      "technology consulting", "financial consulting", "advisory services",
      "professional services", "consulting",
    ],
  },
  // ── Media & Publishing ────────────────────────────────────────────────────
  {
    canonical: "Media & Publishing",
    patterns: [
      "media production", "broadcast media", "online media", "digital media",
      "film production", "animation", "television", "radio", "journalism",
      "content creation", "news media", "magazines", "newspapers",
      "publishing",
    ],
  },
  // ── Events & Entertainment ────────────────────────────────────────────────
  {
    canonical: "Events & Entertainment",
    patterns: [
      "events services", "event management", "entertainment services",
      "trade shows", "conferences", "live entertainment",
      "performing arts", "theater", "music", "comedy", "entertainment",
    ],
  },
  // ── Gaming ────────────────────────────────────────────────────────────────
  {
    canonical: "Gaming",
    patterns: [
      "computer games", "video games", "mobile gaming", "esports",
      "game development", "gaming",
    ],
  },
  // ── Telecommunications ────────────────────────────────────────────────────
  {
    canonical: "Telecommunications",
    patterns: [
      "telecommunications", "wireless", "telecom", "mobile network",
      "internet service provider", "isp", "broadband",
      "cable & satellite tv", "cable and satellite tv",
    ],
  },
  // ── Manufacturing ─────────────────────────────────────────────────────────
  {
    canonical: "Manufacturing",
    patterns: [
      "industrial manufacturing", "chemicals", "chemical",
      "plastics", "rubber", "paper", "packaging", "printing", "textiles",
      "industrial machinery", "manufacturing",
    ],
  },
  // ── Automotive ────────────────────────────────────────────────────────────
  {
    canonical: "Automotive",
    patterns: [
      "motor vehicles", "automotive parts", "auto parts",
      "car dealer", "dealership", "fleet management", "vehicle",
      "automotive",
    ],
  },
  // ── Logistics & Supply Chain ──────────────────────────────────────────────
  {
    canonical: "Logistics & Supply Chain",
    patterns: [
      "logistics and supply chain", "logistics & supply chain",
      "warehousing", "fulfillment", "freight", "customs", "3pl",
      "distribution", "supply chain", "logistics",
    ],
  },
  // ── Transportation ────────────────────────────────────────────────────────
  {
    canonical: "Transportation",
    patterns: [
      "transportation/trucking/railroad", "transportation trucking railroad",
      "trucking", "railroad", "freight forwarding",
      "airlines/aviation", "airlines and aviation", "aviation",
      "maritime", "shipping industry", "transportation",
    ],
  },
  // ── Oil & Gas ─────────────────────────────────────────────────────────────
  {
    canonical: "Oil & Gas",
    patterns: [
      "oil & energy", "oil and energy", "oil & gas", "oil and gas",
      "petroleum", "natural gas", "mining & metals",
      "mining and metals", "oil extraction", "drilling",
    ],
  },
  // ── Energy & Utilities ────────────────────────────────────────────────────
  {
    canonical: "Energy & Utilities",
    patterns: [
      "utilities", "electric power", "power generation",
      "renewables & environment", "renewables and environment",
      "renewable energy", "solar energy", "wind energy", "cleantech",
      "clean tech", "energy management", "nuclear energy",
    ],
  },
  // ── Environmental & Sustainability ────────────────────────────────────────
  {
    canonical: "Environmental & Sustainability",
    patterns: [
      "environmental services", "environmental", "sustainability",
      "green energy", "clean energy", "waste management",
      "recycling", "water purification", "environmental consulting",
    ],
  },
  // ── Food & Beverage ───────────────────────────────────────────────────────
  {
    canonical: "Food & Beverage",
    patterns: [
      "food & beverages", "food and beverages", "food production",
      "beverages", "dairy", "restaurants", "food service",
      "hospitality food", "catering", "food & beverage",
    ],
  },
  // ── Hospitality & Travel ──────────────────────────────────────────────────
  {
    canonical: "Hospitality & Travel",
    patterns: [
      "leisure, travel & tourism", "leisure travel and tourism",
      "hotels", "hotel management", "tourism", "travel management",
      "resort", "airline", "hospitality",
    ],
  },
  // ── Retail ────────────────────────────────────────────────────────────────
  {
    canonical: "Retail",
    patterns: [
      "consumer goods", "supermarkets", "grocery", "department stores",
      "specialty retail", "convenience store", "retail",
    ],
  },
  // ── E-Commerce ────────────────────────────────────────────────────────────
  {
    canonical: "E-Commerce",
    patterns: [
      "e-commerce", "ecommerce", "e commerce", "online retail",
      "marketplace", "direct to consumer", "dtc", "d2c",
      "import and export", "import export",
    ],
  },
  // ── Consumer Goods ────────────────────────────────────────────────────────
  {
    canonical: "Consumer Goods",
    patterns: [
      "apparel & fashion", "apparel and fashion", "fashion", "clothing",
      "luxury goods & jewelry", "luxury goods and jewelry",
      "cosmetics", "beauty", "personal care", "household goods",
      "home furnishings", "sporting goods",
    ],
  },
  // ── Aerospace & Defense ───────────────────────────────────────────────────
  {
    canonical: "Aerospace & Defense",
    patterns: [
      "aerospace", "defense systems", "military technology",
      "space technology", "defense",
    ],
  },
  // ── Agriculture ───────────────────────────────────────────────────────────
  {
    canonical: "Agriculture",
    patterns: [
      "farming", "crop production", "livestock", "agribusiness",
      "agtech", "ag tech", "agriculture",
    ],
  },
];

// ─── Keyword Score Fallback ───────────────────────────────────────────────────
// When no rule matches, keyword scoring gives a best-effort canonical.

const KEYWORD_SCORES: Array<{ word: string; canonical: CanonicalIndustry }> = [
  { word: "saas",          canonical: "Software & SaaS" },
  { word: "software",      canonical: "Software & SaaS" },
  { word: "cyber",         canonical: "Cybersecurity" },
  { word: "security",      canonical: "Cybersecurity" },
  { word: "analytics",     canonical: "Data & Analytics" },
  { word: "data",          canonical: "Data & Analytics" },
  { word: "tech",          canonical: "Information Technology" },
  { word: "fintech",       canonical: "Banking & Financial Services" },
  { word: "finance",       canonical: "Banking & Financial Services" },
  { word: "bank",          canonical: "Banking & Financial Services" },
  { word: "invest",        canonical: "Investment & Private Equity" },
  { word: "venture",       canonical: "Investment & Private Equity" },
  { word: "account",       canonical: "Accounting & Finance" },
  { word: "insurtech",     canonical: "Insurance" },
  { word: "insurance",     canonical: "Insurance" },
  { word: "proptech",      canonical: "Real Estate" },
  { word: "property",      canonical: "Real Estate" },
  { word: "health",        canonical: "Healthcare & Medical" },
  { word: "medical",       canonical: "Healthcare & Medical" },
  { word: "biotech",       canonical: "Biotechnology & Pharmaceuticals" },
  { word: "pharma",        canonical: "Biotechnology & Pharmaceuticals" },
  { word: "edtech",        canonical: "Education" },
  { word: "educat",        canonical: "Education" },
  { word: "nonprofit",     canonical: "Non-Profit & NGO" },
  { word: "government",    canonical: "Government & Public Sector" },
  { word: "legal",         canonical: "Legal Services" },
  { word: "law",           canonical: "Legal Services" },
  { word: "recruit",       canonical: "Human Resources & Recruiting" },
  { word: "staffing",      canonical: "Human Resources & Recruiting" },
  { word: "consult",       canonical: "Consulting" },
  { word: "media",         canonical: "Media & Publishing" },
  { word: "publish",       canonical: "Media & Publishing" },
  { word: "gaming",        canonical: "Gaming" },
  { word: "telecom",       canonical: "Telecommunications" },
  { word: "manufactur",    canonical: "Manufacturing" },
  { word: "logistic",      canonical: "Logistics & Supply Chain" },
  { word: "supply chain",  canonical: "Logistics & Supply Chain" },
  { word: "transport",     canonical: "Transportation" },
  { word: "aviation",      canonical: "Transportation" },
  { word: "oil",           canonical: "Oil & Gas" },
  { word: "energy",        canonical: "Energy & Utilities" },
  { word: "sustain",       canonical: "Environmental & Sustainability" },
  { word: "food",          canonical: "Food & Beverage" },
  { word: "restaurant",    canonical: "Food & Beverage" },
  { word: "hotel",         canonical: "Hospitality & Travel" },
  { word: "travel",        canonical: "Hospitality & Travel" },
  { word: "retail",        canonical: "Retail" },
  { word: "ecommerce",     canonical: "E-Commerce" },
  { word: "fashion",       canonical: "Consumer Goods" },
  { word: "cosmetic",      canonical: "Consumer Goods" },
  { word: "aerospace",     canonical: "Aerospace & Defense" },
  { word: "defense",       canonical: "Aerospace & Defense" },
  { word: "farm",          canonical: "Agriculture" },
  { word: "agricult",      canonical: "Agriculture" },
  { word: "market",        canonical: "Advertising & Marketing" },
  { word: "advertis",      canonical: "Advertising & Marketing" },
  { word: "construct",     canonical: "Construction & Engineering" },
  { word: "real estate",   canonical: "Real Estate" },
  { word: "automotive",    canonical: "Automotive" },
  { word: "sport",         canonical: "Sports & Fitness" },
  { word: "fitness",       canonical: "Sports & Fitness" },
  { word: "internet",      canonical: "Software & SaaS" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prep(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s&\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SMALL_WORDS_TC = new Set(["a","an","and","as","at","but","by","for","if","in","nor","of","on","or","so","the","to","up","yet","via"]);
const UPPER_WORDS_TC = new Set(["llc","inc","co","usa","uk","uae","eu","nyc","la","dc","it","ai","hr","pr","crm","saas","b2b","b2c","seo","api","iot","ceo","cfo","cto","ngo","vc","pe","eor","peo","dtc","d2c","isp","msp","aws"]);

function titleCase(str: string): string {
  if (!str) return "";
  return str.toLowerCase().split(/([\s\-\/&]+)/).map((word, i) => {
    if (/^[\s\-\/&]+$/.test(word)) return word;
    const lower = word.toLowerCase();
    if (UPPER_WORDS_TC.has(lower)) return word.toUpperCase();
    if (i > 0 && SMALL_WORDS_TC.has(lower)) return lower;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join("");
}

// ─── Main Exported Function ───────────────────────────────────────────────────

export function normalizeIndustry(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  const p = prep(s);
  if (!p) return titleCase(s);

  // 1. Exact pattern match (faster: iterate all exact patterns first)
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (p === pattern) return rule.canonical;
    }
  }

  // 2. Substring match — prepared contains pattern OR pattern contains prepared
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (p.includes(pattern) || (pattern.length > 4 && pattern.includes(p))) {
        return rule.canonical;
      }
    }
  }

  // 3. Check against canonical label names directly
  for (const canon of CANONICAL_INDUSTRIES) {
    const cp = prep(canon);
    if (p === cp || p.includes(cp) || (cp.length > 4 && cp.includes(p))) {
      return canon;
    }
  }

  // 4. Keyword scoring fallback
  for (const { word, canonical } of KEYWORD_SCORES) {
    if (p.includes(word)) return canonical;
  }

  // 5. Short unknown industries: title-case as-is (up to 3 words)
  const wordCount = s.split(/\s+/).length;
  if (wordCount <= 3) return titleCase(s);

  return "Other";
}

/**
 * Normalize contact/person name — Title Case with smart acronym handling.
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  return titleCase(raw.trim());
}

/**
 * Normalize job title — Title Case with smart acronym handling.
 */
export function normalizeJobTitle(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  return titleCase(raw.trim());
}

/**
 * Normalize location fields (city, state, country).
 * Keeps known abbreviations uppercase (CA, NY, TX, UK, USA, UAE, etc.)
 */
export function normalizeLocation(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  return titleCase(raw.trim());
}
