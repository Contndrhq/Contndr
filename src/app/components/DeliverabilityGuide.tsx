import { AlertCircle, CheckCircle2, ExternalLink, Shield, Mail, TrendingUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function DeliverabilityGuide() {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserEmail(session.user.email || null);
      }
    };
    loadUser();
  }, []);

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="mb-1 text-[var(--foreground)]">Email Deliverability</h1>
        <p className="text-[var(--foreground-muted)] text-[14px]">
          Improve your email inbox placement and avoid spam filters
        </p>
      </div>

      {/* Current Status */}
      <div className="p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-[#1ED4A7]/10 rounded-lg flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-[#1ED4A7]" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold mb-1 text-gray-900 dark:text-white">
              Domains Verified ✓
            </h3>
            <p className="text-gray-600 dark:text-gray-400 text-[13px]">
              {userEmail === 'or@roadr.com' 
                ? 'Both roadr.com and sourcr.net are now verified in Resend. DNS propagation is in progress.' 
                : 'Your sending domain is verified. DNS propagation is in progress.'}
            </p>
          </div>
        </div>
      </div>

      {/* DNS Propagation Notice */}
      {userEmail === 'or@roadr.com' && (
      <div className="p-5 bg-zinc-800/50 border border-zinc-700 rounded-xl">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-[15px] font-semibold mb-1 text-zinc-300">
              sourcr.net Domain: Just Verified (1 hour ago)
            </h3>
            <p className="text-zinc-400 text-[13px] mb-3">
              Your sourcr.net domain was just verified, so emails may still land in spam for 24-48 hours while DNS records fully propagate across the internet.
            </p>
            <div className="space-y-2 text-[13px] text-zinc-400">
              <p><strong>What's happening:</strong></p>
              <ul className="ml-4 space-y-1 list-disc">
                <li>DNS records take 24-48 hours to propagate globally</li>
                <li>Some email providers may still see the old (unverified) DNS</li>
                <li>Deliverability will improve gradually as propagation completes</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* What We've Already Done */}
      <div className="p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <h3 className="text-[15px] font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-[#1ED4A7]" />
          What We've Implemented
        </h3>
        <div className="space-y-3">
          {[
            'Proper HTML email structure with responsive design',
            'Unsubscribe footer in all emails (required for CAN-SPAM compliance)',
            'List-Unsubscribe headers for easy opt-out',
            'Reply-To headers for better engagement',
            'Plain text + HTML versions of all emails',
            'Improved AI prompts to avoid spam trigger words',
            'X-Entity-Ref-ID headers for tracking',
            'Precedence: bulk headers for proper email classification',
            'Campaign tags for better tracking in Resend',
          ].map((item, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#1ED4A7] mt-0.5 flex-shrink-0" />
              <p className="text-[13px] text-gray-700 dark:text-gray-300">{item}</p>
            </div>
          ))}
        </div>
      </div>

      {/* What to Do Now */}
      <div className="p-5 bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-xl">
        <h3 className="text-[15px] font-semibold mb-3 text-gray-900 dark:text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#1ED4A7]" />
          What to Do Right Now (While DNS Propagates)
        </h3>
        <div className="space-y-3 text-[13px] text-gray-700 dark:text-gray-300">
          <div className="flex items-start gap-2">
            <span className="text-[#1ED4A7] font-bold mt-0.5">1.</span>
            <div>
              <strong>Start Small:</strong> Send 5-10 test emails from {userEmail === 'or@roadr.com' ? 'hello@sourcr.net' : 'your verified domain'} to yourself and colleagues at different email providers (Gmail, Outlook, Yahoo)
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#1ED4A7] font-bold mt-0.5">2.</span>
            <div>
              <strong>Check Spam Scores:</strong> Send a test email to <a href="https://www.mail-tester.com/" target="_blank" rel="noopener noreferrer" className="text-[#1ED4A7] hover:underline">mail-tester.com</a> to see your current score
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#1ED4A7] font-bold mt-0.5">3.</span>
            <div>
              <strong>Verify DNS Propagation:</strong> Check <a href="https://dnschecker.org/" target="_blank" rel="noopener noreferrer" className="text-[#1ED4A7] hover:underline">dnschecker.org</a> to see if your DNS records have propagated globally
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#1ED4A7] font-bold mt-0.5">4.</span>
            <div>
              <strong>Warm Up Slowly:</strong> Don't send bulk emails yet. Gradually increase volume over the next 2-3 weeks
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#1ED4A7] font-bold mt-0.5">5.</span>
            <div>
              <strong>Ask Recipients to Whitelist:</strong> Have initial recipients add hello@sourcr.net to their contacts/safe senders to build reputation faster
            </div>
          </div>
        </div>
      </div>

      {/* Action Items */}
      <div className="space-y-4">
        <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">
          Action Items (Your Responsibility)
        </h3>

        {/* 1. DNS Authentication */}
        <div className="p-5 bg-white dark:bg-gray-900 border-2 border-zinc-300 dark:border-zinc-700 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            </div>
            <div className="flex-1">
              <h4 className="text-[14px] font-semibold mb-1 text-gray-900 dark:text-white">
                1. Set Up Email Authentication (CRITICAL)
              </h4>
              <p className="text-gray-600 dark:text-gray-400 text-[13px] mb-3">
                Without these DNS records, your emails WILL go to spam. Set up for BOTH domains:
              </p>
            </div>
          </div>

          <div className="ml-11 space-y-4">
            <div className="p-3 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-300 dark:border-zinc-700 rounded-lg">
              <p className="text-[13px] font-semibold mb-2 text-zinc-700 dark:text-zinc-300">
                {userEmail === 'or@roadr.com' ? '📌 Set up for BOTH domains: roadr.com AND sourcr.net' : '📌 Set up for your custom domain'}
              </p>
            </div>

            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <p className="text-[13px] font-medium mb-2 text-gray-900 dark:text-white">SPF Record</p>
              <p className="text-[12px] text-gray-600 dark:text-gray-400 mb-2">
                {userEmail === 'or@roadr.com' ? 'Add this TXT record to both roadr.com and sourcr.net DNS:' : 'Add this TXT record to your domain DNS:'}
              </p>
              <code className="block p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 font-mono break-all">
                v=spf1 include:_spf.resend.com ~all
              </code>
            </div>

            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <p className="text-[13px] font-medium mb-2 text-gray-900 dark:text-white">DKIM Record</p>
              <p className="text-[12px] text-gray-600 dark:text-gray-400 mb-2">
                Get your DKIM keys from Resend dashboard for both domains and add to DNS
              </p>
              <a
                href="https://resend.com/domains"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-[#1ED4A7] hover:underline"
              >
                Open Resend Dashboard <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <p className="text-[13px] font-medium mb-2 text-gray-900 dark:text-white">DMARC Record</p>
              <p className="text-[12px] text-gray-600 dark:text-gray-400 mb-2">
                {userEmail === 'or@roadr.com' ? 'Add this TXT record to both roadr.com and sourcr.net DNS:' : 'Add this TXT record to your domain DNS:'}
              </p>
              <code className="block p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 font-mono break-all">
                v=DMARC1; p=none; rua=mailto:dmarc@[yourdomain]
              </code>
            </div>

            <div className="p-3 bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg">
              <p className="text-[12px] text-zinc-700 dark:text-zinc-300">
                {userEmail === 'or@roadr.com' 
                  ? <strong>Step-by-step: Go to Resend → Add roadr.com → Get DNS records → Add to DNS → Verify. Then repeat for sourcr.net.</strong>
                  : <strong>Step-by-step: Go to Resend → Add your domain → Get DNS records → Add to DNS → Verify.</strong>}
              </p>
            </div>
          </div>
        </div>

        {/* 2. Domain Warming */}
        <div className="p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 bg-[#1ED4A7]/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-[#1ED4A7]" />
            </div>
            <div className="flex-1">
              <h4 className="text-[14px] font-semibold mb-1 text-gray-900 dark:text-white">
                2. Warm Up Your Sending Domain
              </h4>
              <p className="text-gray-600 dark:text-gray-400 text-[13px] mb-3">
                New sending addresses need to build reputation gradually:
              </p>
            </div>
          </div>

          <div className="ml-11 space-y-2">
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 bg-[#1ED4A7]/10 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-semibold text-[#1ED4A7]">1</span>
              </div>
              <p className="text-[13px] text-gray-700 dark:text-gray-300">
                <strong>Week 1:</strong> Send 10-20 emails per day to engaged recipients
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 bg-[#1ED4A7]/10 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-semibold text-[#1ED4A7]">2</span>
              </div>
              <p className="text-[13px] text-gray-700 dark:text-gray-300">
                <strong>Week 2:</strong> Increase to 50 emails per day
              </p>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 bg-[#1ED4A7]/10 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-semibold text-[#1ED4A7]">3</span>
              </div>
              <p className="text-[13px] text-gray-700 dark:text-gray-300">
                <strong>Week 3+:</strong> Gradually increase to your target volume
              </p>
            </div>
          </div>
        </div>

        {/* 3. Verify Domain */}
        <div className="p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
              <Mail className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            </div>
            <div className="flex-1">
              <h4 className="text-[14px] font-semibold mb-1 text-gray-900 dark:text-white">
                {userEmail === 'or@roadr.com' ? '3. Verify Both Domains in Resend' : '3. Verify Domain in Resend'}
              </h4>
              <p className="text-gray-600 dark:text-gray-400 text-[13px] mb-3">
                {userEmail === 'or@roadr.com' 
                  ? 'Make sure both roadr.com AND sourcr.net are verified in your Resend account:'
                  : 'Make sure your domain is verified in your Resend account:'}
              </p>
            </div>
          </div>

          <div className="ml-11">
            <a
              href="https://resend.com/domains"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black text-[13px] font-medium rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
            >
              Verify Domain in Resend <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Best Practices */}
      <div className="p-5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
        <h3 className="text-[14px] font-semibold mb-3 text-gray-900 dark:text-white">
          Additional Best Practices
        </h3>
        <ul className="space-y-2 text-[13px] text-gray-700 dark:text-gray-300">
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-0.5">•</span>
            <span>Monitor your Resend dashboard for bounce rates and spam complaints</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-0.5">•</span>
            <span>Keep bounce rate below 5% and spam complaints below 0.1%</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-0.5">•</span>
            <span>Send test emails to multiple providers (Gmail, Outlook, Yahoo) before campaigns</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-0.5">•</span>
            <span>Ask engaged recipients to add you to their contacts or safe senders list</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-0.5">•</span>
            <span>Remove bounced emails and unsubscribers immediately</span>
          </li>
        </ul>
      </div>

      {/* Resources */}
      <div className="p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
        <h3 className="text-[14px] font-semibold mb-3 text-gray-900 dark:text-white">
          Helpful Resources
        </h3>
        <div className="space-y-2">
          <a
            href="https://resend.com/docs/dashboard/domains/introduction"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[13px] text-[#1ED4A7] hover:underline"
          >
            <ExternalLink className="w-4 h-4" />
            Resend Domain Setup Guide
          </a>
          <a
            href="https://www.mail-tester.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[13px] text-[#1ED4A7] hover:underline"
          >
            <ExternalLink className="w-4 h-4" />
            Test Your Email Score (mail-tester.com)
          </a>
          <a
            href="https://mxtoolbox.com/SuperTool.aspx"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[13px] text-[#1ED4A7] hover:underline"
          >
            <ExternalLink className="w-4 h-4" />
            Check DNS Records (MXToolbox)
          </a>
        </div>
      </div>
    </div>
  );
}