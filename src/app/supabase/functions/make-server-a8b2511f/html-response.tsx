/**
 * Shared HTML response helper for OAuth callback pages.
 *
 * Hono's `c.html()` sometimes fails to set Content-Type to text/html in
 * Supabase Edge Function environments, causing browsers to render raw HTML
 * source as plain text.  Using `new Response()` directly guarantees the
 * correct Content-Type header.
 */
export const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
