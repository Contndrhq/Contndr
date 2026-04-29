// Improved email scraper for lead discovery - STRICT email validation

/**
 * Scrapes REAL email addresses from a website
 * NO fake emails, NO placeholders, NO forms - only verified emails
 */
export async function scrapeRealEmail(website: string, businessName: string): Promise<string | null> {
  if (!website) return null;

  try {
    let baseUrl = website.trim();
    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
    
    // Check contact/about pages first (most reliable), then homepage
    const urlsToTry = [
      `${baseUrl}/contact`,
      `${baseUrl}/contact-us`,
      `${baseUrl}/contactus`,
      `${baseUrl}/contact.html`,
      `${baseUrl}/about`,
      `${baseUrl}/about-us`,
      baseUrl
    ];
    
    for (const url of urlsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 second timeout
        
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) continue;
        
        const html = await response.text();
        
        // STRICT email extraction regex
        const emailRegex = /\b([A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})\b/g;
        const matches = html.match(emailRegex) || [];
        
        // Filter out invalid/fake emails with COMPREHENSIVE rules
        const invalidPatterns = [
          // Image files
          '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
          // Fake/placeholder emails
          'example.com', 'example.org', 'test.com', 'domain.com', 'email.com', 
          'yourdomain.com', 'yoursite.com', 'yourcompany.com', 'youremail.com',
          'placeholder', 'dummy', 'sample',
          // Service emails (not business emails)
          'wix.com', 'wixpress.com', 'squarespace.com', 'wordpress.com', 
          'weebly.com', 'godaddy.com', 'hostgator.com', 'bluehost.com',
          'sentry.io', 'cloudflare.com', 'google.com', 'facebook.com', 
          'twitter.com', 'instagram.com', 'youtube.com', 'linkedin.com',
          'schema.org', 'w3.org', 'w3c.org', 'gravatar.com',
          // No-reply emails
          'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'bounce',
          // Retina image indicators
          '@2x', '@3x', '@4x',
          // Common spam/invalid patterns
          'mailto:', 'javascript:', 'test@', 'user@', 'admin@localhost',
          'support@localhost', 'webmaster@localhost'
        ];
        
        const validEmails = matches
          .map(e => e.toLowerCase().trim())
          .filter(e => {
            // Must not contain invalid patterns
            if (invalidPatterns.some(pattern => e.includes(pattern))) return false;
            
            // Must have valid email format
            if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i.test(e)) return false;
            
            // Check valid TLD length
            const tld = e.split('.').pop() || '';
            if (tld.length < 2 || tld.length > 10) return false;
            
            // Reasonable total length
            if (e.length > 100 || e.length < 6) return false;
            
            // Must not end with image extension
            if (/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/i.test(e)) return false;
            
            // Must not have multiple @ symbols
            if ((e.match(/@/g) || []).length !== 1) return false;
            
            return true;
          });
        
        if (validEmails.length > 0) {
          // Prioritize SPECIFIC decision-maker emails over generic ones
          const genericPatterns = ['info@', 'contact@', 'hello@', 'sales@', 'support@', 'admin@', 'office@', 'inquiries@', 'careers@', 'jobs@', 'billing@', 'accounts@', 'hr@', 'team@'];
          
          // Get unique emails only
          const uniqueEmails = [...new Set(validEmails)];
          
          // Sort: Specific emails first, Generic emails last
          uniqueEmails.sort((a, b) => {
            const aGeneric = genericPatterns.some(p => a.startsWith(p));
            const bGeneric = genericPatterns.some(p => b.startsWith(p));
            
            if (aGeneric && !bGeneric) return 1; // a is generic, move to end
            if (!aGeneric && bGeneric) return -1; // b is generic, move to end
            return 0;
          });
          
          const foundEmail = uniqueEmails[0];
          
          console.log(`    ✓ Found real email on ${url}: ${foundEmail}`);
          return foundEmail;
        }
      } catch (e) {
        // Timeout or fetch error, continue to next URL
        continue;
      }
    }
    
    console.log(`    ✗ No real email found for ${businessName}`);
    return null;
    
  } catch (error) {
    console.log(`    ✗ Error scraping ${website}: ${error.message}`);
    return null;
  }
}
