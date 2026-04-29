/**
 * International phone number formatting utility.
 * Formats raw digit strings and partially formatted numbers into
 * a consistent international display format.
 */

/**
 * Strip everything except digits and leading +
 */
function stripPhone(raw: string): string {
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Format a phone number for display in international format.
 * - 10-digit US numbers → +1 (XXX) XXX-XXXX
 * - 11-digit starting with 1 → +1 (XXX) XXX-XXXX
 * - Other lengths → +{country code} grouped digits
 * Returns the original string if it can't be parsed.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  
  const cleaned = stripPhone(phone.trim());
  if (!cleaned) return phone;

  // Extract digits (remove leading +)
  let digits = cleaned.replace(/^\+/, '');
  
  // US/Canada: 10 digits or 11 starting with 1
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const mid = digits.slice(3, 6);
    const last = digits.slice(6);
    return `+1 (${area}) ${mid}-${last}`;
  }
  
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const mid = digits.slice(4, 7);
    const last = digits.slice(7);
    return `+1 (${area}) ${mid}-${last}`;
  }
  
  // UK: 44 + 10 digits
  if (digits.length >= 11 && digits.startsWith('44')) {
    const rest = digits.slice(2);
    // Group as +44 XXXX XXX XXX
    return `+44 ${rest.slice(0, 4)} ${rest.slice(4, 7)} ${rest.slice(7)}`.trim();
  }
  
  // Israel: 972 + 9 digits
  if (digits.startsWith('972')) {
    const rest = digits.slice(3);
    return `+972 ${rest.slice(0, 2)}-${rest.slice(2, 5)}-${rest.slice(5)}`.trim();
  }
  
  // Generic international: +CC XXXX XXXX...
  if (digits.length > 10) {
    // Try to identify country code (1-3 digits)
    // Group remaining digits in blocks of 3-4
    let cc = '';
    let rest = '';
    if (digits.startsWith('1')) {
      cc = '1';
      rest = digits.slice(1);
    } else if (['20','27','30','31','32','33','34','36','39','40','41','43','45','46','47','48','49','51','52','53','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98'].includes(digits.slice(0, 2))) {
      cc = digits.slice(0, 2);
      rest = digits.slice(2);
    } else if (digits.length >= 3) {
      cc = digits.slice(0, 3);
      rest = digits.slice(3);
    }
    
    if (cc && rest) {
      // Group in chunks of 3-4
      const groups: string[] = [];
      for (let i = 0; i < rest.length; i += 4) {
        groups.push(rest.slice(i, i + 4));
      }
      return `+${cc} ${groups.join(' ')}`.trim();
    }
  }
  
  // Short numbers or already formatted — just ensure + prefix if digits only
  if (/^\d+$/.test(cleaned) && digits.length >= 7) {
    return `+${digits}`;
  }
  
  // Fallback: return original
  return phone;
}

/**
 * Format phone number as the user types (for input fields).
 * Formats US numbers progressively: +1 (XXX) XXX-XXXX
 * Returns the formatted string for display in the input.
 */
export function formatPhoneInput(value: string): string {
  const raw = value.trim();
  const startsInternational = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (!digits) return startsInternational ? '+' : '';

  if (startsInternational) {
    if (digits.startsWith('1')) return formatNanpInput(digits);
    return formatInternationalInput(digits);
  }

  // US is the default when the user types digits without a country code.
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  return formatNanpInput(digits);
}

function formatNanpInput(digitsWithOptionalCountryCode: string): string {
  const digits = digitsWithOptionalCountryCode.startsWith('1')
    ? digitsWithOptionalCountryCode.slice(1)
    : digitsWithOptionalCountryCode;
  const d = digits.slice(0, 10);

  if (d.length <= 3) return `+1 (${d}`;
  if (d.length <= 6) return `+1 (${d.slice(0, 3)}) ${d.slice(3)}`;
  return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatInternationalInput(digits: string): string {
  const countryCode = resolveCountryCode(digits);
  const rest = digits.slice(countryCode.length);
  if (!rest) return `+${countryCode}`;

  const groups: string[] = [];
  for (let i = 0; i < rest.length; i += 3) {
    groups.push(rest.slice(i, i + 3));
  }

  return `+${countryCode} ${groups.join(' ')}`;
}

function resolveCountryCode(digits: string): string {
  const knownCodes = [
    '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43',
    '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56',
    '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84',
    '86', '90', '91', '92', '93', '94', '95', '98', '212', '213', '216',
    '218', '220', '221', '222', '223', '224', '225', '226', '227', '228',
    '229', '230', '231', '232', '233', '234', '235', '236', '237', '238',
    '239', '240', '241', '242', '243', '244', '245', '246', '248', '249',
    '250', '251', '252', '253', '254', '255', '256', '257', '258', '260',
    '261', '262', '263', '264', '265', '266', '267', '268', '269', '290',
    '291', '297', '298', '299', '350', '351', '352', '353', '354', '355',
    '356', '357', '358', '359', '370', '371', '372', '373', '374', '375',
    '376', '377', '378', '380', '381', '382', '383', '385', '386', '387',
    '389', '420', '421', '423', '500', '501', '502', '503', '504', '505',
    '506', '507', '508', '509', '590', '591', '592', '593', '594', '595',
    '596', '597', '598', '599', '670', '672', '673', '674', '675', '676',
    '677', '678', '679', '680', '681', '682', '683', '685', '686', '687',
    '688', '689', '690', '691', '692', '850', '852', '853', '855', '856',
    '880', '886', '960', '961', '962', '963', '964', '965', '966', '967',
    '968', '970', '971', '972', '973', '974', '975', '976', '977', '992',
    '993', '994', '995', '996', '998'
  ];

  const three = digits.slice(0, 3);
  const two = digits.slice(0, 2);
  if (knownCodes.includes(three)) return three;
  if (knownCodes.includes(two)) return two;
  return digits.slice(0, Math.min(3, digits.length));
}

/**
 * Extract raw digits from a formatted phone string (for storage/API calls).
 */
export function phoneToDigits(formatted: string): string {
  return formatted.replace(/\D/g, '');
}
