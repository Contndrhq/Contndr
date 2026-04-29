import { useEffect } from 'react';

const FAVICON_32 = 'https://zylftkvcasvznhkmyzfj.supabase.co/storage/v1/object/public/assets/Fav%20Icon%2032.png';
const FAVICON_180 = 'https://zylftkvcasvznhkmyzfj.supabase.co/storage/v1/object/public/assets/Fav%20icon%20180.png';

/**
 * Ensures the Contndr "C" mark favicon PNGs are applied.
 * Removes any stale/cached favicon links and re-applies the correct ones.
 */
export function useFavicon() {
  useEffect(() => {
    // Clear any existing favicon links to avoid conflicts
    document.querySelectorAll(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]'
    ).forEach((el) => el.remove());

    const addLink = (rel: string, href: string, type?: string, sizes?: string) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (type) link.type = type;
      if (sizes) link.setAttribute('sizes', sizes);
      document.head.appendChild(link);
    };

    addLink('icon', FAVICON_32, 'image/png', '32x32');
    addLink('shortcut icon', FAVICON_32, 'image/png');
    addLink('apple-touch-icon', FAVICON_180, 'image/png', '180x180');
  }, []);
}
