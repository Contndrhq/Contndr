// Web scraper utility for extracting emails from websites

/**
 * Extracts email addresses from a website
 * @param website - The website URL to scrape
 * @returns Array of unique email addresses found
 */
export async function scrapeEmailsFromWebsite(website: string): Promise<string[]> {
  if (!website) return [];

  try {
    // Normalize URL
    const url = website.startsWith('http') ? website : `https://${website}`;
    const baseUrl = new URL(url);

    // Pages to check for email addresses - contact pages FIRST (they're most reliable)
    const pagesToCheck = [
      `${baseUrl.origin}/contact`,
      `${baseUrl.origin}/contact-us`,
      `${baseUrl.origin}/contactus`,
      `${baseUrl.origin}/contact-us.html`,
      `${baseUrl.origin}/get-in-touch`,
      `${baseUrl.origin}/about`,
      `${baseUrl.origin}/about-us`,
      url, // Homepage last (often has more junk emails)
    ];

    const foundEmails = new Set<string>();
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;

    // Try to fetch each page
    for (const pageUrl of pagesToCheck) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) continue;

        const html = await response.text();

        // Extract emails using regex
        const matches = html.match(emailRegex);
        if (matches) {
          matches.forEach(email => {
            // Clean up the email
            const cleanEmail = email.toLowerCase().trim();
            
            // Strict validation for emails
            const invalidPatterns = [
              '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
              'example.com', 'test.com', 'domain.com', 'email.com', 'yourdomain.com',
              'wix.com', 'wixpress.com', 'sentry.io', 'sentry.wixpress.com', 
              'schema.org', 'www.w3.org', 'wordpress.com', 'cloudflare.com', 
              'google.com', 'facebook.com', 'twitter.com', 'instagram.com', 
              'youtube.com', 'linkedin.com', 'noreply', 'no-reply', 'donotreply',
              '@2x.', '@3x.', 'placeholder', 'dummy',
            ];
            
            // Check for invalid patterns
            const hasInvalidPattern = invalidPatterns.some(pattern => cleanEmail.includes(pattern));
            
            // Verify proper email format
            const properFormat = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i.test(cleanEmail);
            
            // Check TLD validity
            const tld = cleanEmail.split('.').pop() || '';
            const validTld = tld.length >= 2 && tld.length <= 10;
            
            // Filter criteria
            if (
              !hasInvalidPattern &&
              properFormat &&
              validTld &&
              cleanEmail.length < 100 // Reasonable email length
            ) {
              foundEmails.add(cleanEmail);
            }
          });
        }

        // If we found emails on this page, we can stop searching
        if (foundEmails.size > 0) {
          console.log(`Found ${foundEmails.size} emails on ${pageUrl}`);
          break;
        }
      } catch (error) {
        // Continue to next page if this one fails
        console.log(`Failed to fetch ${pageUrl}:`, error.message);
        continue;
      }
    }

    // Return emails as array
    const emails = Array.from(foundEmails);
    
    // Prioritize certain email patterns (info, contact, hello, sales come first)
    const priorityPatterns = ['info@', 'contact@', 'hello@', 'sales@', 'support@'];
    emails.sort((a, b) => {
      const aPriority = priorityPatterns.findIndex(p => a.startsWith(p));
      const bPriority = priorityPatterns.findIndex(p => b.startsWith(p));
      
      if (aPriority !== -1 && bPriority === -1) return -1;
      if (bPriority !== -1 && aPriority === -1) return 1;
      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      
      return a.localeCompare(b);
    });

    return emails;
  } catch (error) {
    console.error(`Error scraping emails from ${website}:`, error);
    return [];
  }
}

/**
 * Gets the best email address for a lead
 * First tries to scrape from website, then falls back to generated patterns
 */
export async function getBestEmailForLead(
  website: string,
  businessName: string,
  existingEmail?: string
): Promise<string | null> {
  // If we already have an email, return it
  if (existingEmail) return existingEmail;

  // Try to scrape email from website
  const scrapedEmails = await scrapeEmailsFromWebsite(website);
  if (scrapedEmails.length > 0) {
    console.log(`Found scraped email for ${businessName}: ${scrapedEmails[0]}`);
    return scrapedEmails[0]; // Return the highest priority email
  }

  // Fallback to generated pattern if scraping fails
  if (website) {
    try {
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      const domain = url.hostname.replace('www.', '');
      const generatedEmail = `info@${domain}`;
      console.log(`Using generated email for ${businessName}: ${generatedEmail}`);
      return generatedEmail;
    } catch {
      return null;
    }
  }

  return null;
}