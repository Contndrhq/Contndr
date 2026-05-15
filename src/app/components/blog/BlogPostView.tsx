import { BlogPost } from '../../data/blog-posts';
import { BlogLayout } from './BlogLayout';
import { motion } from 'motion/react';
import { ArrowLeft, Calendar, User, Clock, Share2, Facebook, Twitter, Linkedin, ArrowRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { SEOHead } from '../SEOHead';
import DOMPurify from 'dompurify';

interface BlogPostProps {
  post: BlogPost;
  onNavigate: (path: string) => void;
  onLogin: () => void;
  onGetStarted: () => void;
}

export function BlogPostView({ post, onNavigate, onLogin, onGetStarted }: BlogPostProps) {
  const publishedTime = new Date(post.date).toISOString();

  useEffect(() => {
    const schema = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": post.title,
      "image": post.image,
      "author": { "@type": "Person", "name": post.author },
      "publisher": {
        "@type": "Organization",
        "name": "Contndr",
        "logo": { "@type": "ImageObject", "url": "https://contndr.com/logo.png" }
      },
      "datePublished": post.date,
      "description": post.excerpt
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(schema);
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, [post]);

  return (
    <>
      <SEOHead
        title={`${post.title} | Contndr Blog`}
        description={post.excerpt}
        keywords={`${post.tags.join(', ')}, sales automation, B2B sales`}
        canonical={`https://contndr.com/blog/${post.slug}`}
        ogTitle={post.title}
        ogDescription={post.excerpt}
        ogImage={post.image}
        ogType="article"
        publishedTime={publishedTime}
        author={post.author}
        section={post.tags[0]}
        tags={post.tags}
      />
      <BlogLayout onNavigate={onNavigate} onLogin={onLogin} onGetStarted={onGetStarted}>
        <article>
          {/* Hero Image */}
          <div className="relative h-[50vh] min-h-[400px] max-h-[640px] w-full overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/40 to-[#050505]/10 z-10" />
            <img
              src={post.image}
              alt={post.title}
              className="w-full h-full object-cover"
            />

            <div className="absolute inset-0 z-20 flex flex-col justify-end pb-16 md:pb-20 px-6">
              <div className="max-w-4xl mx-auto w-full">
                <button
                  onClick={() => onNavigate('/blog')}
                  className="flex items-center gap-2 text-zinc-500 hover:text-white mb-8 text-xs font-semibold uppercase tracking-[0.12em] transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Blog
                </button>

                <div className="flex flex-wrap gap-3 mb-6">
                  {post.tags.map(tag => (
                    <span key={tag} className="px-3 py-1 bg-white/10 backdrop-blur-sm text-white text-[10px] font-semibold rounded-lg uppercase tracking-wider">
                      {tag}
                    </span>
                  ))}
                </div>

                <motion.h1
                  initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="text-3xl md:text-5xl lg:text-[4.5rem] font-medium text-white tracking-tighter leading-[1.06] mb-8"
                >
                  {post.title}
                </motion.h1>

                <div className="flex flex-wrap items-center gap-6 text-xs md:text-sm text-zinc-400 font-medium">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white font-semibold border border-white/10">
                      {post.author.charAt(0)}
                    </div>
                    {post.author}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                    {post.date}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-zinc-500" />
                    {post.readTime}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="max-w-4xl mx-auto px-6 py-20 md:py-28 relative">
            {/* Social Share (Sticky) */}
            <div className="hidden lg:flex flex-col gap-2.5 absolute left-0 top-24 -translate-x-full pr-12">
              <div className="text-[10px] uppercase font-semibold text-zinc-600 tracking-wider mb-1">Share</div>
              <button className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-white/[0.08] hover:border-white/[0.12] border border-zinc-200 dark:border-zinc-800 transition-all text-zinc-500 hover:text-white">
                <Facebook className="w-3.5 h-3.5" />
              </button>
              <button className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-white/[0.08] hover:border-white/[0.12] border border-zinc-200 dark:border-zinc-800 transition-all text-zinc-500 hover:text-white">
                <Twitter className="w-3.5 h-3.5" />
              </button>
              <button className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-white/[0.08] hover:border-white/[0.12] border border-zinc-200 dark:border-zinc-800 transition-all text-zinc-500 hover:text-white">
                <Linkedin className="w-3.5 h-3.5" />
              </button>
              <button className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 hover:bg-white/[0.08] hover:border-white/[0.12] border border-zinc-200 dark:border-zinc-800 transition-all text-zinc-500 hover:text-white">
                <Share2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div
              className="prose prose-invert prose-lg max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-white prose-a:underline prose-a:underline-offset-4 prose-a:decoration-zinc-700 hover:prose-a:decoration-zinc-400 prose-img:rounded-2xl prose-strong:text-white prose-p:text-zinc-400 prose-li:text-zinc-400 prose-blockquote:border-zinc-800 prose-blockquote:text-zinc-400"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content) }}
            />

            {/* CTA */}
            <div className="mt-24 pt-12 border-t border-zinc-200 dark:border-zinc-800">
              <div className="rounded-[2rem] p-10 md:p-14 border border-zinc-200 dark:border-zinc-800 bg-[#0A0A0A] text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.02),transparent_60%)] pointer-events-none" />

                <div className="relative z-10">
                  <h3 className="text-2xl md:text-3xl font-medium text-white mb-3 tracking-tighter">
                    Ready to <span className="font-extrabold">automate</span> your sales?
                  </h3>
                  <p className="text-sm text-zinc-500 mb-10 max-w-md mx-auto leading-relaxed">
                    Join 10,000+ sales leaders using Contndr to scale revenue without scaling headcount.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={onGetStarted}
                      className="h-14 md:h-16 px-10 rounded-2xl bg-white text-black font-semibold text-base hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-[0_0_40px_-10px_rgba(255,255,255,0.15)]"
                    >
                      Start Building for Free <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>
      </BlogLayout>
    </>
  );
}

export default BlogPostView;