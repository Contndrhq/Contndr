import { blogPosts } from '../data/blog-posts';

/**
 * Generates a comprehensive sitemap XML for Contndr
 * Includes: static pages, dynamic blog posts, image sitemaps
 * 
 * Usage:
 *   - Run `downloadSitemap()` from browser console to export
 *   - Call `generateSitemap()` from server to serve dynamically
 *   - Use `getAllPublicUrls()` for prerendering or testing
 */

export interface SitemapUrl {
  loc: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
  images?: SitemapImage[];
}

export interface SitemapImage {
  loc: string;
  title: string;
  caption?: string;
}

const BASE_URL = 'https://contndr.com';

/**
 * Returns today's date in ISO format (YYYY-MM-DD)
 */
function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Converts a readable date string like "February 1, 2026" to ISO format "2026-02-01"
 */
function convertDateToISOFormat(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return today();
    }
    return date.toISOString().split('T')[0];
  } catch {
    return today();
  }
}

/**
 * Escapes special XML characters in a string
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds the complete list of URLs for the sitemap
 */
export function getSitemapUrls(): SitemapUrl[] {
  const todayStr = today();

  const urls: SitemapUrl[] = [
    // ── Homepage ─────────────────────────────────────
    {
      loc: `${BASE_URL}/`,
      lastmod: todayStr,
      changefreq: 'weekly',
      priority: 1.0,
      images: [
        {
          loc: `${BASE_URL}/og-image.png`,
          title: 'Contndr - Sales Automation Platform',
          caption: 'All-in-one sales operating system replacing Salesforce, Apollo, Instantly, Calendly, and Outreach',
        },
      ],
    },

    // ── Company pages ────────────────────────────────
    {
      loc: `${BASE_URL}/about`,
      lastmod: todayStr,
      changefreq: 'monthly',
      priority: 0.8,
    },
    {
      loc: `${BASE_URL}/security`,
      lastmod: todayStr,
      changefreq: 'monthly',
      priority: 0.7,
    },
    {
      loc: `${BASE_URL}/contact`,
      lastmod: todayStr,
      changefreq: 'monthly',
      priority: 0.7,
    },
    {
      loc: `${BASE_URL}/careers`,
      lastmod: todayStr,
      changefreq: 'weekly',
      priority: 0.6,
    },

    // ── Blog index ───────────────────────────────────
    {
      loc: `${BASE_URL}/blog`,
      lastmod: todayStr,
      changefreq: 'weekly',
      priority: 0.9,
    },

    // ── Blog posts (dynamic from data) ───────────────
    ...blogPosts.map(post => ({
      loc: `${BASE_URL}/blog/${post.slug}`,
      lastmod: convertDateToISOFormat(post.date),
      changefreq: 'monthly' as const,
      priority: 0.7,
      images: post.image
        ? [
            {
              loc: post.image,
              title: post.title,
              caption: post.excerpt,
            },
          ]
        : undefined,
    })),

    // ── Legal pages ──────────────────────────────────
    {
      loc: `${BASE_URL}/privacy`,
      lastmod: '2026-01-29',
      changefreq: 'yearly',
      priority: 0.3,
    },
    {
      loc: `${BASE_URL}/terms`,
      lastmod: '2026-01-29',
      changefreq: 'yearly',
      priority: 0.3,
    },
  ];

  return urls;
}

/**
 * Generates the full sitemap XML string
 */
export function generateSitemap(): string {
  const urls = getSitemapUrls();

  const urlEntries = urls
    .map(url => {
      let entry = `
  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>`;

      if (url.images?.length) {
        for (const img of url.images) {
          entry += `
    <image:image>
      <image:loc>${escapeXml(img.loc)}</image:loc>
      <image:title>${escapeXml(img.title)}</image:title>${
            img.caption
              ? `
      <image:caption>${escapeXml(img.caption)}</image:caption>`
              : ''
          }
    </image:image>`;
        }
      }

      entry += `
  </url>`;
      return entry;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">${urlEntries}
</urlset>`;
}

/**
 * Get all public URLs for the application (path-only, no domain)
 * Useful for prerendering, testing, or link checking
 */
export function getAllPublicUrls(): string[] {
  return [
    '/',
    '/about',
    '/security',
    '/contact',
    '/careers',
    '/blog',
    ...blogPosts.map(post => `/blog/${post.slug}`),
    '/privacy',
    '/terms',
  ];
}

/**
 * Returns the total count of indexable pages
 */
export function getIndexablePageCount(): number {
  return getSitemapUrls().length;
}

/**
 * Export sitemap as downloadable file (for debugging in browser console)
 * Usage: import { downloadSitemap } from './utils/sitemap-generator'; downloadSitemap();
 */
export function downloadSitemap(): void {
  const xml = generateSitemap();
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sitemap.xml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Validate sitemap URLs — checks for duplicates and malformed entries
 * Returns an array of warning strings (empty = all good)
 */
export function validateSitemap(): string[] {
  const urls = getSitemapUrls();
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    if (seen.has(url.loc)) {
      warnings.push(`Duplicate URL: ${url.loc}`);
    }
    seen.add(url.loc);

    if (url.priority < 0 || url.priority > 1) {
      warnings.push(`Invalid priority ${url.priority} for ${url.loc}`);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(url.lastmod)) {
      warnings.push(`Invalid lastmod format "${url.lastmod}" for ${url.loc}`);
    }
  }

  return warnings;
}
