import { createClient } from '@supabase/supabase-js';
import { publicAnonKey, supabaseUrl } from '../utils/supabase/info';

const supabaseAnonKey = publicAnonKey;

// Log configuration (only in development)
const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
if (isDev) {
  console.log('[SUPABASE] Initializing client:', {
    url: supabaseUrl,
    hasKey: !!supabaseAnonKey,
    keyPrefix: supabaseAnonKey?.substring(0, 20) + '...'
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  global: {
    headers: {
      'X-Client-Info': 'contndr-web'
    }
  }
});

// Database types
export interface Lead {
  id: string;
  org_id?: string;
  business_name: string;
  category?: string;
  city?: string;
  address?: string;
  website?: string;
  email?: string;
  phone?: string;
  source: string;
  created_at: string;
}

export interface Campaign {
  id: string;
  org_id?: string;
  name: string;
  product: 'roadr_provider' | 'sourcr_web' | 'sourcr_app' | 'custom';
  price_summary: string;
  landing_url: string;
  tone: 'casual' | 'professional' | 'enthusiastic';
  from_email: string;
  status: 'draft' | 'active' | 'paused';
  created_at: string;
}

export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: 'pending' | 'email_1_sent' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'won' | 'lost';
  last_email_id?: string;
  created_at: string;
}

export interface Email {
  id: string;
  campaign_id: string;
  lead_id: string;
  resend_id?: string;
  subject: string;
  preview: string;
  text_body: string;
  html_body: string;
  direction: 'outbound' | 'inbound';
  status: 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced';
  sent_at?: string;
  created_at: string;
}
