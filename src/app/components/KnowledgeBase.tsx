import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Save, X, Book, Search, Filter, Zap, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from './LoadingSpinner';
import { WritingPresetSelector } from './WritingPresetSelector';

interface KnowledgeBaseEntry {
  id?: string;
  brand: 'roadr' | 'sourcr' | 'covera' | 'contndr' | 'global';
  category: string;
  title: string;
  content: string;
  is_active: boolean;
  tone?: string;
  custom_instructions?: string;
  example_email?: string;
  max_words?: number;
}

const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual', description: 'Like texting a colleague — highest reply rates' },
  { value: 'professional', label: 'Professional', description: 'Polished but still human' },
  { value: 'direct', label: 'Direct', description: 'Straight to the point, no fluff' },
  { value: 'friendly', label: 'Friendly', description: 'Warm and approachable' },
  { value: 'enthusiastic', label: 'Enthusiastic', description: 'Energetic and exciting' },
  { value: 'formal', label: 'Formal', description: 'Traditional business tone' },
  { value: 'witty', label: 'Witty', description: 'Clever with personality' },
  { value: 'empathetic', label: 'Empathetic', description: 'Understanding of their challenges' },
];

export function KnowledgeBase() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState<'all' | 'roadr' | 'sourcr' | 'covera' | 'contndr' | 'global'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeBaseEntry | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState<KnowledgeBaseEntry>({
    brand: 'global',
    category: 'General',
    title: '',
    content: '',
    is_active: true,
    tone: '',
    custom_instructions: '',
    example_email: '',
    max_words: 75,
  });
  const [showWritingControls, setShowWritingControls] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserEmail(session.user.email || null);
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    loadEntries();
  }, [selectedBrand]);

  async function loadEntries() {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/knowledge-base?brand=${selectedBrand}`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        setEntries(data.data || []);
      }
    } catch (error) {
      console.error('Error loading knowledge base entries:', error);
    } finally {
      setLoading(false);
    }
  }

  async function seedCoveraKnowledgeBase() {
    try {
      setSeeding(true);
      setSeedResult(null);
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/knowledge-base/seed-covera`,
        {
          method: 'POST',
          headers,
        }
      );

      const data = await response.json();
      if (response.ok) {
        setSeedResult(`✅ ${data.message}`);
        loadEntries(); // Reload to show new entries
      } else {
        setSeedResult(`❌ Error: ${data.error}`);
      }
    } catch (error: any) {
      console.error('Error seeding Covera KB:', error);
      setSeedResult(`❌ Error: ${error.message}`);
    } finally {
      setSeeding(false);
    }
  }

  async function seedContndrKnowledgeBase() {
    try {
      setSeeding(true);
      setSeedResult(null);
      const headers = await getAuthHeaders();
      
      const contndrEntries = [
        {
          brand: 'contndr',
          category: 'Overview',
          title: 'What is Contndr',
          content: 'Contndr is an exclusive, all-in-one sales operating system available via priority access only.\\nIt combines CRM, outreach, calling, automation, and analytics into a single workspace.\\nAccess is currently restricted to a waitlist to ensure platform stability and high-quality onboarding.\\nWe release a limited number of spots every 48 hours.\\nContndr is built for teams that want results without enterprise software complexity.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Strategy',
          title: 'Outreach & Call to Action',
          content: 'Do NOT ask prospects to "sign up". General access is closed.\\nInstead, invite them to "apply for access" or "join the priority list".\\nLeverage FOMO (Fear Of Missing Out) by mentioning limited spots are released every 48 hours.\\nFor high-value prospects, offer to "skip the line" by booking a demo directly.\\nThe goal is to make access feel earned and exclusive.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Strategy',
          title: 'Handling Access Questions',
          content: 'If prospects ask about immediate access, explain that we are "soft-gated" to maintain high service levels.\\nMention that approved teams get white-glove onboarding.\\nFrame the waitlist as a quality control measure.\\nEmphasize that the technology (AI voice, enrichment) is in high demand and spots fill quickly.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Features',
          title: 'CRM + Lead Management',
          content: 'Contndr stores and manages all leads in one centralized CRM.\\nEach lead includes enriched data, activity history, and engagement tracking.\\nSales teams can see who opened emails, clicked links, or visited the site.\\nLead scoring helps prioritize high-intent prospects automatically.\\nEverything needed to close lives in one place.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Features',
          title: 'Lead Enrichment',
          content: 'Contndr turns a single email into a complete prospect profile instantly.\\nThe system enriches leads with over 50 data points including company, role, and intent signals.\\nSales teams no longer need separate enrichment tools.\\nBetter data leads to better conversations.\\nThis helps outreach feel personalized and relevant.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Features',
          title: 'AI Composer',
          content: 'The AI Composer generates personalized emails based on real prospect data.\\nMessages are written to sound natural and human.\\nSales teams can adjust tone, offer, and call-to-action quickly.\\nAI removes writer\'s block and speeds up outreach.\\nPersonalization happens at scale without losing quality.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Features',
          title: 'Workflow Automation',
          content: 'Contndr automates follow-ups, calls, and lead routing.\\nLeads can be enrolled into multi-step sequences instantly.\\nTasks and reminders are created automatically for the sales team.\\nWorkflows ensure no opportunity is missed.\\nAutomation keeps the pipeline moving consistently.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Features',
          title: 'AI Dialer + Call Intelligence',
          content: 'AI voice agents can call leads and qualify them automatically.\\nCalls are recorded, transcribed, and analyzed for buying signals.\\nThe system detects keywords like budget, timeline, or interest.\\nInsights update directly inside the CRM.\\nSales teams always know where deals stand.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Features',
          title: 'Analytics + Revenue Tracking',
          content: 'Contndr tracks pipeline value, conversion rates, and revenue.\\nDashboards show what is closing and what needs attention.\\nTeams can forecast accurately based on real activity.\\nPerformance tracking improves decision making.\\nData replaces guesswork.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Workflow',
          title: '1. Lead Capture',
          content: 'Leads enter through forms, imports, API, or email forwarding.\\nContndr enriches each lead instantly with additional data.\\nThe system assigns a lead score based on intent.\\nHigh-quality leads are prioritized automatically.\\nThis ensures teams focus on the right prospects.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Workflow',
          title: '2. Automated Outreach',
          content: 'Leads are enrolled into email or multi-channel sequences.\\nMessages are personalized using AI variables and enrichment data.\\nFollow-ups are scheduled automatically.\\nSales reps can monitor opens and replies in real time.\\nConsistent outreach increases reply rates.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Workflow',
          title: '3. Calls + Engagement',
          content: 'AI dialers or reps call high-intent leads.\\nAll calls are logged and transcribed automatically.\\nKey insights and objections are captured.\\nNext steps are suggested by the system.\\nEvery conversation moves the deal forward.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Workflow',
          title: '4. Deal Tracking + Close',
          content: 'Pipeline dashboards show deal stages and value.\\nRevenue forecasting updates in real time.\\nSales teams know exactly what to prioritize.\\nClosed deals and performance metrics are tracked automatically.\\nContndr keeps closing predictable.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Pricing',
          title: 'Professional Plan',
          content: '$199 per month.\\nIncludes 5,000 tracked leads.\\nUnlimited users and core automation included.\\nBest for small teams starting outbound.\\nSimple and affordable entry.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Pricing',
          title: 'Growth Plan',
          content: '$399 per month.\\nUnlimited leads and unlimited users.\\nAdvanced workflows and AI voice agents included.\\nDesigned for scaling outbound teams.\\nMost popular plan for growth.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Pricing',
          title: 'Enterprise Plan',
          content: 'Custom pricing based on needs.\\nIncludes SSO, security, and dedicated support.\\nCustom integrations available.\\nBuilt for large teams and organizations.\\nTailored for scale and security.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Pricing',
          title: 'Annual Lead Plans',
          content: '5,000 enriched leads per year available at lower cost.\\nUnlimited plan available with no lead caps.\\nNo long-term contracts required.\\nCancel anytime.\\nTeams switching to Contndr save significantly on software and lead costs.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Why Switch',
          title: 'Why Teams Switch to Contndr',
          content: 'Contndr replaces multiple tools with one platform.\\nSetup takes minutes instead of months.\\nCosts are significantly lower than legacy stacks.\\nAI tools are built to actually generate revenue.\\nSales teams gain speed, visibility, and control.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Usage',
          title: 'Logging In',
          content: 'Go to the Contndr login page.\\nEnter your work email and password.\\nAccess your dashboard and leads instantly.\\nIf login issues occur, use password reset or contact support.\\nAccess is granted upon approval of your application.',
          is_active: true
        },
        {
          brand: 'contndr',
          category: 'Usage',
          title: 'Getting Started',
          content: 'Submit your request for access.\\nOnce approved (typically 48h), create your account and connect your email.\\nImport or capture your first leads.\\nActivate enrichment and AI composer.\\nLaunch your first outreach workflow.',
          is_active: true
        }
      ];

      // Sequential creation to avoid overwhelming the server
      let successCount = 0;
      for (const entry of contndrEntries) {
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/knowledge-base`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(entry),
          }
        );
        
        if (response.ok) successCount++;
      }

      setSeedResult(`Created ${successCount} Contndr entries`);
      loadEntries();
    } catch (error: any) {
      console.error('Error seeding Contndr KB:', error);
      setSeedResult(`Error: ${error.message}`);
    } finally {
      setSeeding(false);
    }
  }

  async function saveEntry(entry: KnowledgeBaseEntry) {
    try {
      const headers = await getAuthHeaders();
      
      if (entry.id) {
        // Update existing entry
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/knowledge-base/${entry.id}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify(entry),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to update entry');
        }
      } else {
        // Create new entry
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/knowledge-base`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(entry),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to create entry');
        }
      }

      // Reset form and reload
      setShowAddForm(false);
      setEditingEntry(null);
      setNewEntry({
        brand: 'global',
        category: 'General',
        title: '',
        content: '',
        is_active: true,
        tone: '',
        custom_instructions: '',
        example_email: '',
        max_words: 75,
      });
      loadEntries();
    } catch (error) {
      console.error('Error saving knowledge base entry:', error);
      alert(t('knowledgeBaseView.failedToSave'));
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm(t('knowledgeBaseView.deleteConfirm'))) {
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/knowledge-base/${id}`,
        {
          method: 'DELETE',
          headers,
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete entry');
      }

      loadEntries();
    } catch (error) {
      console.error('Error deleting knowledge base entry:', error);
      alert(t('knowledgeBaseView.failedToDelete'));
    }
  }

  const filteredEntries = entries.filter(entry => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        entry.title.toLowerCase().includes(search) ||
        entry.content.toLowerCase().includes(search) ||
        entry.category.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const groupedEntries = filteredEntries.reduce((acc, entry) => {
    if (!acc[entry.category]) {
      acc[entry.category] = [];
    }
    acc[entry.category].push(entry);
    return acc;
  }, {} as Record<string, KnowledgeBaseEntry[]>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-1">{t('knowledgeBaseView.title')}</h2>
          <p className="text-[14px] text-zinc-600 dark:text-zinc-400">
            {t('knowledgeBaseView.description')}
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>{t('knowledgeBaseView.addEntry')}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        {/* Brand Filter */}
        {userEmail === 'or@roadr.com' && (
          <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-2 min-w-max">
              {(['all', 'global', 'roadr', 'sourcr', 'covera', 'contndr'] as const).map(brand => (
                <button
                  key={brand}
                  onClick={() => setSelectedBrand(brand)}
                  className={`px-3 py-2 text-[13px] font-medium rounded-lg transition-all whitespace-nowrap ${
                    selectedBrand === brand
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10'
                  }`}
                >
                  {brand === 'all' ? t('knowledgeBaseView.allBrands') : brand.charAt(0).toUpperCase() + brand.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={t('knowledgeBaseView.searchEntries')}
            className="w-full pl-9 pr-3 py-2 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-white/5 text-zinc-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
          />
        </div>
      </div>

      {/* Add/Edit Form */}
      {(showAddForm || editingEntry) && (() => {
        const entry = editingEntry || newEntry;
        const setEntry = (updates: Partial<KnowledgeBaseEntry>) => {
          if (editingEntry) {
            setEditingEntry({ ...editingEntry, ...updates });
          } else {
            setNewEntry({ ...newEntry, ...updates });
          }
        };
        const hasWritingConfig = !!(entry.tone || entry.custom_instructions || entry.example_email || (entry.max_words && entry.max_words !== 75));
        const writingOpen = showWritingControls || hasWritingConfig;

        return (
        <div className="bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-medium text-zinc-900 dark:text-white">
              {editingEntry ? t('knowledgeBaseView.editEntry') : t('knowledgeBaseView.newEntry')}
            </h3>
            <button
              onClick={() => {
                setShowAddForm(false);
                setEditingEntry(null);
                setShowWritingControls(false);
              }}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className={`grid ${userEmail === 'or@roadr.com' ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            {userEmail === 'or@roadr.com' && (
              <div>
                <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                  Brand
                </label>
                <select
                  value={entry.brand}
                  onChange={e => setEntry({ brand: e.target.value as any })}
                  className="w-full px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-600 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                >
                  <option value="global">Global (All Brands)</option>
                  <option value="roadr">Roadr</option>
                  <option value="sourcr">Sourcr</option>
                  <option value="covera">Covera</option>
                  <option value="contndr">Contndr</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                Category
              </label>
              <input
                type="text"
                value={entry.category}
                onChange={e => setEntry({ category: e.target.value })}
                placeholder="e.g., Payment Options, Services, Pricing"
                className="w-full px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-600 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
              Title
            </label>
            <input
              type="text"
              value={entry.title}
              onChange={e => setEntry({ title: e.target.value })}
              placeholder="e.g., Flexible Payment Plans"
              className="w-full px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-600 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
            />
          </div>

          <div>
            <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
              Content
            </label>
            <textarea
              value={entry.content}
              onChange={e => setEntry({ content: e.target.value })}
              placeholder="Enter the detailed information that AI should use when generating emails..."
              rows={5}
              className="w-full px-4 py-3 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-600 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all resize-none"
            />
          </div>

          {/* ═══ WRITING CONTROL CENTER — synced with CampaignBuilder ═══ */}
          <div className="space-y-4 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-zinc-50 dark:bg-white/[0.01]">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowWritingControls(!writingOpen)}
                className="flex items-center gap-2 min-w-0"
              >
                <Zap className="w-3.5 h-3.5 text-zinc-900 dark:text-white shrink-0" />
                <span className="text-[11px] font-semibold text-zinc-900 dark:text-white uppercase tracking-wider shrink-0">Writing Control</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-600 normal-case tracking-normal hidden sm:inline">— Tell the AI exactly how to write emails for this entry</span>
                <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform shrink-0 ${writingOpen ? 'rotate-180' : ''}`} />
              </button>
              {writingOpen && (
                <WritingPresetSelector
                  currentValues={{
                    tone: entry.tone || '',
                    maxWords: entry.max_words || 75,
                    customInstructions: entry.custom_instructions || '',
                    exampleEmail: entry.example_email || '',
                  }}
                  onApply={(values) => setEntry({
                    tone: values.tone,
                    max_words: values.maxWords,
                    custom_instructions: values.customInstructions,
                    example_email: values.exampleEmail,
                  })}
                />
              )}
            </div>

            {writingOpen && (
              <div className="space-y-4 pt-1">
                {/* Writing Instructions */}
                <div>
                  <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                    Writing Instructions
                  </label>
                  <textarea
                    value={entry.custom_instructions || ''}
                    onChange={e => setEntry({ custom_instructions: e.target.value })}
                    placeholder={"Tell the AI exactly how you want your emails written. Be specific.\n\nExamples:\n\u2022 \"Write like a normal person. No fancy words. Keep sentences short. Don't sound like a salesperson.\"\n\u2022 \"Be blunt and direct. One question, one value prop, one CTA. That's it.\"\n\u2022 \"Match my voice \u2014 I'm a founder, not a marketing team. Write like I'd actually talk.\""}
                    rows={4}
                    className="w-full px-4 py-3 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-600 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all resize-none"
                  />
                  <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                    These instructions override all defaults. The AI will follow them word for word.
                  </p>
                </div>

                {/* Example Email */}
                <div>
                  <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                    Example Email <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-600">(paste an email you like for the AI to mimic)</span>
                  </label>
                  <textarea
                    value={entry.example_email || ''}
                    onChange={e => setEntry({ example_email: e.target.value })}
                    placeholder={"Paste an email that sounds like YOU. The AI will match this style, tone, and vocabulary.\n\nExample:\n\"Hey [name], quick question \u2014 are you guys still doing [X] manually?\n\nWe built something that handles it automatically. A few companies in [industry] are testing it.\n\nWorth a look? [link]\""}
                    rows={3}
                    className="w-full px-4 py-3 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-600 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all resize-none"
                  />
                </div>

                {/* Max Words + Tone — side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                      Max Words
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={30}
                        max={200}
                        step={5}
                        value={entry.max_words || 75}
                        onChange={e => setEntry({ max_words: Number(e.target.value) })}
                        className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full appearance-none cursor-pointer accent-zinc-900 dark:accent-white"
                      />
                      <span className="text-[13px] font-mono text-zinc-900 dark:text-white w-8 text-right tabular-nums">{entry.max_words || 75}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-600">
                      {(entry.max_words || 75) <= 50 ? 'Ultra-short \u2014 punchy and direct' : (entry.max_words || 75) <= 80 ? 'Short \u2014 ideal for cold outreach' : (entry.max_words || 75) <= 120 ? 'Medium \u2014 room for context' : 'Long \u2014 detailed outreach'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-zinc-600 dark:text-zinc-400 mb-1.5 font-medium tracking-wide uppercase text-[11px]">
                      Tone
                    </label>
                    <select
                      value={entry.tone || ''}
                      onChange={e => setEntry({ tone: e.target.value })}
                      className="w-full px-3 py-2.5 text-[13px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white rounded-xl focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-600 focus:ring-1 focus:ring-zinc-900/10 dark:focus:ring-white/10 transition-all"
                    >
                      <option value="">Use campaign default</option>
                      {TONE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label} \u2014 {opt.description}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => { saveEntry(entry); setShowWritingControls(false); }}
              disabled={!entry.title || !entry.content}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Save className="w-4 h-4" />
              <span>Save Entry</span>
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setEditingEntry(null);
                setShowWritingControls(false);
              }}
              className="px-4 py-2 text-[13px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
        );
      })()}

      {/* Entries List */}
      {loading ? (
        <LoadingSpinner size="lg" text="Loading knowledge base..." center />
      ) : Object.keys(groupedEntries).length === 0 ? (
        <div className="text-center py-12 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <Book className="w-12 h-12 text-zinc-400 dark:text-zinc-500 mx-auto mb-3" />
          <p className="text-[14px] text-zinc-600 dark:text-zinc-400">No knowledge base entries found</p>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-500 mt-1">
            {searchTerm ? 'Try a different search term' : 'Click "Add Entry" to create your first entry'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedEntries).map(([category, categoryEntries]) => (
            <div key={category}>
              <h3 className="text-[14px] font-medium text-zinc-900 dark:text-white mb-3">
                {category}
              </h3>
              <div className="space-y-3">
                {categoryEntries.map(entry => {
                  const hasWriting = !!(entry.tone || entry.custom_instructions || entry.example_email || (entry.max_words && entry.max_words !== 75));
                  return (
                  <div
                    key={entry.id}
                    className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <h4 className="text-[14px] font-medium text-zinc-900 dark:text-white">
                            {entry.title}
                          </h4>
                          {userEmail === 'or@roadr.com' && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
                              {entry.brand}
                            </span>
                          )}
                          {hasWriting && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
                              <Zap className="w-2.5 h-2.5" />
                              {[
                                entry.tone && TONE_OPTIONS.find(t => t.value === entry.tone)?.label,
                                entry.max_words && entry.max_words !== 75 && `${entry.max_words}w`,
                                entry.custom_instructions && 'Custom',
                                entry.example_email && 'Example',
                              ].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap line-clamp-3">
                          {entry.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="p-2 text-zinc-400 hover:text-zinc-300 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteEntry(entry.id!)}
                          className="p-2 text-zinc-400 hover:text-zinc-300 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
