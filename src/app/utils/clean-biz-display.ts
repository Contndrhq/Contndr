/**
 * Display-level cleaner: rejects LinkedIn headlines, taglines, and job titles
 * from business_name fields. Returns empty string if the name is garbage,
 * so callers can fall back to contact_name or other fields.
 */
export function cleanBizDisplay(raw: string): string {
  if (!raw) return '';
  let c = raw.trim();

  // ── "Company. Company Location" pattern ──
  const dotParts = c.split(/\.\s+/);
  if (dotParts.length >= 2) {
    const first = dotParts[0].trim();
    const second = dotParts.slice(1).join('. ').trim();
    if (first.length >= 3 && second.toLowerCase().startsWith(first.toLowerCase())) {
      c = first;
    }
  }

  // ── Pipe-separated LinkedIn taglines ──
  const pipeParts = c.split(/\s*\|\s*/);
  if (pipeParts.length >= 3) {
    const TITLE_KW = /\b(founder|ceo|cto|cfo|coo|cmo|director|manager|head|vp|president|board|member|partner|lead|chief|officer|consultant|advisor|coach|owner|principal)\b/i;
    if (pipeParts.some(p => TITLE_KW.test(p))) return '';
    if (pipeParts.length >= 4) return '';
  }

  // ── "Company and CEO/Title" pattern ──
  const titleSuffix = c.match(/^(.+?)\s+and\s+(CEO|CTO|CFO|COO|CMO|Founder|Co-?Founder|President|Director|VP|SVP|EVP|Partner|Owner|Board\s+Member|Chairman)\b/i);
  if (titleSuffix) {
    c = titleSuffix[1].trim();
  }

  // Truncate at comma if followed by sentence-like fragment
  c = c.replace(/,\s+(?:My |I |We |Our |Your |A |The |An |Helping |Passionate |Dedicated |Experienced |Building |Creating |Empowering |Enabling |Transforming |Committed |Focused |Specializ|Leverag|Proven |Award|Driving |Working |Looking |Seeking |Striving |Results).*/i, '').trim();

  // Reject LinkedIn headline patterns
  const HEADLINE = /^(working\s+(?:in|at|with|on|for)|helping\s|passionate\s|dedicated\s|experienced\s|building\s|creating\s|empowering\s|enabling\s|transforming\s|committed\s|focused\s+on|specializ\w+\s+in|leverag\w+|driving\s|delivering\s|seeking\s|looking\s+(?:for|to)|striving\s|results[\s-]|i\s+(?:help|am|love|work|build|create)|we\s+(?:help|are|build|create|provide|deliver)|my\s+(?:goal|mission|passion|focus))/i;
  if (HEADLINE.test(c)) return '';

  // Reject pure job titles as company names
  const PURE_TITLE = /^(ceo|cto|cfo|coo|cmo|vp|svp|evp|avp|director|manager|head|lead|chief|founder|co-?founder|owner|partner|president|consultant|advisor|analyst|engineer|architect|coordinator|specialist|strategist|executive|coach|trainer|mentor|instructor|therapist|practitioner|freelanc\w+|entrepreneur|realtor|agent|broker|attorney|lawyer|accountant|developer|designer|recruiter|marketer|sales\w*|business\s+development)(\s+(of|at|for|in|&|and|\/)\s+.*)?$/i;
  if (PURE_TITLE.test(c)) return '';

  // Reject sentence-verb patterns in >3-word strings
  if (/\b(helping|empowering|enabling|transforming|building|creating|delivering|providing|growing|driving|solving|improving|supporting|managing|developing|seeking|looking|striving|committed|passionate|dedicated|experienced)\b/i.test(c) && c.split(/\s+/).length > 3) return '';

  // Reject pronoun-heavy strings
  if (/\b(my goal|i help|i am|we help|we are|our mission)\b/i.test(c) && c.split(/\s+/).length > 2) return '';

  // Reject if >7 words (real company names are short)
  if (c.split(/\s+/).length > 7) return '';

  return c;
}
