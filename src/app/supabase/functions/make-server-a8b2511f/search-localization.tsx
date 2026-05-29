type LocaleHint = { gl: string; hl: string };

const COUNTRY_HINTS: Array<{ test: RegExp; hint: LocaleHint }> = [
  { test: /\b(brazil|brasil)\b/i, hint: { gl: "br", hl: "pt" } },
  { test: /\b(portugal)\b/i, hint: { gl: "pt", hl: "pt" } },
  { test: /\b(spain|españa|espana)\b/i, hint: { gl: "es", hl: "es" } },
  { test: /\b(mexico|méxico)\b/i, hint: { gl: "mx", hl: "es" } },
  { test: /\b(argentina)\b/i, hint: { gl: "ar", hl: "es" } },
  { test: /\b(colombia)\b/i, hint: { gl: "co", hl: "es" } },
  { test: /\b(chile)\b/i, hint: { gl: "cl", hl: "es" } },
  { test: /\b(peru|perú)\b/i, hint: { gl: "pe", hl: "es" } },
  { test: /\b(france|francia)\b/i, hint: { gl: "fr", hl: "fr" } },
  { test: /\b(germany|deutschland|alemania)\b/i, hint: { gl: "de", hl: "de" } },
  { test: /\b(italy|italia)\b/i, hint: { gl: "it", hl: "it" } },
  { test: /\b(united kingdom|uk|england|scotland|wales)\b/i, hint: { gl: "gb", hl: "en" } },
  { test: /\b(canada)\b/i, hint: { gl: "ca", hl: "en" } },
  { test: /\b(australia)\b/i, hint: { gl: "au", hl: "en" } },
  { test: /\b(united states|usa|us)\b/i, hint: { gl: "us", hl: "en" } },
];

const TERM_TRANSLATIONS: Record<string, string[]> = {
  restaurant: ["restaurant", "restaurants", "restaurante", "restaurantes", "restaurateur", "restaurador", "gastronomia"],
  restaurants: ["restaurant", "restaurants", "restaurante", "restaurantes", "restaurateur", "restaurador", "gastronomia"],
  hospitality: ["hospitality", "hospitalidad", "hotelaria", "hotelería", "restaurante", "bar"],
  cleaning: ["cleaning", "commercial cleaning", "limpieza", "limpieza comercial", "limpeza", "limpeza comercial"],
  cosmetics: ["cosmetics", "cosmetic", "cosméticos", "cosmeticos", "cosmética", "cosmetica", "beleza", "belleza"],
  salon: ["salon", "salón", "salao", "salão", "beauty salon", "salón de belleza", "salão de beleza"],
  dental: ["dental", "dentist", "dentista", "odontologia", "odontología", "clínica dental", "clinica dental"],
  clinic: ["clinic", "clínica", "clinica", "healthcare", "saúde", "salud"],
  fitness: ["fitness", "gym", "academia", "gimnasio", "ginásio", "personal trainer"],
  retail: ["retail", "retailer", "varejo", "retalho", "minorista", "comercio"],
  real_estate: ["real estate", "realty", "inmobiliaria", "imobiliária", "imobiliaria", "bienes raíces"],
};

const TITLE_TRANSLATIONS: Record<string, string[]> = {
  ceo: ["CEO", "Chief Executive Officer", "Director General", "Diretor Geral", "Presidente", "Administrador"],
  owner: ["Owner", "Business Owner", "Propietario", "Dueño", "Proprietário", "Dono", "Sócio Proprietário"],
  founder: ["Founder", "Co-Founder", "Fundador", "Cofundador", "Fundadora", "Sócio Fundador"],
  president: ["President", "Presidente"],
  partner: ["Partner", "Managing Partner", "Socio", "Sócio", "Parceiro", "Sócio Diretor"],
  director: ["Director", "Managing Director", "Director General", "Diretor", "Diretor Executivo", "Directeur", "Direttore"],
  manager: ["Manager", "General Manager", "Gerente", "Gerente General", "Gerente Geral", "Responsable"],
  head: ["Head of", "Jefe de", "Responsable de", "Chefe de", "Líder de"],
  vp: ["VP", "Vice President", "Vicepresidente", "Vice Presidente"],
};

export function localeHintsFromLocations(locations?: string[]): LocaleHint | null {
  const joined = (locations || []).join(" ");
  if (!joined) return null;
  for (const item of COUNTRY_HINTS) {
    if (item.test.test(joined)) return item.hint;
  }
  return null;
}

export function applyLocaleParams(params: URLSearchParams, locations?: string[] | string): void {
  const locationList = Array.isArray(locations) ? locations : locations ? [locations] : [];
  const hint = localeHintsFromLocations(locationList);
  if (!hint) return;
  if (!params.has("gl")) params.set("gl", hint.gl);
  if (!params.has("hl")) params.set("hl", hint.hl);
}

function normalizeTerm(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function expandLocalizedSearchTerms(term?: string, max = 8): string[] {
  const raw = (term || "").trim();
  if (!raw) return [];
  const key = normalizeTerm(raw);
  const direct = TERM_TRANSLATIONS[key];
  const fuzzyKey = Object.keys(TERM_TRANSLATIONS).find((candidate) => key.includes(candidate) || candidate.includes(key));
  return [...new Set([raw, ...(direct || TERM_TRANSLATIONS[fuzzyKey || ""] || [])])].slice(0, max);
}

export function expandLocalizedTitleTerms(titles?: string[], seniorities?: string[], max = 12): string[] {
  const requested = [...(titles || []), ...(seniorities || [])].filter(Boolean);
  const fallback = requested.length ? requested : ["CEO", "Owner", "Founder", "Director", "Manager"];
  const expanded: string[] = [];
  for (const raw of fallback) {
    const key = normalizeTerm(raw);
    const mappedKey =
      key.includes("owner") ? "owner" :
      key.includes("founder") ? "founder" :
      key.includes("president") ? "president" :
      key.includes("partner") ? "partner" :
      key.includes("director") ? "director" :
      key.includes("manager") ? "manager" :
      key.includes("head") ? "head" :
      key.includes("vp") || key.includes("vice") ? "vp" :
      key.includes("ceo") || key.includes("c_suite") || key.includes("chief") ? "ceo" :
      key;
    expanded.push(raw, ...(TITLE_TRANSLATIONS[mappedKey] || []));
  }
  return [...new Set(expanded.filter(Boolean))].slice(0, max);
}
