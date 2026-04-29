import * as kv from "./kv-retry.tsx";

export interface KnowledgeBaseEntry {
  id?: string;
  user_id: string; // Added user_id for isolation
  brand: 'roadr' | 'sourcr' | 'covera' | 'contndr' | 'global';
  category: string;
  title: string;
  content: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  // Per-entry writing config (overrides campaign-level settings when set)
  tone?: string;
  custom_instructions?: string;
  example_email?: string;
  max_words?: number;
}

// Aggregated writing overrides extracted from KB entries
export interface KBWritingOverrides {
  tone?: string;
  custom_instructions?: string;
  example_email?: string;
  max_words?: number;
}

// Generate a unique ID
function generateId(): string {
  return `kb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Create knowledge base entry
export async function createKnowledgeBaseEntry(entry: Omit<KnowledgeBaseEntry, 'id' | 'created_at' | 'updated_at'>): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const id = generateId();
    const newEntry: KnowledgeBaseEntry = {
      id,
      user_id: entry.user_id,
      brand: entry.brand,
      category: entry.category,
      title: entry.title,
      content: entry.content,
      is_active: entry.is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Optional writing config
      tone: entry.tone,
      custom_instructions: entry.custom_instructions,
      example_email: entry.example_email,
      max_words: entry.max_words,
    };

    await kv.set(`knowledge_base:${id}`, newEntry);
    return { success: true, data: newEntry };
  } catch (error) {
    console.error('Error creating knowledge base entry:', error);
    return { success: false, error: error.message };
  }
}

// Update knowledge base entry
export async function updateKnowledgeBaseEntry(id: string, user_id: string, updates: Partial<KnowledgeBaseEntry>): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const existing = await kv.get(`knowledge_base:${id}`);
    
    if (!existing) {
      return { success: false, error: 'Knowledge base entry not found' };
    }

    // Security check: Ensure user owns this entry
    if (existing.user_id !== user_id) {
        return { success: false, error: 'Unauthorized' };
    }

    const updated: KnowledgeBaseEntry = {
      ...existing,
      ...updates,
      id, // Ensure ID doesn't change
      user_id, // Ensure owner doesn't change
      updated_at: new Date().toISOString(),
    };

    await kv.set(`knowledge_base:${id}`, updated);
    return { success: true, data: updated };
  } catch (error) {
    console.error('Error updating knowledge base entry:', error);
    return { success: false, error: error.message };
  }
}

// Delete knowledge base entry
export async function deleteKnowledgeBaseEntry(id: string, user_id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await kv.get(`knowledge_base:${id}`);
    if (existing && existing.user_id !== user_id) {
        return { success: false, error: 'Unauthorized' };
    }

    await kv.del(`knowledge_base:${id}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting knowledge base entry:', error);
    return { success: false, error: error.message };
  }
}

// Get all knowledge base entries for a brand (Filtered by User)
export async function getKnowledgeBaseByBrand(user_id: string, brand: 'roadr' | 'sourcr' | 'covera' | 'contndr' | 'global' | 'all'): Promise<KnowledgeBaseEntry[]> {
  try {
    const allEntries = await kv.getByPrefix<KnowledgeBaseEntry>('knowledge_base:');
    
    // Filter by user_id FIRST, then brand and active status
    let filtered = allEntries.filter(entry => 
        entry.user_id === user_id && // Strict user isolation
        entry.is_active
    );
    
    if (brand !== 'all') {
      filtered = filtered.filter(entry => 
        entry.brand === brand || entry.brand === 'global'
      );
    }

    // Sort by category, then by created_at (newest first)
    filtered.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    return filtered;
  } catch (error) {
    console.error('Error fetching knowledge base entries:', error);
    return [];
  }
}

// Get knowledge base entries by category (Filtered by User)
export async function getKnowledgeBaseByCategory(user_id: string, brand: 'roadr' | 'sourcr' | 'global', category: string): Promise<KnowledgeBaseEntry[]> {
  try {
    const allEntries = await kv.getByPrefix<KnowledgeBaseEntry>('knowledge_base:');
    
    // Filter by user_id, brand, category, and active status
    const filtered = allEntries.filter(entry => 
      entry.user_id === user_id && // Strict user isolation
      entry.is_active &&
      (entry.brand === brand || entry.brand === 'global') &&
      entry.category === category
    );

    // Sort by created_at (newest first)
    filtered.sort((a, b) => 
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    return filtered;
  } catch (error) {
    console.error('Error fetching knowledge base entries by category:', error);
    return [];
  }
}

// Get knowledge base context for email generation (Filtered by User)
export async function getKnowledgeBaseContext(user_id: string, brand: string, campaignKnowledge?: string): Promise<string> {
  try {
    // Get brand-specific and global knowledge base entries for this user
    // For 'custom' or unknown brands, load 'all' entries so the user's full KB is included
    const effectiveBrand = ['roadr', 'sourcr', 'covera', 'contndr', 'global'].includes(brand) ? brand : 'all';
    const entries = await getKnowledgeBaseByBrand(user_id, effectiveBrand as any);
    
    let context = '';
    
    // Group by category
    const categorized: Record<string, KnowledgeBaseEntry[]> = {};
    entries.forEach(entry => {
      if (!categorized[entry.category]) {
        categorized[entry.category] = [];
      }
      categorized[entry.category].push(entry);
    });

    // Build context string
    Object.keys(categorized).forEach(category => {
      context += `\n## ${category}\n`;
      categorized[category].forEach(entry => {
        context += `\n### ${entry.title}\n${entry.content}\n`;
      });
    });

    // Add campaign-specific knowledge if provided
    if (campaignKnowledge && campaignKnowledge.trim()) {
      context += `\n## Campaign-Specific Information\n${campaignKnowledge}\n`;
    }

    return context;
  } catch (error) {
    console.error('Error building knowledge base context:', error);
    return campaignKnowledge || '';
  }
}

/**
 * Extract writing overrides from KB entries.
 * Returns the MOST SPECIFIC overrides found (brand-specific > global).
 * Falls back to undefined for any field not set in KB entries.
 */
export async function getKBWritingOverrides(user_id: string, brand: string): Promise<KBWritingOverrides> {
  try {
    const effectiveBrand = ['roadr', 'sourcr', 'covera', 'contndr', 'global'].includes(brand) ? brand : 'all';
    const entries = await getKnowledgeBaseByBrand(user_id, effectiveBrand as any);
    
    // Collect overrides — brand-specific entries take priority over global
    const overrides: KBWritingOverrides = {};
    
    // Process global entries first, then brand-specific (so brand wins)
    const globalEntries = entries.filter(e => e.brand === 'global');
    const brandEntries = entries.filter(e => e.brand !== 'global');
    
    for (const entry of [...globalEntries, ...brandEntries]) {
      if (entry.tone) overrides.tone = entry.tone;
      if (entry.custom_instructions) overrides.custom_instructions = entry.custom_instructions;
      if (entry.example_email) overrides.example_email = entry.example_email;
      if (entry.max_words) overrides.max_words = entry.max_words;
    }
    
    return overrides;
  } catch (error) {
    console.error('Error getting KB writing overrides:', error);
    return {};
  }
}

// Search knowledge base (Filtered by User)
export async function searchKnowledgeBase(user_id: string, searchTerm: string, brand?: 'roadr' | 'sourcr' | 'covera' | 'global'): Promise<KnowledgeBaseEntry[]> {
  try {
    const allEntries = await kv.getByPrefix<KnowledgeBaseEntry>('knowledge_base:');
    
    const searchLower = searchTerm.toLowerCase();
    
    // Filter by user_id, brand, active status, and search term
    let filtered = allEntries.filter(entry => 
      entry.user_id === user_id && // Strict user isolation
      entry.is_active &&
      (entry.title.toLowerCase().includes(searchLower) || 
       entry.content.toLowerCase().includes(searchLower))
    );

    if (brand) {
      filtered = filtered.filter(entry => 
        entry.brand === brand || entry.brand === 'global'
      );
    }

    return filtered;
  } catch (error) {
    console.error('Error searching knowledge base:', error);
    return [];
  }
}

// Initialize default knowledge base entries (Now takes user_id to seed FOR THAT USER)
export async function initializeKnowledgeBase(user_id: string): Promise<void> {
  try {
    // Check if already initialized FOR THIS USER
    const allEntries = await kv.getByPrefix<KnowledgeBaseEntry>('knowledge_base:');
    const userEntries = allEntries.filter(e => e.user_id === user_id);
    
    if (userEntries.length > 0) {
      console.log('Knowledge base already initialized for user:', user_id);
      return;
    }

    console.log('Initializing default knowledge base entries for user:', user_id);

    // Helper to create entry for specific user
    const createEntry = async (entry: Omit<KnowledgeBaseEntry, 'id' | 'created_at' | 'updated_at' | 'user_id'>) => {
        await createKnowledgeBaseEntry({ ...entry, user_id });
    };

    // ============================================
    // SOURCR INVESTOR CAMPAIGN KNOWLEDGE
    // ============================================
    
    await createEntry({
      brand: 'sourcr',
      category: 'Investor Outreach',
      title: 'Company Overview - Investor Pitch',
      content: `Sourcr is a profitable, bootstrapped digital product studio specializing in high-performance websites, mobile applications, and digital platforms for startups and growing businesses. We handle everything from strategy and design to development and launch, with a strong focus on execution speed, quality, and long-term support.

Key Differentiators:
- Fully bootstrapped with zero debt and no outside investors
- Profitable and cash-flow positive from day one
- Service and subscription-based model creating predictable cash flow
- Strong track record of client retention and repeat engagements`,
      is_active: true,
    });

    await createEntry({
      brand: 'sourcr',
      category: 'Investor Outreach',
      title: 'Current Traction & Financial Performance',
      content: `Financial Performance:
- Monthly Revenue: $30,000 to $35,000 average
- Annual Run Rate: ~$360,000 based on current performance
- 100% organic revenue - zero paid advertising to date
- No debt, no dilution, fully profitable

Revenue Model:
- Clients engage on recurring monthly subscriptions or structured build-out timelines
- Predictable cash flow from subscription-based maintenance plans
- Service offerings: websites, mobile apps, branding, and ongoing maintenance`,
      is_active: true,
    });

    await createEntry({
      brand: 'sourcr',
      category: 'Investor Outreach',
      title: 'Investment Positioning & Partnership Goals',
      content: `Why We're Raising:
Sourcr is NOT seeking capital out of necessity. We are profitable and self-sustaining. The goal is to partner with individuals who bring strategic value in operations, marketing, distribution, or growth to accelerate our next phase.

Current Bottleneck:
- Not demand or delivery quality
- Scale across operations, marketing, and sales systems
- With the right partners, we can accelerate growth without changing our core offering

Ideal Partner Profile:
- Operators with experience scaling service or SaaS businesses
- Marketing leaders with proven acquisition systems
- Advisors or partners with strong distribution or network access
- Individuals aligned with long-term growth and execution

Investment Philosophy:
- Partnerships structured around value creation
- Flexibility between strategic investment, advisory involvement, or growth partnerships
- Focus on alignment, execution, and shared upside (not short-term capital injection)`,
      is_active: true,
    });

    await createEntry({
      brand: 'sourcr',
      category: 'Investor Outreach',
      title: 'Growth Strategy & Use of Capital',
      content: `Growth Focus Areas:
1. Scaling marketing channels (moving beyond 100% organic)
2. Improving outbound and inbound lead systems
3. Expanding operational capacity and delivery team
4. Building repeatable acquisition funnels
5. Strengthening brand presence and investor-grade materials

Positioning Narrative:
- Stable, profitable foundation with significant upside
- Growth acceleration story, not fundraising pressure
- Real numbers, real execution, no inflated projections
- Confident, not promotional tone`,
      is_active: true,
    });

    // ============================================
    // ROADR INVESTOR CAMPAIGN KNOWLEDGE
    // ============================================

    await createEntry({
      brand: 'roadr',
      category: 'Investor Outreach',
      title: 'Company Overview - Investor Pitch',
      content: `Roadr is an all-in-one automotive super app designed to simplify every aspect of vehicle ownership. What started as a roadside assistance concept has evolved into a daily-use platform that connects drivers to services, tools, and reminders they actually need.

Product Evolution:
- Roadr V2 is live across iOS and Android
- Fully rebuilt experience focused on utility, frequency, and long-term engagement
- No longer limited to towing or emergencies
- Positioned as a complete automotive companion

Platform Type:
- Scalable consumer and service-provider marketplace
- Nationwide reach with verified service provider network
- Dual-sided subscription model for sustainable revenue`,
      is_active: true,
    });

    await createEntry({
      brand: 'roadr',
      category: 'Investor Outreach',
      title: 'Product Features & Platform Capabilities',
      content: `Core Features:
- Roadside assistance and vehicle services nationwide
- Service marketplace covering maintenance, repairs, detailing, and more
- Verified service provider network
- OEM and aftermarket parts integration
- Parking spot memory (never forget where you parked)
- Insurance and registration expiration reminders
- Vehicle care reminders and notifications
- In-app tools designed for everyday driver use
- Scalable infrastructure built for national growth

Platform Defensibility:
- Dual-sided marketplace creates network effects
- Daily-use utility features drive engagement
- Verified provider network builds trust and quality`,
      is_active: true,
    });

    await createEntry({
      brand: 'roadr',
      category: 'Investor Outreach',
      title: 'Business Model & Monetization',
      content: `Dual Subscription Model:
1. Service Provider Subscriptions:
   - Providers subscribe to access leads, visibility, and verified status
   - Creates predictable B2B revenue stream
   
2. Consumer Subscriptions:
   - Premium features, peace of mind, and daily vehicle tools
   - Recurring revenue from engaged user base

Revenue Defensibility:
- Two-sided subscription model supports long-term recurring revenue
- Platform defensibility through network effects
- Multiple revenue streams reduce dependency on single source`,
      is_active: true,
    });

    await createEntry({
      brand: 'roadr',
      category: 'Investor Outreach',
      title: 'Market Traction & Brand Strength',
      content: `Brand Ambassadors:
- Secured brand ambassadors from NBA and NFL
- Positions brand alongside nationally recognized athletes
- Strengthens credibility, awareness, and user trust
- Athlete-led content and campaigns actively rolling out

Product Status:
- Roadr V2 is LIVE and functional (not theoretical)
- Built for daily use, not just emergencies
- Active subscriptions on both sides of marketplace
- Expanded beyond roadside assistance into true automotive ecosystem
- Foundation in place to scale user adoption, provider density, and brand reach

Download: roadr.com`,
      is_active: true,
    });

    await createEntry({
      brand: 'roadr',
      category: 'Investor Outreach',
      title: 'Investment Positioning & Growth Strategy',
      content: `Why Roadr Now:
- Product is no longer theoretical - V2 is LIVE
- Subscriptions are active on both sides
- Platform has proven utility beyond just emergencies
- Foundation is built - ready to scale

Growth Focus:
1. Expanding consumer subscriptions
2. Growing verified service provider network
3. Scaling brand awareness through ambassadors and content
4. Increasing daily app usage through utility-driven features
5. Strengthening partnerships across automotive services and parts

Partnership Goal:
- Not positioned as idea-stage company
- Seeking partners who add strategic value in growth, distribution, partnerships, or scale
- Capital is secondary to alignment, execution support, and long-term vision

Ideal Partner Profile:
- Operators with experience scaling marketplaces or consumer apps
- Strategic marketers with national or regional distribution reach
- Advisors with automotive, consumer tech, or platform experience
- Individuals aligned with building a long-term category leader

Positioning:
- Product-first company with momentum
- Conversation about expansion, adoption, and scale
- Focus on what already exists, not promises
- Emphasis on utility, brand strength, and platform leverage`,
      is_active: true,
    });

    // ============================================
    // COVERA BUSINESS CAMPAIGN KNOWLEDGE
    // ============================================

    await createEntry({
      brand: 'covera',
      category: 'Product Overview',
      title: 'What is Covera',
      content: `Covera is a comprehensive vendor management platform that centralizes insurance tracking, contract management, and compliance documentation in one dashboard for property managers, real estate portfolios, and facilities teams.

What We Do:
- Track vendor insurance certificates (COIs) and expiration dates
- Manage vendor contracts and renewal dates
- Centralized dashboard for all vendor compliance documentation
- Receive alerts before insurance and contracts expire
- Eliminate manual tracking across spreadsheets, emails, and file cabinets
- Reduce liability risk from uninsured vendors and missed contract renewals
- Store all vendor agreements and documents in one organized place

The Software:
- Cloud-based SaaS platform accessible from any device
- Automated vendor onboarding and document collection
- Email notifications for expiring certificates and contracts
- Contract lifecycle management and renewal tracking
- Compliance reporting and audit trails
- Vendor portal for easy document uploads
- Everything organized in one dashboard - no more scattered systems`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Problem & Solution',
      title: 'The Problem Covera Solves',
      content: `The Manual Vendor Management Nightmare:
Property managers and real estate teams currently track vendor compliance using:
- Excel spreadsheets that get outdated immediately
- Email folders stuffed with PDF certificates and contracts
- Physical filing cabinets with paper copies
- Mental reminders that inevitably fail
- Scattered systems for insurance vs contracts vs other documents

This creates massive problems:
- Vendors work on properties with expired insurance (huge liability risk)
- Missed contract renewal dates leading to unfavorable auto-renewals
- Staff waste hours chasing vendors for updated certificates and contracts
- Compliance audits become chaotic paper hunts across multiple systems
- Risk of lawsuits if uninsured vendor causes damage or injury
- Contract disputes from lost or disorganized agreements
- No centralized system to see which vendors are compliant
- Important documents scattered across email, drives, and filing cabinets

How Covera Fixes This:
- One centralized dashboard for ALL vendor documents (insurance, contracts, compliance)
- Automatic expiration alerts before insurance lapses AND contract renewals
- Vendors can upload their own updated certificates via portal
- Contract lifecycle management with renewal tracking
- Real-time compliance dashboard shows status at a glance
- Complete audit trail for all vendor documentation
- Eliminates spreadsheets, emails, file cabinets, and manual tracking
- Never miss a renewal or expiration again`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Target Customers',
      title: 'Who Uses Covera',
      content: `Ideal Customers:
- Property management companies (residential, commercial, HOAs)
- Real estate portfolio managers
- Facilities managers
- Corporate real estate teams
- Anyone managing multiple vendors who need insurance verification

Common Use Cases:
- Property managers with 10+ vendors (contractors, cleaners, landscapers, etc.)
- Commercial real estate teams managing vendor compliance across properties
- HOA managers tracking community vendor insurance
- Facilities teams coordinating maintenance contractors
- Anyone tired of spreadsheet chaos and compliance risk`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Platform Features',
      title: 'Key Platform Features',
      content: `Core Features:
- Automated insurance (COI) tracking and expiration monitoring
- Contract lifecycle management and renewal tracking
- Email alerts for expiring certificates AND contracts (30/60/90 day reminders)
- Vendor self-service portal for document uploads
- Centralized compliance dashboard for everything
- Document storage and organization (insurance, contracts, compliance docs)
- Compliance reporting and exports
- Audit trail for all document updates
- Multi-property management support
- Mobile-friendly access
- Everything in one dashboard - no more scattered systems

Benefits:
- Save hours per week on manual tracking
- Reduce liability risk from expired insurance and missed contract renewals
- Eliminate spreadsheet chaos and scattered documents
- Faster vendor onboarding
- Peace of mind with automatic alerts for both insurance and contracts
- Always audit-ready
- Avoid unfavorable auto-renewals by tracking contract dates
- One source of truth for all vendor documentation`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Pricing & Access',
      title: 'Platform Access',
      content: `Platform Access:
- Cloud-based SaaS platform at covera.co
- No software installation required
- Works on desktop, tablet, and mobile
- Secure cloud storage for all documents
- Multiple user access levels (admin, viewer, etc.)

Getting Started:
- Quick platform demo available
- Easy vendor data import
- Intuitive onboarding process
- Support during setup`,
      is_active: true,
    });

    // ============================================
    // COVERA INVESTOR CAMPAIGN KNOWLEDGE
    // ============================================

    await createEntry({
      brand: 'covera',
      category: 'Investor Outreach',
      title: 'Company Overview - Investor Pitch',
      content: `Covera is a comprehensive vendor management platform that centralizes insurance tracking, contract management, and compliance documentation in one dashboard for property managers, real estate teams, and facilities managers.

What We Built:
- Cloud-based SaaS platform that automatically tracks vendor insurance certificates AND contracts
- Eliminates manual spreadsheet tracking and email chasing across multiple systems
- Alerts teams before vendor insurance expires AND contract renewals
- Contract lifecycle management with renewal tracking
- Centralized compliance dashboard with complete audit trail
- Everything in one place - insurance, contracts, compliance docs

Market Opportunity:
Property management is a massive, fragmented industry still relying on spreadsheets and manual processes for critical compliance tasks. Vendor management is:
- Time-consuming (hours per week per property manager)
- High-risk (expired insurance = massive liability exposure, missed contract renewals = unfavorable terms)
- Universally painful (every property manager deals with scattered documents and manual tracking)
- Completely unautomated in most organizations
- Currently requires multiple systems (one for insurance, another for contracts, etc.)

Platform Type:
- B2B SaaS with recurring subscription revenue
- Sticky product (becomes system of record for vendor compliance AND contracts)
- Scalable across property types (residential, commercial, HOA, corporate)
- Network effects as vendors onboard to portal
- Expanding TAM by solving multiple pain points (insurance + contracts) in one platform`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Investor Outreach',
      title: 'Market Problem & Opportunity Size',
      content: `The Pain Point:
Every property manager and facilities team manually tracks vendor compliance using:
- Excel spreadsheets that instantly become outdated
- Email inboxes overflowing with PDF certificates and contracts
- Physical filing cabinets with paper copies
- Calendar reminders they forget to check
- Multiple scattered systems for insurance vs contracts

This Creates:
- Massive liability risk when vendors work with expired insurance
- Missed contract renewal dates leading to unfavorable auto-renewals
- Wasted staff time chasing vendors for updated certificates and contracts
- Compliance audit nightmares across scattered documents
- Potential lawsuits if uninsured vendors cause damage
- Contract disputes from lost or disorganized agreements

Market Size:
- 350,000+ property management companies in the US alone
- Millions of commercial properties requiring vendor compliance
- HOAs, corporate real estate, facilities teams all have same problem
- Underserved SMB market with high willingness to pay for pain relief
- Recurring revenue model with strong retention (becomes system of record)
- Expanding TAM by solving multiple pain points (insurance + contracts) in one platform

Why Now:
- Property management digitizing post-COVID
- Increased liability awareness and insurance requirements
- Remote work requires cloud-based compliance tools
- Rising insurance costs make tracking more critical
- Contract complexity increasing - businesses need centralized management
- Compliance requirements becoming more stringent across industries`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Investor Outreach',
      title: 'Product Status & Differentiation',
      content: `Platform Status:
- Live production SaaS platform at covera.co
- Fully functional vendor compliance automation
- Active paying customers using the platform
- Proven product-market fit with property management segment

Key Differentiators:
- Purpose-built for COI tracking (not generic document management)
- Automated expiration alerts eliminate manual calendar tracking
- Vendor self-service portal reduces admin burden
- Clean, intuitive UX vs legacy enterprise software
- Affordable SaaS pricing vs expensive enterprise compliance suites
- Quick implementation (days not months)

Platform Advantages:
- Becomes system of record for vendor compliance
- High switching costs once data is migrated
- Network effects as vendors join portal
- Expansion revenue from additional properties/users
- Low churn in compliance software category`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Investor Outreach',
      title: 'Business Model & Revenue Strategy',
      content: `Revenue Model:
- B2B SaaS subscription pricing
- Tiered plans based on property count or vendor volume
- Monthly/annual billing options
- High gross margins (typical SaaS economics)

Monetization Strategy:
- Land with single property/portfolio
- Expand to additional properties within organization
- Upsell premium features (advanced reporting, integrations, etc.)
- Low customer acquisition cost via targeted outreach
- Strong retention due to switching costs

Revenue Characteristics:
- Recurring, predictable SaaS revenue
- High gross retention (compliance tools are sticky)
- Expansion revenue from growth customers
- Low incremental cost to serve additional customers
- Scalable infrastructure`,
      is_active: true,
    });

    await createEntry({
      brand: 'covera',
      category: 'Investor Outreach',
      title: 'Investment Positioning & Growth Strategy',
      content: `Why We're Raising:
Covera has proven product-market fit with property management customers. We're seeking strategic partners to accelerate growth across distribution, partnerships, and go-to-market execution.

Current Traction:
- Live SaaS platform with paying customers
- Validated pain point with clear willingness to pay
- Strong customer feedback and retention
- Proven use case across property types

Growth Focus:
1. Scaling outbound sales to property management companies
2. Building partnerships with property management software platforms
3. Expanding into adjacent markets (facilities, corporate real estate)
4. Growing vendor network for platform stickiness
5. Developing integrations with property management systems

Capital Use:
- Sales team expansion
- Marketing and customer acquisition
- Platform integrations and partnerships
- Product development (mobile app, advanced features)
- Customer success infrastructure

Ideal Partner Profile:
- Operators with B2B SaaS scaling experience
- Strategic connections in property management or real estate
- Growth marketers with vertical SaaS expertise
- Advisors with compliance software or proptech background
- Aligned with building category-defining compliance platform

Investment Philosophy:
- Strategic value over pure capital
- Focus on distribution, partnerships, and execution
- Building sustainable, profitable SaaS business
- Long-term category leadership in vendor compliance`,
      is_active: true,
    });

    // ============================================
    // EXISTING SOURCR KNOWLEDGE (Client Campaigns)
    // ============================================

    // Sourcr Payment Knowledge
    await createEntry({
      brand: 'sourcr',
      category: 'Payment & Pricing',
      title: 'Payment Structure',
      content: `Sourcr offers flexible payment options:
- 50% upfront, 50% on delivery
- Monthly payment plans available for qualified clients
- All major credit cards and ACH transfers accepted
- Net-30 terms for established business relationships`,
      is_active: true,
    });

    await createEntry({
      brand: 'sourcr',
      category: 'Payment & Pricing',
      title: 'Pricing Packages',
      content: `Our pricing is transparent and value-based:
- Starter Package: $5,000 - $10,000 (5-page website, mobile-responsive)
- Professional Package: $10,000 - $25,000 (custom design, CMS, SEO)
- Enterprise Package: $25,000+ (full web app, mobile app, ongoing support)
- Mobile Apps: Starting at $15,000
- Ongoing maintenance: $500-$2,000/month`,
      is_active: true,
    });

    await createEntry({
      brand: 'sourcr',
      category: 'Services',
      title: 'Core Services',
      content: `We specialize in:
- Custom website design and development
- Mobile app development (iOS & Android)
- E-commerce solutions (Shopify, WooCommerce, custom)
- Web applications and SaaS platforms
- UI/UX design and branding
- SEO and digital marketing
- Ongoing maintenance and support`,
      is_active: true,
    });

    await createEntry({
      brand: 'sourcr',
      category: 'Process',
      title: 'Development Timeline',
      content: `Typical project timelines:
- Simple website: 2-4 weeks
- Professional website: 4-8 weeks
- E-commerce site: 6-10 weeks
- Custom web app: 8-16 weeks
- Mobile app: 12-20 weeks
- Timelines vary based on complexity and client feedback cycles.`,
      is_active: true,
    });

    console.log('Knowledge base initialized successfully for user', user_id);
  } catch (error) {
    console.error('Error initializing knowledge base:', error);
  }
}