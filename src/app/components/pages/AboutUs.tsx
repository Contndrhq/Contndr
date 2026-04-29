import { BlogLayout } from '../blog/BlogLayout';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { SEOHead } from '../SEOHead';

interface PageProps {
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

const stats = [
  { value: '10k+', label: 'Active users' },
  { value: '50M+', label: 'Emails sent' },
  { value: '$2B+', label: 'Pipeline generated' },
  { value: '99%', label: 'Customer satisfaction' },
];

const values = [
  {
    title: 'Clarity over complexity',
    description: 'Every feature exists to remove friction, not add it. If it doesn\'t simplify, it doesn\'t ship.',
  },
  {
    title: 'Speed as a feature',
    description: 'Fast software respects people\'s time. We obsess over performance at every layer of the stack.',
  },
  {
    title: 'Builders first',
    description: 'We\'re craftspeople who care deeply about details. The details that compound into great products.',
  },
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

export function AboutUs({ onNavigate, onLogin, onGetStarted }: PageProps) {
  return (
    <>
      <SEOHead
        title="About Contndr - Building the Operating System for Sales"
        description="Learn about Contndr's mission to transform sales teams with AI-powered automation, unified workflows, and modern technology."
        keywords="about contndr, sales automation company, B2B sales software, sales technology"
        canonical="https://contndr.com/about"
        ogTitle="About Contndr - Building the Operating System for Sales"
      />
      <BlogLayout onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted}>
        {/* Hero */}
        <section className="relative pt-24 pb-28 md:pt-36 md:pb-44 px-6 overflow-hidden">
          {/* Subtle radial glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)] pointer-events-none" />

          <div className="relative z-10 max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-10"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
              Our Story
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="text-[2.5rem] sm:text-[3rem] md:text-6xl lg:text-[5.5rem] font-medium text-white tracking-tighter leading-[1.06] mb-8"
            >
              The <span className="font-extrabold">operating system</span>{' '}
              <span className="text-zinc-500">for sales.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="text-base md:text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed font-normal"
            >
              Sales tools are too complex, too expensive, and too disjointed.
              We believe there's a better way.
            </motion.p>
          </div>
        </section>

        {/* Stats */}
        <section className="px-6 md:px-12 pb-28 md:pb-44">
          <div className="max-w-[1200px] mx-auto">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-[2rem] overflow-hidden bg-white/[0.04]">
              {stats.map((stat, i) => (
                <ScrollReveal key={stat.label} delay={i * 0.08}>
                  <div className="bg-[#080808] p-10 md:p-14 text-center h-full">
                    <div className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-2">{stat.value}</div>
                    <div className="text-xs text-zinc-600 font-medium uppercase tracking-[0.12em]">{stat.label}</div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* Mission */}
        <section className="py-28 md:py-44 px-6 border-t border-white/5 relative overflow-hidden">
          <div className="absolute right-0 top-0 w-[600px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.02),transparent_70%)] pointer-events-none" />

          <div className="max-w-[1200px] mx-auto grid md:grid-cols-5 gap-16 md:gap-24 items-start relative z-10">
            <div className="md:col-span-2">
              <ScrollReveal>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 mb-6">Our Mission</div>
                <h2 className="text-3xl md:text-4xl lg:text-5xl font-medium text-white leading-[1.1] tracking-tighter">
                  Empower sales teams to do their{' '}
                  <span className="font-extrabold">best work.</span>
                </h2>
              </ScrollReveal>
            </div>
            <div className="md:col-span-3 space-y-8 md:pt-4">
              <ScrollReveal delay={0.1}>
                <p className="text-lg text-zinc-400 leading-relaxed font-normal">
                  We believe that technology should fade into the background, allowing human connection to take center stage. Too many tools fight for attention instead of earning it through simplicity.
                </p>
              </ScrollReveal>
              <ScrollReveal delay={0.15}>
                <p className="text-lg text-zinc-400 leading-relaxed font-normal">
                  By consolidating the sales stack — CRM, outreach, data, and intelligence — into one fluid interface, we remove the friction that slows teams down and let sellers focus on what actually matters: relationships.
                </p>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* Values */}
        <section className="py-28 md:py-44 px-6 border-t border-white/5">
          <div className="max-w-[1200px] mx-auto">
            <ScrollReveal>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 mb-4">What We Believe</div>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-medium text-white tracking-tighter mb-20">
                Principles that guide every{' '}
                <span className="font-extrabold">decision.</span>
              </h2>
            </ScrollReveal>

            <div className="grid md:grid-cols-3 gap-6">
              {values.map((value, i) => (
                <ScrollReveal key={value.title} delay={0.1 + i * 0.1}>
                  <div className="group h-full rounded-[2rem] border border-white/[0.06] bg-[#0A0A0A] p-10 md:p-12 hover:border-white/[0.12] transition-all duration-500 relative overflow-hidden">
                    {/* Subtle hover glow */}
                    <div className="absolute inset-0 bg-[radial-gradient(300px_circle_at_50%_0%,rgba(255,255,255,0.02),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    <div className="relative z-10">
                      <div className="text-[11px] font-mono text-zinc-700 mb-8">0{i + 1}</div>
                      <h3 className="text-xl font-semibold text-white mb-4 tracking-tight">{value.title}</h3>
                      <p className="text-sm text-zinc-500 leading-relaxed">{value.description}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-28 md:py-44 px-6 border-t border-white/5 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.02),transparent_60%)] pointer-events-none" />

          <div className="relative z-10 max-w-3xl mx-auto text-center">
            <ScrollReveal>
              <h2 className="text-3xl md:text-5xl lg:text-[4.5rem] font-medium text-white mb-7 tracking-tighter leading-[1.06]">
                Join the{' '}
                <span className="font-extrabold">revolution.</span>
              </h2>
            </ScrollReveal>
            <ScrollReveal delay={0.1}>
              <p className="text-lg text-zinc-500 mb-12 max-w-lg mx-auto leading-relaxed font-normal">
                Ready to stop wrestling with your CRM and start closing deals?
              </p>
            </ScrollReveal>
            <ScrollReveal delay={0.2}>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={onGetStarted}
                  className="h-14 md:h-16 px-10 rounded-2xl bg-white text-black font-semibold text-base md:text-lg hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-[0_0_40px_-10px_rgba(255,255,255,0.15)]"
                >
                  Get Started for Free <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => window.open('https://calendly.com/ax-contndr/30min?month=2026-02', '_blank')}
                  className="h-14 md:h-16 px-10 rounded-2xl border border-white/10 hover:bg-white/5 transition-colors font-semibold text-base md:text-lg text-white flex items-center justify-center"
                >
                  Book a Demo
                </button>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </BlogLayout>
    </>
  );
}

export default AboutUs;