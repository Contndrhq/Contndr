import { useEffect } from 'react';

interface SEOHeadProps {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: 'website' | 'article';
  twitterCard?: 'summary' | 'summary_large_image';
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  section?: string;
  tags?: string[];
}

/**
 * SEO Head Component
 * Dynamically updates meta tags for different pages to improve SEO
 */
export function SEOHead({
  title = 'Contndr - Sales Automation Platform | Streamline Your Entire Sales Stack',
  description = 'The operating system for modern sales teams. Contndr works with the tools you already use to streamline prospecting, outreach, scheduling, and pipeline management in one platform.',
  keywords,
  canonical,
  ogTitle,
  ogDescription,
  ogImage = 'https://contndr.com/og-image.png',
  ogType = 'website',
  twitterCard = 'summary_large_image',
  publishedTime,
  modifiedTime,
  author,
  section,
  tags = [],
}: SEOHeadProps) {
  useEffect(() => {
    // Update document title
    document.title = title;

    // Helper function to update or create meta tags
    const updateMeta = (selector: string, attribute: string, content: string) => {
      let element = document.querySelector(selector);
      if (!element) {
        element = document.createElement('meta');
        if (attribute === 'name') {
          element.setAttribute('name', selector.replace('meta[name="', '').replace('"]', ''));
        } else if (attribute === 'property') {
          element.setAttribute('property', selector.replace('meta[property="', '').replace('"]', ''));
        }
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    // Update canonical URL
    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = canonical;
    }

    // Basic meta tags
    updateMeta('meta[name="description"]', 'name', description);
    if (keywords) {
      updateMeta('meta[name="keywords"]', 'name', keywords);
    }
    if (author) {
      updateMeta('meta[name="author"]', 'name', author);
    }

    // Open Graph
    updateMeta('meta[property="og:title"]', 'property', ogTitle || title);
    updateMeta('meta[property="og:description"]', 'property', ogDescription || description);
    updateMeta('meta[property="og:type"]', 'property', ogType);
    updateMeta('meta[property="og:image"]', 'property', ogImage);
    if (canonical) {
      updateMeta('meta[property="og:url"]', 'property', canonical);
    }

    // Article-specific Open Graph tags
    if (ogType === 'article') {
      if (publishedTime) {
        updateMeta('meta[property="article:published_time"]', 'property', publishedTime);
      }
      if (modifiedTime) {
        updateMeta('meta[property="article:modified_time"]', 'property', modifiedTime);
      }
      if (author) {
        updateMeta('meta[property="article:author"]', 'property', author);
      }
      if (section) {
        updateMeta('meta[property="article:section"]', 'property', section);
      }
      // Add tags
      tags.forEach((tag, index) => {
        const selector = `meta[property="article:tag"][content="${tag}"]`;
        let element = document.querySelector(selector);
        if (!element) {
          element = document.createElement('meta');
          element.setAttribute('property', 'article:tag');
          element.setAttribute('content', tag);
          document.head.appendChild(element);
        }
      });
    }

    // Twitter
    updateMeta('meta[name="twitter:card"]', 'name', twitterCard);
    updateMeta('meta[name="twitter:title"]', 'name', ogTitle || title);
    updateMeta('meta[name="twitter:description"]', 'name', ogDescription || description);
    updateMeta('meta[name="twitter:image"]', 'name', ogImage);
    if (canonical) {
      updateMeta('meta[name="twitter:url"]', 'name', canonical);
    }

    // Cleanup function
    return () => {
      // Reset to default title when component unmounts
      document.title = 'Contndr - Sales Automation Platform';
    };
  }, [title, description, keywords, canonical, ogTitle, ogDescription, ogImage, ogType, twitterCard, publishedTime, modifiedTime, author, section, tags]);

  return null;
}