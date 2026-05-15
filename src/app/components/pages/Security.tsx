import { BlogLayout } from '../blog/BlogLayout';
import { motion } from 'motion/react';
import { Shield, Lock, Server, Key, FileCheck, Eye, ArrowRight } from 'lucide-react';
import { SEOHead } from '../SEOHead';

interface PageProps {
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

const features = [
  { icon: Lock, title: 'Encryption Everywhere', description: 'All data encrypted at rest (AES-256) and in transit (TLS 1.3). Your sensitive information is never exposed.' },
  { icon: Server, title: 'SOC 2 Compliant', description: 'Infrastructure hosted in SOC 2 Type II compliant data centers. The highest standards of physical and digital security.' },
  { icon: Key, title: 'Role-Based Access', description: 'Granular permission controls let you define exactly who can see and edit what within your workspace.' },
  { icon: FileCheck, title: 'GDPR & CCPA Ready', description: 'Fully compliant with GDPR and CCPA regulations. Tools for data subject requests built right in.' },
  { icon: Eye, title: 'Audit Logs', description: 'Enterprise plans include detailed audit logs — every login, export, and data change tracked and searchable.' },
  { icon: Shield, title: 'Bug Bounty', description: 'We partner with top security researchers to continuously test our systems for vulnerabilities.' },
];

function ScrollReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
      viewport={{ once: true, margin: '-80px' }}
    >
      {children}
    </motion.div>
  );
}

export function Security({ onNavigate, onLogin, onGetStarted }: PageProps) {
  return (
    <>
      <SEOHead
        title="Security & Compliance - Enterprise-Grade Data Protection | Contndr"
        description="Contndr uses enterprise-grade security with SOC 2 compliance, end-to-end encryption, and secure infrastructure."
        keywords="sales security, data protection, SOC 2, encryption, compliance, enterprise security"
        canonical="https://contndr.com/security"
        ogTitle="Security & Compliance - Enterprise-Grade Protection"
      />
      <BlogLayout onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted}>
        {/* Hero */}
        <section className="relative pt-24 pb-28 md:pt-36 md:pb-44 px-6 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)] pointer-events-none" />

          <div className="relative z-10 max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-10"
            >
              <Shield className="w-3 h-3 text-emerald-500/70" /> Security First
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="text-[2.5rem] sm:text-[3rem] md:text-6xl lg:text-[5.5rem] font-medium text-white tracking-tighter leading-[1.06] mb-8"
            >
              Your data is <span className="font-extrabold">safe</span> <span className="text-zinc-500">with us.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="text-base md:text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed font-normal"
            >
              Your sales data is your most valuable asset. We've built enterprise-grade security into every layer of the platform.
            </motion.p>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-28 md:py-44 px-6 border-t border-white/5">
          <div className="max-w-[1200px] mx-auto">
            <ScrollReveal>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 mb-4">Protection</div>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-medium text-white tracking-tighter mb-20">
                Enterprise-grade at{' '}
                <span className="font-extrabold">every layer.</span>
              </h2>
            </ScrollReveal>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature, i) => (
                <ScrollReveal key={feature.title} delay={0.06 + i * 0.06}>
                  <div className="group h-full rounded-[2rem] border border-zinc-200 dark:border-zinc-800 bg-[#0A0A0A] p-10 md:p-12 hover:border-white/[0.12] transition-all duration-500 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(300px_circle_at_50%_0%,rgba(255,255,255,0.02),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    <div className="relative z-10">
                      <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-7 group-hover:border-white/[0.12] transition-colors">
                        <feature.icon className="w-4 h-4 text-zinc-400" />
                      </div>
                      <h3 className="text-base font-semibold text-white mb-3 tracking-tight">{feature.title}</h3>
                      <p className="text-sm text-zinc-500 leading-relaxed">{feature.description}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* Compliance Bar */}
        <section className="py-20 px-6 border-t border-white/5">
          <div className="max-w-[1200px] mx-auto">
            <ScrollReveal>
              <div className="rounded-[2rem] bg-[#0A0A0A] border border-zinc-200 dark:border-zinc-800 p-10 md:p-14 flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-80 h-80 bg-zinc-50 dark:bg-zinc-950 rounded-full blur-[100px] pointer-events-none" />

                <div className="relative z-10 text-center md:text-left">
                  <h3 className="text-xl md:text-2xl font-semibold text-white tracking-tight mb-2">
                    Have specific security questions?
                  </h3>
                  <p className="text-sm text-zinc-500">
                    Our security team is ready to walk you through our practices and certifications.
                  </p>
                </div>
                <a
                  href="mailto:security@contndr.com"
                  className="relative z-10 shrink-0 h-14 md:h-16 px-10 rounded-2xl bg-white text-black font-semibold text-sm md:text-base hover:bg-zinc-200 transition-colors flex items-center gap-2 shadow-[0_0_40px_-10px_rgba(255,255,255,0.15)]"
                >
                  Contact Security <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </BlogLayout>
    </>
  );
}

export default Security;