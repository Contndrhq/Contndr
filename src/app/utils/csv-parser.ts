/**
 * Intelligent CSV Parser for Contndr
 * Handles various column name formats and combines address fields
 */

import { parseApolloCSV, type ParsedLead } from './apollo-csv-parser';

/**
 * Convert Apollo parsed format to flat format for backward compatibility
 */
function apolloToFlat(apolloLeads: ParsedLead[]): any[] {
  return apolloLeads.map(item => {
    const flat: any = {};
    
    // Combine first/last name
    if (item.lead.first_name || item.lead.last_name) {
      flat.contact_name = [item.lead.first_name, item.lead.last_name].filter(Boolean).join(' ');
    }
    
    // Use primary email
    if (item.emails.length > 0) {
      flat.email = item.emails[0].email;
    }
    
    // Use first available phone
    if (item.phones.length > 0) {
      flat.phone = item.phones[0].phone;
    }
    
    // Company info - MAP ALL FIELDS
    flat.business_name = item.company.name || flat.contact_name;
    flat.name_for_emails = item.company.name_for_emails;
    flat.website = item.company.website;
    flat.industry = item.company.industry;
    flat.category = item.company.industry;
    flat.employees = item.company.employees;
    flat.keywords = item.company.keywords;
    flat.company_phone = item.company.company_phone;
    flat.linkedin_url = item.company.linkedin_url;
    flat.facebook_url = item.company.facebook_url;
    flat.twitter_url = item.company.twitter_url;
    flat.technologies = item.company.technologies;
    flat.apollo_account_id = item.company.apollo_account_id;
    
    // Financial fields - ADD ALL OF THESE
    flat.annual_revenue = item.company.annual_revenue;
    flat.total_funding = item.company.total_funding;
    flat.latest_funding = item.company.latest_funding;
    flat.latest_funding_amount = item.company.latest_funding_amount;
    flat.last_raised_at = item.company.last_raised_at;
    flat.subsidiary_of = item.company.subsidiary_of;
    flat.number_of_retail_locations = item.company.number_of_retail_locations;
    
    // Location fields
    flat.city = item.lead.city || item.company.city;
    flat.state = item.lead.state || item.company.state;
    flat.country = item.lead.country || item.company.country;
    flat.address = item.company.address_full;
    
    // Lead info
    flat.job_title = item.lead.title;
    flat.seniority = item.lead.seniority;
    flat.linkedin = item.lead.person_linkedin_url;
    flat.person_linkedin_url = item.lead.person_linkedin_url;
    flat.stage = item.lead.stage;
    flat.account_owner = item.lead.account_owner;
    flat.last_contacted = item.lead.last_contacted;
    flat.apollo_contact_id = item.lead.apollo_contact_id;
    flat.departments = item.lead.departments;
    flat.lists = item.lead.lists;
    
    // Engagement flags
    flat.email_sent = item.lead.email_sent;
    flat.email_open = item.lead.email_open;
    flat.email_bounced = item.lead.email_bounced;
    flat.replied = item.lead.replied;
    flat.demoed = item.lead.demoed;
    
    // Build notes from additional info only (not duplicating what's in fields)
    const noteParts: string[] = [];
    
    // Add all secondary emails
    if (item.emails.length > 1) {
      const secondaryEmails = item.emails.slice(1).map(e => e.email).join(', ');
      noteParts.push(`Additional Emails: ${secondaryEmails}`);
    }
    
    // Add all other phones
    if (item.phones.length > 1) {
      const otherPhones = item.phones.slice(1).map(p => `${p.type}: ${p.phone}`).join(', ');
      noteParts.push(`Additional Phones: ${otherPhones}`);
    }
    
    // Add custom fields
    if (Object.keys(item.custom_fields).length > 0) {
      for (const [key, value] of Object.entries(item.custom_fields)) {
        noteParts.push(`${key}: ${value}`);
      }
    }
    
    if (noteParts.length > 0) {
      flat.notes = noteParts.join('\n');
    }
    
    return flat;
  });
}

/**
 * Auto-detect CSV format and parse accordingly
 */
export function parseCSV(text: string) {
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
    const apolloLeads = parseApolloCSV(text);
    const flatLeads = apolloToFlat(apolloLeads);
    console.log(`Converted ${flatLeads.length} Apollo leads to flat format`);
    return flatLeads;
  }
  
  // Otherwise use simple parser
  console.log('Detected simple CSV format');
  return parseSimpleCSV(text);
}

/**
 * Simple CSV parser for non-Apollo formats
 */
function parseSimpleCSV(text: string) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  // Parse headers - keep original for debugging
  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const headers = rawHeaders.map(h => h.toLowerCase());
  
  console.log('CSV Headers detected:', rawHeaders);
  
  const result = [];
  
  for (let i = 1; i < lines.length; i++) {
    const row = [];
    let inQuote = false;
    let currentValue = '';
    
    // Parse CSV row respecting quotes
    for (const char of lines[i]) {
      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        row.push(currentValue.trim().replace(/^"|"$/g, ''));
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    row.push(currentValue.trim().replace(/^"|"$/g, ''));
    
    if (row.length >= headers.length * 0.5) { 
      const obj: any = {};
      const addressParts: string[] = [];
      
      headers.forEach((h, index) => {
        if (index >= row.length) return;
        const value = row[index]?.trim();
        if (!value) return; // Skip empty values
        
        let key = h;
        
        // Email & Phone
        if (h.includes('mail') || h.includes('email')) {
          key = 'email';
        }
        else if (h.includes('phone') || h.includes('tel') || h.includes('mobile') || h.includes('cell')) {
          key = 'phone';
        }
        
        // Name handling - combine first/last automatically
        else if (h.includes('first') && h.includes('name')) {
          obj.contact_name = value;
          return;
        }
        else if (h.includes('last') && h.includes('name')) {
          if (obj.contact_name) {
            obj.contact_name += ' ' + value;
          } else {
            obj.contact_name = value;
          }
          return;
        }
        else if (h.includes('full') && h.includes('name')) {
          key = 'contact_name';
        }
        else if (h.includes('person') || h.includes('contact')) {
          key = 'contact_name';
        }
        
        // Business name - prioritize company-specific columns
        else if (h.includes('company') || h.includes('business') || h.includes('organization') || h.includes('account')) {
          key = 'business_name';
        }
        else if (h.includes('firm') || h.includes('corp')) {
          key = 'business_name';
        }
        else if (h === 'name' && !obj.business_name) {
          // Plain "name" likely means business name
          key = 'business_name';
        }
        
        // Website
        else if (h.includes('web') || h.includes('url') || h.includes('site') || h.includes('domain')) {
          key = 'website';
        }
        
        // Address components - collect them to combine later
        else if (h.includes('street') || (h.includes('address') && !h.includes('email'))) {
          // If it's a "full address" or just "address", use it directly
          if (h === 'address' || h.includes('full') || h.includes('complete')) {
            key = 'address';
            obj[key] = value;
            return;
          }
          addressParts.push(value);
          return;
        }
        else if (h === 'city' || h.includes('city')) {
          if (!obj.address) { // Only add to parts if we don't have a full address already
            addressParts.push(value);
          }
          obj.city = value; // Also save city separately
          return;
        }
        else if (h.includes('state') || h.includes('province') || h.includes('region')) {
          if (!obj.address) {
            addressParts.push(value);
          }
          obj.state = value; // Also save state separately
          return;
        }
        else if (h.includes('zip') || h.includes('postal')) {
          if (!obj.address) {
            addressParts.push(value);
          }
          return;
        }
        else if (h.includes('country')) {
          // Only add country if not USA (assumed default)
          const lowerValue = value.toLowerCase();
          if (!obj.address && !['united states', 'usa', 'us', 'united states of america'].includes(lowerValue)) {
            addressParts.push(value);
          }
          obj.country = value; // Also save country separately
          return;
        }
        
        // Other standard fields
        else if (h.includes('note') || h.includes('desc') || h.includes('comment')) {
          key = 'notes';
        }
        else if (h.includes('title') || h.includes('role') || h.includes('position') || h.includes('job')) {
          key = 'job_title';
        }
        else if (h.includes('linkedin') || h.includes('linked')) {
          key = 'linkedin';
        }
        else if (h.includes('employee') || h.includes('size') || h.includes('staff') || h.includes('headcount')) {
          key = 'employees';
        }
        else if (h.includes('key') || h.includes('tag')) {
          key = 'keywords';
        }
        else if (h.includes('industry') || h.includes('sector') || h.includes('vertical')) {
          key = 'industry';
        }
        else if (h.includes('category') || h.includes('type')) {
          key = 'category';
        }
        
        // Assign the value
        obj[key] = value;
      });
      
      // Combine address parts into single field (only if we don't already have a full address)
      if (addressParts.length > 0 && !obj.address) {
        obj.address = addressParts.join(', ');
      }
      
      // Fallback for business name if missing
      if (!obj.business_name) {
        if (obj.contact_name) {
          obj.business_name = obj.contact_name;
        } else if (obj.email) {
          const domain = obj.email.split('@')[1];
          if (domain) {
            // Extract company name from domain (e.g., "acme.com" -> "Acme")
            const companyName = domain.split('.')[0];
            obj.business_name = companyName.charAt(0).toUpperCase() + companyName.slice(1);
          } else {
            obj.business_name = obj.email.split('@')[0];
          }
        }
      }
      
      // Only include rows with at least a business name or email
      if (obj.business_name || obj.email) {
        result.push(obj);
      }
    }
  }
  
  console.log(`Parsed ${result.length} leads from CSV`);
  if (result.length > 0) {
    console.log('First lead sample:', result[0]);
    console.log('Last lead sample:', result[result.length - 1]);
  }
  
  return result;
}