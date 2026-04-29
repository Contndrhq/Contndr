import React from 'react';

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

export function PageShell({ children, className = '' }: PageShellProps) {
  return (
    <div className={`min-h-screen w-full bg-[var(--bg-page)] text-[var(--text-main)] relative overflow-hidden transition-colors duration-300 ${className}`}>
       {/* Dark Mode Gradient Glow - Emerald/Teal */}
       <div className="fixed top-0 left-0 w-full h-[500px] bg-gradient-to-b from-[#1ED4A7]/5 to-transparent opacity-0 dark:opacity-100 pointer-events-none transition-opacity duration-500" />
       
       {/* Main Content */}
       <div className="relative z-10">
         {children}
       </div>
    </div>
  );
}
