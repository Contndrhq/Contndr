import { BlogLayout } from '../blog/BlogLayout';
import { motion } from 'motion/react';
import { ArrowUpRight, ArrowRight, MapPin, Clock, Briefcase } from 'lucide-react';
import { useState } from 'react';
import { ApplicationModal } from './ApplicationModal';
import { SEOHead } from '../SEOHead';

interface PageProps {
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

const perks = [
  {
    title: 'Remote First',
    description: 'We believe talent is everywhere. Work from wherever you\'re most productive — your home, a caf\u00e9, or a beach.',
  },
  {
    title: 'Competitive Equity',
    description: 'Top-tier salary and meaningful equity. We want every team member to think and act like an owner.',
  },
  {
    title: 'Unlimited PTO',
    description: 'We trust you to manage your time. Take what you need, when you need it — no questions asked.',
  },
  {
    title: '$2k Learning Budget',
    description: 'Annual budget for courses, conferences, books — anything that helps you grow as a professional.',
  },
];

const openRoles = [
  {
    title: 'Sales Representative',
    department: 'Sales',
    location: 'Remote',
    type: 'Full time',
  },
  {
    title: 'Product Marketing Manager',
    department: 'Marketing',
    location: 'Remote',
    type: 'Full time',
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

export function Careers({ onNavigate, onLogin, onGetStarted }: PageProps) {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  return (
    <>
      <SEOHead
        title="Careers at Contndr - Join Our Team Building the Future of Sales"
        description="Join Contndr and help build the next generation of sales automation. Remote-first, competitive equity, and a team that ships fast."
        keywords="contndr careers, sales jobs, remote jobs, startup jobs, sales automation careers"
        canonical="https://contndr.com/careers"
        ogTitle="Careers at Contndr - Join Our Team"
      />
      <BlogLayout onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted}>
        <ApplicationModal
          isOpen={!!selectedRole}
          onClose={() => setSelectedRole(null)}
          roleTitle={selectedRole || ''}
        />

        {/* Hero */}
        <section className="relative pt-24 pb-28 md:pt-36 md:pb-44 px-6 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)] pointer-events-none" />

          <div className="relative z-10 max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-10"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
              We're Hiring
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="text-[2.5rem] sm:text-[3rem] md:text-6xl lg:text-[5.5rem] font-medium text-white tracking-tighter leading-[1.06] mb-8"
            >
              Do the <span className="font-extrabold">best work</span> <span className="text-zinc-500">of your life.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="text-base md:text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed font-normal"
            >
              We're a small team of builders, dreamers, and doers. Join us on our mission to reinvent how companies grow.
            </motion.p>
          </div>
        </section>

        {/* Perks */}
        <section className="py-28 md:py-44 px-6 border-t border-white/5">
          <div className="max-w-[1200px] mx-auto">
            <ScrollReveal>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 mb-4">Why Contndr</div>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-medium text-white tracking-tighter mb-20">
                Built for people who{' '}
                <span className="font-extrabold">ship.</span>
              </h2>
            </ScrollReveal>

            <div className="grid sm:grid-cols-2 gap-6">
              {perks.map((perk, i) => (
                <ScrollReveal key={perk.title} delay={0.08 + i * 0.08}>
                  <div className="group rounded-[2rem] border border-white/[0.06] bg-[#0A0A0A] p-10 md:p-12 hover:border-white/[0.12] transition-all duration-500 relative overflow-hidden h-full">
                    <div className="absolute inset-0 bg-[radial-gradient(300px_circle_at_50%_0%,rgba(255,255,255,0.02),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                    <div className="relative z-10">
                      <h3 className="text-lg font-semibold text-white mb-3 tracking-tight">{perk.title}</h3>
                      <p className="text-sm text-zinc-500 leading-relaxed">{perk.description}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* Open Positions */}
        <section className="py-28 md:py-44 px-6 border-t border-white/5 relative overflow-hidden">
          <div className="absolute left-0 bottom-0 w-[600px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.02),transparent_70%)] pointer-events-none" />

          <div className="max-w-[900px] mx-auto relative z-10">
            <ScrollReveal>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-600 mb-4">Open Roles</div>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-medium text-white tracking-tighter mb-16">
                Find your next{' '}
                <span className="font-extrabold">chapter.</span>
              </h2>
            </ScrollReveal>

            <div className="space-y-4">
              {openRoles.map((role, idx) => (
                <ScrollReveal key={idx} delay={0.08 + idx * 0.08}>
                  <div
                    onClick={() => setSelectedRole(role.title)}
                    className="group flex flex-col md:flex-row md:items-center justify-between rounded-2xl border border-white/[0.06] bg-[#0A0A0A] p-6 md:p-8 hover:border-white/[0.15] hover:bg-[#0E0E0E] transition-all duration-300 cursor-pointer"
                  >
                    <div>
                      <h4 className="text-lg font-semibold text-white mb-2.5 tracking-tight group-hover:text-zinc-200 transition-colors">
                        {role.title}
                      </h4>
                      <div className="flex flex-wrap gap-4 text-xs text-zinc-500 font-medium">
                        <span className="flex items-center gap-1.5"><Briefcase className="w-3 h-3 text-zinc-600" />{role.department}</span>
                        <span className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-zinc-600" />{role.location}</span>
                        <span className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-zinc-600" />{role.type}</span>
                      </div>
                    </div>
                    <div className="mt-4 md:mt-0 flex items-center gap-2 text-sm font-semibold text-zinc-500 group-hover:text-white transition-colors shrink-0">
                      Apply <ArrowUpRight className="w-4 h-4" />
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>

            {/* General application */}
            <ScrollReveal delay={0.3}>
              <div className="mt-20 text-center pt-16 border-t border-white/5">
                <p className="text-zinc-600 mb-6 text-sm">Don't see your perfect role?</p>
                <a
                  href="mailto:careers@contndr.com?subject=General Application"
                  className="inline-flex items-center gap-2 h-14 md:h-16 px-10 rounded-2xl bg-white text-black font-semibold text-sm md:text-base hover:bg-zinc-200 transition-colors shadow-[0_0_40px_-10px_rgba(255,255,255,0.15)]"
                >
                  Send a General Application <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </BlogLayout>
    </>
  );
}

export default Careers;