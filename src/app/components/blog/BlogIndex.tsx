import { blogPosts } from '../../data/blog-posts';
import { BlogLayout } from './BlogLayout';
import { motion } from 'motion/react';
import { ArrowRight, Calendar, User, Clock } from 'lucide-react';
import { SEOHead } from '../SEOHead';

interface BlogIndexProps {
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

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

export function BlogIndex({ onNavigate, onLogin, onGetStarted }: BlogIndexProps) {
  const featuredPost = blogPosts[0];
  const remainingPosts = blogPosts.slice(1);

  return (
    <>
      <SEOHead
        title="Contndr Blog - Sales Automation Insights, Tips & Best Practices"
        description="Learn about sales automation, AI-powered outreach, email deliverability, CRM strategies, and modern sales techniques."
        keywords="sales blog, sales automation tips, email marketing, CRM best practices, B2B sales"
        canonical="https://contndr.com/blog"
        ogTitle="Contndr Blog - Sales Automation Insights"
      />
      <BlogLayout onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted}>
        {/* Header */}
        <section className="relative pt-24 pb-28 md:pt-36 md:pb-36 px-6 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)] pointer-events-none" />

          <div className="relative z-10 max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500 mb-10"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70" />
              Blog
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="text-[2.5rem] sm:text-[3rem] md:text-6xl lg:text-[5.5rem] font-medium text-white tracking-tighter leading-[1.06] mb-8"
            >
              Insights for the <span className="font-extrabold">modern</span> <span className="text-zinc-500">seller.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="text-base md:text-lg text-zinc-500 max-w-xl mx-auto leading-relaxed font-normal"
            >
              Tactical guides, industry trends, and deep dives into the future of sales automation.
            </motion.p>
          </div>
        </section>

        <div className="max-w-[1400px] mx-auto px-6 md:px-12 pb-28 md:pb-44">
          {/* Featured Post */}
          <ScrollReveal>
            <div
              className="group cursor-pointer mb-24 md:mb-32"
              onClick={() => onNavigate(`/blog/${featuredPost.slug}`)}
            >
              <div className="relative rounded-[2rem] overflow-hidden border border-white/[0.06] bg-[#0A0A0A] hover:border-white/[0.12] transition-all duration-500 shadow-2xl">
                <div className="grid md:grid-cols-2 gap-0">
                  <div className="h-[300px] md:h-[480px] overflow-hidden relative">
                    <img
                      src={featuredPost.image}
                      alt={featuredPost.title}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#0A0A0A]/30 md:block hidden" />
                  </div>
                  <div className="p-8 md:p-14 lg:p-16 flex flex-col justify-center">
                    <div className="flex flex-wrap gap-3 mb-6">
                      {featuredPost.tags.map(tag => (
                        <span key={tag} className="text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.15em]">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <h2 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-white mb-5 leading-tight tracking-tight group-hover:text-zinc-200 transition-colors">
                      {featuredPost.title}
                    </h2>

                    <p className="text-sm text-zinc-500 mb-8 leading-relaxed line-clamp-3">
                      {featuredPost.excerpt}
                    </p>

                    <div className="flex items-center gap-5 text-xs text-zinc-600 font-medium mb-8">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3" />
                        {featuredPost.author}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {featuredPost.date}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {featuredPost.readTime}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-white font-semibold group-hover:translate-x-1 transition-transform">
                      Read Article <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>

          {/* Post Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {remainingPosts.map((post, index) => (
              <ScrollReveal key={post.slug} delay={index * 0.06}>
                <div
                  className="group cursor-pointer flex flex-col h-full"
                  onClick={() => onNavigate(`/blog/${post.slug}`)}
                >
                  <div className="aspect-[16/10] rounded-2xl overflow-hidden mb-6 border border-white/[0.06] relative bg-zinc-900 group-hover:border-white/[0.12] transition-all duration-300">
                    <img
                      src={post.image}
                      alt={post.title}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                    />
                  </div>

                  <div className="flex gap-3 mb-3">
                    {post.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.12em]">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <h3 className="text-lg font-semibold text-white mb-2.5 tracking-tight group-hover:text-zinc-300 transition-colors leading-snug">
                    {post.title}
                  </h3>

                  <p className="text-xs text-zinc-500 mb-6 line-clamp-2 leading-relaxed">
                    {post.excerpt}
                  </p>

                  <div className="mt-auto flex items-center justify-between text-[11px] text-zinc-600 font-medium pt-4 border-t border-white/[0.04]">
                    <span>{post.date}</span>
                    <span>{post.readTime}</span>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </BlogLayout>
    </>
  );
}

export default BlogIndex;