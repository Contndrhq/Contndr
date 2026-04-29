import { useRef, useState, useEffect, useCallback, CSSProperties } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
}

/**
 * Virtual scrolling list component
 * Only renders visible items + overscan for smooth scrolling
 * Dramatically improves performance for lists with 100+ items
 */
export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
  className = '',
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = items.length * itemHeight;
  
  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative',
      }}
      onScroll={handleScroll}
    >
      {/* Spacer to maintain scroll height */}
      <div style={{ height: totalHeight, width: '100%', position: 'relative' }}>
        {/* Visible items container */}
        <div
          style={{
            position: 'absolute',
            top: offsetY,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, index) => (
            <div key={startIndex + index} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for virtual scrolling with dynamic item heights
 */
interface VirtualScrollOptions {
  itemCount: number;
  estimatedItemHeight: number;
  overscan?: number;
}

export function useVirtualScroll({
  itemCount,
  estimatedItemHeight,
  overscan = 3,
}: VirtualScrollOptions) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeights = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const setItemHeight = useCallback((index: number, height: number) => {
    itemHeights.current.set(index, height);
  }, []);

  const getItemOffset = (index: number): number => {
    let offset = 0;
    for (let i = 0; i < index; i++) {
      offset += itemHeights.current.get(i) || estimatedItemHeight;
    }
    return offset;
  };

  const getTotalHeight = (): number => {
    let height = 0;
    for (let i = 0; i < itemCount; i++) {
      height += itemHeights.current.get(i) || estimatedItemHeight;
    }
    return height;
  };

  // Binary search to find start index
  const getStartIndex = (): number => {
    let low = 0;
    let high = itemCount - 1;
    
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const offset = getItemOffset(mid);
      
      if (offset === scrollTop) return mid;
      if (offset < scrollTop) low = mid + 1;
      else high = mid - 1;
    }
    
    return Math.max(0, high - overscan);
  };

  const getEndIndex = (): number => {
    const startIndex = getStartIndex();
    let offset = getItemOffset(startIndex);
    let index = startIndex;
    
    while (offset < scrollTop + containerHeight && index < itemCount) {
      offset += itemHeights.current.get(index) || estimatedItemHeight;
      index++;
    }
    
    return Math.min(itemCount, index + overscan);
  };

  const visibleRange = {
    start: getStartIndex(),
    end: getEndIndex(),
  };

  return {
    containerRef,
    handleScroll,
    setItemHeight,
    visibleRange,
    totalHeight: getTotalHeight(),
    offsetY: getItemOffset(visibleRange.start),
  };
}
