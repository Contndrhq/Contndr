import { useState, useEffect, useMemo } from 'react';
import { Search, Download, Trash2, FolderPlus, Send, Filter, Upload, Folder, X as XIcon, Users, AlertTriangle, Sparkles, MapPin, Star, Globe, Check, Edit2, Mail as MailIcon, Phone, Clock, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getAuthHeaders } from '../lib/auth';
import { LeadImporter } from './LeadImporter';
import { GroupsManager } from './GroupsManager';
import { GroupSelector } from './GroupSelector';
import { projectId } from '../utils/supabase/info';
import { apiCache } from '../lib/api-cache';
import { CrmExportMenu } from './CrmExportMenu';
import { toTitleCase } from '../utils/title-case';
import { useTranslation } from 'react-i18next';

// ── Display-level cleaner: reject LinkedIn headlines/taglines from business names ──
function cleanBizDisplay(raw: string): string {
  if (!raw) return '';
  let c = raw.trim();
  c = c.replace(/,\s+(?:My |I |We |Our |Your |A |The |An |Helping |Passionate |Dedicated |Experienced |Building |Creating |Empowering |Enabling |Transforming |Committed |Focused |Specializ|Leverag|Proven |Award|Driving |Working |Looking |Seeking |Striving |Results).*/i, '').trim();
  const HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+\s+in|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work|build|create)|we\s+(?:help|are|build|create|provide|deliver)|my\s+(?:goal|mission|passion|focus))/i;
  if (HEADLINE.test(c)) return '';
  const PURE_TITLE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|director|manager|head|lead|chief|founder|co-?founder|owner|partner|president|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelanc\w+|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|developer|designer|recruiter|marketer|sales\w*|business\s+development)(\s+(of|at|for|in|&|and|\/)\s+.*)?$/i;
  if (PURE_TITLE.test(c)) return '';
  if (/\b(helping|empowering|enabling|transforming|building|creating|delivering|providing|growing|driving|solving|improving|supporting|managing|developing|seeking|looking|striving|committed|passionate|dedicated|experienced)\b/i.test(c) && c.split(/\s+/).length > 3) return '';
  if (/\b(my goal|i help|i am|we help|we are|our mission)\b/i.test(c) && c.split(/\s+/).length > 2) return '';
  if (c.split(/\s+/).length > 7) return '';
  // ── Strict Title Case normalization ──
  if (c.length > 1) {
    const isAllUpper = c === c.toUpperCase() && /[A-Z]/.test(c) && c.length > 4;
    const isAllLower = c === c.toLowerCase() && /[a-z]/.test(c);
    if (isAllUpper || isAllLower) {
      c = toTitleCase(c);
    }
  }
  return c;
}

interface Lead {
  id: string;
  business_name: string;
  category: string;
  city: string;
  address: string;
  website: string;
  email: string;
  phone: string;
  source: string;
  rating: number | null;
  reviews: number | null;
  created_at: string;
  contacted?: boolean; // Whether this lead has been contacted via email
  last_contacted?: string; // When they were last contacted
  last_engagement_date?: string; // When they last engaged (opened/clicked/replied)
  score?: number; // Lead engagement score
  reply_classification?: string; // Reply classification
  unsubscribed?: boolean; // Whether they unsubscribed
  bounced?: boolean; // Whether their email bounced (invalid email)
  // Team lead fields (from /team-leads endpoint)
  added_by?: string;
  added_by_email?: string;
  is_team_lead?: boolean;
  // Team outreach attribution
  team_outreach?: TeamOutreach[];
}

interface TeamOutreach {
  contacted_by: string;
  contacted_by_email: string;
  user_id: string;
  is_you: boolean;
  campaign_name: string;
  campaign_id: string;
  sent_at: string;
  status: string;
}

type LeadView = 'mine' | 'team';

export function LeadsTable() {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImporter, setShowImporter] = useState(false);
  const [showGroupsManager, setShowGroupsManager] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [updating, setUpdating] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [showGroupSelector, setShowGroupSelector] = useState(false);
  const [showOnlyUncontacted, setShowOnlyUncontacted] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  // Team leads state
  const [leadView, setLeadView] = useState<LeadView>('mine');
  const [teamLeads, setTeamLeads] = useState<Lead[]>([]);
  const [loadingTeamLeads, setLoadingTeamLeads] = useState(false);
  const [teamSize, setTeamSize] = useState(0);
  const [teamMembers, setTeamMembers] = useState<{id: string; name: string; email: string}[]>([]);
  const [teamLeadsLoaded, setTeamLeadsLoaded] = useState(false);

  useEffect(() => {
    loadLeads();
  }, [selectedBrand]); // Re-load when brand changes

  // Load available brands from user's campaigns
  useEffect(() => {
    async function loadBrands() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: brandData } = await supabase
        .from('campaigns')
        .select('brand')
        .eq('user_id', session.user.id);
      const brandsSet = new Set<string>();
      if (brandData) {
        brandData.forEach(c => {
          if (c.brand) brandsSet.add(c.brand.toLowerCase());
        });
      }
      setAvailableBrands(Array.from(brandsSet).sort());
    }
    loadBrands();
  }, []);

  async function loadLeads() {
    try {
      // Check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('No active session - leads will be filtered by RLS');
        setLeads([]);
        setLoading(false);
        return;
      }

      // Fetch ALL leads in batches (Supabase has 1000 row limit)
      let allLeads: any[] = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;
      
      console.log(`[LEADS TABLE] Fetching leads in batches of ${batchSize} (brand: ${selectedBrand})...`);
      
      while (hasMore) {
        let batchQuery = supabase
          .from('leads')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .range(offset, offset + batchSize - 1);
        
        // Filter by brand if not "all"
        if (selectedBrand !== 'all') {
          batchQuery = batchQuery.eq('brand', selectedBrand);
        }
        
        const { data: batch, error: batchError } = await batchQuery;
        
        if (batchError) {
          console.error('Error loading leads:', batchError);
          throw batchError;
        }
        
        if (batch && batch.length > 0) {
          allLeads = allLeads.concat(batch);
          console.log(`[LEADS TABLE] Batch ${Math.floor(offset / batchSize) + 1}: ${batch.length} leads (total: ${allLeads.length})`);
          offset += batchSize;
          hasMore = batch.length === batchSize;
        } else {
          hasMore = false;
        }
      }
      
      // Deduplicate leads by ID (just in case)
      const uniqueLeadsMap = new Map();
      allLeads.forEach(lead => {
        if (!uniqueLeadsMap.has(lead.id)) {
          uniqueLeadsMap.set(lead.id, lead);
        }
      });
      const leadsData = Array.from(uniqueLeadsMap.values());
      console.log(`[LEADS TABLE] Loaded ${leadsData.length} unique leads (from ${allLeads.length} total) for user ${session.user.email} (brand: ${selectedBrand})`);
      
      // Then get all emails for this user to check contacted status (in batches)
      let allEmails: any[] = [];
      let emailOffset = 0;
      let hasMoreEmails = true;
      
      console.log(`[LEADS TABLE] Fetching emails in batches of ${batchSize}...`);
      
      while (hasMoreEmails) {
        const { data: emailBatch, error: emailsError } = await supabase
          .from('emails')
          .select('lead_id, sent_at, status')
          .eq('user_id', session.user.id)
          .order('sent_at', { ascending: false })
          .range(emailOffset, emailOffset + batchSize - 1);
        
        if (emailsError) {
          console.error('Error loading emails for contact status:', emailsError);
          break; // Continue without contact status if emails query fails
        }
        
        if (emailBatch && emailBatch.length > 0) {
          allEmails = allEmails.concat(emailBatch);
          console.log(`[LEADS TABLE] Email batch ${Math.floor(emailOffset / batchSize) + 1}: ${emailBatch.length} emails (total: ${allEmails.length})`);
          emailOffset += batchSize;
          hasMoreEmails = emailBatch.length === batchSize;
        } else {
          hasMoreEmails = false;
        }
      }
      
      const emailsData = allEmails;
      
      // Create a map of lead_id to last email sent
      const emailMap = new Map();
      if (emailsData) {
        emailsData.forEach(email => {
          if (!emailMap.has(email.lead_id)) {
            emailMap.set(email.lead_id, email);
          }
        });
      }
      
      console.log(`Found ${emailMap.size} leads with emails sent`);
      
      // Merge the data
      const leadsWithStatus = (leadsData || []).map(lead => {
        const lastEmail = emailMap.get(lead.id);
        return {
          ...lead,
          contacted: !!lastEmail,
          last_contacted: lastEmail?.sent_at
        };
      });
      
      setLeads(leadsWithStatus);
    } catch (error) {
      console.error('Error loading leads:', error);
    } finally {
      setLoading(false);
    }
  }

  // Load team leads from the backend (uses service role to bypass RLS)
  async function loadTeamLeads(forceRefresh = false) {
    if (teamLeadsLoaded && !forceRefresh) return; // Already loaded
    setLoadingTeamLeads(true);
    try {
      const headers = await getAuthHeaders();
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
      const brandParam = selectedBrand !== 'all' ? `&brand=${encodeURIComponent(selectedBrand)}` : '';
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-engine/team-leads?per_page=2000${searchParam}${brandParam}`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setTeamLeads(data.leads || []);
        setTeamSize(data.team_size || 0);
        setTeamMembers(data.members || []);
        setTeamLeadsLoaded(true);
        console.log(`[LEADS TABLE] Loaded ${data.leads?.length || 0} team leads from ${data.team_size} members`);
      } else {
        const err = await response.text();
        console.error('[LEADS TABLE] Team leads fetch error:', err);
      }
    } catch (error) {
      console.error('[LEADS TABLE] Team leads error:', error);
    } finally {
      setLoadingTeamLeads(false);
    }
  }

  // When switching to team view, load team leads
  useEffect(() => {
    if (leadView === 'team' && !teamLeadsLoaded) {
      loadTeamLeads();
    }
  }, [leadView]);

  const filteredLeads = leads.filter(lead =>
    (lead.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lead.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lead.city?.toLowerCase().includes(searchQuery.toLowerCase())) &&
    (!showOnlyUncontacted || !lead.contacted)
  );

  function exportLeads() {
    const csv = [
      ['Business Name', 'Category', 'City', 'Address', 'Website', 'Email', 'Phone', 'Rating', 'Reviews', 'Source'].join(','),
      ...filteredLeads.map(lead => [
        lead.business_name,
        lead.category || '',
        lead.city || '',
        lead.address || '',
        lead.website || '',
        lead.email || '',
        lead.phone || '',
        lead.rating?.toString() || '',
        lead.reviews?.toString() || '',
        lead.source
      ].map(field => `\"${field}\"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contndr-leads-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  function startEditing(lead: Lead) {
    setEditingLeadId(lead.id);
    setEditEmail(lead.email || '');
  }

  function cancelEditing() {
    setEditingLeadId(null);
    setEditEmail('');
  }

  async function saveEmail(leadId: string) {
    if (!editEmail.trim()) {
      alert('Please enter a valid email address');
      return;
    }

    setUpdating(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/${leadId}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ email: editEmail.trim() }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update lead');
      }

      // Update local state
      setLeads(leads.map(lead => 
        lead.id === leadId ? { ...lead, email: editEmail.trim() } : lead
      ));
      
      cancelEditing();
    } catch (error) {
      console.error('Error updating email:', error);
      alert('Failed to update email. Please try again.');
    } finally {
      setUpdating(false);
    }
  }

  const leadsWithEmail = filteredLeads.filter(l => l.email).length;
  const leadsWithoutEmail = filteredLeads.length - leadsWithEmail;
  const genericEmailsCount = filteredLeads.filter(l => {
     if (!l.email) return false;
     const emailLower = l.email.toLowerCase();
     const genericPatterns = [
        'info@', 'contact@', 'hello@', 'sales@', 'support@', 'admin@', 
        'office@', 'inquiries@', 'careers@', 'jobs@', 'hr@', 'team@',
        'help@', 'marketing@', 'media@', 'press@', 'billing@', 'accounts@',
        'reception@', 'frontdesk@', 'mail@', 'webmaster@', 'staff@'
      ];
     return genericPatterns.some(pattern => emailLower.startsWith(pattern));
  }).length;

  async function fixGenericEmails() {
    const leadsToFix = leads.filter(l => {
      if (!l.email) return false;
      const emailLower = l.email.toLowerCase();
      // Expanded list of generic patterns
      const genericPatterns = [
        'info@', 'contact@', 'hello@', 'sales@', 'support@', 'admin@', 
        'office@', 'inquiries@', 'careers@', 'jobs@', 'hr@', 'team@',
        'help@', 'marketing@', 'media@', 'press@', 'billing@', 'accounts@',
        'reception@', 'frontdesk@', 'mail@', 'webmaster@', 'staff@'
      ];
      return genericPatterns.some(pattern => emailLower.startsWith(pattern));
    });
    
    if (leadsToFix.length === 0) {
      alert('No leads with generic emails found!');
      return;
    }

    const confirmed = confirm(
      `Found ${leadsToFix.length} leads with generic emails (info@, sales@, etc).\n\nAttempt to find specific decision makers for these leads?\n\nThis will use enrichment credits.`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/fix-generic`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ limit: 50 }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fix generic emails');
      }

      const result = await response.json();
      
      await loadLeads();
      
      alert(
        `Process complete!\n\n` +
        `✓ ${result.fixed} leads updated with decision maker info\n` +
        `ℹ Checked ${result.results.length} leads`
      );
    } catch (error) {
      console.error('Error fixing generic emails:', error);
      alert('Failed to fix emails. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function bulkScrapeEmails() {
    // Find leads that need email scraping:
    // 1. Leads without emails
    // 2. Leads with fake/placeholder emails (info@domain.com pattern)
    const leadsToScrape = leads.filter(l => {
      if (!l.website) return false; // Must have website
      if (!l.email) return true; // No email - needs scraping
      
      // Check if email is a placeholder pattern
      const emailLower = l.email.toLowerCase();
      const placeholderPatterns = ['info@', 'contact@', 'hello@', 'sales@', 'support@'];
      const isFakeEmail = placeholderPatterns.some(pattern => emailLower.startsWith(pattern));
      
      return isFakeEmail; // Scrape if it looks like a fake email
    });
    
    if (leadsToScrape.length === 0) {
      alert('No leads found that need email enrichment!\n\nAll leads either:\n• Already have real email addresses\n• Don\'t have websites to enrich from');
      return;
    }

    const confirmed = confirm(
      `Find real emails from ${leadsToScrape.length} lead websites?\n\nThis will:\n✓ Visit each website\n✓ Find actual email addresses from contact pages\n✓ Replace placeholder emails (info@, contact@) with real ones\n\nThis may take a few minutes.`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      const leadIds = leadsToScrape.map(l => l.id);
      const headers = await getAuthHeaders();
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/leads/bulk-enrich`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ lead_ids: leadIds }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to find emails');
      }

      const result = await response.json();
      
      // Reload leads to get updated emails
      await loadLeads();
      
      alert(
        `Email enrichment complete!\\n\\n` +
        `✓ ${result.results.enriched} real emails found\\n` +
        `✗ ${result.results.failed} failed (no email on website)\\n` +
        `${result.results.already_had_email > 0 ? `⚠ ${result.results.already_had_email} already had emails` : ''}`
      );
    } catch (error) {
      console.error('Error enriching emails:', error);
      alert('Failed to enrich emails. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function deleteLeadsWithoutEmail() {
    const leadsToDelete = leads.filter(l => !l.email);
    
    if (leadsToDelete.length === 0) {
      alert('All leads already have email addresses!');
      return;
    }

    const confirmed = confirm(
      `Are you sure you want to delete ${leadsToDelete.length} leads without email addresses? This cannot be undone.`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      const leadIds = leadsToDelete.map(l => l.id);
      
      // Get session for user_id guard
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert('Not authenticated'); setLoading(false); return; }
      
      const { error } = await supabase
        .from('leads')
        .delete()
        .in('id', leadIds)
        .eq('user_id', session.user.id); // Defense-in-depth: ensure user owns these leads

      if (error) throw error;

      // Update local state
      setLeads(leads.filter(l => l.email));
      apiCache.invalidate('campaign-builder:leads');
      
      alert(`Successfully deleted ${leadsToDelete.length} leads without email addresses.`);
    } catch (error) {
      console.error('Error deleting leads:', error);
      alert('Failed to delete leads. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function deleteAllLeads() {
    if (leads.length === 0) {
      alert('No leads to delete!');
      return;
    }

    const confirmed = confirm(
      `⚠️ WARNING: Delete ALL ${leads.length} leads?\n\nThis will permanently delete all leads from your database. This action cannot be undone.\n\nAre you absolutely sure?`
    );

    if (!confirmed) return;

    // Double confirmation for safety
    const doubleConfirm = confirm(
      `This is your final confirmation.\n\nDelete ${leads.length} leads permanently?`
    );

    if (!doubleConfirm) return;

    setLoading(true);
    try {
      const leadIds = leads.map(l => l.id);
      
      // Get session for user_id guard
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert('Not authenticated'); setLoading(false); return; }
      
      const { error } = await supabase
        .from('leads')
        .delete()
        .in('id', leadIds)
        .eq('user_id', session.user.id); // Defense-in-depth: ensure user owns these leads

      if (error) throw error;

      // Clear local state
      setLeads([]);
      apiCache.invalidate('campaign-builder:leads');
      
      alert(`Successfully deleted all ${leadIds.length} leads.`);
    } catch (error) {
      console.error('Error deleting leads:', error);
      alert('Failed to delete leads. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelectedLeads() {
    if (selectedLeads.size === 0) {
      alert('No leads selected!');
      return;
    }

    const confirmed = confirm(
      `Delete ${selectedLeads.size} selected lead${selectedLeads.size > 1 ? 's' : ''}?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      const leadIds = Array.from(selectedLeads);
      
      // Get session for user_id guard
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert('Not authenticated'); setLoading(false); return; }
      
      const { error } = await supabase
        .from('leads')
        .delete()
        .in('id', leadIds)
        .eq('user_id', session.user.id); // Defense-in-depth: ensure user owns these leads

      if (error) throw error;

      // Clear selection and reload
      setSelectedLeads(new Set());
      await loadLeads();
      
      alert(`Successfully deleted ${leadIds.length} lead${leadIds.length > 1 ? 's' : ''}.`);
    } catch (error) {
      console.error('Error deleting selected leads:', error);
      alert('Failed to delete leads. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function fixCoordinatesInCityField() {
    const leadsWithCoordinates = leads.filter(l => l.city && l.city.startsWith('@'));
    
    if (leadsWithCoordinates.length === 0) {
      alert('No leads with coordinate issues found!');
      return;
    }

    const confirmed = confirm(
      `Fix ${leadsWithCoordinates.length} leads with coordinates in city field?\n\nThis will extract the proper city name from the address.`
    );

    if (!confirmed) return;

    // Get session for user_id guard
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { alert('Not authenticated'); return; }

    setLoading(true);
    try {
      let fixedCount = 0;
      let failedCount = 0;
      
      for (const lead of leadsWithCoordinates) {
        let city = '';
        
        if (lead.address) {
          // Parse city from address
          // Common formats:
          // "8000 Braygreen Rd, Laurel, MD 20707"
          // "123 Main St, City Name, State ZIP"
          const addressParts = lead.address.split(',').map(p => p.trim());
          
          if (addressParts.length >= 3) {
            // Format: "Street, City, State ZIP"
            city = addressParts[1];
          } else if (addressParts.length === 2) {
            // Format: "Street, City State" or "Street City, State"
            const lastPart = addressParts[1];
            // Try to extract city (remove state and ZIP)
            city = lastPart.replace(/\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/, '').trim();
          } else if (addressParts.length === 1) {
            // Try to extract from single string
            const parts = lead.address.split(/\s+/);
            if (parts.length > 3) {
              // Guess: last 2-3 words might be "City State ZIP"
              city = parts[parts.length - 3] || '';
            }
          }
        }
        
        if (city && !city.startsWith('@')) {
          const { error } = await supabase
            .from('leads')
            .update({ city })
            .eq('id', lead.id)
            .eq('user_id', session.user.id); // Defense-in-depth: ensure user owns this lead

          if (!error) {
            fixedCount++;
            console.log(`Fixed lead ${lead.business_name}: "${lead.city}" -> "${city}"`);
          } else {
            failedCount++;
            console.error(`Failed to update lead ${lead.id}:`, error);
          }
        } else {
          failedCount++;
          console.warn(`Could not extract city for lead ${lead.business_name}, address: ${lead.address}`);
        }
      }
      
      // Reload leads to show updated data
      await loadLeads();
      
      if (fixedCount > 0) {
        alert(`✓ Successfully fixed ${fixedCount} leads!${failedCount > 0 ? `\n⚠ Could not fix ${failedCount} leads (no valid address)` : ''}`);
      } else {
        alert(`⚠ Could not fix any leads. They may not have valid addresses.`);
      }
    } catch (error) {
      console.error('Error fixing coordinates:', error);
      alert('Failed to fix leads. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Duplicate detection ──────────────────────────────────────────────
  // Finds leads that share the same email address (primary key) or the
  // same name+company combo when email is missing. Keeps the NEWEST entry
  // (latest created_at) and marks the rest as duplicates to delete.

  const duplicateInfo = useMemo(() => {
    if (leads.length === 0) return { count: 0, idsToDelete: [] as string[] };

    const emailMap = new Map<string, { id: string; created_at: string }[]>();
    const nameCompanyMap = new Map<string, { id: string; created_at: string }[]>();

    for (const lead of leads) {
      // Group by email
      if (lead.email) {
        const key = lead.email.trim().toLowerCase();
        if (!emailMap.has(key)) emailMap.set(key, []);
        emailMap.get(key)!.push({ id: lead.id, created_at: lead.created_at });
      }

      // Group by name+company for leads without unique emails
      const contactName = ((lead as any).contact_name || '').trim().toLowerCase();
      const bizName = (lead.business_name || '').trim().toLowerCase();
      if (contactName && bizName) {
        const key = `${contactName}::${bizName}`;
        if (!nameCompanyMap.has(key)) nameCompanyMap.set(key, []);
        nameCompanyMap.get(key)!.push({ id: lead.id, created_at: lead.created_at });
      }
    }

    const idsToDelete = new Set<string>();

    // Email duplicates — keep newest
    for (const [, entries] of emailMap) {
      if (entries.length <= 1) continue;
      entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      for (let i = 1; i < entries.length; i++) {
        idsToDelete.add(entries[i].id);
      }
    }

    // Name+Company duplicates — only for leads not already caught by email
    for (const [, entries] of nameCompanyMap) {
      if (entries.length <= 1) continue;
      const remaining = entries.filter(e => !idsToDelete.has(e.id));
      if (remaining.length <= 1) continue;
      remaining.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      for (let i = 1; i < remaining.length; i++) {
        idsToDelete.add(remaining[i].id);
      }
    }

    return { count: idsToDelete.size, idsToDelete: Array.from(idsToDelete) };
  }, [leads]);

  async function removeDuplicates() {
    if (duplicateInfo.count === 0) {
      alert('No duplicate leads found!');
      return;
    }

    const confirmed = confirm(
      `Found ${duplicateInfo.count} duplicate lead${duplicateInfo.count > 1 ? 's' : ''}.\n\nDuplicates are identified by matching email address or matching name + company.\n\nThe newest entry for each lead will be kept. Delete the ${duplicateInfo.count} older duplicates?`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert('Not authenticated'); setLoading(false); return; }

      // Delete in batches of 200 to avoid Supabase limits
      const batchSize = 200;
      let deleted = 0;
      for (let i = 0; i < duplicateInfo.idsToDelete.length; i += batchSize) {
        const batch = duplicateInfo.idsToDelete.slice(i, i + batchSize);
        const { error } = await supabase
          .from('leads')
          .delete()
          .in('id', batch)
          .eq('user_id', session.user.id);

        if (error) throw error;
        deleted += batch.length;
      }

      // Reload
      setSelectedLeads(new Set());
      apiCache.invalidate('campaign-builder:leads');
      await loadLeads();

      alert(`Successfully removed ${deleted} duplicate lead${deleted > 1 ? 's' : ''}!`);
    } catch (error) {
      console.error('Error removing duplicates:', error);
      alert('Failed to remove duplicates. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-white/5 rounded-xl w-64 border border-white/10" />
          <div className="h-96 bg-white/5 rounded-xl border border-white/10" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Leads</h1>
          <p className="text-gray-400 text-[14px]">
            Manage and organize your sales leads with intelligent grouping
          </p>
          
          {/* Brand Filter - Segmented Control */}
          <div className="mt-6 inline-flex items-center p-1 bg-black/20 border border-white/10 rounded-xl">
            <button
              onClick={() => setSelectedBrand('all')}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                selectedBrand === 'all'
                  ? 'bg-white/10 text-white shadow-sm border border-white/5'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              All Brands
            </button>
            {availableBrands.map(brand => (
              <button
                key={brand}
                onClick={() => setSelectedBrand(brand)}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  selectedBrand === brand
                    ? 'bg-white/10 text-white shadow-sm border border-white/5'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {brand.charAt(0).toUpperCase() + brand.slice(1)}
              </button>
            ))}
          </div>

          {/* Lead View Toggle — My Leads / Team Leads */}
          <div className="mt-3 inline-flex items-center p-1 bg-black/20 border border-white/10 rounded-xl">
            <button
              onClick={() => setLeadView('mine')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                leadView === 'mine'
                  ? 'bg-white/10 text-white shadow-sm border border-white/5'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              My Leads
              <span className="text-[11px] opacity-70">({leads.length})</span>
            </button>
            <button
              onClick={() => setLeadView('team')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
                leadView === 'team'
                  ? 'bg-blue-500/20 text-blue-300 shadow-sm border border-blue-500/20'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
              Team Leads
              {teamLeadsLoaded && <span className="text-[11px] opacity-70">({teamLeads.length})</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════ MY LEADS VIEW ══════════════ */}
      {leadView === 'mine' && <>
      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" strokeWidth={1.5} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search leads..."
            className="w-full pl-10 pr-4 py-2.5 text-[13px] bg-black/20 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-[#1ED4A7]/50 focus:ring-1 focus:ring-[#1ED4A7]/20 transition-all"
          />
        </div>

        <button
          onClick={() => setShowOnlyUncontacted(!showOnlyUncontacted)}
          className={`glass-button-secondary flex items-center gap-2 !px-4 !py-2.5 !text-[13px] whitespace-nowrap ${
            showOnlyUncontacted
              ? '!border-[#1ED4A7]/30 !bg-[#1ED4A7]/10 !text-[#1ED4A7]'
              : ''
          }`}
        >
          <Filter className="w-3.5 h-3.5" strokeWidth={1.5} />
          <span className="hidden sm:inline">{showOnlyUncontacted ? 'Show All' : 'Uncontacted Only'}</span>
          <span className="sm:hidden">Filter</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {selectedLeads.size > 0 ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg text-[13px] text-[#1ED4A7]">
                <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden xs:inline">{selectedLeads.size} selected</span>
                <span className="xs:hidden">{selectedLeads.size}</span>
              </div>
              <button
                onClick={() => setShowGroupSelector(true)}
                className="glass-button-primary flex items-center gap-2 !px-4 !py-2 !text-[13px]"
              >
                <Folder className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden xs:inline">Add to Group</span>
                <span className="xs:hidden">Add</span>
              </button>
              <CrmExportMenu
                leads={leads.filter(l => selectedLeads.has(l.id))}
              />
              <button
                onClick={deleteSelectedLeads}
                className="flex items-center gap-2 px-4 py-2 text-[13px] border border-red-500/30 bg-red-500/10 text-red-400 rounded-full hover:bg-red-500/20 transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden xs:inline">Delete</span>
                <span className="xs:hidden">Delete</span>
              </button>
              <button
                onClick={() => setSelectedLeads(new Set())}
                className="glass-button-secondary !px-3 !py-2 !text-[13px]"
              >
                <XIcon className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span>Clear</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowImporter(true)}
                className="glass-button-secondary flex items-center gap-2 !px-4 !py-2.5 !text-[13px]"
              >
                <Upload className="w-3.5 h-3.5 text-gray-400 group-hover:text-white" strokeWidth={1.5} />
                <span>Import</span>
              </button>

              <button
                onClick={() => setShowGroupsManager(true)}
                className="glass-button-secondary flex items-center gap-2 !px-4 !py-2.5 !text-[13px]"
              >
                <Folder className="w-3.5 h-3.5 text-gray-400 group-hover:text-white" strokeWidth={1.5} />
                <span>Groups</span>
              </button>

              <button
                onClick={fixGenericEmails}
                className="glass-button-secondary flex items-center gap-2 !px-4 !py-2.5 !text-[13px] hover:!border-purple-500/30 hover:!bg-purple-500/10 hover:!text-purple-300"
                title="Find Decision Makers for generic leads"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400" strokeWidth={1.5} />
                <span className="hidden sm:inline">Fix Generic</span>
                <span className="sm:hidden">Fix</span>
              </button>

              <button
                onClick={exportLeads}
                className="glass-button-secondary flex items-center gap-2 !px-4 !py-2.5 !text-[13px] hover:!border-[#1ED4A7]/30 hover:!bg-[#1ED4A7]/10 hover:!text-[#1ED4A7]"
              >
                <Download className="w-3.5 h-3.5 text-[#1ED4A7]" strokeWidth={1.5} />
                <span className="hidden sm:inline">Export</span>
                <span className="sm:hidden">Export</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Generic Email Warning */}
      {genericEmailsCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <p className="text-purple-200 text-[14px] font-medium mb-0.5">
                {genericEmailsCount} leads have generic email addresses
              </p>
              <p className="text-purple-300/70 text-[12px]">
                Use the Enrichment Agent to identify specific decision makers.
              </p>
            </div>
          </div>
          <button
            onClick={fixGenericEmails}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-[13px] font-medium rounded-lg transition-colors border border-purple-500/30"
          >
            <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span>Fix Generic Emails</span>
          </button>
        </div>
      )}

      {/* Coordinates Fix Warning */}
      {leads.filter(l => l.city && l.city.startsWith('@')).length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-zinc-500/10 border border-zinc-500/20 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-zinc-500/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-zinc-200 text-[14px] font-medium mb-0.5">
                {leads.filter(l => l.city && l.city.startsWith('@')).length} leads have coordinates issues
              </p>
              <p className="text-zinc-400/70 text-[12px]">
                Location coordinates were used instead of city names.
              </p>
            </div>
          </div>
          <button
            onClick={fixCoordinatesInCityField}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-300 text-[13px] font-medium rounded-lg transition-colors border border-zinc-500/30"
          >
            <MapPin className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span>Fix Now</span>
          </button>
        </div>
      )}

      {/* Duplicate Leads Warning */}
      {duplicateInfo.count > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <Copy className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-amber-200 text-[14px] font-medium mb-0.5">
                {duplicateInfo.count} duplicate lead{duplicateInfo.count > 1 ? 's' : ''} detected
              </p>
              <p className="text-amber-300/70 text-[12px]">
                Leads with the same email address or same name + company appear more than once. The newest entry will be kept.
              </p>
            </div>
          </div>
          <button
            onClick={removeDuplicates}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[13px] font-medium rounded-lg transition-colors border border-amber-500/30 whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span>Remove Duplicates</span>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {filteredLeads.length === 0 ? (
          <div className="text-center py-20 px-6">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/10">
              <Search className="w-6 h-6 text-gray-500" strokeWidth={1.5} />
            </div>
            <h3 className="text-[16px] font-medium text-white mb-1">No leads found</h3>
            <p className="text-gray-500 text-[13px] mb-6">
              {searchQuery ? 'Try adjusting your search' : 'Import leads to get started'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowImporter(true)}
                className="glass-button-primary inline-flex items-center gap-2"
              >
                <Upload className="w-4 h-4" strokeWidth={2} />
                <span>{t('sidebar.leads', 'Import Leads')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="px-6 py-4 w-12">
                    <input
                      type="checkbox"
                      checked={filteredLeads.length > 0 && filteredLeads.every(l => selectedLeads.has(l.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedLeads(new Set(filteredLeads.map(l => l.id)));
                        } else {
                          setSelectedLeads(new Set());
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900 focus:ring-offset-0 focus:ring-offset-transparent"
                    />
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Business</th>
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Category</th>
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Location</th>
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Contact</th>
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredLeads.map(lead => (
                  <tr 
                    key={lead.id}
                    className={`hover:bg-white/5 transition-colors ${selectedLeads.has(lead.id) ? 'bg-[#1ED4A7]/5' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedLeads.has(lead.id)}
                        onChange={(e) => {
                          const newSelected = new Set(selectedLeads);
                          if (e.target.checked) {
                            newSelected.add(lead.id);
                          } else {
                            newSelected.delete(lead.id);
                          }
                          setSelectedLeads(newSelected);
                        }}
                        className="w-4 h-4 rounded border-gray-300 dark:border-zinc-700 accent-[#1ED4A7] text-[#1ED4A7] focus:ring-[#1ED4A7] bg-white dark:bg-zinc-900 focus:ring-offset-0 focus:ring-offset-transparent"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-[14px] font-medium text-white">{cleanBizDisplay(lead.business_name) || toTitleCase(lead.contact_name) || toTitleCase(lead.business_name) || '—'}</p>
                        </div>
                        {lead.rating && (
                          <div className="flex items-center gap-1.5">
                            <div className="flex items-center gap-0.5">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  className={`w-3 h-3 ${
                                    i < Math.floor(lead.rating || 0)
                                      ? 'text-amber-400 fill-amber-400'
                                      : 'text-gray-700'
                                  }`}
                                  strokeWidth={1.5}
                                />
                              ))}
                            </div>
                            <span className="text-xs text-gray-400 font-medium">
                              {lead.rating.toFixed(1)}
                            </span>
                            {lead.reviews && (
                              <span className="text-xs text-gray-600">
                                ({lead.reviews})
                              </span>
                            )}
                          </div>
                        )}
                        {lead.website && (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12px] text-gray-500 hover:text-[#1ED4A7] transition-colors flex items-center gap-1.5 w-fit mt-1"
                          >
                            <Globe className="w-3 h-3" strokeWidth={1.5} />
                            <span>Website</span>
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-300">
                        {toTitleCase(lead.category) || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                        <div>
                          <p className="text-[13px] text-gray-300">{toTitleCase(lead.city) || 'N/A'}</p>
                          {lead.address && (
                            <p className="text-xs text-gray-600 mt-0.5 max-w-[150px] truncate">{lead.address}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1.5">
                        {editingLeadId === lead.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={e => setEditEmail(e.target.value)}
                              placeholder="email@example.com"
                              className="w-40 px-2 py-1 text-[12px] bg-black/20 border border-white/20 text-white rounded focus:outline-none focus:border-[#1ED4A7]"
                              autoFocus
                              onKeyPress={e => e.key === 'Enter' && !updating && saveEmail(lead.id)}
                            />
                            <button
                              onClick={() => saveEmail(lead.id)}
                              disabled={updating}
                              className="p-1 text-[#1ED4A7] hover:bg-[#1ED4A7]/10 rounded transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" strokeWidth={2} />
                            </button>
                            <button
                              onClick={cancelEditing}
                              disabled={updating}
                              className="p-1 text-gray-500 hover:bg-white/10 rounded transition-colors"
                            >
                              <XIcon className="w-3.5 h-3.5" strokeWidth={2} />
                            </button>
                          </div>
                        ) : (
                          <>
                            {lead.email ? (
                              <div className="flex items-center gap-2 text-[13px] group">
                                {lead.bounced ? (
                                  <>
                                    <XIcon className="w-3.5 h-3.5 text-red-400" strokeWidth={1.5} />
                                    <span className="text-red-400 line-through decoration-red-400/50">{lead.email}</span>
                                    <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                      BOUNCED
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <MailIcon className="w-3.5 h-3.5 text-[#1ED4A7]" strokeWidth={1.5} />
                                    <span className="text-gray-300">{lead.email}</span>
                                  </>
                                )}
                                <button
                                  onClick={() => startEditing(lead)}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-white transition-all"
                                  title="Edit email"
                                >
                                  <Edit2 className="w-3 h-3" strokeWidth={1.5} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEditing(lead)}
                                className="flex items-center gap-1.5 text-[12px] text-amber-500/80 hover:text-amber-400 transition-colors"
                              >
                                <AlertTriangle className="w-3 h-3" strokeWidth={1.5} />
                                <span>Add email</span>
                              </button>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-2 text-[13px] text-gray-500">
                                <Phone className="w-3.5 h-3.5" strokeWidth={1.5} />
                                <span>{lead.phone}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {/* Actions can go here */}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Count */}
      <div className="flex items-center justify-between text-[13px] text-gray-500 px-2">
        <span>Showing {filteredLeads.length} of {leads.length} leads</span>
        {filteredLeads.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="text-[#1ED4A7] font-medium">{leadsWithEmail} with email</span>
            {leadsWithoutEmail > 0 && (
              <>
                <span className="w-1 h-1 bg-gray-600 rounded-full" />
                <span className="text-amber-500/80 font-medium">{leadsWithoutEmail} without email</span>
              </>
            )}
          </span>
        )}
      </div>

      </>}

      {/* ══════════════ TEAM LEADS VIEW ══════════════ */}
      {leadView === 'team' && (
        <div className="glass-card overflow-hidden">
          {loadingTeamLeads ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full" />
              <span className="ml-3 text-gray-400 text-[13px]">Loading team leads...</span>
            </div>
          ) : teamLeads.length === 0 ? (
            <div className="text-center py-20 px-6">
              <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                <Users className="w-6 h-6 text-blue-400" strokeWidth={1.5} />
              </div>
              <h3 className="text-[16px] font-medium text-white mb-1">
                {teamSize <= 1 ? 'No team members yet' : 'No team leads found'}
              </h3>
              <p className="text-gray-500 text-[13px] max-w-md mx-auto">
                {teamSize <= 1
                  ? 'Invite team members from Settings to share leads and prevent double-contacting prospects.'
                  : 'Your team members haven\'t saved any leads yet. Leads saved by team members will appear here.'}
              </p>
            </div>
          ) : (
            <>
              {/* Team info banner */}
              <div className="px-6 py-3 bg-blue-500/5 border-b border-blue-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" strokeWidth={1.5} />
                  <span className="text-[13px] text-blue-300 font-medium">
                    {teamLeads.length} leads from {teamMembers.filter(m => teamLeads.some(l => l.added_by_email === m.email)).length} team member{teamMembers.length > 2 ? 's' : ''}
                  </span>
                  {/* Outreach summary */}
                  {(() => {
                    const contactedCount = teamLeads.filter(l => l.team_outreach && l.team_outreach.length > 0).length;
                    const availableCount = teamLeads.length - contactedCount;
                    return contactedCount > 0 ? (
                      <span className="flex items-center gap-3 sm:ml-3 sm:pl-3 sm:border-l border-white/10">
                        <span className="flex items-center gap-1.5 text-[12px] text-amber-400">
                          <Send className="w-3 h-3" strokeWidth={1.5} />
                          {contactedCount} contacted
                        </span>
                        <span className="flex items-center gap-1.5 text-[12px] text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          {availableCount} available
                        </span>
                      </span>
                    ) : null;
                  })()}
                </div>
                <button
                  onClick={() => loadTeamLeads(true)}
                  className="text-[12px] text-gray-500 hover:text-white transition-colors"
                >
                  Refresh
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Business</th>
                      <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Category</th>
                      <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Location</th>
                      <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Contact</th>
                      <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Outreach</th>
                      <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Added By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {teamLeads
                      .filter(lead =>
                        !searchQuery ||
                        lead.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        lead.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        lead.city?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        lead.email?.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      .map(lead => (
                      <tr key={lead.id} className={`hover:bg-white/5 transition-colors ${lead.team_outreach && lead.team_outreach.length > 0 ? 'bg-amber-500/[0.02]' : ''}`}>
                        <td className="px-6 py-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-[14px] font-medium text-white">{cleanBizDisplay(lead.business_name) || toTitleCase(lead.contact_name) || toTitleCase(lead.business_name) || '—'}</p>
                              {lead.team_outreach && lead.team_outreach.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider flex-shrink-0">
                                  <Send className="w-2.5 h-2.5" strokeWidth={2} />
                                  Contacted
                                </span>
                              )}
                            </div>
                            {lead.website && (
                              <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-[12px] text-gray-500 hover:text-[#1ED4A7] transition-colors flex items-center gap-1.5 w-fit mt-1">
                                <Globe className="w-3 h-3" strokeWidth={1.5} />
                                <span>Website</span>
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-300">
                            {toTitleCase(lead.category) || 'N/A'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-start gap-2">
                            <MapPin className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                            <p className="text-[13px] text-gray-300">{toTitleCase(lead.city) || 'N/A'}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            {lead.email && (
                              <div className="flex items-center gap-2 text-[13px]">
                                <MailIcon className="w-3.5 h-3.5 text-blue-400" strokeWidth={1.5} />
                                <span className="text-gray-300">{lead.email}</span>
                              </div>
                            )}
                            {lead.phone && (
                              <div className="flex items-center gap-2 text-[13px] text-gray-500">
                                <Phone className="w-3.5 h-3.5" strokeWidth={1.5} />
                                <span>{lead.phone}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        {/* ── Outreach Attribution Column ── */}
                        <td className="px-6 py-4">
                          {lead.team_outreach && lead.team_outreach.length > 0 ? (
                            <div className="space-y-1.5">
                              {lead.team_outreach.slice(0, 2).map((outreach, idx) => (
                                <div key={idx} className="flex items-center gap-2 group/outreach relative">
                                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                                    outreach.is_you
                                      ? 'bg-[#1ED4A7]/20 border border-[#1ED4A7]/30 text-[#1ED4A7]'
                                      : 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                                  }`}>
                                    {outreach.contacted_by[0].toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className={`text-[11px] font-medium truncate max-w-[140px] ${
                                      outreach.is_you ? 'text-[#1ED4A7]' : 'text-amber-400'
                                    }`}>
                                      {outreach.is_you ? 'You' : outreach.contacted_by}
                                    </p>
                                    <p className="text-[10px] text-gray-600 truncate max-w-[140px]">
                                      {outreach.campaign_name} &middot; {new Date(outreach.sent_at).toLocaleDateString()}
                                    </p>
                                  </div>
                                  {/* Tooltip on hover */}
                                  <div className="absolute bottom-full left-0 mb-2 hidden group-hover/outreach:block z-20 pointer-events-none">
                                    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                                      <p className="text-[11px] text-white font-medium">
                                        {outreach.is_you ? 'You' : outreach.contacted_by} contacted this lead
                                      </p>
                                      <p className="text-[10px] text-gray-400 mt-0.5">
                                        Campaign: {outreach.campaign_name}
                                      </p>
                                      <p className="text-[10px] text-gray-400">
                                        Sent: {new Date(outreach.sent_at).toLocaleString()}
                                      </p>
                                      <p className="text-[10px] text-gray-400 capitalize">
                                        Status: {outreach.status}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {lead.team_outreach.length > 2 && (
                                <p className="text-[10px] text-gray-600">
                                  +{lead.team_outreach.length - 2} more
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-medium text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              Available
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-[10px] font-bold text-blue-300 flex-shrink-0">
                              {(lead.added_by || '?')[0].toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] text-gray-300 truncate">{lead.added_by || 'Team Member'}</p>
                              <p className="text-[10px] text-gray-600 truncate">{new Date(lead.created_at).toLocaleDateString()}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Importer Modal */}
      {showImporter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={() => setShowImporter(false)}
          />
          <div className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto glass-card animate-scale-in">
            <LeadImporter
              onClose={() => setShowImporter(false)}
              onImportComplete={loadLeads}
            />
          </div>
        </div>
      )}

      {/* Groups Manager Modal */}
      {showGroupsManager && (
        <GroupsManager
          onClose={() => setShowGroupsManager(false)}
          onGroupCreated={loadLeads}
        />
      )}

      {/* Group Selector Modal */}
      {showGroupSelector && (
        <GroupSelector
          onClose={() => setShowGroupSelector(false)}
          selectedLeadIds={Array.from(selectedLeads)}
          onSuccess={() => {
            setSelectedLeads(new Set());
            loadLeads();
          }}
        />
      )}
    </div>
  );
}