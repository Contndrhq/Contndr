/**
 * Data Backfill & Cleanup Script
 * 
 * Features:
 * 1. Country backfill - Sets "United States" for leads without country
 * 2. State backfill - Sets default state for leads without state (DEPRECATED - use fixStateMappings instead)
 * 3. City cleanup - Normalizes city names (LA → Los Angeles, NYC → New York, etc.)
 * 4. State mapping fix - Intelligently corrects state based on city name
 * 
 * Recent Enhancement (2026-02-14):
 * - Added intelligent handling of truncated city names
 * - Fixes data corruption like "New, California" → "New York, New York"
 * - Fixes "Los, California" → "Los Angeles, California"
 * - Comprehensive city-to-state mapping for 300+ US cities
 */

import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Backfill country field for all leads
 * Sets to "United States" by default since all current leads are US-based
 */
export async function backfillCountryData(userId: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log('[COUNTRY BACKFILL] Starting backfill for user:', userId);
    
    // PHASE 1: Process in batches without loading all into memory
    const pageSize = 500;
    const updateBatchSize = 500;
    let page = 0;
    let hasMore = true;
    let totalUpdated = 0;
    const maxPages = 20; // Limit to prevent timeout
    
    while (hasMore && page < maxPages) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error: fetchError } = await supabase
        .from('leads')
        .select('id')
        .eq('user_id', userId)
        .or('country.is.null,country.eq.')
        .order('id', { ascending: true })
        .range(from, to);

      if (fetchError) {
        console.error('[COUNTRY BACKFILL] Error fetching leads page', page + 1, ':', fetchError);
        throw fetchError;
      }

      const batch = leads || [];
      console.log(`[COUNTRY BACKFILL] Processing page ${page + 1}: ${batch.length} leads`);
      
      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      // Update this batch
      const batchIds = batch.map(lead => lead.id);
      
      const { data: updatedLeads, error: updateError } = await supabase
        .from('leads')
        .update({ country: 'United States' })
        .in('id', batchIds)
        .select('id');

      if (updateError) {
        console.error(`[COUNTRY BACKFILL] Error updating batch ${page + 1}:`, updateError);
        throw updateError;
      }

      const batchCount = updatedLeads?.length || 0;
      totalUpdated += batchCount;
      console.log(`[COUNTRY BACKFILL] Updated batch ${page + 1}: ${batchCount} leads (total: ${totalUpdated})`);
      
      if (batch.length < pageSize) {
        hasMore = false;
      }
      page++;
    }

    console.log(`[COUNTRY BACKFILL] Successfully updated ${totalUpdated} leads`);

    return {
      success: true,
      updated: totalUpdated,
      message: `Successfully set country to "United States" for ${totalUpdated} leads`
    };

  } catch (error: any) {
    console.error('[COUNTRY BACKFILL] Fatal error:', error);
    return {
      success: false,
      updated: 0,
      error: error.message
    };
  }
}

/**
 * Comprehensive mapping of US cities to their states
 * This is used for intelligent state backfilling based on city names
 */
const CITY_TO_STATE: Record<string, string> = {
  // Alabama
  'Birmingham': 'Alabama', 'Montgomery': 'Alabama', 'Mobile': 'Alabama', 'Huntsville': 'Alabama',
  
  // Alaska
  'Anchorage': 'Alaska', 'Fairbanks': 'Alaska', 'Juneau': 'Alaska',
  
  // Arizona
  'Phoenix': 'Arizona', 'Tucson': 'Arizona', 'Mesa': 'Arizona', 'Chandler': 'Arizona', 
  'Scottsdale': 'Arizona', 'Glendale': 'Arizona', 'Tempe': 'Arizona', 'Peoria': 'Arizona',
  
  // Arkansas
  'Little Rock': 'Arkansas', 'Fort Smith': 'Arkansas', 'Fayetteville': 'Arkansas',
  
  // California
  'Los Angeles': 'California', 'San Diego': 'California', 'San Jose': 'California', 
  'San Francisco': 'California', 'Fresno': 'California', 'Sacramento': 'California',
  'Long Beach': 'California', 'Oakland': 'California', 'Bakersfield': 'California',
  'Anaheim': 'California', 'Santa Ana': 'California', 'Riverside': 'California',
  'Stockton': 'California', 'Irvine': 'California', 'Fremont': 'California',
  'San Bernardino': 'California', 'Modesto': 'California', 'Oxnard': 'California',
  'Fontana': 'California', 'Moreno Valley': 'California', 'Glendale': 'California',
  'Huntington Beach': 'California', 'Santa Clarita': 'California', 'Oceanside': 'California',
  'Garden Grove': 'California', 'Santa Rosa': 'California', 'Ontario': 'California',
  'Rancho Cucamonga': 'California', 'Elk Grove': 'California', 'Corona': 'California',
  'Pasadena': 'California', 'Sunnyvale': 'California', 'Berkeley': 'California',
  'Palo Alto': 'California', 'Mountain View': 'California', 'Santa Barbara': 'California',
  'Redwood City': 'California', 'Cupertino': 'California', 'Burbank': 'California',
  'Carlsbad': 'California', 'Chula Vista': 'California',
  
  // Colorado
  'Denver': 'Colorado', 'Colorado Springs': 'Colorado', 'Aurora': 'Colorado', 
  'Fort Collins': 'Colorado', 'Lakewood': 'Colorado', 'Thornton': 'Colorado',
  'Arvada': 'Colorado', 'Westminster': 'Colorado', 'Boulder': 'Colorado',
  
  // Connecticut
  'Bridgeport': 'Connecticut', 'New Haven': 'Connecticut', 'Hartford': 'Connecticut',
  'Stamford': 'Connecticut', 'Waterbury': 'Connecticut',
  
  // Delaware
  'Wilmington': 'Delaware', 'Dover': 'Delaware', 'Newark': 'Delaware',
  
  // Florida
  'Jacksonville': 'Florida', 'Miami': 'Florida', 'Tampa': 'Florida', 
  'Orlando': 'Florida', 'St. Petersburg': 'Florida', 'Hialeah': 'Florida',
  'Tallahassee': 'Florida', 'Fort Lauderdale': 'Florida', 'Port St. Lucie': 'Florida',
  'Cape Coral': 'Florida', 'Pembroke Pines': 'Florida', 'Hollywood': 'Florida',
  'Miramar': 'Florida', 'Gainesville': 'Florida', 'Coral Springs': 'Florida',
  'Miami Beach': 'Florida', 'Clearwater': 'Florida', 'Fort Myers': 'Florida',
  'Lakeland': 'Florida', 'West Palm Beach': 'Florida', 'Boca Raton': 'Florida',
  'Naples': 'Florida', 'Sarasota': 'Florida',
  
  // Georgia
  'Atlanta': 'Georgia', 'Augusta': 'Georgia', 'Columbus': 'Georgia', 
  'Savannah': 'Georgia', 'Athens': 'Georgia', 'Sandy Springs': 'Georgia',
  'Roswell': 'Georgia', 'Macon': 'Georgia', 'Johns Creek': 'Georgia',
  
  // Hawaii
  'Honolulu': 'Hawaii', 'Pearl City': 'Hawaii', 'Hilo': 'Hawaii',
  
  // Idaho
  'Boise': 'Idaho', 'Meridian': 'Idaho', 'Nampa': 'Idaho', 'Idaho Falls': 'Idaho',
  
  // Illinois
  'Chicago': 'Illinois', 'Aurora': 'Illinois', 'Rockford': 'Illinois', 
  'Joliet': 'Illinois', 'Naperville': 'Illinois', 'Springfield': 'Illinois',
  'Peoria': 'Illinois', 'Elgin': 'Illinois', 'Waukegan': 'Illinois',
  'Champaign': 'Illinois', 'Bloomington': 'Illinois', 'Evanston': 'Illinois',
  
  // Indiana
  'Indianapolis': 'Indiana', 'Fort Wayne': 'Indiana', 'Evansville': 'Indiana',
  'South Bend': 'Indiana', 'Carmel': 'Indiana', 'Fishers': 'Indiana',
  'Bloomington': 'Indiana',
  
  // Iowa
  'Des Moines': 'Iowa', 'Cedar Rapids': 'Iowa', 'Davenport': 'Iowa',
  'Sioux City': 'Iowa', 'Iowa City': 'Iowa',
  
  // Kansas
  'Wichita': 'Kansas', 'Overland Park': 'Kansas', 'Kansas City': 'Kansas',
  'Topeka': 'Kansas', 'Olathe': 'Kansas',
  
  // Kentucky
  'Louisville': 'Kentucky', 'Lexington': 'Kentucky', 'Bowling Green': 'Kentucky',
  'Owensboro': 'Kentucky',
  
  // Louisiana
  'New Orleans': 'Louisiana', 'Baton Rouge': 'Louisiana', 'Shreveport': 'Louisiana',
  'Lafayette': 'Louisiana', 'Lake Charles': 'Louisiana', 'Kenner': 'Louisiana',
  'Bossier City': 'Louisiana',
  
  // Maine
  'Portland': 'Maine', 'Lewiston': 'Maine', 'Bangor': 'Maine',
  
  // Maryland
  'Baltimore': 'Maryland', 'Frederick': 'Maryland', 'Rockville': 'Maryland',
  'Gaithersburg': 'Maryland', 'Bowie': 'Maryland', 'Annapolis': 'Maryland',
  
  // Massachusetts
  'Boston': 'Massachusetts', 'Worcester': 'Massachusetts', 'Springfield': 'Massachusetts',
  'Cambridge': 'Massachusetts', 'Lowell': 'Massachusetts', 'Brockton': 'Massachusetts',
  'New Bedford': 'Massachusetts', 'Quincy': 'Massachusetts', 'Lynn': 'Massachusetts',
  'Newton': 'Massachusetts', 'Somerville': 'Massachusetts',
  
  // Michigan
  'Detroit': 'Michigan', 'Grand Rapids': 'Michigan', 'Warren': 'Michigan',
  'Sterling Heights': 'Michigan', 'Ann Arbor': 'Michigan', 'Lansing': 'Michigan',
  'Flint': 'Michigan', 'Dearborn': 'Michigan', 'Livonia': 'Michigan',
  
  // Minnesota
  'Minneapolis': 'Minnesota', 'St. Paul': 'Minnesota', 'Rochester': 'Minnesota',
  'Duluth': 'Minnesota', 'Bloomington': 'Minnesota',
  
  // Mississippi
  'Jackson': 'Mississippi', 'Gulfport': 'Mississippi', 'Southaven': 'Mississippi',
  'Hattiesburg': 'Mississippi', 'Biloxi': 'Mississippi',
  
  // Missouri
  'Kansas City': 'Missouri', 'St. Louis': 'Missouri', 'Springfield': 'Missouri',
  'Columbia': 'Missouri', 'Independence': 'Missouri',
  
  // Montana
  'Billings': 'Montana', 'Missoula': 'Montana', 'Great Falls': 'Montana',
  
  // Nebraska
  'Omaha': 'Nebraska', 'Lincoln': 'Nebraska', 'Bellevue': 'Nebraska',
  
  // Nevada
  'Las Vegas': 'Nevada', 'Henderson': 'Nevada', 'Reno': 'Nevada',
  'North Las Vegas': 'Nevada', 'Sparks': 'Nevada',
  
  // New Hampshire
  'Manchester': 'New Hampshire', 'Nashua': 'New Hampshire', 'Concord': 'New Hampshire',
  
  // New Jersey
  'Newark': 'New Jersey', 'Jersey City': 'New Jersey', 'Paterson': 'New Jersey',
  'Elizabeth': 'New Jersey', 'Edison': 'New Jersey', 'Woodbridge': 'New Jersey',
  'Lakewood': 'New Jersey', 'Toms River': 'New Jersey', 'Hamilton': 'New Jersey',
  'Trenton': 'New Jersey', 'Clifton': 'New Jersey',
  
  // New Mexico
  'Albuquerque': 'New Mexico', 'Las Cruces': 'New Mexico', 'Rio Rancho': 'New Mexico',
  'Santa Fe': 'New Mexico',
  
  // New York
  'New York': 'New York', 'Buffalo': 'New York', 'Rochester': 'New York',
  'Yonkers': 'New York', 'Syracuse': 'New York', 'Albany': 'New York',
  'New Rochelle': 'New York', 'Mount Vernon': 'New York', 'Schenectady': 'New York',
  'Utica': 'New York', 'White Plains': 'New York', 'Troy': 'New York',
  'Niagara Falls': 'New York', 'Binghamton': 'New York', 'Brooklyn': 'New York',
  'Queens': 'New York', 'Manhattan': 'New York', 'Bronx': 'New York',
  'Staten Island': 'New York',
  
  // North Carolina
  'Charlotte': 'North Carolina', 'Raleigh': 'North Carolina', 'Greensboro': 'North Carolina',
  'Durham': 'North Carolina', 'Winston-Salem': 'North Carolina', 'Fayetteville': 'North Carolina',
  'Cary': 'North Carolina', 'Wilmington': 'North Carolina', 'High Point': 'North Carolina',
  'Asheville': 'North Carolina',
  
  // North Dakota
  'Fargo': 'North Dakota', 'Bismarck': 'North Dakota', 'Grand Forks': 'North Dakota',
  
  // Ohio
  'Columbus': 'Ohio', 'Cleveland': 'Ohio', 'Cincinnati': 'Ohio',
  'Toledo': 'Ohio', 'Akron': 'Ohio', 'Dayton': 'Ohio',
  'Parma': 'Ohio', 'Canton': 'Ohio', 'Youngstown': 'Ohio',
  
  // Oklahoma
  'Oklahoma City': 'Oklahoma', 'Tulsa': 'Oklahoma', 'Norman': 'Oklahoma',
  'Broken Arrow': 'Oklahoma', 'Lawton': 'Oklahoma',
  
  // Oregon
  'Portland': 'Oregon', 'Salem': 'Oregon', 'Eugene': 'Oregon',
  'Gresham': 'Oregon', 'Hillsboro': 'Oregon', 'Beaverton': 'Oregon',
  
  // Pennsylvania
  'Philadelphia': 'Pennsylvania', 'Pittsburgh': 'Pennsylvania', 'Allentown': 'Pennsylvania',
  'Erie': 'Pennsylvania', 'Reading': 'Pennsylvania', 'Scranton': 'Pennsylvania',
  'Bethlehem': 'Pennsylvania', 'Lancaster': 'Pennsylvania', 'Harrisburg': 'Pennsylvania',
  
  // Rhode Island
  'Providence': 'Rhode Island', 'Warwick': 'Rhode Island', 'Cranston': 'Rhode Island',
  
  // South Carolina
  'Columbia': 'South Carolina', 'Charleston': 'South Carolina', 'North Charleston': 'South Carolina',
  'Mount Pleasant': 'South Carolina', 'Rock Hill': 'South Carolina', 'Greenville': 'South Carolina',
  'Summerville': 'South Carolina',
  
  // South Dakota
  'Sioux Falls': 'South Dakota', 'Rapid City': 'South Dakota', 'Aberdeen': 'South Dakota',
  
  // Tennessee
  'Nashville': 'Tennessee', 'Memphis': 'Tennessee', 'Knoxville': 'Tennessee',
  'Chattanooga': 'Tennessee', 'Clarksville': 'Tennessee', 'Murfreesboro': 'Tennessee',
  'Franklin': 'Tennessee',
  
  // Texas
  'Houston': 'Texas', 'San Antonio': 'Texas', 'Dallas': 'Texas',
  'Austin': 'Texas', 'Fort Worth': 'Texas', 'El Paso': 'Texas',
  'Arlington': 'Texas', 'Corpus Christi': 'Texas', 'Plano': 'Texas',
  'Laredo': 'Texas', 'Lubbock': 'Texas', 'Garland': 'Texas',
  'Irving': 'Texas', 'Amarillo': 'Texas', 'Grand Prairie': 'Texas',
  'McKinney': 'Texas', 'Frisco': 'Texas', 'Brownsville': 'Texas',
  'Pasadena': 'Texas', 'Killeen': 'Texas', 'McAllen': 'Texas',
  'Waco': 'Texas', 'Carrollton': 'Texas', 'Denton': 'Texas',
  'Midland': 'Texas', 'Abilene': 'Texas', 'Beaumont': 'Texas',
  'Round Rock': 'Texas', 'Odessa': 'Texas', 'Wichita Falls': 'Texas',
  'Richardson': 'Texas', 'Lewisville': 'Texas', 'Tyler': 'Texas',
  'College Station': 'Texas', 'Pearland': 'Texas', 'San Angelo': 'Texas',
  
  // Utah
  'Salt Lake City': 'Utah', 'West Valley City': 'Utah', 'Provo': 'Utah',
  'West Jordan': 'Utah', 'Orem': 'Utah', 'Sandy': 'Utah',
  
  // Vermont
  'Burlington': 'Vermont', 'South Burlington': 'Vermont', 'Rutland': 'Vermont',
  
  // Virginia
  'Virginia Beach': 'Virginia', 'Norfolk': 'Virginia', 'Chesapeake': 'Virginia',
  'Richmond': 'Virginia', 'Newport News': 'Virginia', 'Alexandria': 'Virginia',
  'Hampton': 'Virginia', 'Roanoke': 'Virginia', 'Portsmouth': 'Virginia',
  'Suffolk': 'Virginia', 'Lynchburg': 'Virginia', 'Arlington': 'Virginia',
  
  // Washington
  'Seattle': 'Washington', 'Spokane': 'Washington', 'Tacoma': 'Washington',
  'Vancouver': 'Washington', 'Bellevue': 'Washington', 'Kent': 'Washington',
  'Everett': 'Washington', 'Renton': 'Washington', 'Yakima': 'Washington',
  'Federal Way': 'Washington', 'Spokane Valley': 'Washington', 'Bellingham': 'Washington',
  
  // West Virginia
  'Charleston': 'West Virginia', 'Huntington': 'West Virginia', 'Parkersburg': 'West Virginia',
  
  // Wisconsin
  'Milwaukee': 'Wisconsin', 'Madison': 'Wisconsin', 'Green Bay': 'Wisconsin',
  'Kenosha': 'Wisconsin', 'Racine': 'Wisconsin', 'Appleton': 'Wisconsin',
  
  // Wyoming
  'Cheyenne': 'Wyoming', 'Casper': 'Wyoming', 'Laramie': 'Wyoming',
  
  // Washington DC
  'Washington': 'Washington DC',
  
  // Truncated city names that need special handling
  'New': 'New York',        // Truncated "New York"
  'Los': 'California',      // Truncated "Los Angeles"
};

/**
 * Optimized lowercase city lookup map for O(1) performance
 */
const CITY_TO_STATE_LOWERCASE = Object.entries(CITY_TO_STATE).reduce((acc, [city, state]) => {
  acc[city.toLowerCase()] = state;
  return acc;
}, {} as Record<string, string>);

/**
 * Find the correct state for a city name (case-insensitive) - O(1) lookup
 * Handles truncated city names intelligently
 */
function findStateForCity(cityName: string | null | undefined): string | null {
  if (!cityName || cityName.trim() === '') return null;
  
  const normalized = cityName.trim().toLowerCase();
  
  // First try exact match
  const exactMatch = CITY_TO_STATE_LOWERCASE[normalized];
  if (exactMatch) return exactMatch;
  
  // Handle common truncated city names
  const truncationMap: Record<string, string> = {
    'new': 'New York',           // "New" → "New York, New York"
    'los': 'California',         // "Los" → most likely "Los Angeles, California"
    'san': 'California',         // "San" → could be SF, SD, SJ (default to California)
    'fort': 'Texas',             // "Fort" → likely Fort Worth
    'saint': 'Minnesota',        // "Saint" → likely St. Paul/Minneapolis area
    'st': 'Minnesota',           // "St" → likely St. Paul
    'mount': 'New York',         // "Mount" → likely Mount Vernon, NY
    'port': 'Florida',           // "Port" → likely Port St. Lucie, FL
    'south': 'Indiana',          // "South" → likely South Bend
    'north': 'South Carolina',   // "North" → likely North Charleston
    'west': 'Florida',           // "West" → likely West Palm Beach
    'east': 'California',        // "East" → likely East Los Angeles
  };
  
  const truncatedMatch = truncationMap[normalized];
  if (truncatedMatch) return truncatedMatch;
  
  return null;
}

/**
 * DEPRECATED: This function blindly sets all leads to one state
 * Use fixStateMappings() instead to intelligently map cities to states
 */
export async function backfillStateData(userId: string, defaultState: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log('[STATE BACKFILL] ⚠️ WARNING: This function blindly sets all leads to one state!');
    console.log('[STATE BACKFILL] Use fixStateMappings() instead for intelligent city-to-state mapping');
    console.log('[STATE BACKFILL] Starting backfill for user:', userId, 'with default state:', defaultState);
    
    // PHASE 1: Fetch ALL leads without state via pagination (Supabase caps at 1000 per query)
    const allLeadsToUpdate: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    
    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error: fetchError } = await supabase
        .from('leads')
        .select('id, business_name, city, state, country')
        .eq('user_id', userId)
        .or('state.is.null,state.eq.')
        .order('id', { ascending: true })
        .range(from, to);

      if (fetchError) {
        console.error('[STATE BACKFILL] Error fetching leads page', page + 1, ':', fetchError);
        throw fetchError;
      }

      const batch = leads || [];
      console.log(`[STATE BACKFILL] Fetched page ${page + 1}: ${batch.length} leads`);
      allLeadsToUpdate.push(...batch);
      
      if (batch.length < pageSize) hasMore = false;
      page++;
    }

    console.log(`[STATE BACKFILL] Total leads fetched: ${allLeadsToUpdate.length} across ${page} pages`);

    if (allLeadsToUpdate.length === 0) {
      console.log('[STATE BACKFILL] No leads found without state data');
      return {
        success: true,
        updated: 0,
        message: 'All leads already have state data'
      };
    }

    // PHASE 2: Update in batches of 500 IDs at a time
    let totalUpdated = 0;
    const updateBatchSize = 500;
    
    for (let i = 0; i < allLeadsToUpdate.length; i += updateBatchSize) {
      const batch = allLeadsToUpdate.slice(i, i + updateBatchSize);
      const batchIds = batch.map(lead => lead.id);
      
      const { data: updatedLeads, error: updateError } = await supabase
        .from('leads')
        .update({ state: defaultState })
        .in('id', batchIds)
        .select('id');

      if (updateError) {
        console.error(`[STATE BACKFILL] Error updating batch ${Math.floor(i / updateBatchSize) + 1}:`, updateError);
        throw updateError;
      }

      const batchCount = updatedLeads?.length || 0;
      totalUpdated += batchCount;
      console.log(`[STATE BACKFILL] Updated batch ${Math.floor(i / updateBatchSize) + 1}: ${batchCount} leads (total: ${totalUpdated})`);
    }

    console.log(`[STATE BACKFILL] Successfully updated ${totalUpdated} leads`);

    return {
      success: true,
      updated: totalUpdated,
      message: `Successfully set state to "${defaultState}" for ${totalUpdated} leads`
    };

  } catch (error: any) {
    console.error('[STATE BACKFILL] Fatal error:', error);
    return {
      success: false,
      updated: 0,
      error: error.message
    };
  }
}

/**
 * Fix state mappings by intelligently matching cities to their correct states
 * This corrects data corrupted by the old blind backfillStateData function
 * Also fixes truncated city names (e.g., "New" → "New York", "Los" → "Los Angeles")
 */
export async function fixStateMappings(userId: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log('[FIX STATE MAPPINGS] Starting intelligent state mapping for user:', userId);
    
    // PHASE 1: Fetch leads in smaller batches and process incrementally
    const pageSize = 500; // Reduced from 1000
    let page = 0;
    let totalUpdated = 0;
    let hasMore = true;
    const maxPages = 20; // Limit to 10,000 leads per run to prevent timeout
    
    while (hasMore && page < maxPages) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error: fetchError } = await supabase
        .from('leads')
        .select('id, city, state')
        .eq('user_id', userId)
        .not('city', 'is', null)
        .order('id', { ascending: true })
        .range(from, to);

      if (fetchError) {
        console.error('[FIX STATE MAPPINGS] Error fetching leads page', page + 1, ':', fetchError);
        throw fetchError;
      }

      const batch = leads || [];
      console.log(`[FIX STATE MAPPINGS] Processing page ${page + 1}: ${batch.length} leads`);
      
      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      // PHASE 2: Identify leads that need corrections in this batch
      const leadsToUpdate: Array<{ id: number; newState: string; newCity?: string }> = [];

      for (const lead of batch) {
        if (!lead.city || lead.city.trim() === '') continue;
        
        // Normalize city name first (handles truncations like "New" → "New York")
        const normalizedCity = normalizeCity(lead.city);
        const cityToUse = normalizedCity || lead.city;
        
        // Find correct state for the (possibly normalized) city
        const correctState = findStateForCity(cityToUse);
        
        if (correctState) {
          const needsUpdate = 
            lead.state !== correctState || // State is wrong
            (normalizedCity && lead.city !== normalizedCity); // City name needs normalization
          
          if (needsUpdate) {
            leadsToUpdate.push({
              id: lead.id,
              newState: correctState,
              ...(normalizedCity && lead.city !== normalizedCity ? { newCity: normalizedCity } : {})
            });
          }
        }
      }

      // PHASE 3: Update this batch
      if (leadsToUpdate.length > 0) {
        console.log(`[FIX STATE MAPPINGS] Updating ${leadsToUpdate.length} leads in batch ${page + 1}`);
        
        // Update in smaller sub-batches
        const updateBatchSize = 50;
        for (let i = 0; i < leadsToUpdate.length; i += updateBatchSize) {
          const subBatch = leadsToUpdate.slice(i, i + updateBatchSize);
          
          const updatePromises = subBatch.map(lead => {
            const updateData: any = { state: lead.newState };
            if (lead.newCity) {
              updateData.city = lead.newCity;
            }
            
            return supabase
              .from('leads')
              .update(updateData)
              .eq('id', lead.id)
              .select('id');
          });

          const results = await Promise.all(updatePromises);
          const successCount = results.filter(r => !r.error && r.data && r.data.length > 0).length;
          totalUpdated += successCount;
        }
      }
      
      if (batch.length < pageSize) {
        hasMore = false;
      }
      page++;
    }

    console.log(`[FIX STATE MAPPINGS] Successfully updated ${totalUpdated} leads across ${page} pages`);

    return {
      success: true,
      updated: totalUpdated,
      message: totalUpdated > 0 
        ? `Successfully corrected state mappings and city names for ${totalUpdated} leads`
        : 'All city-to-state mappings are already correct',
    };

  } catch (error: any) {
    console.error('[FIX STATE MAPPINGS] Fatal error:', error);
    return {
      success: false,
      updated: 0,
      error: error.message
    };
  }
}

/**
 * Analyze state mapping issues - find cities with incorrect states
 */
export async function analyzeStateMappings(userId: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log('[ANALYZE STATE MAPPINGS] Starting analysis for user:', userId);
    
    // Analyze in batches without loading everything into memory
    const pageSize = 500;
    let page = 0;
    let hasMore = true;
    const maxPages = 20; // Limit to prevent timeout
    
    const issues: any[] = [];
    let correctCount = 0;
    let noStateCount = 0;
    let noCityCount = 0;
    let totalProcessed = 0;
    
    while (hasMore && page < maxPages) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error } = await supabase
        .from('leads')
        .select('id, business_name, city, state')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to);

      if (error) throw error;

      const batch = leads || [];
      totalProcessed += batch.length;
      
      for (const lead of batch) {
        if (!lead.city || lead.city.trim() === '') {
          noCityCount++;
          continue;
        }

        if (!lead.state || lead.state.trim() === '') {
          noStateCount++;
          continue;
        }
        
        // Normalize the city name first (to handle truncations)
        const normalizedCity = normalizeCity(lead.city);
        const cityToCheck = normalizedCity || lead.city;
        
        const correctState = findStateForCity(cityToCheck);
        
        if (correctState && lead.state !== correctState) {
          // Only keep first 100 samples to prevent memory issues
          if (issues.length < 100) {
            issues.push({
              id: lead.id,
              business_name: lead.business_name,
              city: lead.city,
              normalizedCity: normalizedCity !== lead.city ? normalizedCity : undefined,
              currentState: lead.state,
              correctState: correctState,
            });
          }
        } else if (correctState) {
          correctCount++;
        }
      }
      
      if (batch.length < pageSize) {
        hasMore = false;
      }
      page++;
    }

    console.log(`[ANALYZE STATE MAPPINGS] Analyzed ${totalProcessed} leads across ${page} pages`);

    const stats = {
      total: totalProcessed,
      correct: correctCount,
      incorrect: issues.length,
      noState: noStateCount,
      noCity: noCityCount,
      samples: issues.slice(0, 20),
      topIssues: getTopStateIssues(issues)
    };

    return { success: true, stats };

  } catch (error: any) {
    console.error('[ANALYZE STATE MAPPINGS] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get the most common incorrect state mappings
 */
function getTopStateIssues(issues: any[]): Array<{ incorrectState: string; count: number; examples: string[] }> {
  const issueMap = new Map<string, { count: number; examples: Set<string> }>();
  
  issues.forEach(issue => {
    const key = issue.currentState;
    if (!issueMap.has(key)) {
      issueMap.set(key, { count: 0, examples: new Set() });
    }
    const data = issueMap.get(key)!;
    data.count++;
    if (data.examples.size < 5) {
      const cityDisplay = issue.normalizedCity 
        ? `"${issue.city}" (will be "${issue.normalizedCity}")` 
        : issue.city;
      data.examples.add(`${cityDisplay} should be ${issue.correctState}`);
    }
  });

  return Array.from(issueMap.entries())
    .map(([state, data]) => ({
      incorrectState: state,
      count: data.count,
      examples: Array.from(data.examples)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/**
 * Get state statistics for a user's leads
 */
export async function getStateStats(userId: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Process in smaller batches to prevent timeout
    const pageSize = 500;
    let page = 0;
    let hasMore = true;
    const maxPages = 20;
    
    const stateMap = new Map<string, number>();
    let nullCount = 0;
    let totalCount = 0;
    
    while (hasMore && page < maxPages) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error } = await supabase
        .from('leads')
        .select('state')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to);

      if (error) throw error;

      const batch = leads || [];
      
      batch.forEach(lead => {
        totalCount++;
        if (!lead.state || lead.state.trim() === '') {
          nullCount++;
        } else {
          stateMap.set(lead.state, (stateMap.get(lead.state) || 0) + 1);
        }
      });
      
      if (batch.length < pageSize) hasMore = false;
      page++;
    }

    console.log(`[STATE STATS] Processed ${totalCount} leads across ${page} pages`);

    const stats = {
      total: totalCount,
      without_state: nullCount,
      by_state: Array.from(stateMap.entries()).map(([state, count]) => ({
        state,
        count
      })).sort((a, b) => b.count - a.count)
    };

    return { success: true, stats };

  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Common city name normalizations
 * Maps abbreviations and common misspellings to proper city names
 */
const CITY_NORMALIZATIONS: Record<string, string> = {
  // Truncated city names (critical fix for data corruption)
  'New': 'New York',
  'Los': 'Los Angeles',
  
  // California
  'LA': 'Los Angeles',
  'L.A.': 'Los Angeles',
  'L.A': 'Los Angeles',
  'SF': 'San Francisco',
  'S.F.': 'San Francisco',
  'San Fran': 'San Francisco',
  'Frisco': 'San Francisco',
  'SD': 'San Diego',
  'Sac': 'Sacramento',
  'Sacto': 'Sacramento',
  
  // New York
  'NYC': 'New York',
  'N.Y.C.': 'New York',
  'New York City': 'New York',
  
  // Other major cities
  'Philly': 'Philadelphia',
  'Chi': 'Chicago',
  'Chi-Town': 'Chicago',
  'The Windy City': 'Chicago',
  'Vegas': 'Las Vegas',
  'NOLA': 'New Orleans',
  'Nawlins': 'New Orleans',
  'Phx': 'Phoenix',
  'ATL': 'Atlanta',
  'DC': 'Washington',
  'D.C.': 'Washington',
  'Washington DC': 'Washington',
  'Washington D.C.': 'Washington',
  
  // Texas
  'San Antonio': 'San Antonio',
  'Fort Worth': 'Fort Worth',
  'El Paso': 'El Paso',
  
  // Florida
  'Miami Beach': 'Miami',
  'Tampa Bay': 'Tampa',
  
  // Pacific Northwest
  'PDX': 'Portland',
  'Sea': 'Seattle',
};

/**
 * Normalizes a city name by:
 * 1. Trimming whitespace
 * 2. Fixing common abbreviations/misspellings
 * 3. Proper title casing
 */
function normalizeCity(city: string | null | undefined): string | null {
  if (!city || city.trim() === '') return null;
  
  let normalized = city.trim();
  
  // Check for exact match in normalization map (case-insensitive)
  const mapKey = Object.keys(CITY_NORMALIZATIONS).find(
    key => key.toLowerCase() === normalized.toLowerCase()
  );
  
  if (mapKey) {
    normalized = CITY_NORMALIZATIONS[mapKey];
  } else {
    // Apply title case: "los angeles" -> "Los Angeles"
    normalized = normalized
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  return normalized;
}

/**
 * Analyze city data quality for a user's leads
 * Returns statistics about potential issues
 */
export async function analyzeCityData(userId: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log('[CITY ANALYSIS] Starting analysis for user:', userId);
    
    // Fetch ALL leads with cities via pagination
    const allLeads: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    
    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error } = await supabase
        .from('leads')
        .select('id, business_name, city, state')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to);

      if (error) throw error;

      const batch = leads || [];
      allLeads.push(...batch);
      
      if (batch.length < pageSize) hasMore = false;
      page++;
    }

    console.log(`[CITY ANALYSIS] Fetched ${allLeads.length} leads across ${page} pages`);

    // Analyze city data
    const issues = {
      empty: 0,
      needsNormalization: [] as any[],
      cassingIssues: [] as any[],
      abbreviations: [] as any[],
    };

    const cityMap = new Map<string, number>();

    allLeads.forEach(lead => {
      const city = lead.city;
      
      if (!city || city.trim() === '') {
        issues.empty++;
        return;
      }

      // Track city counts
      cityMap.set(city, (cityMap.get(city) || 0) + 1);

      const normalized = normalizeCity(city);
      
      // Check if normalization would change the city
      if (normalized && normalized !== city) {
        const issue: any = {
          id: lead.id,
          business_name: lead.business_name,
          original: city,
          normalized: normalized,
        };

        // Categorize the issue
        if (Object.keys(CITY_NORMALIZATIONS).some(key => key.toLowerCase() === city.toLowerCase())) {
          issues.abbreviations.push(issue);
        } else if (city.toLowerCase() === normalized.toLowerCase()) {
          issues.cassingIssues.push(issue);
        } else {
          issues.needsNormalization.push(issue);
        }
      }
    });

    const totalIssues = issues.abbreviations.length + issues.cassingIssues.length + issues.needsNormalization.length;

    const stats = {
      total: allLeads.length,
      empty: issues.empty,
      needsFixing: totalIssues,
      abbreviations: issues.abbreviations.length,
      casingIssues: issues.cassingIssues.length,
      other: issues.needsNormalization.length,
      samples: {
        abbreviations: issues.abbreviations.slice(0, 10),
        casingIssues: issues.cassingIssues.slice(0, 10),
        other: issues.needsNormalization.slice(0, 10),
      },
      topCities: Array.from(cityMap.entries())
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
    };

    return { success: true, stats };

  } catch (error: any) {
    console.error('[CITY ANALYSIS] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Clean up city names by normalizing abbreviations and fixing casing
 */
export async function cleanupCityData(userId: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    console.log('[CITY CLEANUP] Starting cleanup for user:', userId);
    
    // PHASE 1: Fetch ALL leads via pagination
    const allLeads: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    
    while (hasMore) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error } = await supabase
        .from('leads')
        .select('id, business_name, city, state')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to);

      if (error) throw error;

      const batch = leads || [];
      allLeads.push(...batch);
      
      if (batch.length < pageSize) hasMore = false;
      page++;
    }

    console.log(`[CITY CLEANUP] Fetched ${allLeads.length} leads across ${page} pages`);

    // PHASE 2: Identify leads that need updates
    const leadsToUpdate: Array<{ id: number; city: string; original: string }> = [];

    allLeads.forEach(lead => {
      if (!lead.city || lead.city.trim() === '') return;
      
      const normalized = normalizeCity(lead.city);
      
      if (normalized && normalized !== lead.city) {
        leadsToUpdate.push({
          id: lead.id,
          city: normalized,
          original: lead.city,
        });
      }
    });

    console.log(`[CITY CLEANUP] Found ${leadsToUpdate.length} leads needing cleanup`);

    if (leadsToUpdate.length === 0) {
      return {
        success: true,
        updated: 0,
        message: 'All city names are already normalized'
      };
    }

    // PHASE 3: Update in batches
    let totalUpdated = 0;
    const updateBatchSize = 100; // Smaller batches for individual updates

    for (let i = 0; i < leadsToUpdate.length; i += updateBatchSize) {
      const batch = leadsToUpdate.slice(i, i + updateBatchSize);
      
      // Update each lead individually since they have different city values
      const updatePromises = batch.map(lead =>
        supabase
          .from('leads')
          .update({ city: lead.city })
          .eq('id', lead.id)
          .select('id')
      );

      const results = await Promise.all(updatePromises);
      
      const successCount = results.filter(r => !r.error && r.data && r.data.length > 0).length;
      totalUpdated += successCount;
      
      console.log(`[CITY CLEANUP] Updated batch ${Math.floor(i / updateBatchSize) + 1}: ${successCount}/${batch.length} leads (total: ${totalUpdated})`);
      
      // Log any errors
      results.forEach((r, idx) => {
        if (r.error) {
          console.error(`[CITY CLEANUP] Error updating lead ${batch[idx].id}:`, r.error);
        }
      });
    }

    console.log(`[CITY CLEANUP] Successfully updated ${totalUpdated} leads`);

    return {
      success: true,
      updated: totalUpdated,
      message: `Successfully normalized ${totalUpdated} city names`
    };

  } catch (error: any) {
    console.error('[CITY CLEANUP] Fatal error:', error);
    return {
      success: false,
      updated: 0,
      error: error.message
    };
  }
}

/**
 * Get country statistics for a user's leads
 */
export async function getCountryStats(userId: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Process in smaller batches to prevent timeout
    const pageSize = 500;
    let page = 0;
    let hasMore = true;
    const maxPages = 20;
    
    const countryMap = new Map<string, number>();
    let nullCount = 0;
    let totalCount = 0;
    
    while (hasMore && page < maxPages) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      
      const { data: leads, error } = await supabase
        .from('leads')
        .select('country')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to);

      if (error) throw error;

      const batch = leads || [];
      
      batch.forEach(lead => {
        totalCount++;
        if (!lead.country || lead.country.trim() === '') {
          nullCount++;
        } else {
          countryMap.set(lead.country, (countryMap.get(lead.country) || 0) + 1);
        }
      });
      
      if (batch.length < pageSize) hasMore = false;
      page++;
    }

    console.log(`[COUNTRY STATS] Processed ${totalCount} leads across ${page} pages`);

    const stats = {
      total: totalCount,
      without_country: nullCount,
      by_country: Array.from(countryMap.entries()).map(([country, count]) => ({
        country,
        count
      })).sort((a, b) => b.count - a.count)
    };

    return { success: true, stats };

  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
