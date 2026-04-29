// AI-Powered Lead Scoring System
// Analyzes lead data and assigns quality scores (0-100)
// V2: Now integrates Buying Intent Engine scores for a unified score

import * as kv from "./kv-retry.tsx";

interface Lead {
  id: string;
  business_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  title?: string;
  company_size?: string;
  industry?: string;
  city?: string;
  state?: string;
  status?: string;
  last_contacted?: string;
  created_at: string;
}

interface LeadWithEngagement extends Lead {
  email_opens?: number;
  email_clicks?: number;
  email_replies?: number;
  total_emails_sent?: number;
}

interface ScoringFactors {
  dataCompleteness: number;
  contactQuality: number;
  companySize: number;
  industryValue: number;
  titleValue: number;
  engagement: number;
  recency: number;
  status: number;
  intentScore: number;
}

// Industry value weights (higher = more valuable for B2B SaaS)
const INDUSTRY_SCORES: Record<string, number> = {
  'SaaS': 100,
  'Technology': 95,
  'Finance': 90,
  'Healthcare': 85,
  'Legal': 80,
  'Consulting': 80,
  'Marketing': 75,
  'E-commerce': 70,
  'Real Estate': 65,
  'Education': 60,
  'Manufacturing': 55,
  'Retail': 50,
  'Hospitality': 45,
  'Construction': 40,
  'Media': 70
};

// Company size scores
const COMPANY_SIZE_SCORES: Record<string, number> = {
  '500+': 100,
  '201-500': 85,
  '51-200': 70,
  '11-50': 50,
  '1-10': 30
};

// Job title scores (decision-making power)
const TITLE_KEYWORDS: Record<string, number> = {
  'CEO': 100,
  'Founder': 100,
  'Co-Founder': 100,
  'President': 95,
  'Owner': 95,
  'CTO': 90,
  'CMO': 90,
  'CFO': 90,
  'COO': 90,
  'VP': 85,
  'Vice President': 85,
  'Director': 75,
  'Head': 75,
  'Manager': 60,
  'Lead': 50,
  'Coordinator': 40,
  'Specialist': 35,
  'Associate': 30
};

// Lead status scores
const STATUS_SCORES: Record<string, number> = {
  'won': 100,
  'negotiation': 90,
  'proposal': 80,
  'qualified': 70,
  'contacted': 50,
  'new': 30,
  'lost': 0,
  'unqualified': 0
};

/**
 * Calculate data completeness score (0-100)
 */
function calculateDataCompleteness(lead: Lead): number {
  const fields = [
    lead.business_name,
    lead.contact_name,
    lead.email,
    lead.phone,
    lead.website,
    lead.title,
    lead.company_size,
    lead.industry,
    lead.city,
    lead.state
  ];

  const filledFields = fields.filter(field => field && field.trim() !== '').length;
  return (filledFields / fields.length) * 100;
}

/**
 * Calculate contact quality score (0-100)
 */
function calculateContactQuality(lead: Lead): number {
  let score = 0;

  // Email quality
  if (lead.email) {
    if (lead.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      score += 25;
      
      // Generic emails are lower quality
      const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
      const domain = lead.email.split('@')[1];
      if (!genericDomains.includes(domain)) {
        score += 25; // Business email is better
      }
    }
  }

  // Phone number
  if (lead.phone && lead.phone.length >= 10) {
    score += 20;
  }

  // Website
  if (lead.website && lead.website.startsWith('http')) {
    score += 15;
  }

  // Full name vs just first name
  if (lead.contact_name && lead.contact_name.includes(' ')) {
    score += 15;
  }

  return Math.min(score, 100);
}

/**
 * Calculate company size score (0-100)
 */
function calculateCompanySizeScore(lead: Lead): number {
  if (!lead.company_size) return 40; // Neutral if unknown
  return COMPANY_SIZE_SCORES[lead.company_size] || 40;
}

/**
 * Calculate industry value score (0-100)
 */
function calculateIndustryScore(lead: Lead): number {
  if (!lead.industry) return 50; // Neutral if unknown
  return INDUSTRY_SCORES[lead.industry] || 50;
}

/**
 * Calculate title value score (0-100)
 */
function calculateTitleScore(lead: Lead): number {
  if (!lead.title) return 40; // Neutral if unknown

  const titleLower = lead.title.toLowerCase();
  
  // Check for keyword matches
  for (const [keyword, score] of Object.entries(TITLE_KEYWORDS)) {
    if (titleLower.includes(keyword.toLowerCase())) {
      return score;
    }
  }

  return 40; // Default for unknown titles
}

/**
 * Calculate engagement score (0-100)
 */
function calculateEngagementScore(lead: LeadWithEngagement): number {
  const { email_opens = 0, email_clicks = 0, email_replies = 0, total_emails_sent = 0 } = lead;

  if (total_emails_sent === 0) return 50; // Neutral if no emails sent

  // Calculate engagement rates
  const openRate = email_opens / total_emails_sent;
  const clickRate = email_clicks / total_emails_sent;
  const replyRate = email_replies / total_emails_sent;

  // Weighted scoring
  let score = 0;
  score += openRate * 30; // Opens worth 30%
  score += clickRate * 40; // Clicks worth 40%
  score += replyRate * 50; // Replies worth 50% (can exceed 100 if multiple replies)

  return Math.min(score * 100, 100);
}

/**
 * Calculate recency score (0-100)
 */
function calculateRecencyScore(lead: Lead): number {
  const lastContactDate = lead.last_contacted ? new Date(lead.last_contacted) : new Date(lead.created_at);
  const daysSinceContact = Math.floor((Date.now() - lastContactDate.getTime()) / (1000 * 60 * 60 * 24));

  // Fresh leads (0-7 days) = 100
  // Week old (8-14 days) = 85
  // Month old (15-30 days) = 70
  // Quarter old (31-90 days) = 50
  // Older = decaying score

  if (daysSinceContact <= 7) return 100;
  if (daysSinceContact <= 14) return 85;
  if (daysSinceContact <= 30) return 70;
  if (daysSinceContact <= 90) return 50;
  if (daysSinceContact <= 180) return 30;
  return 10;
}

/**
 * Calculate status score (0-100)
 */
function calculateStatusScore(lead: Lead): number {
  if (!lead.status) return 50;
  return STATUS_SCORES[lead.status] || 50;
}

/**
 * Calculate overall lead score with weighted factors
 * intentScoreOverride: optional 0-100 from the Buying Intent Engine
 */
export function calculateLeadScore(lead: LeadWithEngagement, intentScoreOverride?: number): {
  totalScore: number;
  factors: ScoringFactors;
  grade: string;
} {
  const factors: ScoringFactors = {
    dataCompleteness: calculateDataCompleteness(lead),
    contactQuality: calculateContactQuality(lead),
    companySize: calculateCompanySizeScore(lead),
    industryValue: calculateIndustryScore(lead),
    titleValue: calculateTitleScore(lead),
    engagement: calculateEngagementScore(lead),
    recency: calculateRecencyScore(lead),
    status: calculateStatusScore(lead),
    intentScore: intentScoreOverride ?? 50, // 50 = neutral when no intent data
  };

  // Weighted total score — intent gets 15%, engagement drops to 12%,
  // other factors adjusted to keep sum = 1.0
  const hasIntent = intentScoreOverride !== undefined && intentScoreOverride !== null;
  const weights = hasIntent ? {
    dataCompleteness: 0.08,
    contactQuality: 0.12,
    companySize: 0.12,
    industryValue: 0.08,
    titleValue: 0.13,
    engagement: 0.12,
    recency: 0.08,
    status: 0.05,
    intentScore: 0.22, // Intent is the strongest signal when present
  } : {
    dataCompleteness: 0.10,
    contactQuality: 0.15,
    companySize: 0.15,
    industryValue: 0.10,
    titleValue: 0.15,
    engagement: 0.20,
    recency: 0.10,
    status: 0.05,
    intentScore: 0.00, // No intent data — use legacy weights
  };

  const totalScore = Math.round(
    factors.dataCompleteness * weights.dataCompleteness +
    factors.contactQuality * weights.contactQuality +
    factors.companySize * weights.companySize +
    factors.industryValue * weights.industryValue +
    factors.titleValue * weights.titleValue +
    factors.engagement * weights.engagement +
    factors.recency * weights.recency +
    factors.status * weights.status +
    factors.intentScore * weights.intentScore
  );

  // Assign grade
  let grade = 'F';
  if (totalScore >= 90) grade = 'A+';
  else if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 80) grade = 'A-';
  else if (totalScore >= 75) grade = 'B+';
  else if (totalScore >= 70) grade = 'B';
  else if (totalScore >= 65) grade = 'B-';
  else if (totalScore >= 60) grade = 'C+';
  else if (totalScore >= 55) grade = 'C';
  else if (totalScore >= 50) grade = 'C-';
  else if (totalScore >= 40) grade = 'D';

  return { totalScore, factors, grade };
}

/**
 * Get engagement data for a lead
 */
async function getLeadEngagement(supabase: any, leadId: string): Promise<{
  email_opens: number;
  email_clicks: number;
  email_replies: number;
  total_emails_sent: number;
}> {
  const { data: emails } = await supabase
    .from('emails')
    .select('open_count, click_count, status')
    .eq('lead_id', leadId);

  if (!emails || emails.length === 0) {
    return { email_opens: 0, email_clicks: 0, email_replies: 0, total_emails_sent: 0 };
  }

  return {
    email_opens: emails.reduce((sum: number, e: any) => sum + (e.open_count || 0), 0),
    email_clicks: emails.reduce((sum: number, e: any) => sum + (e.click_count || 0), 0),
    email_replies: emails.filter((e: any) => e.status === 'replied').length,
    total_emails_sent: emails.length
  };
}

/**
 * Fetch the buying intent score for a lead from the Intent Engine KV store.
 * Looks up by lead_${leadId} first, then falls back to company name match.
 */
async function getIntentScoreForLead(userId: string, leadId: string, businessName?: string): Promise<number | undefined> {
  try {
    // Primary lookup: by lead-based company ID
    const directScore = await kv.get(`intent:score:${userId}:lead_${leadId}`);
    if (directScore && typeof (directScore as any).total_score === 'number') {
      return (directScore as any).total_score;
    }

    // Fallback: search by org-based company ID derived from business name
    if (businessName) {
      const orgKey = `org_${businessName.toLowerCase().replace(/\s+/g, '_')}`;
      const orgScore = await kv.get(`intent:score:${userId}:${orgKey}`);
      if (orgScore && typeof (orgScore as any).total_score === 'number') {
        return (orgScore as any).total_score;
      }

      // Last resort: scan all scores for a name match (expensive — capped)
      const allScores = await kv.getByPrefix(`intent:score:${userId}:`) as any[];
      if (allScores && allScores.length > 0) {
        const nameLower = businessName.toLowerCase();
        const match = allScores.find((s: any) =>
          s.company_name && s.company_name.toLowerCase() === nameLower
        );
        if (match) return match.total_score;
      }
    }

    return undefined; // No intent data — legacy scoring weights apply
  } catch (e) {
    console.warn(`[LEAD-SCORING] Intent score lookup failed for lead ${leadId}:`, e);
    return undefined;
  }
}

/**
 * Score a single lead
 */
export async function scoreLead(
  supabase: any,
  leadId: string
): Promise<{ score: number; grade: string; factors: ScoringFactors }> {
  // Get lead data
  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (error || !lead) {
    throw new Error(`Failed to fetch lead: ${error?.message}`);
  }

  // Get engagement data
  const engagement = await getLeadEngagement(supabase, leadId);

  // Get buying intent score from the Intent Engine
  const intentScore = await getIntentScoreForLead(lead.user_id, leadId, lead.business_name);

  // Calculate score with intent integration
  const leadWithEngagement: LeadWithEngagement = { ...lead, ...engagement };
  const result = calculateLeadScore(leadWithEngagement, intentScore);

  // Update lead score in database
  await supabase
    .from('leads')
    .update({ 
      score: result.totalScore,
      updated_at: new Date().toISOString()
    })
    .eq('id', leadId);

  return {
    score: result.totalScore,
    grade: result.grade,
    factors: result.factors
  };
}

/**
 * Score all leads for a user
 */
export async function scoreAllLeads(
  supabase: any,
  userId: string,
  onProgress?: (current: number, total: number) => void
): Promise<{
  totalLeads: number;
  scored: number;
  errors: number;
  averageScore: number;
}> {
  // Get all leads for user
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  const totalLeads = leads?.length || 0;
  let scored = 0;
  let errors = 0;
  let totalScore = 0;

  console.log(`[LEAD-SCORING] Scoring ${totalLeads} leads for user ${userId}...`);

  // Score each lead
  for (let i = 0; i < totalLeads; i++) {
    const lead = leads[i];
    try {
      const result = await scoreLead(supabase, lead.id);
      totalScore += result.score;
      scored++;
      
      if (onProgress) {
        onProgress(i + 1, totalLeads);
      }

      if (scored % 10 === 0) {
        console.log(`[LEAD-SCORING] Progress: ${scored}/${totalLeads} leads scored`);
      }
    } catch (err) {
      console.error(`[LEAD-SCORING] Error scoring lead ${lead.id}:`, err);
      errors++;
    }
  }

  const averageScore = scored > 0 ? Math.round(totalScore / scored) : 0;

  console.log(`[LEAD-SCORING] Complete: ${scored} scored, ${errors} errors, avg score: ${averageScore}`);

  return {
    totalLeads,
    scored,
    errors,
    averageScore
  };
}

/**
 * Get scoring breakdown for a lead (for UI display)
 */
export async function getLeadScoreBreakdown(
  supabase: any,
  leadId: string
): Promise<{
  totalScore: number;
  grade: string;
  factors: ScoringFactors;
  recommendations: string[];
}> {
  // Get lead data
  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (error || !lead) {
    throw new Error(`Failed to fetch lead: ${error?.message}`);
  }

  // Get engagement data
  const engagement = await getLeadEngagement(supabase, leadId);

  // Get buying intent score
  const intentScore = await getIntentScoreForLead(lead.user_id, leadId, lead.business_name);

  // Calculate score with intent
  const leadWithEngagement: LeadWithEngagement = { ...lead, ...engagement };
  const result = calculateLeadScore(leadWithEngagement, intentScore);

  // Generate recommendations
  const recommendations: string[] = [];

  if (result.factors.dataCompleteness < 70) {
    recommendations.push('Complete missing lead data fields for better targeting');
  }
  if (result.factors.contactQuality < 60) {
    recommendations.push('Verify email and phone number accuracy');
  }
  if (result.factors.engagement < 50 && engagement.total_emails_sent > 0) {
    recommendations.push('Low engagement - consider different messaging or timing');
  }
  if (result.factors.engagement === 50 && engagement.total_emails_sent === 0) {
    recommendations.push('No emails sent yet - initiate outreach');
  }
  if (result.factors.recency < 50) {
    recommendations.push('Lead is going cold - follow up soon');
  }
  if (result.factors.titleValue < 60) {
    recommendations.push('Try to identify a higher-level decision maker');
  }
  if (intentScore !== undefined && intentScore >= 61) {
    recommendations.push('High buying intent detected — prioritize immediate outreach');
  } else if (intentScore === undefined) {
    recommendations.push('No intent data yet — install the tracking script to capture website signals');
  }

  return {
    totalScore: result.totalScore,
    grade: result.grade,
    factors: result.factors,
    recommendations
  };
}
