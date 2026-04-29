/**
 * Valid US states, territories, and military designations
 */
export const US_STATES = new Set([
  // 50 States
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
  'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  
  // Territories
  'Puerto Rico', 'Guam', 'U.S. Virgin Islands', 'US Virgin Islands',
  'American Samoa', 'Northern Mariana Islands',
  
  // Federal District
  'District of Columbia', 'Washington DC', 'Washington D.C.', 'DC', 'D.C.',
  
  // Common abbreviations (2-letter)
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  
  // Military/Diplomatic
  'Armed Forces Americas', 'Armed Forces Europe', 'Armed Forces Pacific',
  'AA', 'AE', 'AP',
]);

/**
 * Valid Canadian provinces and territories
 */
export const CANADIAN_PROVINCES = new Set([
  // Provinces
  'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
  'Newfoundland and Labrador', 'Nova Scotia', 'Ontario',
  'Prince Edward Island', 'Quebec', 'Saskatchewan',
  
  // Territories
  'Northwest Territories', 'Nunavut', 'Yukon',
  
  // Abbreviations
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK',
  'NT', 'NU', 'YT',
]);

/**
 * Check if a state/province belongs to a specific country
 */
export function isValidStateForCountry(state: string | null | undefined, country: string | null | undefined): boolean {
  if (!state || !country) return true; // If no state or country, don't filter
  
  const stateTrimmed = state.trim();
  const countryTrimmed = country.trim();
  
  // US states
  if (countryTrimmed === 'United States' || countryTrimmed === 'United States of America' || 
      countryTrimmed === 'USA' || countryTrimmed === 'US' || countryTrimmed === 'U.S.' || countryTrimmed === 'U.S.A.') {
    // Check exact match (case-sensitive first for performance)
    if (US_STATES.has(stateTrimmed)) return true;
    // Check case-insensitive
    const lowerState = stateTrimmed.toLowerCase();
    for (const validState of US_STATES) {
      if (validState.toLowerCase() === lowerState) return true;
    }
    return false;
  }
  
  // Canadian provinces
  if (countryTrimmed === 'Canada') {
    if (CANADIAN_PROVINCES.has(stateTrimmed)) return true;
    const lowerState = stateTrimmed.toLowerCase();
    for (const validProvince of CANADIAN_PROVINCES) {
      if (validProvince.toLowerCase() === lowerState) return true;
    }
    return false;
  }
  
  // For other countries, allow any non-country state value
  // (we already filtered out country names in the main filter)
  return true;
}
