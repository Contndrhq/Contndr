// City Field Data Cleanup Utility for Contndr
// Fixes pollution in the leads table city field where coordinates or other invalid data exists

interface CleanupResult {
  total_leads_scanned: number;
  issues_found: number;
  fixes_applied: number;
  errors: number;
  issues_by_type: {
    coordinates_in_city: number;
    empty_city: number;
    invalid_format: number;
    too_long: number;
  };
  sample_fixes: Array<{
    lead_id: string;
    business_name: string;
    before: string;
    after: string;
    fix_type: string;
  }>;
}

/**
 * Detect if a city field contains coordinates (starts with @ or contains lat/lng pattern)
 */
function hasCoordinatesInCity(city: string | null): boolean {
  if (!city) return false;
  
  // Check for @ symbol (coordinate marker)
  if (city.startsWith('@')) return true;
  
  // Check for lat/lng patterns like "12.34,-56.78" or "(12.34, -56.78)"
  const coordPattern = /^[\(\[]?\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*[\)\]]?$/;
  if (coordPattern.test(city.trim())) return true;
  
  return false;
}

/**
 * Extract city name from an address string
 */
function extractCityFromAddress(address: string | null): string | null {
  if (!address) return null;
  
  // Common US address patterns:
  // "123 Main St, Springfield, IL 62701"
  // "456 Oak Ave, Los Angeles, CA"
  // "789 Elm Street, New York, NY 10001"
  
  const parts = address.split(',').map(s => s.trim());
  
  if (parts.length >= 2) {
    // City is typically the second-to-last part (before state/zip)
    const cityCandidate = parts[parts.length - 2];
    
    // Remove state abbreviations and zip codes from city name
    const cleaned = cityCandidate
      .replace(/\b[A-Z]{2}\b/g, '') // Remove state codes like CA, NY
      .replace(/\b\d{5}(-\d{4})?\b/g, '') // Remove zip codes
      .trim();
    
    if (cleaned.length >= 2 && cleaned.length <= 50) {
      return cleaned;
    }
  }
  
  return null;
}

/**
 * Validate if a city name looks reasonable
 */
function isValidCityName(city: string | null): boolean {
  if (!city || city.trim().length === 0) return false;
  
  const trimmed = city.trim();
  
  // Too short or too long
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  
  // Contains obvious coordinate markers
  if (hasCoordinatesInCity(trimmed)) return false;
  
  // Contains mostly numbers (likely coordinates or zip code)
  const numberRatio = (trimmed.match(/\d/g) || []).length / trimmed.length;
  if (numberRatio > 0.5) return false;
  
  // Contains special characters that don't belong in city names
  if (/[@$%^&*()+=\[\]{}|\\<>]/.test(trimmed)) return false;
  
  return true;
}

/**
 * Analyze leads table for city field issues
 */
export async function analyzeCityFieldIssues(supabase: any, userId: string): Promise<{
  total_leads: number;
  issues: {
    coordinates_in_city: number;
    empty_city: number;
    invalid_format: number;
    too_long: number;
  };
  sample_issues: Array<{
    lead_id: string;
    business_name: string;
    city: string | null;
    address: string | null;
    issue_type: string;
  }>;
}> {
  console.log(`[CITY-CLEANUP] Analyzing city field issues for user ${userId}...`);
  
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, business_name, city, address')
    .eq('user_id', userId)
    .limit(5000); // Process in batches for large datasets
  
  if (error) {
    console.error('[CITY-CLEANUP] Error fetching leads:', error);
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  const issues = {
    coordinates_in_city: 0,
    empty_city: 0,
    invalid_format: 0,
    too_long: 0
  };

  const sampleIssues: Array<{
    lead_id: string;
    business_name: string;
    city: string | null;
    address: string | null;
    issue_type: string;
  }> = [];

  for (const lead of leads || []) {
    let issueType: string | null = null;

    if (!lead.city || lead.city.trim() === '') {
      issues.empty_city++;
      issueType = 'empty_city';
    } else if (hasCoordinatesInCity(lead.city)) {
      issues.coordinates_in_city++;
      issueType = 'coordinates_in_city';
    } else if (lead.city.length > 100) {
      issues.too_long++;
      issueType = 'too_long';
    } else if (!isValidCityName(lead.city)) {
      issues.invalid_format++;
      issueType = 'invalid_format';
    }

    if (issueType && sampleIssues.length < 20) {
      sampleIssues.push({
        lead_id: lead.id,
        business_name: lead.business_name || 'Unknown',
        city: lead.city,
        address: lead.address,
        issue_type: issueType
      });
    }
  }

  const totalIssues = Object.values(issues).reduce((sum, count) => sum + count, 0);

  console.log(`[CITY-CLEANUP] Analysis complete: ${totalIssues} issues found out of ${leads?.length || 0} leads`);
  console.log(`[CITY-CLEANUP] Breakdown:`, issues);

  return {
    total_leads: leads?.length || 0,
    issues,
    sample_issues: sampleIssues
  };
}

/**
 * Fix city field data pollution in the leads table
 */
export async function cleanupCityField(
  supabase: any,
  userId: string,
  options: {
    dryRun?: boolean;
    fixCoordinates?: boolean;
    fillEmptyCities?: boolean;
    removeInvalidCities?: boolean;
  } = {}
): Promise<CleanupResult> {
  const {
    dryRun = false,
    fixCoordinates = true,
    fillEmptyCities = true,
    removeInvalidCities = true
  } = options;

  console.log(`[CITY-CLEANUP] Starting cleanup for user ${userId}${dryRun ? ' (DRY RUN)' : ''}...`);
  console.log(`[CITY-CLEANUP] Options:`, { fixCoordinates, fillEmptyCities, removeInvalidCities });

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, business_name, city, address, state')
    .eq('user_id', userId)
    .limit(5000);

  if (error) {
    console.error('[CITY-CLEANUP] Error fetching leads:', error);
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  const result: CleanupResult = {
    total_leads_scanned: leads?.length || 0,
    issues_found: 0,
    fixes_applied: 0,
    errors: 0,
    issues_by_type: {
      coordinates_in_city: 0,
      empty_city: 0,
      invalid_format: 0,
      too_long: 0
    },
    sample_fixes: []
  };

  const updates: Array<{ id: string; city: string | null }> = [];

  for (const lead of leads || []) {
    let needsFix = false;
    let newCity: string | null = lead.city;
    let fixType = '';

    // Fix 1: Coordinates in city field
    if (fixCoordinates && hasCoordinatesInCity(lead.city)) {
      result.issues_by_type.coordinates_in_city++;
      result.issues_found++;
      needsFix = true;
      fixType = 'coordinates_removed';
      
      // Try to extract city from address
      const extractedCity = extractCityFromAddress(lead.address);
      newCity = extractedCity || null;
    }
    // Fix 2: Empty city but address exists
    else if (fillEmptyCities && (!lead.city || lead.city.trim() === '') && lead.address) {
      result.issues_by_type.empty_city++;
      result.issues_found++;
      needsFix = true;
      fixType = 'extracted_from_address';
      
      const extractedCity = extractCityFromAddress(lead.address);
      newCity = extractedCity;
    }
    // Fix 3: Invalid city format
    else if (removeInvalidCities && lead.city && !isValidCityName(lead.city)) {
      if (lead.city.length > 100) {
        result.issues_by_type.too_long++;
      } else {
        result.issues_by_type.invalid_format++;
      }
      result.issues_found++;
      needsFix = true;
      fixType = 'invalid_format_cleared';
      
      // Try to extract from address, otherwise clear
      const extractedCity = extractCityFromAddress(lead.address);
      newCity = extractedCity || null;
    }

    if (needsFix && newCity !== lead.city) {
      updates.push({ id: lead.id, city: newCity });
      
      if (result.sample_fixes.length < 10) {
        result.sample_fixes.push({
          lead_id: lead.id,
          business_name: lead.business_name || 'Unknown',
          before: lead.city || '(empty)',
          after: newCity || '(empty)',
          fix_type: fixType
        });
      }
    }
  }

  result.fixes_applied = updates.length;

  // Apply updates if not a dry run
  if (!dryRun && updates.length > 0) {
    console.log(`[CITY-CLEANUP] Applying ${updates.length} fixes...`);
    
    // Update in batches of 100
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      try {
        for (const update of batch) {
          const { error: updateError } = await supabase
            .from('leads')
            .update({ city: update.city })
            .eq('id', update.id)
            .eq('user_id', userId); // Security: ensure user owns this lead

          if (updateError) {
            console.error(`[CITY-CLEANUP] Error updating lead ${update.id}:`, updateError);
            result.errors++;
          }
        }
        
        console.log(`[CITY-CLEANUP] Processed batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(updates.length / batchSize)}`);
      } catch (err) {
        console.error(`[CITY-CLEANUP] Batch update error:`, err);
        result.errors += batch.length;
      }
    }
    
    console.log(`[CITY-CLEANUP] Cleanup complete. ${result.fixes_applied} fixes applied, ${result.errors} errors.`);
  } else if (dryRun) {
    console.log(`[CITY-CLEANUP] DRY RUN complete. Would have applied ${result.fixes_applied} fixes.`);
  } else {
    console.log(`[CITY-CLEANUP] No fixes needed.`);
  }

  return result;
}
