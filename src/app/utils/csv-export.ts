// CSV Export utility for Company Search
// Extracted to keep the export logic clean and maintainable

interface CsvCompany {
  id: string;
  name: string;
  website_url: string;
  industry: string;
  estimated_num_employees: number;
  annual_revenue_printed: string;
  rating?: number;
  reviews_count?: number;
  city: string;
  state: string;
  country: string;
  phone: string;
  linkedin_url: string;
  address?: string;
  short_description: string;
  legal_name?: string;
  company_type?: string;
  company_status?: string;
  sec_ticker?: string;
  incorporation_date?: string;
  tech_stack?: { name: string; category: string }[];
  careers_count?: number;
  social_links?: Record<string, string>;
}

/** Escape a value for CSV (double-quote any internal quotes) */
function esc(v: any): string {
  const s = String(v != null ? v : '');
  return s.replace(/"/g, '""');
}

export function buildCompanyCsv(
  companies: CsvCompany[],
  scoreFunc: (c: CsvCompany) => number,
): string {
  const headers = [
    'Name', 'Website', 'Industry', 'Employees', 'Revenue', 'Lead Score',
    'Rating', 'Reviews', 'City', 'State', 'Country', 'Phone',
    'Social Profile', 'Address', 'Description', 'Legal Name', 'Entity Type',
    'Status', 'Ticker', 'Incorporation Date', 'Tech Stack', 'Open Roles',
    'Social Links',
  ];

  const rows = companies.map(c => [
    esc(c.name),
    c.website_url || '',
    c.industry || '',
    c.estimated_num_employees || '',
    c.annual_revenue_printed || '',
    String(scoreFunc(c)),
    c.rating || '',
    c.reviews_count || '',
    c.city || '',
    c.state || '',
    c.country || '',
    c.phone || '',
    c.linkedin_url || '',
    esc(c.address || ''),
    esc(c.short_description || ''),
    c.legal_name || '',
    c.company_type || '',
    c.company_status || '',
    c.sec_ticker || '',
    c.incorporation_date || '',
    (c.tech_stack || []).map(t => t.name).join('; '),
    String(c.careers_count || ''),
    c.social_links
      ? Object.entries(c.social_links).map(([k, v]) => `${k}: ${v}`).join('; ')
      : '',
  ]);

  return [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${v}"`).join(',')),
  ].join('\n');
}
