/**
 * Apollo CSV Parser for Contndr
 * Handles complex Apollo.io export format with all metadata
 * Maps to normalized schema: companies, leads, lead_emails, lead_phones, lead_custom_fields
 */

export interface ParsedLead {
  // Lead fields
  lead: {
    first_name?: string;
    last_name?: string;
    title?: string;
    seniority?: string;
    departments?: string[]; // JSON array
    stage?: string;
    lists?: string[]; // JSON array
    account_owner?: string;
    last_contacted?: string; // ISO timestamp
    person_linkedin_url?: string;
    city?: string;
    state?: string;
    country?: string;
    email_sent?: boolean;
    email_open?: boolean;
    email_bounced?: boolean;
    replied?: boolean;
    demoed?: boolean;
    apollo_contact_id?: string;
    raw_source: string; // "Apollo CSV"
  };
  
  // Company fields
  company: {
    name?: string;
    name_for_emails?: string;
    website?: string;
    industry?: string;
    keywords?: string;
    linkedin_url?: string;
    facebook_url?: string;
    twitter_url?: string;
    company_phone?: string;
    address_full?: string;
    city?: string;
    state?: string;
    country?: string;
    annual_revenue?: number;
    total_funding?: number;
    latest_funding?: string;
    latest_funding_amount?: number;
    last_raised_at?: string; // ISO timestamp
    subsidiary_of?: string;
    number_of_retail_locations?: number;
    employees?: string; // Store as text: "51-200", "500-1000", etc.
    technologies?: string;
    apollo_account_id?: string;
  };
  
  // Email records
  emails: Array<{
    email: string;
    type: 'primary' | 'secondary' | 'tertiary' | 'other';
    status?: string;
    source?: string;
    verification_source?: string;
    confidence?: string;
    catch_all_status?: string;
    last_verified_at?: string; // ISO timestamp
  }>;
  
  // Phone records
  phones: Array<{
    phone: string;
    type: 'work_direct' | 'home' | 'mobile' | 'corporate' | 'other';
  }>;
  
  // Custom fields (anything not mapped above)
  custom_fields: Record<string, any>;
}

/**
 * Parse CSV text into structured lead data
 */
export function parseApolloCSV(text: string): ParsedLead[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  // Parse headers - keep original for custom field detection
  const rawHeaders = parseCSVRow(lines[0]);
  const headerMap = buildHeaderMap(rawHeaders);
  
  console.log('CSV Headers detected:', rawHeaders.length, 'columns');
  console.log('Known fields mapped:', Object.keys(headerMap.knownFields).length);
  console.log('Custom fields detected:', headerMap.customFields.length);
  
  const results: ParsedLead[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (row.length < rawHeaders.length * 0.3) continue; // Skip mostly empty rows
    
    const parsed = parseRow(rawHeaders, row, headerMap);
    if (parsed) {
      results.push(parsed);
    }
  }
  
  console.log(`Parsed ${results.length} leads from Apollo CSV`);
  if (results.length > 0) {
    console.log('First lead sample:', {
      name: `${results[0].lead.first_name} ${results[0].lead.last_name}`,
      company: results[0].company.name,
      emails: results[0].emails.length,
      phones: results[0].phones.length
    });
  }
  
  return results;
}

/**
 * Parse a single CSV row respecting quotes and commas
 */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      // Check for escaped quote ""
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuote = !inQuote;
      }
    } else if (char === ',' && !inQuote) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Build a map of header indices to field types
 */
function buildHeaderMap(headers: string[]) {
  const knownFields: Record<string, number> = {};
  const customFields: string[] = [];
  
  headers.forEach((header, index) => {
    const normalized = header.toLowerCase().trim();
    const mapped = mapHeaderToField(normalized, header);
    
    if (mapped) {
      knownFields[mapped] = index;
    } else {
      // Unknown field - will go to custom_fields
      customFields.push(header);
    }
  });
  
  return { knownFields, customFields };
}

/**
 * Map header name to internal field name
 * Returns null if header should go to custom_fields
 */
function mapHeaderToField(normalized: string, original: string): string | null {
  // Lead fields
  if (normalized === 'first name') return 'lead.first_name';
  if (normalized === 'last name') return 'lead.last_name';
  if (normalized === 'title') return 'lead.title';
  if (normalized === 'seniority') return 'lead.seniority';
  if (normalized === 'departments') return 'lead.departments';
  if (normalized === 'stage') return 'lead.stage';
  if (normalized === 'lists') return 'lead.lists';
  if (normalized === 'account owner') return 'lead.account_owner';
  if (normalized === 'last contacted') return 'lead.last_contacted';
  if (normalized === 'person linkedin url') return 'lead.person_linkedin_url';
  if (normalized === 'city' && !normalized.includes('company') && !normalized.includes('account')) return 'lead.city';
  if (normalized === 'person city') return 'lead.city';
  if (normalized === 'state' && !normalized.includes('company') && !normalized.includes('account')) return 'lead.state';
  if (normalized === 'person state') return 'lead.state';
  if (normalized === 'country' && !normalized.includes('company') && !normalized.includes('account')) return 'lead.country';
  if (normalized === 'person country') return 'lead.country';
  if (normalized === 'apollo contact id') return 'lead.apollo_contact_id';
  
  // Email fields (primary)
  if (normalized === 'email') return 'email.primary';
  if (normalized === 'email status') return 'email.primary.status';
  if (normalized === 'primary email source') return 'email.primary.source';
  if (normalized === 'primary email verification source') return 'email.primary.verification_source';
  if (normalized === 'email confidence') return 'email.primary.confidence';
  if (normalized === 'primary email catch-all status') return 'email.primary.catch_all_status';
  if (normalized === 'primary email last verified at') return 'email.primary.last_verified_at';
  
  // Email fields (secondary)
  if (normalized === 'secondary email') return 'email.secondary';
  if (normalized === 'secondary email source') return 'email.secondary.source';
  if (normalized === 'secondary email status') return 'email.secondary.status';
  if (normalized === 'secondary email verification source') return 'email.secondary.verification_source';
  
  // Email fields (tertiary)
  if (normalized === 'tertiary email') return 'email.tertiary';
  if (normalized === 'tertiary email source') return 'email.tertiary.source';
  if (normalized === 'tertiary email status') return 'email.tertiary.status';
  if (normalized === 'tertiary email verification source') return 'email.tertiary.verification_source';
  
  // Phone fields
  if (normalized === 'work direct phone') return 'phone.work_direct';
  if (normalized === 'home phone') return 'phone.home';
  if (normalized === 'mobile phone') return 'phone.mobile';
  if (normalized === 'corporate phone') return 'phone.corporate';
  if (normalized === 'other phone') return 'phone.other';
  
  // Company fields
  if (normalized === 'company name') return 'company.name';
  if (normalized === 'account name') return 'company.name';
  if (normalized === 'company name for emails') return 'company.name_for_emails';
  if (normalized === 'website') return 'company.website';
  if (normalized === 'company linkedin url') return 'company.linkedin_url';
  if (normalized === 'facebook url') return 'company.facebook_url';
  if (normalized === 'twitter url') return 'company.twitter_url';
  if (normalized === 'company phone') return 'company.company_phone';
  if (normalized === 'company address') return 'company.address_full';
  if (normalized === 'account address') return 'company.address_full';
  if (normalized === 'address') return 'company.address_full';
  if (normalized === 'street address') return 'company.address_full';
  if (normalized === 'full address') return 'company.address_full';
  if (normalized === 'location') return 'company.address_full';
  if (normalized === 'company location') return 'company.address_full';
  if (normalized === 'company city') return 'company.city';
  if (normalized === 'account city') return 'company.city';
  if (normalized === 'company state') return 'company.state';
  if (normalized === 'account state') return 'company.state';
  if (normalized === 'company country') return 'company.country';
  if (normalized === 'account country') return 'company.country';
  if (normalized === 'employees') return 'company.employees';
  if (normalized === 'industry') return 'company.industry';
  if (normalized === 'keywords') return 'company.keywords';
  if (normalized === 'technologies') return 'company.technologies';
  if (normalized === 'annual revenue') return 'company.annual_revenue';
  if (normalized === 'total funding') return 'company.total_funding';
  if (normalized === 'latest funding') return 'company.latest_funding';
  if (normalized === 'latest funding amount') return 'company.latest_funding_amount';
  if (normalized === 'last raised at') return 'company.last_raised_at';
  if (normalized === 'subsidiary of') return 'company.subsidiary_of';
  if (normalized === 'number of retail locations') return 'company.number_of_retail_locations';
  if (normalized === 'apollo account id') return 'company.apollo_account_id';
  
  // Engagement fields
  if (normalized === 'email sent') return 'lead.email_sent';
  if (normalized === 'email open') return 'lead.email_open';
  if (normalized === 'email bounced') return 'lead.email_bounced';
  if (normalized === 'replied') return 'lead.replied';
  if (normalized === 'demoed') return 'lead.demoed';
  
  // Not a known field - will go to custom_fields
  return null;
}

/**
 * Parse a single row into structured lead data
 */
function parseRow(headers: string[], row: string[], headerMap: any): ParsedLead | null {
  const getValue = (field: string): string | undefined => {
    const index = headerMap.knownFields[field];
    if (index === undefined) return undefined;
    const value = row[index]?.trim();
    return value || undefined;
  };
  
  const getBoolValue = (field: string): boolean => {
    const value = getValue(field);
    if (!value) return false;
    const lower = value.toLowerCase();
    return lower === 'true' || lower === 'yes' || lower === '1';
  };
  
  const getNumericValue = (field: string): number | undefined => {
    const value = getValue(field);
    if (!value) return undefined;
    const cleaned = value.replace(/[^0-9.-]/g, ''); // Remove currency symbols, commas
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  };
  
  const getArrayValue = (field: string): string[] | undefined => {
    const value = getValue(field);
    if (!value) return undefined;
    // Handle both JSON arrays and comma-separated lists
    if (value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch {
        return value.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return value.split(',').map(s => s.trim()).filter(Boolean);
  };
  
  // Build lead object
  const lead = {
    first_name: getValue('lead.first_name'),
    last_name: getValue('lead.last_name'),
    title: getValue('lead.title'),
    seniority: getValue('lead.seniority'),
    departments: getArrayValue('lead.departments'),
    stage: getValue('lead.stage') || 'Cold',
    lists: getArrayValue('lead.lists'),
    account_owner: getValue('lead.account_owner'),
    last_contacted: getValue('lead.last_contacted'),
    person_linkedin_url: getValue('lead.person_linkedin_url'),
    city: getValue('lead.city'),
    state: getValue('lead.state'),
    country: getValue('lead.country'),
    email_sent: getBoolValue('lead.email_sent'),
    email_open: getBoolValue('lead.email_open'),
    email_bounced: getBoolValue('lead.email_bounced'),
    replied: getBoolValue('lead.replied'),
    demoed: getBoolValue('lead.demoed'),
    apollo_contact_id: getValue('lead.apollo_contact_id'),
    raw_source: 'Apollo CSV'
  };
  
  // Build company object
  const company = {
    name: getValue('company.name'),
    name_for_emails: getValue('company.name_for_emails'),
    website: getValue('company.website'),
    industry: getValue('company.industry'),
    keywords: getValue('company.keywords'),
    linkedin_url: getValue('company.linkedin_url'),
    facebook_url: getValue('company.facebook_url'),
    twitter_url: getValue('company.twitter_url'),
    company_phone: getValue('company.company_phone'),
    address_full: getValue('company.address_full'),
    city: getValue('company.city'),
    state: getValue('company.state'),
    country: getValue('company.country'),
    annual_revenue: getNumericValue('company.annual_revenue'),
    total_funding: getNumericValue('company.total_funding'),
    latest_funding: getValue('company.latest_funding'),
    latest_funding_amount: getNumericValue('company.latest_funding_amount'),
    last_raised_at: getValue('company.last_raised_at'),
    subsidiary_of: getValue('company.subsidiary_of'),
    number_of_retail_locations: getNumericValue('company.number_of_retail_locations'),
    employees: getValue('company.employees'),
    technologies: getValue('company.technologies'),
    apollo_account_id: getValue('company.apollo_account_id')
  };
  
  // Build emails array
  const emails: ParsedLead['emails'] = [];
  
  const primaryEmail = getValue('email.primary');
  if (primaryEmail) {
    emails.push({
      email: primaryEmail,
      type: 'primary',
      status: getValue('email.primary.status'),
      source: getValue('email.primary.source'),
      verification_source: getValue('email.primary.verification_source'),
      confidence: getValue('email.primary.confidence'),
      catch_all_status: getValue('email.primary.catch_all_status'),
      last_verified_at: getValue('email.primary.last_verified_at')
    });
  }
  
  const secondaryEmail = getValue('email.secondary');
  if (secondaryEmail) {
    emails.push({
      email: secondaryEmail,
      type: 'secondary',
      status: getValue('email.secondary.status'),
      source: getValue('email.secondary.source'),
      verification_source: getValue('email.secondary.verification_source')
    });
  }
  
  const tertiaryEmail = getValue('email.tertiary');
  if (tertiaryEmail) {
    emails.push({
      email: tertiaryEmail,
      type: 'tertiary',
      status: getValue('email.tertiary.status'),
      source: getValue('email.tertiary.source'),
      verification_source: getValue('email.tertiary.verification_source')
    });
  }
  
  // Build phones array
  const phones: ParsedLead['phones'] = [];
  
  const workPhone = getValue('phone.work_direct');
  if (workPhone) phones.push({ phone: workPhone, type: 'work_direct' });
  
  const homePhone = getValue('phone.home');
  if (homePhone) phones.push({ phone: homePhone, type: 'home' });
  
  const mobilePhone = getValue('phone.mobile');
  if (mobilePhone) phones.push({ phone: mobilePhone, type: 'mobile' });
  
  const corporatePhone = getValue('phone.corporate');
  if (corporatePhone) phones.push({ phone: corporatePhone, type: 'corporate' });
  
  const otherPhone = getValue('phone.other');
  if (otherPhone) phones.push({ phone: otherPhone, type: 'other' });
  
  // Build custom fields
  const custom_fields: Record<string, any> = {};
  
  headerMap.customFields.forEach((header: string) => {
    const index = headers.indexOf(header);
    if (index >= 0 && row[index]) {
      const value = row[index].trim();
      if (value) {
        custom_fields[header] = value;
      }
    }
  });
  
  // Require at least a name or email or company
  if (!lead.first_name && !lead.last_name && emails.length === 0 && !company.name) {
    return null;
  }
  
  return {
    lead,
    company,
    emails,
    phones,
    custom_fields
  };
}

/**
 * Fallback parser for simple CSVs (backwards compatibility)
 * NOTE: Removed circular require('./csv-parser') dependency.
 * If you need the simple parser, import parseCSV from csv-parser.ts directly.
 */
export function parseSimpleCSV(_text: string) {
  console.warn('parseSimpleCSV called from apollo-csv-parser — use parseCSV from csv-parser.ts instead');
  return [];
}

/**
 * Auto-detect CSV format and use appropriate parser
 */
export function parseCSVAuto(text: string) {
  const firstLine = text.split('\n')[0]?.toLowerCase() || '';
  
  // Check for Apollo CSV indicators
  const apolloIndicators = [
    'apollo contact id',
    'apollo account id',
    'primary email source',
    'company name for emails',
    'secondary email',
    'work direct phone'
  ];
  
  const isApolloFormat = apolloIndicators.some(indicator => 
    firstLine.includes(indicator)
  );
  
  if (isApolloFormat) {
    console.log('Detected Apollo CSV format - using advanced parser');
    return parseApolloCSV(text);
  } else {
    console.log('Detected simple CSV format - using basic parser');
    return parseSimpleCSV(text);
  }
}