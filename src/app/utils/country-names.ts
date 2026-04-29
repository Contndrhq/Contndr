/**
 * Comprehensive set of world country names and common variants.
 * Used to prevent country names from appearing in state/province dropdowns.
 * Includes all UN member states, observer states, and common aliases.
 * Case-sensitive — use with exact match or normalize before comparing.
 */
export const ALL_COUNTRY_NAMES: ReadonlySet<string> = new Set([
  // ─── A ────────────────────────────────────────────────────
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola',
  'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan',
  // ─── B ────────────────────────────────────────────────────
  'Bahamas', 'The Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
  'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Bosnia', 'Botswana', 'Brazil',
  'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  // ─── C ────────────────────────────────────────────────────
  'Cabo Verde', 'Cape Verde', 'Cambodia', 'Cameroon', 'Canada',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia',
  'Comoros', 'Congo', 'Republic of the Congo',
  'Democratic Republic of the Congo', 'Costa Rica', 'Croatia', 'Cuba',
  'Cyprus', 'Czech Republic', 'Czechia',
  // ─── D ────────────────────────────────────────────────────
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
  // ─── E ────────────────────────────────────────────────────
  'East Timor', 'Timor-Leste', 'Ecuador', 'Egypt', 'El Salvador',
  'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Swaziland',
  'Ethiopia',
  // ─── F ────────────────────────────────────────────────────
  'Fiji', 'Finland', 'France',
  // ─── G ────────────────────────────────────────────────────
  'Gabon', 'Gambia', 'The Gambia', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  // ─── H ────────────────────────────────────────────────────
  'Haiti', 'Honduras', 'Hungary',
  // ─── I ────────────────────────────────────────────────────
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
  'Israel', 'Italy', 'Ivory Coast', "Côte d'Ivoire",
  // ─── J ────────────────────────────────────────────────────
  'Jamaica', 'Japan', 'Jordan',
  // ─── K ────────────────────────────────────────────────────
  'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
  // ─── L ────────────────────────────────────────────────────
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya',
  'Liechtenstein', 'Lithuania', 'Luxembourg',
  // ─── M ────────────────────────────────────────────────────
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico',
  'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro',
  'Morocco', 'Mozambique', 'Myanmar', 'Burma',
  // ─── N ────────────────────────────────────────────────────
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'The Netherlands',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
  'North Macedonia', 'Macedonia', 'Norway',
  // ─── O ────────────────────────────────────────────────────
  'Oman',
  // ─── P ────────────────────────────────────────────────────
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea',
  'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  // ─── Q ────────────────────────────────────────────────────
  'Qatar',
  // ─── R ────────────────────────────────────────────────────
  'Romania', 'Russia', 'Russian Federation', 'Rwanda',
  // ─── S ────────────────────────────────────────────────────
  'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia',
  'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia',
  'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
  'Sweden', 'Switzerland', 'Syria', 'Syrian Arab Republic',
  // ─── T ────────────────────────────────────────────────────
  'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Tonga',
  'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Türkiye',
  'Turkmenistan', 'Tuvalu',
  // ─── U ────────────────────────────────────────────────────
  'Uganda', 'Ukraine', 'United Arab Emirates', 'UAE',
  'United Kingdom', 'UK', 'Great Britain', 'England', 'Scotland', 'Wales',
  'United States', 'United States of America', 'USA', 'US', 'U.S.', 'U.S.A.',
  'Uruguay', 'Uzbekistan',
  // ─── V ────────────────────────────────────────────────────
  'Vanuatu', 'Vatican City', 'Holy See', 'Venezuela', 'Vietnam', 'Viet Nam',
  // ─── Y ────────────────────────────────────────────────────
  'Yemen',
  // ─── Z ────────────────────────────────────────────────────
  'Zambia', 'Zimbabwe',
  // ─── Territories & common aliases ─────────────────────────
  'Hong Kong', 'Macau', 'Macao', 'Puerto Rico', 'Guam',
  'U.S. Virgin Islands', 'American Samoa', 'Northern Mariana Islands',
  'Bermuda', 'Cayman Islands', 'Greenland', 'Faroe Islands',
  'French Guiana', 'French Polynesia', 'Guadeloupe', 'Martinique',
  'Mayotte', 'New Caledonia', 'Réunion', 'Reunion',
  'Aruba', 'Curaçao', 'Curacao', 'Sint Maarten',
  'Gibraltar', 'Isle of Man', 'Jersey', 'Guernsey',
]);

/**
 * Case-insensitive check: is this string a known country name?
 * We build a lowercase lookup set lazily for performance.
 */
let _lowercaseSet: Set<string> | null = null;
function getLowercaseSet(): Set<string> {
  if (!_lowercaseSet) {
    _lowercaseSet = new Set(
      Array.from(ALL_COUNTRY_NAMES).map(n => n.toLowerCase())
    );
  }
  return _lowercaseSet;
}

export function isCountryName(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  // Fast path: exact match
  if (ALL_COUNTRY_NAMES.has(trimmed)) return true;
  // Slower path: case-insensitive
  return getLowercaseSet().has(trimmed.toLowerCase());
}
