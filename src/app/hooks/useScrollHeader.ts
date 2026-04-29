import { useEffect, useRef, useState } from 'react';

/**
 * Hook to hide header on scroll down, show on scroll up.
 * Returns a ref to attach to the scrollable container and a className for the header.
 * 
 * @param threshold - Scroll distance (px) before toggling header visibility (default: 5)
 * @param mobileOnly - If true, only applies on mobile (<1024px) (default: true)
 * @returns {object} - { scrollRef, headerClass }
 */
export function useScrollHeader(threshold = 5, mobileOnly = true) {
  const [isHidden, setIsHidden] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const currentScrollY = container.scrollTop;
      
      // Skip if scroll is at the very top
      if (currentScrollY < threshold) {
        setIsHidden(false);
        lastScrollY.current = currentScrollY;
        return;
      }

      // Scrolling down
      if (currentScrollY > lastScrollY.current + threshold) {
        setIsHidden(true);
      }
      // Scrolling up
      else if (currentScrollY < lastScrollY.current - threshold) {
        setIsHidden(false);
      }

      lastScrollY.current = currentScrollY;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [threshold]);

  const baseClass = mobileOnly ? 'scroll-header-mobile' : 'scroll-header';
  const headerClass = isHidden ? `${baseClass} hidden` : baseClass;

  return { scrollRef, headerClass, isHidden };
}
