import { BlogLayout } from '../blog/BlogLayout';
import { motion } from 'motion/react';
import { SEOHead } from '../SEOHead';

interface LegalPageProps {
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

export function TermsOfService({ onNavigate, onLogin, onGetStarted }: LegalPageProps) {
  return (
    <>
      <SEOHead
        title="Terms of Service - Contndr"
        description="Read Contndr's Terms of Service to understand the rules, regulations, and third-party integration policies governing the use of our platform."
        canonical="https://contndr.com/terms"
      />
      <BlogLayout onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted}>
        <div className="max-w-3xl mx-auto px-6 pt-24 md:pt-36 pb-28 md:pb-44">
          <motion.div
            initial={{ opacity: 0, y: 20, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-10">
              Legal
            </div>

            <h1 className="text-[2.25rem] md:text-5xl lg:text-6xl font-medium text-white mb-4 tracking-tighter leading-[1.06]">
              Terms of <span className="font-extrabold">Use</span>
            </h1>
            <div className="text-xs text-zinc-600 font-mono mb-20">Last Updated: February 23, 2026</div>
          </motion.div>
          
          <div className="space-y-12 text-[15px] text-zinc-400 leading-[1.8]">
            <p>Welcome to Contndr. By accessing or using our platform, you agree to be bound by these Terms of Use. If you do not agree with any part of these terms, you must not use the service.</p>
            
            {/* ── Section 1 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">1. Usage Rights</h3>
              <p>Contndr grants you a limited, non-exclusive, non-transferable, revocable license to use our sales automation services for your internal business purposes, subject to these Terms. This license does not include the right to sublicense, resell, or redistribute any part of the platform or its underlying technology.</p>
            </div>

            {/* ── Section 2 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">2. Account Responsibilities</h3>
              <p className="mb-4">When you create a Contndr account, you agree to:</p>
              <ul className="list-disc list-inside space-y-2 text-zinc-500">
                <li>Provide accurate and complete registration information</li>
                <li>Maintain the security of your account credentials</li>
                <li>Promptly notify us of any unauthorized access</li>
                <li>Accept responsibility for all activity under your account</li>
              </ul>
              <p className="mt-4">You must be at least 18 years old and have the legal authority to enter into these Terms on behalf of yourself or your organization.</p>
            </div>
            
            {/* ── Section 3 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">3. Data &amp; Privacy</h3>
              <p className="mb-4">You retain all rights to your data. We process your data solely to provide and improve our services. We do <strong className="text-white">not</strong> sell your data to third parties.</p>
              <p>Our collection, use, and protection of your personal information &mdash; including data obtained through third-party integrations &mdash; is governed by our{' '}
                <button
                  onClick={() => onNavigate('/privacy')}
                  className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400"
                >
                  Privacy Policy
                </button>, which is incorporated into these Terms by reference.
              </p>
            </div>

            {/* ── Section 4 — Third-Party Integrations & Google Data ── */}
            <div className="relative">
              <div className="absolute -left-4 top-0 bottom-0 w-px bg-gradient-to-b from-white/20 via-white/5 to-transparent hidden md:block" />
              <h3 className="text-white font-semibold text-lg mb-6 tracking-tight">4. Third-Party Integrations &amp; Google User Data</h3>
              <p className="mb-6">Contndr integrates with third-party services &mdash; including Google (Gmail), Microsoft (Outlook), and SMTP providers &mdash; to enable core outreach functionality. By connecting a third-party account, you authorize Contndr to access and use data from that service as described below and in our Privacy Policy.</p>

              {/* Google-specific */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">Google account connections</h4>
                <p className="mb-3">When you connect your Google account, you grant Contndr permission to:</p>
                <ul className="list-disc list-inside space-y-2 text-zinc-500">
                  <li>Access your email address and basic profile information</li>
                  <li>Send emails on your behalf via the Gmail API (<code className="text-xs bg-white/[0.06] px-1.5 py-0.5 rounded font-mono text-zinc-400">gmail.send</code> scope)</li>
                  <li>Track delivery status and replies for campaigns you initiate</li>
                </ul>
                <p className="mt-3">We do <strong className="text-white">not</strong> read, scan, or index your inbox messages unless you explicitly authorize a specific feature that requires it.</p>
              </div>

              {/* Limited Use */}
              <div className="mb-8">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">Google API Limited Use disclosure</h4>
                <p className="mb-3">Contndr's use and transfer to any other app of information received from Google APIs adheres to the{' '}
                  <a
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400"
                  >
                    Google API Services User Data Policy
                  </a>, including the Limited Use requirements. Specifically:
                </p>
                <ul className="list-disc list-inside space-y-2 text-zinc-500">
                  <li>Google data is used only to provide and improve user-facing features within Contndr</li>
                  <li>Google data is never sold, leased, or traded to any third party</li>
                  <li>Google data is never used to train AI models, build advertising profiles, or serve ads</li>
                  <li>Google data is never transferred to any app or service that does not comply with Google's policies</li>
                </ul>
              </div>

              {/* Revocation */}
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h4 className="text-white/90 font-medium text-[15px] mb-3">Revoking access</h4>
                <p className="mb-3">You may disconnect any third-party integration at any time from your Contndr account settings. For Google specifically, you can also revoke access at:</p>
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
                <p>Upon revocation, Contndr will cease using your Google data. Cached tokens will be deleted. For full data deletion, contact{' '}
                  <a href="mailto:privacy@contndr.com" className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400">privacy@contndr.com</a>.
                </p>
              </div>
            </div>
            
            {/* ── Section 5 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">5. Subscription &amp; Billing</h3>
              <p className="mb-4">Subscriptions are billed monthly or annually through Stripe, our payment processor. By subscribing, you agree to:</p>
              <ul className="list-disc list-inside space-y-2 text-zinc-500">
                <li>Pay all fees associated with your chosen plan</li>
                <li>Provide accurate and current billing information</li>
                <li>Authorize recurring charges until you cancel</li>
              </ul>
              <p className="mt-4">You may cancel at any time from your account settings. Cancellation takes effect at the end of your current billing period. Refunds for annual plans are provided at our discretion.</p>
            </div>
            
            {/* ── Section 6 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">6. Acceptable Use</h3>
              <p className="mb-4">You agree not to use Contndr to:</p>
              <ul className="list-disc list-inside space-y-2 text-zinc-500">
                <li>Send unsolicited bulk email (spam) or violate anti-spam laws (CAN-SPAM, GDPR, CASL, etc.)</li>
                <li>Harass, threaten, or impersonate any person or entity</li>
                <li>Transmit malicious code, phishing content, or deceptive materials</li>
                <li>Violate any applicable local, state, national, or international law</li>
                <li>Circumvent usage limits, rate limits, or security measures</li>
                <li>Scrape, reverse-engineer, or attempt to extract source code from the platform</li>
              </ul>
              <p className="mt-4">Violation of these policies may result in immediate suspension or termination of your account without refund.</p>
            </div>

            {/* ── Section 7 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">7. Intellectual Property</h3>
              <p>All content, features, functionality, branding, and technology comprising the Contndr platform are owned by Contndr and protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, or create derivative works from any part of the platform without prior written consent.</p>
            </div>

            {/* ── Section 8 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">8. Limitation of Liability</h3>
              <p className="mb-4">Contndr is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, either express or implied. To the maximum extent permitted by law:</p>
              <ul className="list-disc list-inside space-y-2 text-zinc-500">
                <li>We are not liable for any indirect, special, incidental, consequential, or punitive damages</li>
                <li>Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim</li>
                <li>We are not responsible for third-party service outages (Google, Stripe, email providers, etc.)</li>
              </ul>
            </div>

            {/* ── Section 9 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">9. Termination</h3>
              <p>We may suspend or terminate your account at any time for violation of these Terms, with or without notice. You may terminate your account at any time through your account settings. Upon termination, your right to use the platform ceases immediately. We will retain your data for 30 days after termination to allow for data export, after which it will be permanently deleted unless retention is required by law.</p>
            </div>

            {/* ── Section 10 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">10. Changes to These Terms</h3>
              <p>We reserve the right to modify these Terms at any time. We will notify you of material changes by posting the updated terms on this page with a revised &ldquo;Last Updated&rdquo; date and, where appropriate, by email. Your continued use of Contndr after changes are posted constitutes acceptance of the revised Terms.</p>
            </div>

            {/* ── Section 11 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">11. Governing Law</h3>
              <p>These Terms shall be governed by and construed in accordance with the laws of the State of Florida, United States, without regard to its conflict of law provisions. Any disputes arising from these Terms shall be resolved in the courts of Miami-Dade County, Florida.</p>
            </div>

            {/* ── Section 12 ── */}
            <div>
              <h3 className="text-white font-semibold text-lg mb-4 tracking-tight">12. Contact Us</h3>
              <p>If you have any questions about these Terms of Use, please contact us at{' '}
                <a href="mailto:legal@contndr.com" className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400">legal@contndr.com</a>{' '}
                or{' '}
                <a href="mailto:privacy@contndr.com" className="text-white hover:text-zinc-300 transition-colors underline underline-offset-4 decoration-zinc-700 hover:decoration-zinc-400">privacy@contndr.com</a>.
              </p>
            </div>
          </div>
        </div>
      </BlogLayout>
    </>
  );
}

export default TermsOfService;