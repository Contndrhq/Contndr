/**
 * Premium skeleton loading screens for each major view.
 * These provide instant visual feedback while components lazy-load,
 * dramatically improving perceived performance.
 */

import { memo } from 'react';

// Shared pulse animation block
function Bone({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-zinc-200 dark:bg-zinc-100 dark:bg-zinc-900 animate-pulse skeleton-shimmer ${className}`}
    />
  );
}

// ─── Dashboard Skeleton ────────────────────────────────────────────
export const DashboardSkeleton = memo(function DashboardSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-8 view-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-48" />
          <Bone className="h-4 w-72" />
        </div>
        <Bone className="h-10 w-32 rounded-full" />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <Bone className="h-4 w-20" />
              <Bone className="h-8 w-8 rounded-lg" />
            </div>
            <Bone className="h-8 w-24" />
            <Bone className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
          <Bone className="h-5 w-32" />
          <Bone className="h-48 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
          <Bone className="h-5 w-40" />
          <Bone className="h-48 w-full rounded-xl" />
        </div>
      </div>

      {/* Recent activity */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
        <Bone className="h-5 w-36" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Bone className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-1/2" />
            </div>
            <Bone className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── CRM / Leads Table Skeleton ─────────────────────────────────────
export const CRMSkeleton = memo(function CRMSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-32" />
          <Bone className="h-4 w-56" />
        </div>
        <div className="flex gap-3">
          <Bone className="h-10 w-28 rounded-lg" />
          <Bone className="h-10 w-32 rounded-full" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Bone className="h-10 flex-1 max-w-sm rounded-lg" />
        <Bone className="h-10 w-28 rounded-lg" />
        <Bone className="h-10 w-28 rounded-lg" />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Table header */}
        <div className="bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 px-6 py-3 flex items-center gap-4 border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800">
          <Bone className="h-4 w-4 rounded" />
          <Bone className="h-4 w-40" />
          <Bone className="h-4 w-32 ml-auto" />
          <Bone className="h-4 w-24" />
          <Bone className="h-4 w-20" />
        </div>
        {/* Table rows */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="px-6 py-4 flex items-center gap-4 border-b border-zinc-100 dark:border-white/[0.03]"
          >
            <Bone className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-48" />
              <Bone className="h-3 w-32" />
            </div>
            <Bone className="h-6 w-24 rounded-full" />
            <Bone className="h-4 w-20" />
            <Bone className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Campaigns Skeleton ─────────────────────────────────────────────
export const CampaignsSkeleton = memo(function CampaignsSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-40" />
          <Bone className="h-4 w-64" />
        </div>
        <Bone className="h-10 w-36 rounded-full" />
      </div>

      {/* Campaign cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <Bone className="h-5 w-32" />
              <Bone className="h-6 w-16 rounded-full" />
            </div>
            <div className="space-y-2">
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-2/3" />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Bone className="h-8 w-16 rounded-lg" />
              <Bone className="h-8 w-16 rounded-lg" />
              <Bone className="h-8 w-16 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Analytics Skeleton ─────────────────────────────────────────────
export const AnalyticsSkeleton = memo(function AnalyticsSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-8 view-enter">
      <div className="space-y-2">
        <Bone className="h-8 w-40" />
        <Bone className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-3">
            <Bone className="h-4 w-20" />
            <Bone className="h-8 w-24" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
        <Bone className="h-5 w-48" />
        <Bone className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
});

// ─── Inbox Skeleton ─────────────────────────────────────────────────
export const InboxSkeleton = memo(function InboxSkeleton() {
  return (
    <div className="h-full flex view-enter">
      {/* Sidebar list */}
      <div className="w-80 border-r border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <Bone className="h-10 w-full rounded-lg" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 p-3">
            <Bone className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      {/* Content */}
      <div className="flex-1 p-8 space-y-6">
        <div className="flex items-center gap-4">
          <Bone className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Bone className="h-5 w-40" />
            <Bone className="h-3 w-60" />
          </div>
        </div>
        <Bone className="h-px w-full" />
        <div className="space-y-4">
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-5/6" />
          <Bone className="h-4 w-2/3" />
          <Bone className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
});

// ─── Settings Skeleton ──────────────────────────────────────────────
export const SettingsSkeleton = memo(function SettingsSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-8 view-enter">
      <div className="space-y-2">
        <Bone className="h-8 w-32" />
        <Bone className="h-4 w-56" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bone key={i} className="h-9 w-24 rounded-lg" />
        ))}
      </div>

      {/* Settings form */}
      <div className="max-w-2xl space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Bone className="h-4 w-24" />
            <Bone className="h-10 w-full rounded-lg" />
          </div>
        ))}
        <Bone className="h-10 w-32 rounded-full" />
      </div>
    </div>
  );
});

// ─── AI Calls Skeleton ───────────────────────────────────────────────
export const AiCallsSkeleton = memo(function AiCallsSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-36" />
          <Bone className="h-4 w-60" />
        </div>
        <Bone className="h-10 w-40 rounded-full" />
      </div>

      {/* Live call banner */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 flex items-center gap-4">
        <Bone className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Bone className="h-5 w-48" />
          <Bone className="h-3 w-32" />
        </div>
        <Bone className="h-9 w-24 rounded-full" />
        <Bone className="h-9 w-24 rounded-full" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-3">
            <Bone className="h-4 w-20" />
            <Bone className="h-8 w-16" />
            <Bone className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Campaign list */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="bg-zinc-50 dark:bg-zinc-50 dark:bg-zinc-950 px-6 py-3 flex items-center gap-4 border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800">
          <Bone className="h-4 w-40" />
          <Bone className="h-4 w-24 ml-auto" />
          <Bone className="h-4 w-20" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-6 py-4 flex items-center gap-4 border-b border-zinc-100 dark:border-white/[0.03]">
            <Bone className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-44" />
              <Bone className="h-3 w-28" />
            </div>
            <Bone className="h-6 w-20 rounded-full" />
            <Bone className="h-8 w-8 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Revenue Skeleton ────────────────────────────────────────────────
export const RevenueSkeleton = memo(function RevenueSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-8 view-enter">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-36" />
          <Bone className="h-4 w-64" />
        </div>
        <div className="flex gap-3">
          <Bone className="h-10 w-28 rounded-lg" />
          <Bone className="h-10 w-32 rounded-lg" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Bone className="h-4 w-20" />
              <Bone className="h-7 w-7 rounded-lg" />
            </div>
            <Bone className="h-9 w-28" />
            <Bone className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Main chart */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Bone className="h-5 w-40" />
          <div className="flex gap-2">
            {['7d','30d','90d'].map(k => <Bone key={k} className="h-8 w-12 rounded-lg" />)}
          </div>
        </div>
        <Bone className="h-64 w-full rounded-xl" />
      </div>

      {/* Two-col section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[0,1].map(i => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
            <Bone className="h-5 w-36" />
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between">
                <Bone className="h-4 w-36" />
                <Bone className="h-4 w-20" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Pipeline Skeleton ───────────────────────────────────────────────
export const PipelineSkeleton = memo(function PipelineSkeleton() {
  const cols = [5, 3, 4, 2, 3];
  return (
    <div className="h-full flex flex-col view-enter">
      {/* Header */}
      <div className="px-6 py-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-200 dark:border-zinc-800">
        <div className="space-y-1.5">
          <Bone className="h-7 w-32" />
          <Bone className="h-4 w-52" />
        </div>
        <div className="flex gap-3">
          <Bone className="h-10 w-28 rounded-lg" />
          <Bone className="h-10 w-36 rounded-full" />
        </div>
      </div>
      {/* Kanban */}
      <div className="flex-1 overflow-x-auto px-6 py-5">
        <div className="flex gap-4 h-full min-w-max">
          {cols.map((count, ci) => (
            <div key={ci} className="w-64 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Bone className="h-5 w-24" />
                <Bone className="h-5 w-8 rounded-full" />
              </div>
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-4 space-y-3">
                  <Bone className="h-4 w-36" />
                  <Bone className="h-3 w-24" />
                  <div className="flex items-center gap-2 pt-1">
                    <Bone className="h-6 w-6 rounded-full" />
                    <Bone className="h-3 w-20" />
                    <Bone className="h-5 w-16 rounded-full ml-auto" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ─── Intent (Buying Signals) Skeleton ──────────────────────────────
export const IntentSkeleton = memo(function IntentSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-44" />
          <Bone className="h-4 w-72" />
        </div>
        <Bone className="h-10 w-32 rounded-full" />
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-3">
            <Bone className="h-4 w-24" />
            <Bone className="h-9 w-16" />
            <Bone className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>

      {/* Signal feed */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Bone className="h-5 w-36" />
          <Bone className="h-8 w-24 rounded-lg" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 py-3 border-b border-zinc-100 dark:border-white/[0.03] last:border-0">
            <Bone className="h-10 w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Bone className="h-4 w-36" />
                <Bone className="h-5 w-16 rounded-full" />
              </div>
              <Bone className="h-3 w-56" />
            </div>
            <Bone className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Social Hub Skeleton ─────────────────────────────────────────────
export const SocialSkeleton = memo(function SocialSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-36" />
          <Bone className="h-4 w-60" />
        </div>
        <Bone className="h-10 w-36 rounded-full" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-9 w-28 rounded-lg" />
        ))}
      </div>

      {/* Platform cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <Bone className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Bone className="h-4 w-28" />
                <Bone className="h-3 w-20" />
              </div>
              <Bone className="h-6 w-16 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[0,1,2].map(j => (
                <div key={j} className="space-y-1.5 text-center">
                  <Bone className="h-6 w-full" />
                  <Bone className="h-3 w-full" />
                </div>
              ))}
            </div>
            <Bone className="h-20 w-full rounded-xl" />
          </div>
        ))}
      </div>

      {/* Content scheduler */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Bone className="h-5 w-40" />
          <Bone className="h-9 w-28 rounded-lg" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <Bone className="h-8 w-8 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-52" />
              <Bone className="h-3 w-32" />
            </div>
            <Bone className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Team / Leaderboard Skeleton ─────────────────────────────────────
export const TeamSkeleton = memo(function TeamSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-36" />
          <Bone className="h-4 w-56" />
        </div>
        <Bone className="h-10 w-32 rounded-full" />
      </div>

      {/* Top-3 podium */}
      <div className="flex items-end justify-center gap-4 py-4">
        {[2, 1, 3].map((rank, i) => (
          <div key={i} className={`flex flex-col items-center gap-2 ${rank === 1 ? 'order-2' : rank === 2 ? 'order-1' : 'order-3'}`}>
            <Bone className={`rounded-full ${rank === 1 ? 'h-16 w-16' : 'h-12 w-12'}`} />
            <Bone className="h-4 w-20" />
            <Bone className={`w-20 rounded-t-xl ${rank === 1 ? 'h-24' : rank === 2 ? 'h-16' : 'h-12'}`} />
          </div>
        ))}
      </div>

      {/* Leaderboard rows */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-6 py-4 flex items-center gap-4 border-b border-zinc-100 dark:border-white/[0.03] last:border-0">
            <Bone className="h-6 w-6 rounded-full shrink-0" />
            <Bone className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-36" />
              <Bone className="h-3 w-24" />
            </div>
            <Bone className="h-4 w-16" />
            <Bone className="h-4 w-16" />
            <Bone className="h-7 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Automations Skeleton ────────────────────────────────────────────
export const AutomationsSkeleton = memo(function AutomationsSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-8 w-40" />
          <Bone className="h-4 w-64" />
        </div>
        <Bone className="h-10 w-36 rounded-full" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[0,1,2].map(i => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-3">
            <Bone className="h-4 w-24" />
            <Bone className="h-8 w-16" />
          </div>
        ))}
      </div>

      {/* Rule cards */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-4">
          <div className="flex items-start gap-4">
            <Bone className="h-10 w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <Bone className="h-5 w-40" />
                <Bone className="h-5 w-16 rounded-full" />
              </div>
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-3/4" />
            </div>
            <div className="flex gap-2 shrink-0">
              <Bone className="h-8 w-16 rounded-lg" />
              <Bone className="h-8 w-20 rounded-lg" />
            </div>
          </div>
          {/* Trigger + action row */}
          <div className="flex items-center gap-3 pt-1">
            <Bone className="h-6 w-28 rounded-full" />
            <Bone className="h-4 w-4" />
            <Bone className="h-6 w-28 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
});

// ─── Lead Finder Skeleton ─────────────────────────────────────────────
export const LeadFinderSkeleton = memo(function LeadFinderSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      <div className="space-y-2">
        <Bone className="h-8 w-44" />
        <Bone className="h-4 w-72" />
      </div>

      {/* Search bar */}
      <div className="flex gap-3">
        <Bone className="h-12 flex-1 rounded-xl" />
        <Bone className="h-12 w-32 rounded-xl" />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bone key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      {/* Result cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <Bone className="h-12 w-12 rounded-xl shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Bone className="h-5 w-40" />
                <Bone className="h-3 w-28" />
                <Bone className="h-3 w-36" />
              </div>
              <Bone className="h-8 w-20 rounded-full shrink-0" />
            </div>
            <div className="flex gap-2">
              <Bone className="h-5 w-20 rounded-full" />
              <Bone className="h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Generic Skeleton (fallback) ────────────────────────────────────
export const GenericSkeleton = memo(function GenericSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 space-y-6 view-enter">
      <div className="space-y-2">
        <Bone className="h-8 w-48" />
        <Bone className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-50 dark:bg-zinc-950 p-6 space-y-4">
            <Bone className="h-5 w-32" />
            <Bone className="h-32 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
});
