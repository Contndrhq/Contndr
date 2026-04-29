/**
 * Utility functions for CSV export
 */

export function downloadCSV(data: any[], filename: string) {
  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  // Get all unique keys from all objects
  const allKeys = Array.from(
    new Set(data.flatMap(obj => Object.keys(obj)))
  );

  // Create CSV header
  const header = allKeys.join(',');

  // Create CSV rows
  const rows = data.map(obj => {
    return allKeys
      .map(key => {
        const value = obj[key];
        
        // Handle null/undefined
        if (value == null) return '';
        
        // Convert to string and escape
        const stringValue = String(value);
        
        // Escape quotes and wrap in quotes if contains comma, newline, or quote
        if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        
        return stringValue;
      })
      .join(',');
  });

  // Combine header and rows
  const csv = [header, ...rows].join('\n');

  // Create blob and download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportLeads(leads: any[]) {
  const exportData = leads.map(lead => ({
    business_name: lead.business_name,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    category: lead.category,
    city: lead.city,
    address: lead.address,
    status: lead.status,
    brand: lead.brand,
    source: lead.source,
    rating: lead.rating,
    reviews: lead.reviews,
    notes: lead.notes,
    created_at: lead.created_at,
  }));

  const timestamp = new Date().toISOString().split('T')[0];
  downloadCSV(exportData, `contndr-leads-${timestamp}.csv`);
}

export function exportCampaigns(campaigns: any[]) {
  const exportData = campaigns.map(campaign => ({
    name: campaign.name,
    brand: campaign.brand,
    product: campaign.product,
    status: campaign.status,
    from_email: campaign.from_email,
    sender_name: campaign.sender_name,
    sender_title: campaign.sender_title,
    created_at: campaign.created_at,
  }));

  const timestamp = new Date().toISOString().split('T')[0];
  downloadCSV(exportData, `contndr-campaigns-${timestamp}.csv`);
}

export function exportEmails(emails: any[]) {
  const exportData = emails.map(email => ({
    subject: email.subject,
    to_email: email.leads?.email || email.to_email,
    business_name: email.leads?.business_name || '',
    campaign: email.campaigns?.name || '',
    status: email.status,
    sent_at: email.sent_at,
    opened_at: email.opened_at,
    clicked_at: email.clicked_at,
    replied_at: email.replied_at,
  }));

  const timestamp = new Date().toISOString().split('T')[0];
  downloadCSV(exportData, `contndr-emails-${timestamp}.csv`);
}