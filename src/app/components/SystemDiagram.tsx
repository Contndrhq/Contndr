import { ArrowRight, Database, Cloud, Mail, Sparkles, Search } from 'lucide-react';

export function SystemDiagram() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
      <h2 className="text-[var(--foreground)] mb-6">System Architecture</h2>
      
      <div className="space-y-8">
        {/* Step 1: Lead Discovery */}
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-semibold">
              1
            </div>
          </div>
          <div className="flex-1 flex items-center gap-4">
            <div className="flex-1 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <Search className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-[var(--foreground)]">Lead Discovery</h3>
              </div>
              <p className="text-[var(--foreground-muted)] text-sm">
                Search businesses via Smart Discovery
              </p>
              <code className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded mt-2 inline-block border border-gray-200 dark:border-gray-700">
                "auto repair shop in Miami"
              </code>
            </div>
            <ArrowRight className="w-6 h-6 text-gray-400 dark:text-gray-500" />
            <div className="flex-1 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <Database className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <h3 className="text-[var(--foreground)]">Supabase</h3>
              </div>
              <p className="text-[var(--foreground-muted)] text-sm">
                Leads stored in database
              </p>
              <div className="text-xs text-[var(--foreground-muted)] mt-2">
                • business_name<br />
                • contact info<br />
                • location
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Campaign Setup */}
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center justify-center font-semibold">
              2
            </div>
          </div>
          <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Cloud className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <h3 className="text-[var(--foreground)]">Campaign Configuration</h3>
            </div>
            <p className="text-[var(--foreground-muted)] text-sm mb-2">
              Choose product, pricing, tone, sender email
            </p>
            <div className="flex gap-2">
              <span className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded border border-gray-200 dark:border-gray-700">Roadr</span>
              <span className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded border border-gray-200 dark:border-gray-700">Sourcr</span>
              <span className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded border border-gray-200 dark:border-gray-700">Custom</span>
            </div>
          </div>
        </div>

        {/* Step 3: Email Generation */}
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center font-semibold">
              3
            </div>
          </div>
          <div className="flex-1 flex items-center gap-4">
            <div className="flex-1 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
                <h3 className="text-[var(--foreground)]">AI Generation</h3>
              </div>
              <p className="text-[var(--foreground-muted)] text-sm">
                Gemini AI creates personalized email
              </p>
              <div className="text-xs text-[var(--foreground-muted)] mt-2">
                • Subject line<br />
                • Preview text<br />
                • Email body
              </div>
            </div>
            <ArrowRight className="w-6 h-6 text-gray-400 dark:text-gray-500" />
            <div className="flex-1 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <Mail className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                <h3 className="text-[var(--foreground)]">Resend</h3>
              </div>
              <p className="text-[var(--foreground-muted)] text-sm">
                Email delivered to lead
              </p>
              <code className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded mt-2 inline-block border border-gray-200 dark:border-gray-700">
                sales@roadr.com
              </code>
            </div>
          </div>
        </div>

        {/* Step 4: Tracking */}
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center font-semibold">
              4
            </div>
          </div>
          <div className="flex-1 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg">
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <h3 className="text-[var(--foreground)]">Real-time Tracking</h3>
            </div>
            <p className="text-[var(--foreground-muted)] text-sm mb-2">
              Resend webhooks update email status
            </p>
            <div className="flex gap-2 flex-wrap">
              <span className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded border border-gray-200 dark:border-gray-700">Sent</span>
              <span className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded border border-gray-200 dark:border-gray-700">Delivered</span>
              <span className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded border border-gray-200 dark:border-gray-700">Opened</span>
              <span className="text-xs bg-white dark:bg-gray-800 text-[var(--foreground)] px-2 py-1 rounded border border-gray-200 dark:border-gray-700">Clicked</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tech Stack */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
        <h3 className="text-[var(--foreground-subtle)] mb-4">Technology Stack</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-[var(--foreground)] mb-1">SerpAPI</p>
            <p className="text-[var(--foreground-muted)] text-xs">Smart Discovery</p>
          </div>
          <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-[var(--foreground)] mb-1">Gemini</p>
            <p className="text-[var(--foreground-muted)] text-xs">Email AI</p>
          </div>
          <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-[var(--foreground)] mb-1">Resend</p>
            <p className="text-[var(--foreground-muted)] text-xs">Email Delivery</p>
          </div>
          <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-[var(--foreground)] mb-1">Supabase</p>
            <p className="text-[var(--foreground-muted)] text-xs">Database</p>
          </div>
        </div>
      </div>
    </div>
  );
}