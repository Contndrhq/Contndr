/**
 * Shared skeleton loaders for dashboard cards.
 *
 * Why: a centered spinner makes the whole card look stalled. Skeleton
 * placeholders in the rough shape of the eventual content feel ~2x faster
 * because the layout never shifts and the user immediately knows what kind
 * of content is loading.
 *
 * Two variants cover most cases:
 *   - <DashboardListSkeleton rows={4}/> for cards rendering a vertical list
 *     (Buying Signals, Pipeline, Team Snapshot)
 *   - <DashboardChartSkeleton/> for cards rendering a chart / heatmap
 *     (Engagement Heatmap, Campaign Metrics chart)
 */

interface ListProps {
  rows?: number;
  /** Show a leading icon block on each row. Default true (most lists have one). */
  withIcon?: boolean;
}

export function DashboardListSkeleton({ rows = 4, withIcon = true }: ListProps) {
  return (
    <div className="flex-1 min-h-0 space-y-2 -mx-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg">
          {withIcon && (
            <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 skeleton-shimmer flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div
              className="h-3 rounded bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 skeleton-shimmer"
              style={{ width: `${60 + ((i * 7) % 30)}%` }}
            />
            <div
              className="h-2.5 rounded bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 skeleton-shimmer"
              style={{ width: `${40 + ((i * 11) % 25)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardChartSkeleton() {
  // 7 vertical bars of varying heights — looks like the eventual chart
  // would, without revealing fake data.
  const heights = [40, 65, 30, 80, 55, 70, 45];
  return (
    <div className="flex-1 min-h-0 flex items-end gap-2 px-1 pb-1" aria-hidden="true">
      {heights.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-zinc-100 dark:bg-zinc-100 dark:bg-zinc-900 skeleton-shimmer"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}
