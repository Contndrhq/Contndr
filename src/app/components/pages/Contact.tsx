import { BlogLayout } from '../blog/BlogLayout';
import { motion } from 'motion/react';
import { ArrowUpRight, Mail, MessageSquare } from 'lucide-react';
import { SEOHead } from '../SEOHead';

interface PageProps {
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

const channels = [
  {
    icon: MessageSquare,
    label: 'Chat with Sales',
    description: 'Get a custom demo tailored to your workflow.',
    link: 'mailto:sales@contndr.com',
    linkText: 'sales@contndr.com',
  },
  {
    icon: Mail,
    label: 'Support',
    description: 'Need help setting up? We\'re here 24/7.',
    link: 'mailto:hello@contndr.com',
    linkText: 'hello@contndr.com',
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

export function Contact({ onNavigate, onLogin, onGetStarted }: PageProps) {
  return (
    <>
      <SEOHead
        title="Contact Contndr - Get in Touch with Our Sales Team"
        description="Have questions about Contndr? Contact our team for demos, support, or partnership inquiries."
        keywords="contact contndr, sales demo, customer support, partnership"
        canonical="https://contndr.com/contact"
        ogTitle="Contact Contndr - Get in Touch"
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
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
              Get in Touch
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="text-[2.5rem] sm:text-[3rem] md:text-6xl lg:text-[5.5rem] font-medium text-white tracking-tighter leading-[1.06] mb-8"
            >
              Let's <span className="font-extrabold">talk.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="text-base md:text-lg text-zinc-500 max-w-xl mx-auto leading-relaxed font-normal"
            >
              Whether you need a demo, have questions about pricing, or want a custom solution — our team is ready.
            </motion.p>
          </div>
        </section>

        {/* Content */}
        <section className="pb-28 md:pb-44 px-6">
          <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row gap-16 lg:gap-24">
            {/* Left — Contact Channels */}
            <div className="lg:w-5/12 space-y-6 lg:pt-4">
              {channels.map((ch, i) => (
                <ScrollReveal key={ch.label} delay={i * 0.08}>
                  <a
                    href={ch.link}
                    className="group flex items-start gap-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-[#0A0A0A] p-7 hover:border-white/[0.12] hover:bg-[#0E0E0E] transition-all duration-300"
                  >
                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-white/[0.12] transition-colors">
                      <ch.icon className="w-4 h-4 text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white mb-1">{ch.label}</div>
                      <p className="text-xs text-zinc-500 mb-2.5 leading-relaxed">{ch.description}</p>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 group-hover:text-white transition-colors">
                        {ch.linkText} <ArrowUpRight className="w-3 h-3" />
                      </span>
                    </div>
                  </a>
                </ScrollReveal>
              ))}
            </div>

            {/* Right — Form */}
            <div className="lg:w-7/12">
              <ScrollReveal delay={0.1}>
                <div className="rounded-[2rem] bg-[#0A0A0A] border border-zinc-200 dark:border-zinc-800 p-8 md:p-12 relative overflow-hidden shadow-2xl">
                  {/* Subtle corner glow */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-zinc-50 dark:bg-zinc-950 rounded-full blur-[100px] pointer-events-none" />

                  <form className="relative z-10 space-y-5" onSubmit={(e) => { e.preventDefault(); alert('Message sent!'); }}>
                    <div className="grid grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">First Name</label>
                        <input
                          type="text"
                          className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all placeholder:text-zinc-700"
                          placeholder="Jane"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Last Name</label>
                        <input
                          type="text"
                          className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all placeholder:text-zinc-700"
                          placeholder="Doe"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Work Email</label>
                      <input
                        type="email"
                        className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all placeholder:text-zinc-700"
                        placeholder="jane@company.com"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Message</label>
                      <textarea
                        rows={4}
                        className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all resize-none placeholder:text-zinc-700"
                        placeholder="Tell us about your needs..."
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-4 rounded-2xl bg-white text-black font-semibold hover:bg-zinc-200 transition-all mt-2 shadow-[0_0_40px_-10px_rgba(255,255,255,0.1)]"
                    >
                      Send Message
                    </button>
                  </form>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>
      </BlogLayout>
    </>
  );
}

export default Contact;