import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  onClick?: () => void;
}

export function GlassCard({ children, className = '', hoverEffect = false, onClick }: GlassCardProps) {
  return (
    <div 
      onClick={onClick}
      className={`
        bg-[var(--bg-surface)] 
        border border-[var(--border-color)] 
        rounded-2xl 
        shadow-sm dark:shadow-xl dark:backdrop-blur-xl 
        transition-all duration-300
        ${hoverEffect ? 'hover:border-gray-300 dark:hover:border-white/20 hover:-translate-y-0.5' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
