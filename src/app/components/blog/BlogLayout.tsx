import { ReactNode, useState } from 'react';
import { ContndrLogo } from '../ContndrLogo';
import { LandingFooter } from '../LandingFooter';
import { Menu, X } from 'lucide-react';

interface BlogLayoutProps {
  children: ReactNode;
  onNavigate?: (path: string) => void;
  onLogin?: () => void;
  onGetStarted?: () => void;
}

export function BlogLayout({ children, onNavigate, onLogin, onGetStarted }: BlogLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNav = (path: string) => {
    if (onNavigate) {
      onNavigate(path);
    } else {
      window.location.href = path;
    }
  };

  return (
    <div className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden scroll-smooth bg-[#050505] text-white selection:bg-white/10" style={{ fontFamily: "'Red Hat Display', -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif" }}>
      {/* Navigation — mirrors LandingPage nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#050505]/90 backdrop-blur-lg py-4 border-b border-white/5 shadow-lg" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
        <div className="w-full px-6 md:px-12 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => handleNav('/')}>
            <ContndrLogo className="h-4 lg:h-5 w-auto text-white" stroke="#050505" strokeWidth="6" />
          </div>

          <div className="hidden md:flex items-center gap-10 text-sm font-medium text-zinc-400">
            <button onClick={() => handleNav('/#features')} className="hover:text-white transition-colors">Features</button>
            <button onClick={() => handleNav('/blog')} className="text-white transition-colors">Blog</button>
            <button onClick={() => handleNav('/#pricing')} className="hover:text-white transition-colors">Pricing</button>
            <a href="https://calendly.com/ax-contndr/30min?month=2026-02" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Book Demo</a>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <button onClick={onLogin} className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">Log in</button>
            <button onClick={onGetStarted} className="bg-white text-black px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-zinc-200 transition-colors">
              Get Started
            </button>
          </div>

          <button className="md:hidden p-2 text-white" onClick={() => setMobileMenuOpen(true)}>
            <Menu />
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center p-6 md:hidden">
          <button className="absolute right-6 p-2 text-zinc-500 hover:text-white transition-colors" style={{ top: 'calc(2rem + env(safe-area-inset-top, 0px))' }} onClick={() => setMobileMenuOpen(false)}>
            <X className="w-8 h-8" />
          </button>
          <div className="flex flex-col gap-8 text-2xl font-medium text-center w-full max-w-sm">
            <button onClick={() => { setMobileMenuOpen(false); handleNav('/'); }} className="text-zinc-300 hover:text-white transition-colors">Home</button>
            <button onClick={() => { setMobileMenuOpen(false); handleNav('/blog'); }} className="text-white transition-colors">Blog</button>
            <button onClick={() => { setMobileMenuOpen(false); handleNav('/#pricing'); }} className="text-zinc-300 hover:text-white transition-colors">Pricing</button>
            <a href="https://calendly.com/ax-contndr/30min?month=2026-02" target="_blank" rel="noopener noreferrer" onClick={() => setMobileMenuOpen(false)} className="text-zinc-300 hover:text-white transition-colors">Book Demo</a>
            <div className="h-px bg-zinc-100 dark:bg-zinc-900 w-full my-2" />
            <button onClick={onLogin} className="text-zinc-300 hover:text-white transition-colors">Log in</button>
            <button onClick={onGetStarted} className="bg-white hover:bg-zinc-200 text-black py-4 rounded-xl text-center font-semibold transition-colors">Get Started</button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="pt-[72px]">
        {children}
      </div>

      <LandingFooter onNavigate={handleNav} />
    </div>
  );
}
