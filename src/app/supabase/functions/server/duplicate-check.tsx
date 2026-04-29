// Duplicate checking utility
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

export async function checkDuplicatesAndFilter(leads: any[], userId: string) {
  if (leads.length === 0) {
    return { newLeads: [], duplicates: 0, details: [] };
  }
  
  console.log(`🔍 Checking ${leads.length} leads for duplicates...`);
  
  const phones = leads.map(l => l.phone).filter(Boolean);
  const emails = leads.map(l => l.email).filter(Boolean);
  
  let existingLeads: any[] = [];
  
  // Query for existing leads by phone or email
  if (phones.length > 0 || emails.length > 0) {
    const conditions = [];
    
    if (phones.length > 0) {
      conditions.push(`phone.in.(${phones.join(',')})`);
    }
    if (emails.length > 0) {
      conditions.push(`email.in.(${emails.join(',')})`);
    }
    
    const { data: existing, error } = await supabase
      .from('leads')
      .select('phone, email, business_name')
      .eq('user_id', userId)
      .or(conditions.join(','));
    
    if (!error && existing) {
      existingLeads = existing;
    }
  }
  
  // Also fetch existing leads by name+company for secondary dedup
  let existingNameCompany = new Set<string>();
  {
    // Fetch a broader set for name+company matching (limit to recent 10k to avoid huge queries)
    const { data: ncLeads } = await supabase
      .from('leads')
      .select('contact_name, business_name')
      .eq('user_id', userId)
      .not('contact_name', 'is', null)
      .not('business_name', 'is', null)
      .limit(10000);
    if (ncLeads) {
      for (const l of ncLeads) {
        const key = `${(l.contact_name || '').toLowerCase().trim()}||${(l.business_name || '').toLowerCase().trim()}`;
        if (key !== '||') existingNameCompany.add(key);
      }
    }
  }

  // Create lookup sets
  const existingPhones = new Set(existingLeads.map(l => l.phone).filter(Boolean));
  const existingEmails = new Set(existingLeads.map(l => l.email).filter(Boolean));
  
  // Track within-batch dedup to prevent importing dupes within the same CSV
  const batchEmails = new Set<string>();
  const batchNameCompany = new Set<string>();

  // Filter and track duplicates
  const duplicateDetails: any[] = [];
  const newLeads = leads.filter(lead => {
    const isDuplicateByPhone = lead.phone && existingPhones.has(lead.phone);
    const isDuplicateByEmail = lead.email && existingEmails.has(lead.email);
    
    // Within-batch email dedup
    const emailKey = (lead.email || '').toLowerCase().trim();
    const isDuplicateInBatchByEmail = emailKey && batchEmails.has(emailKey);

    // Name + company dedup (existing DB + within batch)
    const nameCompanyKey = `${(lead.contact_name || '').toLowerCase().trim()}||${(lead.business_name || '').toLowerCase().trim()}`;
    const hasNameCompany = nameCompanyKey !== '||' && (lead.contact_name || '').trim() && (lead.business_name || '').trim();
    const isDuplicateByNameCompany = hasNameCompany && existingNameCompany.has(nameCompanyKey);
    const isDuplicateInBatchByNameCompany = hasNameCompany && batchNameCompany.has(nameCompanyKey);
    
    if (isDuplicateByPhone || isDuplicateByEmail || isDuplicateByNameCompany || isDuplicateInBatchByEmail || isDuplicateInBatchByNameCompany) {
      const reason = isDuplicateByPhone ? 'phone' : isDuplicateByEmail ? 'email' : isDuplicateInBatchByEmail ? 'email (batch)' : isDuplicateByNameCompany ? 'name+company' : 'name+company (batch)';
      duplicateDetails.push({
        business_name: lead.business_name,
        reason,
        value: isDuplicateByPhone ? lead.phone : (lead.email || `${lead.contact_name} @ ${lead.business_name}`),
      });
      return false;
    }
    
    // Track in batch sets
    if (emailKey) batchEmails.add(emailKey);
    if (hasNameCompany) batchNameCompany.add(nameCompanyKey);

    return true;
  });
  
  const duplicatesCount = leads.length - newLeads.length;
  
  if (duplicatesCount > 0) {
    console.log(`⚠️  Found ${duplicatesCount} duplicate leads`);
    console.log(`✅ ${newLeads.length} new leads to import`);
  } else {
    console.log(`✅ All ${newLeads.length} leads are new`);
  }
  
  return {
    newLeads,
    duplicates: duplicatesCount,
    details: duplicateDetails,
  };
}
