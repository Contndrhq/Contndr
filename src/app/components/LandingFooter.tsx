import { ContndrLogo } from './ContndrLogo';
import { Instagram, Linkedin } from 'lucide-react';
import { ContndrWatermark } from './ContndrWatermark';

// Custom X (Twitter) icon
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// Custom TikTok icon (lucide-react doesn't have TikTok)
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      width="20" 
      height="20" 
      viewBox="0 0 24 24" 
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

interface LandingFooterProps {
  onNavigate?: (path: string) => void;
}

export function LandingFooter({ onNavigate }: LandingFooterProps) {
  const handleNav = (path: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
    }
    if (onNavigate) {
      onNavigate(path);
    } else {
      window.location.href = path;
    }
  };

  return (
    <footer className="relative py-24 px-6 overflow-hidden bg-[#050505] text-white">
      {/* Background Video */}
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
        <video
          src="https://zylftkvcasvznhkmyzfj.supabase.co/storage/v1/object/public/assets/web%20loop%20-%20footer.MP4"
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/50 to-transparent" />
      </div>

      <div className="relative z-10 max-w-[1600px] mx-auto bg-[#0A0A0A]/80 backdrop-blur-2xl border border-white/10 rounded-[3rem] p-12 md:p-20 overflow-hidden shadow-2xl">
        {/* Brand mark watermark */}
        <ContndrWatermark variant="dark" />

        <div className="relative z-[1] grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24 mb-20">
          {/* Left Column */}
          <div className="flex flex-col items-start">
            <ContndrLogo className="h-4 lg:h-5 w-auto text-white mb-8" stroke="#0A0A0A" strokeWidth="6" />
            <p className="text-lg md:text-xl font-medium text-gray-500 max-w-xs">
              Close more deals. Touch fewer buttons.
            </p>
          </div>

          {/* Right Column - Navigation */}
          <div className="flex flex-col sm:flex-row gap-16 md:gap-32 md:justify-end">
            <div>
              <h4 className="font-bold text-white mb-8 text-sm uppercase tracking-wider opacity-80">Product</h4>
              <ul className="space-y-6 text-gray-400 font-medium">
                <li><a href="/" onClick={(e) => handleNav('/', e)} className="hover:text-white transition-colors">Home</a></li>
                <li><a href="/#features" onClick={(e) => handleNav('/#features', e)} className="hover:text-white transition-colors">Features</a></li>
                <li><a href="/#pricing" onClick={(e) => handleNav('/#pricing', e)} className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="https://calendly.com/ax-contndr/30min?month=2026-02" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Book Demo</a></li>
                <li><a href="/security" onClick={(e) => handleNav('/security', e)} className="hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-8 text-sm uppercase tracking-wider opacity-80">Company</h4>
              <ul className="space-y-6 text-gray-400 font-medium">
                <li><a href="/about" onClick={(e) => handleNav('/about', e)} className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="/careers" onClick={(e) => handleNav('/careers', e)} className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="/blog" onClick={(e) => handleNav('/blog', e)} className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="/contact" onClick={(e) => handleNav('/contact', e)} className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="relative z-[1] pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-6 text-sm text-gray-500 font-medium">
          <div className="flex flex-wrap gap-6 justify-center md:justify-start">
            <span>&copy; 2026 Contndr Labs Inc. All rights reserved.</span>
            <a href="/privacy" onClick={(e) => handleNav('/privacy', e)} className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="/terms" onClick={(e) => handleNav('/terms', e)} className="hover:text-white transition-colors">Terms of Use</a>
            <div className="flex gap-4 ml-4">
              <a href="https://www.linkedin.com/company/contndr" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors" aria-label="Follow us on LinkedIn">
                <Linkedin className="w-5 h-5" />
              </a>
              <a href="https://www.tiktok.com/@contndrhq" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors" aria-label="Follow us on TikTok">
                <TikTokIcon className="w-5 h-5" />
              </a>
              <a href="https://www.instagram.com/contndrhq" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors" aria-label="Follow us on Instagram">
                <Instagram className="w-5 h-5" />
              </a>
              <a href="https://x.com/contndrhq" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors" aria-label="Follow us on X">
                <XIcon className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}