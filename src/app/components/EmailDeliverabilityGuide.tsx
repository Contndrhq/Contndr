import React from 'react';
import { AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';

export function EmailDeliverabilityGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1 text-[var(--foreground)]">Email Deliverability Setup</h1>
        <p className="text-[var(--foreground-muted)] text-[14px]">
          Configure your domain to avoid spam folders and improve email delivery
        </p>
      </div>

      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-zinc-300 mb-1">
              Emails Going to Spam?
            </h3>
            <p className="text-sm text-zinc-400">
              This happens when your sending domain (sourcr.net or roadr.com) hasn't been properly authenticated with Resend.
              Follow the steps below to fix this issue.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Setup Instructions
        </h2>

        <div className="space-y-3">
          {/* Step 1 */}
          <div className="border dark:border-gray-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-zinc-300">1</span>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-[var(--foreground)] mb-2">
                  Add Your Domain in Resend
                </h3>
                <ol className="text-sm text-[var(--foreground-muted)] space-y-2 list-decimal list-inside">
                  <li>Go to <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-[#1ED4A7] hover:underline inline-flex items-center gap-1">Resend Domains <ExternalLink className="w-3 h-3" /></a></li>
                  <li>Click "Add Domain"</li>
                  <li>Enter <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs">sourcr.net</code></li>
                  <li>Click "Add"</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="border dark:border-gray-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-zinc-300">2</span>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-[var(--foreground)] mb-2">
                  Get DNS Records from Resend
                </h3>
                <p className="text-sm text-[var(--foreground-muted)] mb-2">
                  After adding your domain, Resend will provide DNS records that look like this:
                </p>
                <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 space-y-2 text-xs font-mono">
                  <div>
                    <div className="text-gray-500">SPF Record (TXT)</div>
                    <div className="text-[var(--foreground-muted)]">v=spf1 include:amazonses.com ~all</div>
                  </div>
                  <div>
                    <div className="text-gray-500">DKIM Record (TXT)</div>
                    <div className="text-[var(--foreground-muted)]">resend._domainkey → [long value]</div>
                  </div>
                  <div>
                    <div className="text-gray-500">DMARC Record (TXT)</div>
                    <div className="text-[var(--foreground-muted)]">_dmarc → v=DMARC1; p=none;</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="border dark:border-gray-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-zinc-300">3</span>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-[var(--foreground)] mb-2">
                  Add DNS Records to Your Domain Provider
                </h3>
                <p className="text-sm text-[var(--foreground-muted)] mb-2">
                  Go to your DNS provider (GoDaddy, Cloudflare, Namecheap, etc.) and add the DNS records provided by Resend:
                </p>
                <ul className="text-sm text-[var(--foreground-muted)] space-y-1 list-disc list-inside">
                  <li>Copy each DNS record from Resend</li>
                  <li>Add them to your DNS settings</li>
                  <li>Wait 24-48 hours for DNS propagation</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="border dark:border-gray-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-zinc-300">4</span>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-[var(--foreground)] mb-2">
                  Verify Your Domain
                </h3>
                <p className="text-sm text-[var(--foreground-muted)] mb-2">
                  Once DNS records are added:
                </p>
                <ol className="text-sm text-[var(--foreground-muted)] space-y-1 list-decimal list-inside">
                  <li>Return to Resend Domains page</li>
                  <li>Click "Verify" next to your domain</li>
                  <li>Wait for all checks to pass (SPF, DKIM, DMARC)</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Step 5 */}
          <div className="border dark:border-gray-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-700/50 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-zinc-300">5</span>
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-[var(--foreground)] mb-2">
                  Repeat for Roadr Domain (roadr.com)
                </h3>
                <p className="text-sm text-[var(--foreground-muted)]">
                  Follow the same steps to add and verify <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs">roadr.com</code> in Resend.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#1ED4A7]/10 border border-[#1ED4A7]/20 rounded-lg p-4">
        <div className="flex gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#1ED4A7] flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-[#1ED4A7] mb-1">
              After Verification
            </h3>
            <p className="text-sm text-zinc-400">
              Once your domains are verified, emails will be properly authenticated and will land in the inbox instead of spam.
              This typically takes 24-48 hours for full DNS propagation.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t dark:border-gray-800 pt-4">
        <h3 className="font-medium text-[var(--foreground)] mb-2">Additional Tips</h3>
        <ul className="text-sm text-[var(--foreground-muted)] space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-1">•</span>
            <span><strong>Warm up your domain:</strong> Start by sending 10-20 emails per day and gradually increase volume over 2-3 weeks</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-1">•</span>
            <span><strong>Monitor bounce rates:</strong> Keep bounce rate below 5% by cleaning your email list regularly</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-1">•</span>
            <span><strong>Test emails:</strong> Send test emails to yourself first to check deliverability</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#1ED4A7] mt-1">•</span>
            <span><strong>Avoid spam triggers:</strong> Don't use ALL CAPS, excessive exclamation marks, or spammy words</span>
          </li>
        </ul>
      </div>

      <div className="flex gap-3">
        <a 
          href="https://resend.com/domains" 
          target="_blank" 
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 text-white dark:text-black rounded-lg transition-colors"
        >
          Go to Resend Domains
          <ExternalLink className="w-4 h-4" />
        </a>
        <a 
          href="https://resend.com/docs/dashboard/domains/introduction" 
          target="_blank" 
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          Read Documentation
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}