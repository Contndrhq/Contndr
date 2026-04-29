// Contact scraper - extracts email AND contact name from website
// Looks for leadership team, about us, contact pages to find decision makers

interface ContactInfo {
  email: string | null;
  name: string | null;
  title: string | null;
}

/**
 * Scrapes contact information including name from leadership/team pages
 */
export async function scrapeContactInfo(website: string, businessName: string): Promise<ContactInfo> {
  if (!website) return { email: null, name: null, title: null };

  try {
    let baseUrl = website.trim();
    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
    
    // Pages to check in priority order
    const urlsToTry = [
      `${baseUrl}/about`,
      `${baseUrl}/about-us`,
      `${baseUrl}/team`,
      `${baseUrl}/leadership`,
      `${baseUrl}/our-team`,
      `${baseUrl}/meet-the-team`,
      `${baseUrl}/contact`,
      `${baseUrl}/contact-us`,
      baseUrl
    ];
    
    let email: string | null = null;
    let contactName: string | null = null;
    let contactTitle: string | null = null;
    
    for (const url of urlsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) continue;
        
        const html = await response.text();
        
        // Extract email if not found yet
        if (!email) {
          email = extractEmail(html);
        }
        
        // Extract contact name and title
        if (!contactName) {
          const contact = extractContactName(html);
          if (contact.name) {
            contactName = contact.name;
            contactTitle = contact.title;
            console.log(`    ✓ Found contact on ${url}: ${contactName}${contactTitle ? ` (${contactTitle})` : ''}`);
          }
        }
        
        // If we have both email and name, we're done
        if (email && contactName) {
          break;
        }
        
      } catch (e) {
        continue;
      }
    }
    
    if (email) {
      console.log(`    ✓ Found email: ${email}`);
    }
    if (contactName) {
      console.log(`    ✓ Found contact: ${contactName}${contactTitle ? ` (${contactTitle})` : ''}`);
    }
    
    return { email, name: contactName, title: contactTitle };
    
  } catch (error) {
    console.log(`    ✗ Error scraping ${website}: ${error.message}`);
    return { email: null, name: null, title: null };
  }
}

/**
 * Extract valid email from HTML
 */
function extractEmail(html: string): string | null {
  const emailRegex = /\b([A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})\b/g;
  const matches = html.match(emailRegex) || [];
  
  const invalidPatterns = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
    'example.com', 'example.org', 'test.com', 'domain.com', 'email.com', 
    'yourdomain.com', 'yoursite.com', 'yourcompany.com', 'youremail.com',
    'placeholder', 'dummy', 'sample',
    'wix.com', 'wixpress.com', 'squarespace.com', 'wordpress.com', 
    'weebly.com', 'godaddy.com', 'hostgator.com', 'bluehost.com',
    'sentry.io', 'cloudflare.com', 'google.com', 'facebook.com', 
    'twitter.com', 'instagram.com', 'youtube.com', 'linkedin.com',
    'schema.org', 'w3.org', 'gravatar.com',
    'noreply', 'no-reply', 'donotreply', 'bounce',
    '@2x', '@3x', '@4x',
    'mailto:', 'javascript:', 'test@', 'user@', 'admin@localhost'
  ];
  
  const validEmails = matches
    .map(e => e.toLowerCase().trim())
    .filter(e => {
      if (invalidPatterns.some(pattern => e.includes(pattern))) return false;
      if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/i.test(e)) return false;
      
      const tld = e.split('.').pop() || '';
      if (tld.length < 2 || tld.length > 10) return false;
      if (e.length > 100 || e.length < 6) return false;
      if (/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/i.test(e)) return false;
      if ((e.match(/@/g) || []).length !== 1) return false;
      
      return true;
    });
  
  if (validEmails.length > 0) {
    // Prioritize business emails
    const priorityPatterns = ['info@', 'contact@', 'hello@', 'sales@', 'support@', 'admin@', 'office@'];
    const priorityEmail = validEmails.find(e => priorityPatterns.some(p => e.startsWith(p)));
    return priorityEmail || validEmails[0];
  }
  
  return null;
}

/**
 * Extract contact name and title from HTML
 * Looks for common patterns like CEO, Owner, President, Manager, etc.
 * ONLY returns actual person names - filters out generic text
 */
function extractContactName(html: string): { name: string | null; title: string | null } {
  // Remove script and style tags to avoid false matches
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Common leadership titles to look for
  const titlePatterns = [
    'CEO', 'Chief Executive Officer', 'President', 'Owner', 'Founder', 'Co-Founder',
    'Managing Director', 'General Manager', 'Director', 'Manager', 'Principal',
    'COO', 'Chief Operating Officer', 'CFO', 'Chief Financial Officer',
    'CTO', 'Chief Technology Officer', 'VP', 'Vice President',
    'Head of', 'Lead', 'Senior'
  ];
  
  // Invalid name patterns - filter out generic website text
  const invalidNamePatterns = [
    'Contact Us', 'About Us', 'Our Team', 'Meet the Team', 'Leadership Team',
    'Get in Touch', 'Call Us', 'Email Us', 'Click Here', 'Learn More',
    'Read More', 'Find Out', 'Discover More', 'Get Started', 'Sign Up',
    'Join Us', 'Follow Us', 'Subscribe Now', 'Contact Information',
    'Business Hours', 'Opening Hours', 'Office Hours', 'Customer Service',
    'Support Team', 'Sales Team', 'Management Team', 'Executive Team',
    'Board of Directors', 'Advisory Board', 'Our Mission', 'Our Vision',
    'Our Values', 'Our Story', 'Company Overview', 'What We Do',
    'All Rights', 'Privacy Policy', 'Terms of Service', 'Cookie Policy',
    'Home Page', 'Main Street', 'Contact Page', 'About Page'
  ];
  
  // Helper function to validate if a name is a real person name
  const isValidPersonName = (name: string): boolean => {
    if (!name || name.length < 4 || name.length > 50) return false;
    
    // Must be 2-4 words (e.g., "John Smith" or "Mary Jane Johnson")
    const words = name.trim().split(/\s+/);
    if (words.length < 2 || words.length > 4) return false;
    
    // Each word must start with capital letter and contain lowercase
    for (const word of words) {
      if (!/^[A-Z][a-z]+/.test(word)) return false;
      // Word must be at least 2 characters
      if (word.length < 2) return false;
      // Avoid single letter middle names unless followed by period
      if (word.length === 1 && !word.endsWith('.')) return false;
    }
    
    // Check against invalid patterns
    const nameLower = name.toLowerCase();
    for (const invalid of invalidNamePatterns) {
      if (nameLower.includes(invalid.toLowerCase())) return false;
    }
    
    // Must not contain common non-name words
    const nonNameWords = ['page', 'site', 'website', 'email', 'phone', 'fax', 'address', 'street', 'avenue', 'road', 'drive', 'lane'];
    for (const word of nonNameWords) {
      if (nameLower.includes(word)) return false;
    }
    
    // Must not be all caps (likely a heading/title, not a person)
    if (name === name.toUpperCase()) return false;
    
    return true;
  };
  
  // Try to find name + title combinations
  // Pattern 1: "John Smith, CEO" or "John Smith - CEO"
  const pattern1Regex = new RegExp(
    `([A-Z][a-z]+(?:\\s+[A-Z][a-z'.]+)+)\\s*[,\\-–—]\\s*(${titlePatterns.join('|')})`,
    'gi'
  );
  
  // Pattern 2: "CEO: John Smith" or "CEO - John Smith"
  const pattern2Regex = new RegExp(
    `(${titlePatterns.join('|')})\\s*[:\\-–—]\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z'.]+)+)`,
    'gi'
  );
  
  // Pattern 3: HTML structure like <h3>John Smith</h3><p>CEO</p>
  const pattern3Regex = /<(?:h[1-6]|div|span)[^>]*>\s*([A-Z][a-z]+(?:\s+[A-Z][a-z'.]+)+)\s*<\/(?:h[1-6]|div|span)>\s*<(?:p|div|span)[^>]*>\s*([^<]*(?:CEO|President|Owner|Founder|Director|Manager)[^<]*)\s*<\/(?:p|div|span)>/gi;
  
  let match;
  let attempts = 0;
  const maxAttempts = 10; // Limit regex attempts to avoid infinite loops
  
  // Try pattern 1 with validation
  while ((match = pattern1Regex.exec(cleanHtml)) !== null && attempts < maxAttempts) {
    attempts++;
    const potentialName = match[1].trim();
    if (isValidPersonName(potentialName)) {
      return {
        name: potentialName,
        title: match[2].trim()
      };
    }
  }
  
  // Try pattern 2 with validation
  attempts = 0;
  while ((match = pattern2Regex.exec(cleanHtml)) !== null && attempts < maxAttempts) {
    attempts++;
    const potentialName = match[2].trim();
    if (isValidPersonName(potentialName)) {
      return {
        name: potentialName,
        title: match[1].trim()
      };
    }
  }
  
  // Try pattern 3 with validation
  attempts = 0;
  while ((match = pattern3Regex.exec(cleanHtml)) !== null && attempts < maxAttempts) {
    attempts++;
    const potentialName = match[1].trim();
    if (isValidPersonName(potentialName)) {
      return {
        name: potentialName,
        title: match[2].trim()
      };
    }
  }
  
  // Try to extract from JSON-LD structured data (often used for company info)
  const jsonLdMatch = cleanHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const jsonData = JSON.parse(jsonLdMatch[1]);
      
      // Look for Person schema
      if (jsonData['@type'] === 'Person' && jsonData.name) {
        const potentialName = jsonData.name;
        if (isValidPersonName(potentialName)) {
          return {
            name: potentialName,
            title: jsonData.jobTitle || null
          };
        }
      }
      
      // Look for Organization with founder
      if (jsonData['@type'] === 'Organization' && jsonData.founder) {
        if (typeof jsonData.founder === 'string') {
          if (isValidPersonName(jsonData.founder)) {
            return {
              name: jsonData.founder,
              title: 'Founder'
            };
          }
        } else if (jsonData.founder.name) {
          if (isValidPersonName(jsonData.founder.name)) {
            return {
              name: jsonData.founder.name,
              title: jsonData.founder.jobTitle || 'Founder'
            };
          }
        }
      }
    } catch (e) {
      // Invalid JSON, continue
    }
  }
  
  // Last resort: look for any validated name followed by common titles in text
  const simpleMatch = cleanHtml.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z'.]+)+)[\s,.\-–—]+(CEO|President|Owner|Founder|Director)/i);
  if (simpleMatch) {
    const potentialName = simpleMatch[1].trim();
    if (isValidPersonName(potentialName)) {
      return {
        name: potentialName,
        title: simpleMatch[2].trim()
      };
    }
  }
  
  return { name: null, title: null };
}