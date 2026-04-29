
// Disposable email domains list (Top common ones)
export const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', 'throwawaymail.com', 'guerrillamail.com', 'mailinator.com', 
  'yopmail.com', 'getnada.com', 'maildrop.cc', 'sharklasers.com', 'temp-mail.org',
  '10minutemail.com', 'fakeinbox.com', 'trashmail.com', 'mintemail.com',
  'mailnes.com', 'mailfa.com', 'bodhis.com', 'cannabis.com', 'o2.pl', 
  'dispostable.com', 'guerillamail.com', 'incognitomail.com', 'kmail.com',
  '33mail.com', 'anonbox.net', 'antichef.com', 'antispam.de', 'baxomail.com',
  'bigstring.com', 'binkmail.com', 'bio-part.com', 'bobmail.info', 'bodhi.law',
  'boximail.com', 'brefmail.com', 'bsnow.net', 'ce.mintemail.com', 'clgs.net',
  'click2mail.com', 'clrmail.com', 'corsica.us', 'cust.in', 'dbprof.com',
  'dodgeit.com', 'doramail.com', 'duskmail.com', 'easytrashmail.com', 'email.com',
  'emailproxsy.com', 'emailto.de', 'eml.cc', 'etranquil.com', 'evomonkey.com',
  'expert50.com', 'expressoweb.co.uk', 'fackme.com', 'fastchems.com',
  'fastmail.fm', 'filzmail.com', 'fivestarjerseys.com', 'fleckens.hu',
  'flyspam.com', 'freeletter.me', 'freenet.de', 'freenet.name', 'freenet.net',
  'fremont.k12.ca.us', 'front14.org', 'fuck.org', 'funnisms.com', 'galac.org',
  'gawab.com', 'gishpuppy.com', 'globe-l.com', 'gmx.com', 'gmx.de', 'gmx.net',
  'gmx.us', 'godmail.com', 'gosmail.com', 'gawab.com', 'greenmail.net',
  'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.com', 'gustr.com', 'h00p.com', 'h8s.org', 'haloshits.com',
  'harakirimail.com', 'hazelnut.org', 'hellokitty.com', 'hissyfit.org',
  'hush.com', 'hushmail.com', 'hushmail.me', 'hydra.net', 'ifost.org.au',
  'ilovepics.co.cc', 'imgof.com', 'imisscindy.com', 'inbox.com', 'inbox.lv',
  'inbox.ru', 'inboxclean.com', 'incognitomail.org', 'inorbit.com', 'inout.com',
  'insorg-mail.info', 'interia.pl', 'internal-mail.com', 'investigator.net',
  'ip6.li', 'isburg.net', 'isdn.net', 'iuvab.com', 'iximail.com', 'iyipi.com',
  'j-o-g.com', 'j.o.g.com', 'jab.de', 'jaja.com', 'jam.rr.nu', 'jetable.com',
  'jetable.net', 'jetable.org', 'jiffymail.com', 'jij.com', 'jit.com',
  'jkl.com', 'job.com', 'jobq.com', 'jobs.com', 'johndoe.com', 'jollyroger.com',
  'jotmail.com', 'joymail.com', 'jp.dk', 'jp.net', 'jpp.de', 'jpp.net',
  'jps.net', 'js.com', 'jsmith.com', 'jump.com', 'justemail.com', 'justemail.net',
  'justmail.com', 'justmail.de', 'justmail.net', 'justmail.org', 'juz.de',
  'k-o-l.com', 'k.o.l.com', 'ka.com', 'kad.com', 'kal.com', 'kam.com',
  'kan.com', 'kang.com', 'kap.com', 'kar.com', 'kas.com', 'kat.com',
  'kb.com', 'kc.com', 'kd.com', 'ke.com', 'keemail.me'
]);

// Common typos map
export const TYPO_DOMAINS: Record<string, string> = {
  'gamil.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'yhoo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'iclod.com': 'icloud.com'
};

export const ROLE_BASED_PREFIXES = new Set([
  'admin', 'support', 'sales', 'info', 'help', 'contact', 'hello', 'marketing',
  'billing', 'accounts', 'hr', 'jobs', 'careers', 'press', 'media', 'enquiries',
  'inquiries', 'team', 'staff', 'office', 'reception', 'frontdesk', 'webmaster',
  'postmaster', 'hostmaster', 'abuse', 'noreply', 'no-reply', 'bounce'
]);

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  isRoleBased: boolean;
  isDisposable: boolean;
  suggestion?: string;
  mxFound: boolean;
}

/**
 * FAST validation - only syntax and disposable checks (no MX lookup)
 */
export function validateEmailFast(email: string): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    isRoleBased: false,
    isDisposable: false,
    mxFound: true // Assume valid since we're not checking
  };

  if (!email || typeof email !== 'string') {
    result.isValid = false;
    result.reason = 'Empty or invalid input';
    return result;
  }

  const cleanEmail = email.toLowerCase().trim();
  
  // Check for multiple @ symbols
  const atCount = (cleanEmail.match(/@/g) || []).length;
  if (atCount !== 1) {
    result.isValid = false;
    result.reason = atCount === 0 ? 'Missing @ symbol' : 'Multiple @ symbols';
    return result;
  }
  
  const [localPart, domain] = cleanEmail.split('@');

  // 1. Syntax Check
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!emailRegex.test(cleanEmail) || !domain || !localPart) {
    result.isValid = false;
    result.reason = 'Invalid email syntax';
    return result;
  }

  if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
    result.isValid = false;
    result.reason = 'Invalid domain syntax';
    return result;
  }
  
  // Check for valid TLD (must have a dot and valid extension)
  if (!domain.includes('.')) {
    result.isValid = false;
    result.reason = 'Missing domain extension';
    return result;
  }
  
  const tld = domain.split('.').pop() || '';
  if (tld.length < 2 || !/^[a-z]{2,}$/.test(tld)) {
    result.isValid = false;
    result.reason = 'Invalid domain extension';
    return result;
  }

  // 2. Check for obviously fake patterns
  const fakePatterns = [
    'noemail', 'no-email', 'none', 'n/a', 'na@', 'null', 'undefined',
    'placeholder', 'example', 'test@test', 'fake', 'dummy', 'sample',
    '123456', 'aaaaaa', 'email@email', 'user@user', 'contact@contact'
  ];
  if (fakePatterns.some(pattern => cleanEmail.includes(pattern))) {
    result.isValid = false;
    result.reason = 'Obviously fake email pattern';
    return result;
  }

  // 3. Disposable Domain Check
  if (DISPOSABLE_DOMAINS.has(domain)) {
    result.isDisposable = true;
    result.isValid = false;
    result.reason = 'Disposable domain detected';
    return result;
  }

  // 4. Typo Check
  if (TYPO_DOMAINS[domain]) {
    result.suggestion = `${localPart}@${TYPO_DOMAINS[domain]}`;
    result.isValid = false;
    result.reason = `Likely typo (did you mean ${TYPO_DOMAINS[domain]}?)`;
    return result;
  }

  // 5. Role-Based Check (keep but don't invalidate)
  if (ROLE_BASED_PREFIXES.has(localPart)) {
    result.isRoleBased = true;
  }

  return result;
}

/**
 * Validates an email address using syntax, disposable lists, and MX record lookups.
 */
export async function validateEmailDeep(email: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    isValid: true,
    isRoleBased: false,
    isDisposable: false,
    mxFound: false
  };

  if (!email || typeof email !== 'string') {
    result.isValid = false;
    result.reason = 'Empty or invalid input';
    return result;
  }

  const cleanEmail = email.toLowerCase().trim();
  const [localPart, domain] = cleanEmail.split('@');

  // 1. Syntax Check
  // More comprehensive regex that forbids double dots, starting/ending dots, etc.
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!emailRegex.test(cleanEmail) || !domain || !localPart) {
    result.isValid = false;
    result.reason = 'Invalid email syntax';
    return result;
  }

  if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
    result.isValid = false;
    result.reason = 'Invalid domain syntax';
    return result;
  }

  // 2. Disposable Domain Check
  if (DISPOSABLE_DOMAINS.has(domain)) {
    result.isDisposable = true;
    result.isValid = false;
    result.reason = 'Disposable domain detected';
    return result;
  }

  // 3. Typo Check
  if (TYPO_DOMAINS[domain]) {
    result.suggestion = `${localPart}@${TYPO_DOMAINS[domain]}`;
    // We don't necessarily fail validation, but we can flag it. 
    // Usually a typo means it WILL bounce, so let's mark invalid but provide suggestion.
    result.isValid = false;
    result.reason = `Likely typo (did you mean ${TYPO_DOMAINS[domain]}?)`;
    return result;
  }

  // 4. Role-Based Check
  if (ROLE_BASED_PREFIXES.has(localPart)) {
    result.isRoleBased = true;
    // We do NOT mark as invalid, but this info is useful for scoring.
  }

  // 5. MX Record Check (The "Amazing" Part)
  // Using Google DNS-over-HTTPS for reliability in serverless
  try {
    const dnsUrl = `https://dns.google/resolve?name=${domain}&type=MX`;
    const dnsResponse = await fetch(dnsUrl, {
      headers: { 'Accept': 'application/dns-json' }
    });

    if (dnsResponse.ok) {
      const dnsData = await dnsResponse.json();
      
      // Check if we have answers and they are MX records (type 15)
      if (dnsData.Answer && dnsData.Answer.some((a: any) => a.type === 15)) {
        result.mxFound = true;
      } else {
        // No MX records found? Check for A record (fallback for some older mail servers)
        const aUrl = `https://dns.google/resolve?name=${domain}&type=A`;
        const aResponse = await fetch(aUrl, { headers: { 'Accept': 'application/dns-json' } });
        const aData = await aResponse.json();
        
        if (aData.Answer && aData.Answer.some((a: any) => a.type === 1)) {
           // Has A record, technically can receive mail but rare for business domains without MX
           // We'll consider it "Risky" but technically valid-ish. 
           // For high quality, we might want to flag this.
           result.mxFound = true; 
        } else {
           result.mxFound = false;
           result.isValid = false;
           result.reason = 'Domain has no valid mail servers (MX/A records missing)';
        }
      }
    }
  } catch (error) {
    console.warn(`DNS check failed for ${domain}:`, error);
    // Fail open? Or fail closed? 
    // If DNS check fails due to network, we shouldn't mark as bounced immediately.
    // But if we want "amazing" quality, we should probably warn.
  }

  return result;
}
