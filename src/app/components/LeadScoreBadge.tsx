import React from 'react';

interface LeadScoreBadgeProps {
  score?: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function LeadScoreBadge({ score, showLabel = true, size = 'md' }: LeadScoreBadgeProps) {
  if (score === undefined || score === null) {
    return null;
  }

  const getScoreColor = (score: number): string => {
    if (score >= 61) return 'bg-[#1ED4A7]/10 text-[#1ED4A7] border-[#1ED4A7]/20';
    if (score >= 30) return 'bg-zinc-500/10 text-zinc-400 dark:text-zinc-400 border-zinc-500/20';
    return 'bg-zinc-100 dark:bg-zinc-800/40 text-zinc-400 dark:text-zinc-500 border-zinc-200/60 dark:border-zinc-700/40';
  };

  const getScoreGrade = (score: number): string => {
    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'A-';
    if (score >= 75) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 65) return 'B-';
    if (score >= 60) return 'C+';
    if (score >= 55) return 'C';
    if (score >= 50) return 'C-';
    if (score >= 40) return 'D';
    return 'F';
  };

  const getScoreLabel = (score: number): string => {
    if (score >= 80) return 'Hot';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Low';
  };

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-[11px] gap-1.5',
    lg: 'px-2.5 py-1 text-[12px] gap-2'
  };

  return (
    <div
      className={`inline-flex items-center rounded-md border font-medium ${getScoreColor(score)} ${sizeClasses[size]}`}
      title={`Lead Score: ${score}/100 (${getScoreGrade(score)}) - ${getScoreLabel(score)} quality lead`}
    >
      <span className="font-bold">{score}</span>
      {showLabel && size !== 'sm' && (
        <>
          <span className="opacity-60">•</span>
          <span>{getScoreGrade(score)}</span>
        </>
      )}
    </div>
  );
}