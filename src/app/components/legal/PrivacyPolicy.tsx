import { BlogLayout } from '../blog/BlogLayout';
import { motion } from 'motion/react';
import { SEOHead } from '../SEOHead';

interface LegalPageProps {
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

export function PrivacyPolicy({ onNavigate, onLogin, onGetStarted }: LegalPageProps) {
  return (
    <>
      <SEOHead
        title="Privacy Policy - Contndr"
        description="Read Contndr's Privacy Policy to learn how we collect, use, and protect your personal information including Google user data."
        canonical="https://contndr.com/privacy"
      />
      <BlogLayout onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted}>
        <div className="max-w-3xl mx-auto px-6 pt-24 md:pt-36 pb-28 md:pb-44">
          <motion.div
            initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-10">
              Legal
            </div>

            <h1 className="text-[2.25rem] md:text-5xl lg:text-6xl font-medium text-white mb-4 tracking-tighter leading-[1.06]">
              Privacy <span className="font-extrabold">Policy</span>
            </h1>
            <div className="text-xs text-zinc-600 font-mono mb-20">Last Updated: February 23, 2026</div>
          </motion.div>
          
          <div className="space-y-12 text-[15px] text-zinc-400 leading-[1.8]">
            <p>At Contndr, we take your privacy seriously. This policy outlines how we collect, use, store, and protect your information &mdash; including data accessed through third-party services like Google.</p>
            
            {/* ── Section 1 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">1. Information Collection</h3>
              <p>We collect account information (email, name) and usage data to improve our services. We also process lead data you upload securely. When you connect third-party accounts (such as Google, Outlook, or SMTP providers), we collect authentication tokens and limited profile information necessary to operate the platform on your behalf.</p>
            </div>
            
            {/* ── Section 2 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">2. How We Use Your Data</h3>
              <p className="mb-4">Your data is used to:</p>
              <ul className="list-disc list-inside space-y-2 text-zinc-500">
                <li>Provide and improve the Contndr platform</li>
                <li>Send outbound emails on your behalf via connected email providers</li>
                <li>Track email delivery status and replies</li>
                <li>Power CRM, outbound automation, and engagement features</li>
                <li>Process payments and billing</li>
                <li>Send critical service updates</li>
                <li>Enrich leads at your specific request</li>
              </ul>
              <p className="mt-4">We do <strong className="text-white">not</strong> use your data for advertising purposes.</p>
            </div>

            {/* ── Section 3 — Google User Data (required for Google OAuth approval) ── */}
            <div className="relative">
              <div className="absolute -left-4 top-0 bottom-0 w-px bg-gradient-to-b from-white/20 via-white/5 to-transparent hidden md:block" />
              <h3 className="text-white font-semibold text-lg mb-6 tracking-tight">3. Google User Data (Gmail API) Disclosure</h3>
              <p className="mb-6">If you connect your Google account, Contndr requests access to Google user data via Google APIs to provide core email and inbox-sync functionality.</p>

              {/* Scopes we request */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">Scopes we request</h4>
                <ul className="list-disc list-inside space-y-2 text-zinc-500">
                  <li><code className="text-xs bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded font-mono text-zinc-400">https://www.googleapis.com/auth/gmail.send</code> &mdash; to send emails from your Gmail account inside Contndr</li>
                  <li><code className="text-xs bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded font-mono text-zinc-400">https://www.googleapis.com/auth/gmail.readonly</code> &mdash; to sync your inbox (messages/threads) for reply detection, conversation history, and CRM logging</li>
                  <li><code className="text-xs bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded font-mono text-zinc-400">https://www.googleapis.com/auth/userinfo.email</code> &mdash; to identify the connected Google account</li>
                  <li><code className="text-xs bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded font-mono text-zinc-400">https://www.googleapis.com/auth/userinfo.profile</code> &mdash; to display the connected Google account name and avatar</li>
                </ul>
              </div>

              {/* How we use Gmail data */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">How we use Gmail data</h4>
                <p className="mb-3">We use Gmail data <strong className="text-white">only</strong> to:</p>
                <ul className="list-disc list-inside space-y-2 text-zinc-500">
                  <li>Send outbound emails you initiate through the Contndr platform</li>
                  <li>Sync inbox threads to detect replies and associate conversations with leads</li>
                  <li>Display email history inside the CRM (if enabled)</li>
                </ul>
                <p className="mt-3">We do <strong className="text-white">not</strong> use Google data for advertising, profiling, or any purpose unrelated to providing the Contndr service.</p>
              </div>

              {/* What we store */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">What we store</h4>
                <p className="mb-3">Depending on your settings, we may store limited email data such as:</p>
                <ul className="list-disc list-inside space-y-2 text-zinc-500">
                  <li>Message and thread identifiers, timestamps, sender/recipient addresses, subject lines, and snippets</li>
                  <li>Email content required to display conversation history inside Contndr (if the inbox-sync feature is enabled)</li>
                </ul>
                <p className="mt-3">OAuth access tokens are stored encrypted at rest using industry-standard encryption. Access to tokens and credentials is restricted and logged.</p>
              </div>

              {/* Data sharing & disclosure */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">Data sharing &amp; disclosure</h4>
                <p className="mb-3">We do <strong className="text-white">not</strong> sell Google user data. We only share data with service providers needed to operate Contndr:</p>
                <ul className="list-disc list-inside space-y-2 text-zinc-500">
                  <li><strong className="text-zinc-300">Cloud hosting &amp; database/infrastructure providers</strong> &mdash; secure compute, storage, and database hosting (Supabase)</li>
                  <li><strong className="text-zinc-300">Email infrastructure providers</strong> &mdash; delivery and tracking</li>
                  <li><strong className="text-zinc-300">Logging &amp; monitoring providers</strong> &mdash; error tracking and operational health</li>
                  <li><strong className="text-zinc-300">Payment processing</strong> &mdash; Stripe for billing and subscriptions</li>
                </ul>
                <p className="mt-3">These vendors are contractually required to protect data and use it only to provide services to Contndr.</p>
              </div>

              {/* Data retention and deletion */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">Data retention and deletion</h4>
                <p className="mb-3">We retain Google user data only as long as necessary to provide the service, comply with legal obligations, or until you delete your account and/or request deletion.</p>
                <p>You can request deletion at any time by contacting{' '}
                  <a href="mailto:privacy@contndr.com" className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400">privacy@contndr.com</a>.
                  Upon account deletion, we will remove your Google user data within 30 days, except where retention is required by legal obligation.
                </p>
              </div>

              {/* User control and revocation */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">User control and revocation</h4>
                <p className="mb-3">You can revoke Contndr's access to your Google account at any time by visiting:</p>
                <p className="mb-3">
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400 break-all"
                  >
                    https://myaccount.google.com/permissions
                  </a>
                </p>
                <p>Revoking access will disconnect your Gmail integration from Contndr. You may also disconnect your account from within the Contndr settings page at any time.</p>
              </div>

              {/* Limited Use and AI/ML training compliance */}
              <div className="p-5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">Limited Use &amp; AI/ML training compliance</h4>
                <p className="mb-3">Contndr's use and transfer to any other app of information received from Google APIs will adhere to the{' '}
                  <a
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400"
                  >
                    Google API Services User Data Policy
                  </a>, including the Limited Use requirements.
                </p>
                <p className="mb-3">We do <strong className="text-white">not</strong> use Google user data to train generalized AI or machine learning models.</p>
                <p className="mb-2">Google data is <strong className="text-white">never</strong> used to:</p>
                <ul className="list-disc list-inside space-y-2 text-zinc-500">
                  <li>Train AI or machine learning models</li>
                  <li>Sell, lease, or trade data to third parties</li>
                  <li>Build advertising or user-profiling systems</li>
                  <li>Any purpose not explicitly disclosed in this policy</li>
                </ul>
              </div>
            </div>

            {/* ── Section 4 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">4. Data Security</h3>
              <p>We use industry-standard encryption (AES-256) for data at rest and TLS for data in transit. Our servers are hosted in secure SOC2-compliant data centers. Access to production systems is restricted, logged, and audited.</p>
            </div>

            {/* ── Section 5 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">5. Data Retention</h3>
              <p>We retain your personal data only for as long as necessary to fulfill the purposes outlined in this policy or as required by law. You may request deletion of your data at any time. Upon account deletion, we will remove your personal data within 30 days, except where retention is required by legal obligation.</p>
            </div>

            {/* ── Section 6 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">6. User Rights</h3>
              <p className="mb-4">You have the right to:</p>
              <ul className="list-disc list-inside space-y-2 text-zinc-500">
                <li>Access your personal data we hold</li>
                <li>Correct inaccurate or incomplete data</li>
                <li>Delete your personal data</li>
                <li>Revoke access to connected third-party services (Google, Outlook, etc.)</li>
                <li>Export your data in a portable format</li>
                <li>Manage communication preferences in your account settings</li>
              </ul>
            </div>

            {/* ── Section 7 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">7. Changes to This Policy</h3>
              <p>We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the updated policy on this page with a revised &ldquo;Last Updated&rdquo; date. Your continued use of Contndr after changes are posted constitutes acceptance of the updated policy.</p>
            </div>

            {/* ── Section 8 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">8. Contact Us</h3>
              <p>If you have any questions about this Privacy Policy or how we handle your data, please contact us at{' '}
                <a href="mailto:privacy@contndr.com" className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400">privacy@contndr.com</a>.
              </p>
            </div>
          </div>
        </div>
      </BlogLayout>
    </>
  );
}

export default PrivacyPolicy;