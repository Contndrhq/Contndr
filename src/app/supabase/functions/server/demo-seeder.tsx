// Demo Data Seeder for demo@contndr.com
// Creates realistic showcase data with live tracking events, campaigns, leads, and analytics

import * as kv from "./kv-retry.tsx";

interface DemoConfig {
  userEmail: string;
  leadCount: number;
  campaignCount: number;
  emailsPerCampaign: number;
  trackingEventsPerEmail: number;
  revenueEvents: number;
}

const DEFAULT_DEMO_CONFIG: DemoConfig = {
  userEmail: 'demo@contndr.com',
  leadCount: 250,
  campaignCount: 5,
  emailsPerCampaign: 40,
  trackingEventsPerEmail: 3,
  revenueEvents: 15
};

// Sample business data for realistic leads
const DEMO_CITIES = [
  { city: 'San Francisco', state: 'CA', lat: 37.7749, lng: -122.4194 },
  { city: 'New York', state: 'NY', lat: 40.7128, lng: -74.0060 },
  { city: 'Austin', state: 'TX', lat: 30.2672, lng: -97.7431 },
  { city: 'Seattle', state: 'WA', lat: 47.6062, lng: -122.3321 },
  { city: 'Boston', state: 'MA', lat: 42.3601, lng: -71.0589 },
  { city: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903 },
  { city: 'Miami', state: 'FL', lat: 25.7617, lng: -80.1918 },
  { city: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
  { city: 'Los Angeles', state: 'CA', lat: 34.0522, lng: -118.2437 },
  { city: 'Portland', state: 'OR', lat: 45.5152, lng: -122.6784 },
  { city: 'Atlanta', state: 'GA', lat: 33.7490, lng: -84.3880 },
  { city: 'Phoenix', state: 'AZ', lat: 33.4484, lng: -112.0740 },
  { city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.7970 },
  { city: 'Philadelphia', state: 'PA', lat: 39.9526, lng: -75.1652 },
  { city: 'Nashville', state: 'TN', lat: 36.1627, lng: -86.7816 }
];

const DEMO_INDUSTRIES = [
  'SaaS', 'E-commerce', 'Marketing', 'Real Estate', 'Healthcare',
  'Finance', 'Legal', 'Education', 'Manufacturing', 'Retail',
  'Hospitality', 'Construction', 'Technology', 'Consulting', 'Media'
];

const DEMO_COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'];

const DEMO_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const FIRST_NAMES = [
  'Sarah', 'Michael', 'Jennifer', 'David', 'Emily', 'James', 'Jessica', 'Robert',
  'Ashley', 'Christopher', 'Amanda', 'Daniel', 'Melissa', 'Matthew', 'Lisa', 'Andrew',
  'Nicole', 'Joshua', 'Karen', 'Kevin', 'Angela', 'Brian', 'Michelle', 'Ryan'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White', 'Harris'
];

const COMPANY_PREFIXES = [
  'Tech', 'Digital', 'Smart', 'Cloud', 'Global', 'Innovative', 'Dynamic', 'Premier',
  'Advanced', 'Elite', 'Next', 'Rapid', 'Agile', 'Modern', 'Strategic'
];

const COMPANY_SUFFIXES = [
  'Solutions', 'Systems', 'Group', 'Partners', 'Ventures', 'Labs', 'Studios',
  'Innovations', 'Technologies', 'Enterprises', 'Services', 'Consulting', 'Agency'
];

const JOB_TITLES = [
  'CEO', 'CTO', 'CMO', 'VP of Sales', 'VP of Marketing', 'Director of Operations',
  'Head of Growth', 'Founder', 'Co-Founder', 'General Manager', 'Sales Director',
  'Marketing Director', 'Operations Manager', 'Business Development Manager'
];

// Helper functions
function randomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - randomInt(0, daysAgo));
  return date.toISOString();
}

function generateBusinessName(): string {
  return `${randomItem(COMPANY_PREFIXES)} ${randomItem(COMPANY_SUFFIXES)}`;
}

function generateDomain(businessName: string): string {
  return businessName.toLowerCase().replace(/\s+/g, '') + '.com';
}

function generateEmail(firstName: string, lastName: string, domain: string): string {
  const formats = [
    `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
    `${firstName.toLowerCase()}${lastName.toLowerCase()}@${domain}`,
    `${firstName[0].toLowerCase()}${lastName.toLowerCase()}@${domain}`,
  ];
  return randomItem(formats);
}

function generatePhone(): string {
  const area = randomInt(200, 999);
  const prefix = randomInt(200, 999);
  const line = randomInt(1000, 9999);
  return `(${area}) ${prefix}-${line}`;
}

/**
 * Seed demo data for the demo account
 */
export async function seedDemoData(
  supabase: any,
  userId: string,
  config: Partial<DemoConfig> = {}
): Promise<{
  success: boolean;
  stats: {
    leads: number;
    campaigns: number;
    emails: number;
    tracking_events: number;
    revenue_events: number;
  };
}> {
  const cfg = { ...DEFAULT_DEMO_CONFIG, ...config };

  console.log('[DEMO-SEED] Starting demo data seeding for user:', userId);
  console.log('[DEMO-SEED] Config:', cfg);

  const stats = {
    leads: 0,
    campaigns: 0,
    emails: 0,
    tracking_events: 0,
    revenue_events: 0
  };

  try {
    // 1. Generate and insert demo leads
    console.log('[DEMO-SEED] Creating demo leads...');
    const leads = [];
    // Store location data keyed by email for tracking events later
    const leadLocationMap: Record<string, { lat: number; lng: number }> = {};
    
    for (let i = 0; i < cfg.leadCount; i++) {
      const location = randomItem(DEMO_CITIES);
      const firstName = randomItem(FIRST_NAMES);
      const lastName = randomItem(LAST_NAMES);
      const businessName = generateBusinessName();
      const domain = generateDomain(businessName);
      const email = generateEmail(firstName, lastName, domain);

      // Store location for tracking events (keyed by email)
      leadLocationMap[email] = {
        lat: location.lat + (Math.random() - 0.5) * 0.1,
        lng: location.lng + (Math.random() - 0.5) * 0.1
      };

      leads.push({
        user_id: userId,
        business_name: businessName,
        contact_name: `${firstName} ${lastName}`,
        email: email,
        phone: generatePhone(),
        website: `https://${domain}`,
        address: `${randomInt(100, 9999)} Main St, ${location.city}, ${location.state} ${randomInt(10000, 99999)}`,
        city: location.city,
        state: location.state,
        industry: randomItem(DEMO_INDUSTRIES),
        employees: randomItem(DEMO_COMPANY_SIZES),
        status: randomItem(DEMO_LEAD_STATUSES),
        job_title: randomItem(JOB_TITLES),
        notes: 'Demo lead for showcase purposes',
        last_contacted: Math.random() > 0.5 ? randomDate(30) : null,
        created_at: randomDate(90)
      });

      if (leads.length % 50 === 0) {
        console.log(`[DEMO-SEED] Generated ${leads.length}/${cfg.leadCount} leads...`);
      }
    }

    const { error: leadsError, data: insertedLeads } = await supabase
      .from('leads')
      .insert(leads)
      .select('id, email, contact_name, business_name, city, state, status');

    if (leadsError) throw new Error(`Failed to insert leads: ${leadsError.message}`);
    stats.leads = insertedLeads?.length || 0;
    console.log(`[DEMO-SEED] ✓ Created ${stats.leads} leads`);

    // 2. Create demo campaigns
    console.log('[DEMO-SEED] Creating demo campaigns...');
    const campaigns = [];
    const campaignNames = [
      'Q1 2026 Outreach Campaign',
      'New Product Launch',
      'Re-engagement Campaign',
      'Holiday Special Offer',
      'Partnership Opportunities'
    ];

    for (let i = 0; i < Math.min(cfg.campaignCount, campaignNames.length); i++) {
      campaigns.push({
        user_id: userId,
        name: campaignNames[i],
        brand: 'Contndr Demo',
        product: 'Contndr Demo',
        from_email: 'demo@contndr.com',
        sender_name: 'Demo Team',
        tone: 'professional',
        status: i < 2 ? 'active' : i < 4 ? 'completed' : 'paused',
        created_at: randomDate(60)
      });
    }

    const { error: campaignsError, data: insertedCampaigns } = await supabase
      .from('campaigns')
      .insert(campaigns)
      .select('id, name, status');

    if (campaignsError) throw new Error(`Failed to insert campaigns: ${campaignsError.message}`);
    stats.campaigns = insertedCampaigns?.length || 0;
    console.log(`[DEMO-SEED] ✓ Created ${stats.campaigns} campaigns`);

    // 3. Create demo emails with tracking events
    console.log('[DEMO-SEED] Creating demo emails and tracking events...');
    
    for (const campaign of insertedCampaigns || []) {
      const campaignLeads = insertedLeads?.slice(0, cfg.emailsPerCampaign) || [];
      const emails = [];
      const trackingEvents = [];

      for (const lead of campaignLeads) {
        const sentAt = randomDate(45);
        const sent = new Date(sentAt);
        
        // 95% delivery rate for demo
        const isDelivered = Math.random() < 0.95;
        const deliveredAt = isDelivered 
          ? new Date(sent.getTime() + randomInt(2, 15) * 60 * 1000).toISOString()
          : null;

        // 80% open rate for demo (approx 84% of delivered emails)
        const wasOpened = isDelivered && Math.random() < 0.84;
        const openedAt = wasOpened 
          ? new Date(new Date(deliveredAt!).getTime() + randomInt(1, 48) * 60 * 60 * 1000).toISOString()
          : null;

        // 40% click rate for demo
        const wasClicked = wasOpened && Math.random() < 0.5;
        const clickedAt = wasClicked
          ? new Date(new Date(openedAt!).getTime() + randomInt(1, 12) * 60 * 60 * 1000).toISOString()
          : null;

        // 15% reply rate for demo
        const wasReplied = wasClicked && Math.random() < 0.3;
        const repliedAt = wasReplied
          ? new Date(new Date(clickedAt!).getTime() + randomInt(1, 24) * 60 * 60 * 1000).toISOString()
          : null;

        const email = {
          user_id: userId,
          campaign_id: campaign.id,
          lead_id: lead.id,
          subject: `${campaign.name} - Special Invitation`,
          preview: `Hi ${lead.contact_name}, Demo email content here.`,
          body: `Hi ${lead.contact_name},\n\nDemo email content here.\n\nBest,\nDemo Team`,
          text_body: `Hi ${lead.contact_name},\n\nDemo email content here.\n\nBest,\nDemo Team`,
          html_body: `<p>Hi ${lead.contact_name},</p><p>Demo email content here.</p><p>Best,<br>Demo Team</p>`,
          status: wasReplied ? 'replied' : wasClicked ? 'clicked' : wasOpened ? 'opened' : isDelivered ? 'delivered' : 'sent',
          sent_at: sentAt,
          delivered_at: deliveredAt,
          opened_at: openedAt,
          clicked_at: clickedAt,
          replied_at: repliedAt,
          created_at: sentAt
        };

        emails.push(email);

        // Create tracking events for geographic heatmap
        if (wasOpened) {
          // Open event
          const loc = leadLocationMap[lead.email] || { lat: 0, lng: 0 };
          trackingEvents.push({
            user_id: userId,
            email: lead.email,
            business_name: lead.business_name,
            city: lead.city,
            state: lead.state,
            latitude: loc.lat,
            longitude: loc.lng,
            event_type: 'email_open',
            campaign_name: campaign.name,
            metadata: { email_subject: email.subject },
            created_at: openedAt
          });
        }

        if (wasClicked) {
          // Click event
          const loc = leadLocationMap[lead.email] || { lat: 0, lng: 0 };
          trackingEvents.push({
            user_id: userId,
            email: lead.email,
            business_name: lead.business_name,
            city: lead.city,
            state: lead.state,
            latitude: loc.lat,
            longitude: loc.lng,
            event_type: 'email_click',
            campaign_name: campaign.name,
            metadata: { link_url: 'https://contndr.com/demo' },
            created_at: clickedAt
          });
        }

        // Add some page view events for variety
        if (wasClicked && Math.random() < 0.7) {
          const loc = leadLocationMap[lead.email] || { lat: 0, lng: 0 };
          const viewedAt = new Date(new Date(clickedAt!).getTime() + randomInt(1, 30) * 60 * 1000).toISOString();
          trackingEvents.push({
            user_id: userId,
            email: lead.email,
            business_name: lead.business_name,
            city: lead.city,
            state: lead.state,
            latitude: loc.lat,
            longitude: loc.lng,
            event_type: 'page_view',
            campaign_name: campaign.name,
            metadata: { 
              page_url: 'https://contndr.com/demo',
              page_title: 'Contndr Demo',
              duration_seconds: randomInt(30, 300)
            },
            created_at: viewedAt
          });
        }
      }

      // Insert emails in batch
      if (emails.length > 0) {
        const { data: insertedEmails, error: emailsError } = await supabase
          .from('emails')
          .insert(emails)
          .select('id, lead_id, subject, status, opened_at, clicked_at, replied_at, created_at');

        if (emailsError) throw new Error(`Failed to insert emails: ${emailsError.message}`);
        stats.emails += emails.length;

        // Create email_events for Recent Activity Feed
        const emailEvents = [];
        
        for (const email of insertedEmails || []) {
            // Opened event
            if (email.opened_at) {
                emailEvents.push({
                    email_id: email.id,
                    event_type: 'opened',
                    created_at: email.opened_at
                });
            }
            
            // Clicked event
            if (email.clicked_at) {
                emailEvents.push({
                    email_id: email.id,
                    event_type: 'clicked',
                    created_at: email.clicked_at
                });
            }
            
            // Replied event
            if (email.replied_at) {
                emailEvents.push({
                    email_id: email.id,
                    event_type: 'replied',
                    created_at: email.replied_at
                });
            }
        }
        
        // Insert email_events in batch
        if (emailEvents.length > 0) {
            const { error: eventsError } = await supabase
                .from('email_events')
                .insert(emailEvents);
                
            if (eventsError) {
                console.warn(`[DEMO-SEED] Warning: Failed to insert email_events: ${eventsError.message}`);
            }
        }
      }

      // Insert tracking events in batch
      if (trackingEvents.length > 0) {
        const { error: trackingError } = await supabase
          .from('tracking_events')
          .insert(trackingEvents);

        if (trackingError) {
          console.warn(`[DEMO-SEED] Warning: Failed to insert tracking events: ${trackingError.message}`);
        } else {
          stats.tracking_events += trackingEvents.length;
        }
      }

      console.log(`[DEMO-SEED] ✓ Created ${emails.length} emails and ${trackingEvents.length} tracking events for campaign: ${campaign.name}`);
    }

    // 4. Create demo revenue events
    console.log('[DEMO-SEED] Creating demo revenue events...');
    const revenueEvents = [];
    const dealLeads = insertedLeads?.filter(l => l.status === 'won').slice(0, cfg.revenueEvents) || [];

    for (const lead of dealLeads) {
      const amount = randomInt(500, 50000);
      revenueEvents.push({
        user_id: userId,
        lead_email: lead.email,
        business_name: lead.business_name,
        amount: amount,
        currency: 'usd',
        payment_type: randomItem(['one_time', 'subscription']),
        stripe_payment_id: `demo_pay_${Date.now()}_${randomInt(1000, 9999)}`,
        metadata: {
          demo_data: true,
          plan: randomItem(['Starter', 'Professional', 'Enterprise'])
        },
        created_at: randomDate(60)
      });
    }

    if (revenueEvents.length > 0) {
      const { error: revenueError } = await supabase
        .from('payments')
        .insert(revenueEvents);

      if (revenueError) {
        console.warn(`[DEMO-SEED] Warning: Failed to insert revenue events: ${revenueError.message}`);
      } else {
        stats.revenue_events = revenueEvents.length;
      }
    }

    // 5. Create demo knowledge base entries
    console.log('[DEMO-SEED] Creating demo knowledge base entries...');
    const kbEntries = [
      {
        user_id: userId,
        brand: 'Contndr Demo',
        category: 'product',
        question: 'What is Contndr?',
        answer: 'Contndr is an AI-powered cold outreach platform that helps you find, engage, and convert leads with intelligent email campaigns, live tracking, and revenue analytics.',
        created_at: randomDate(90)
      },
      {
        user_id: userId,
        brand: 'Contndr Demo',
        category: 'pricing',
        question: 'What are your pricing plans?',
        answer: 'We offer Starter ($49/mo), Professional ($149/mo), and Enterprise (custom) plans. All plans include email campaigns, lead tracking, and analytics.',
        created_at: randomDate(90)
      },
      {
        user_id: userId,
        brand: 'Contndr Demo',
        category: 'features',
        question: 'Does Contndr integrate with CRM systems?',
        answer: 'Yes! Contndr integrates with popular CRMs and also includes its own built-in CRM for managing leads, campaigns, and revenue tracking.',
        created_at: randomDate(90)
      }
    ];

    const { error: kbError } = await supabase
      .from('knowledge_base')
      .insert(kbEntries);

    if (kbError) {
      console.warn(`[DEMO-SEED] Warning: Failed to insert knowledge base: ${kbError.message}`);
    }

    // 6. Seed demo email signature into KV store (prevents "Email signature missing" banner)
    console.log('[DEMO-SEED] Creating demo email signature...');
    try {
      const demoSignature = {
        closing_line: 'Best Regards',
        full_name: 'Demo Team',
        title: 'Growth Manager',
        email: 'demo@contndr.com',
        phone: '(555) 123-4567',
        website: 'https://contndr.com',
        custom_html: '',
        updated_at: new Date().toISOString(),
      };
      await kv.set(`signature:${userId}`, JSON.stringify(demoSignature));
      console.log('[DEMO-SEED] ✓ Created demo email signature');
    } catch (sigError) {
      console.warn(`[DEMO-SEED] Warning: Failed to seed email signature: ${(sigError as Error).message}`);
    }

    // 7. Seed pipeline deals from existing leads for a full Kanban demo
    console.log('[DEMO-SEED] Creating demo pipeline deals...');
    try {
      const pipelineLeads = (insertedLeads || []).slice(0, 28); // pick 28 leads for variety
      const now = new Date();
      const DEMO_STAGES = [
        'prospect_identified',
        'contacted',
        'engaged',
        'meeting_booked',
        'proposal_sent',
        'negotiation',
        'closed_won',
        'closed_lost',
      ];
      // Distribution: heavier in mid-funnel to look realistic
      const stageDistribution: Record<string, number> = {
        prospect_identified: 5,
        contacted: 5,
        engaged: 4,
        meeting_booked: 4,
        proposal_sent: 3,
        negotiation: 3,
        closed_won: 3,
        closed_lost: 1,
      };

      const pipelineDeals: any[] = [];
      let leadIdx = 0;

      for (const stage of DEMO_STAGES) {
        const count = stageDistribution[stage] || 1;
        for (let i = 0; i < count && leadIdx < pipelineLeads.length; i++, leadIdx++) {
          const lead = pipelineLeads[leadIdx];
          const daysAgo = randomInt(2, 60);
          const createdAt = new Date(now.getTime() - daysAgo * 86400000).toISOString();
          const stageEnteredDays = Math.min(daysAgo, randomInt(1, 20));
          const stageEnteredAt = new Date(now.getTime() - stageEnteredDays * 86400000).toISOString();

          // Realistic deal values by stage
          const valueRanges: Record<string, [number, number]> = {
            prospect_identified: [2000, 12000],
            contacted: [3000, 18000],
            engaged: [5000, 25000],
            meeting_booked: [8000, 40000],
            proposal_sent: [12000, 65000],
            negotiation: [15000, 85000],
            closed_won: [10000, 120000],
            closed_lost: [5000, 30000],
          };
          const [lo, hi] = valueRanges[stage] || [5000, 50000];
          const value = Math.round(randomInt(lo, hi) / 500) * 500; // round to nearest 500

          // Build stage history from prospect → current stage
          const stageHistory: Array<{ stage: string; entered_at: string; trigger?: string }> = [];
          const stageIndex = DEMO_STAGES.indexOf(stage);
          for (let si = 0; si <= stageIndex; si++) {
            const dAgo = daysAgo - (stageIndex - si) * randomInt(2, 5);
            const triggers = ['manual', 'email_sent', 'email_opened', 'email_replied', 'meeting_booked', undefined];
            stageHistory.push({
              stage: DEMO_STAGES[si],
              entered_at: new Date(now.getTime() - Math.max(dAgo, 1) * 86400000).toISOString(),
              trigger: si > 0 ? (randomItem(triggers) || undefined) : undefined,
            });
          }

          // Expected close date (7–45 days from now for active deals)
          const expectedClose = stage !== 'closed_won' && stage !== 'closed_lost'
            ? new Date(now.getTime() + randomInt(7, 45) * 86400000).toISOString().split('T')[0]
            : undefined;

          // AI fields for showcase
          const aiRiskLevels: Array<'low' | 'medium' | 'high'> = ['low', 'low', 'low', 'medium', 'medium', 'high'];
          const aiNextActions = [
            'Send follow-up with case study',
            'Schedule product demo',
            'Share pricing proposal',
            'Follow up on proposal feedback',
            'Send contract for review',
            'Book a closing call',
            'Reconnect with a new value prop',
            'Send ROI analysis report',
          ];

          pipelineDeals.push({
            id: crypto.randomUUID(),
            contact_name: lead.contact_name || 'Unnamed',
            business_name: lead.business_name || '',
            email: lead.email || '',
            stage,
            value,
            currency: 'USD',
            notes: '',
            category: randomItem(['SaaS', 'E-commerce', 'Enterprise', 'Startup', 'Agency']),
            lead_id: lead.id,
            created_at: createdAt,
            updated_at: stageEnteredAt,
            closed_at: stage === 'closed_won' || stage === 'closed_lost' ? stageEnteredAt : undefined,
            expected_close_date: expectedClose,
            ai_score: stage === 'closed_won' ? 95 : stage === 'closed_lost' ? 12 : randomInt(25, 92),
            ai_next_action: stage !== 'closed_won' && stage !== 'closed_lost' ? randomItem(aiNextActions) : undefined,
            ai_risk_level: stage === 'closed_won' ? 'low' : stage === 'closed_lost' ? 'high' : randomItem(aiRiskLevels),
            ai_predicted_close_date: expectedClose,
            stage_history: stageHistory,
            days_in_stage: stageEnteredDays,
          });
        }
      }

      await kv.set(`pipeline:${userId}:deals`, JSON.stringify(pipelineDeals));
      console.log(`[DEMO-SEED] ✓ Created ${pipelineDeals.length} pipeline deals across ${DEMO_STAGES.length} stages`);

      // Also seed pipeline metrics AI insights for a polished look
      const demoPipelineInsights = {
        health_score: 74,
        summary: 'Your pipeline is healthy with strong mid-funnel activity. Focus on moving 4 engaged deals to meeting stage to maintain velocity.',
        deal_scores: pipelineDeals.filter(d => d.stage !== 'closed_won' && d.stage !== 'closed_lost').map(d => ({
          deal_id: d.id,
          score: d.ai_score,
          risk_level: d.ai_risk_level,
          next_action: d.ai_next_action,
          predicted_days_to_close: randomInt(7, 35),
        })),
        recommendations: [
          'Schedule demos for the 4 engaged prospects this week — they show high intent signals.',
          'The negotiation stage has 3 deals worth $165K total; send revised proposals within 48 hours.',
          'Re-engage the 5 prospects in the early stage with a personalized case study sequence.',
          'Your win rate is trending up — maintain momentum by focusing on deals in proposal stage.',
        ],
        risk_deals: pipelineDeals.filter(d => d.ai_risk_level === 'high' && d.stage !== 'closed_lost').map(d => d.id),
        top_opportunities: pipelineDeals.filter(d => d.value >= 40000 && d.stage !== 'closed_lost').map(d => d.id).slice(0, 3),
        bottleneck_stage: 'proposal_sent',
        forecast_adjustment: '+12% from last week',
        generated_at: now.toISOString(),
      };
      await kv.set(`pipeline:${userId}:ai_insights`, JSON.stringify(demoPipelineInsights));
      console.log('[DEMO-SEED] ✓ Created demo pipeline AI insights');

    } catch (pipelineError) {
      console.warn(`[DEMO-SEED] Warning: Failed to seed pipeline deals: ${(pipelineError as Error).message}`);
    }

    console.log('[DEMO-SEED] ✓ Demo data seeding completed successfully!');
    console.log('[DEMO-SEED] Final stats:', stats);

    return {
      success: true,
      stats
    };

  } catch (error) {
    console.error('[DEMO-SEED] Error during seeding:', error);
    return {
      success: false,
      stats
    };
  }
}

/**
 * Clear all demo data for a user
 */
export async function clearDemoData(
  supabase: any,
  userId: string
): Promise<{ success: boolean; message: string }> {
  console.log('[DEMO-SEED] Clearing all demo data for user:', userId);

  try {
    // Delete in reverse order of dependencies
    await supabase.from('email_events').delete().eq('emails.leads.user_id', userId); // This might fail due to join syntax, need better approach?
    // Actually, email_events doesn't have user_id, it relies on email -> lead -> user_id
    // But we are deleting emails anyway, so cascade delete should handle it if configured.
    // If not, we should find email IDs first.
    
    // Manual cleanup for email_events if cascade isn't set up
    // 1. Get emails for user
    const { data: userEmails } = await supabase.from('emails').select('id').eq('user_id', userId);
    if (userEmails && userEmails.length > 0) {
        const emailIds = userEmails.map((e: any) => e.id);
        await supabase.from('email_events').delete().in('email_id', emailIds);
    }

    await supabase.from('tracking_events').delete().eq('user_id', userId);
    await supabase.from('payments').delete().eq('user_id', userId);
    await supabase.from('emails').delete().eq('user_id', userId);
    await supabase.from('campaigns').delete().eq('user_id', userId);
    await supabase.from('leads').delete().eq('user_id', userId);
    await supabase.from('knowledge_base').delete().eq('user_id', userId);

    // Clear KV-backed demo data (email signature)
    try {
      await kv.del(`signature:${userId}`);
    } catch (e) {
      console.warn('[DEMO-SEED] Warning: Failed to clear KV signature:', (e as Error).message);
    }

    // Clear KV-backed pipeline data
    try {
      await kv.del(`pipeline:${userId}:deals`);
      await kv.del(`pipeline:${userId}:ai_insights`);
      await kv.del(`pipeline:${userId}:settings`);
      await kv.del(`pipeline:${userId}:trigger_log`);
    } catch (e) {
      console.warn('[DEMO-SEED] Warning: Failed to clear KV pipeline data:', (e as Error).message);
    }

    console.log('[DEMO-SEED] ✓ All demo data cleared');

    return {
      success: true,
      message: 'All demo data cleared successfully'
    };
  } catch (error) {
    console.error('[DEMO-SEED] Error clearing data:', error);
    return {
      success: false,
      message: `Failed to clear data: ${(error as Error).message}`
    };
  }
}

/**
 * Simulate live traffic for the demo account
 * Creates "current" visits in the KV store to populate the RealTimeMap
 */
export async function simulateLiveTraffic(
  supabase: any,
  userId: string,
  count: number = 5
) {
  console.log('[DEMO-TRAFFIC] Simulating live traffic for:', userId, 'count:', count);
  
  try {
    // 1. Get some leads to act as visitors
    const { data: leads } = await supabase
      .from('leads')
      .select('id, email, business_name, city, state, brand')
      .eq('user_id', userId)
      .limit(50);
      
    if (!leads || leads.length === 0) {
      return { success: false, message: 'No leads found. Please seed demo data first.' };
    }

    const createdVisits = [];
    
    for (let i = 0; i < count; i++) {
      const lead = randomItem(leads);
      const location = DEMO_CITIES.find(c => c.city === lead.city) || randomItem(DEMO_CITIES);
      
      // Fuzz location slightly so they don't stack perfectly
      const lat = location.lat + (Math.random() - 0.5) * 0.1;
      const lng = location.lng + (Math.random() - 0.5) * 0.1;
      
      const visitData = {
        id: crypto.randomUUID(),
        user_id: userId,
        lead_id: lead.id,
        brand: lead.brand || 'Contndr Demo',
        url: `https://${(lead.brand || 'contndr').toLowerCase().replace(/\s+/g, '')}.com/demo`,
        title: 'Demo Landing Page',
        timestamp: new Date().toISOString(),
        user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        city: location.city,
        country: 'United States',
        region: location.state,
        latitude: lat,
        longitude: lng,
        kv_key: ''
      };
      
      const now = Date.now();
      // Add small random delay to timestamp so they don't all look identical down to the ms
      const visitTs = now - randomInt(0, 60000); // within last minute
      const atomicKey = `recent_visit_v2:${userId}:${visitTs}:${visitData.id}`;
      visitData.kv_key = atomicKey;
      // Update timestamp to match the key
      visitData.timestamp = new Date(visitTs).toISOString();
      
      await kv.set(atomicKey, visitData);
      
      // Update User Live Status
      await kv.set(`live_user:${lead.id}`, {
          ...visitData,
          user_id: userId
      });
      
      // Update analytics
      const today = new Date().toISOString().split('T')[0];
      const analyticsKey = `analytics:daily:${userId}:${today}`;
      const dailyStats = (await kv.get(analyticsKey)) || { date: today, total: 0, brands: {} };
      dailyStats.total = (dailyStats.total || 0) + 1;
      
      const brandKey = (visitData.brand || 'unknown').toLowerCase();
      dailyStats.brands = dailyStats.brands || {};
      dailyStats.brands[brandKey] = (dailyStats.brands[brandKey] || 0) + 1;
      
      await kv.set(analyticsKey, dailyStats);
      
      createdVisits.push(visitData);
    }
    
    console.log(`[DEMO-TRAFFIC] ✓ Generated ${createdVisits.length} live visits`);
    return { success: true, visits: createdVisits };
    
  } catch (error) {
    console.error('[DEMO-TRAFFIC] Error:', error);
    return { success: false, message: (error as Error).message };
  }
}