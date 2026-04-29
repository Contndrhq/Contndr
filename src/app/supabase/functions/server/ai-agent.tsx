// AI Agent for Sourcr Fast Money Targets
// Uses AI to analyze websites and generate hyper-personalized emails

import { Context } from "npm:hono";
import { generateAI } from "./ai-provider.tsx";

interface WebsiteAnalysis {
  hasChatWidget: boolean;
  hasContactForm: boolean;
  websiteStatus: "missing" | "outdated" | "good";
  recommendedService: "website" | "redesign" | "ai_agent";
  servicePrice: "$4,000" | "$6,000" | "$299/mo";
  paymentLink: "appropriate stripe link";
  businessType: string;
  painPoints: string[];
  estimatedValue: string;
  hook: string;
  pain: string;
  solution: string;
}

/**
 * Analyze a website and generate personalized email content
 */
export async function analyzeWebsiteForAI(c: Context) {
  try {
    const { websiteUrl, businessName, city, category } = await c.req.json();

    if (!websiteUrl) {
      return c.json({ error: 'Website URL is required' }, 400);
    }

    const aiKey = Deno.env.get('OPENAI_API_KEY');
    if (!aiKey) {
      return c.json({ error: 'OPENAI_API_KEY not configured' }, 500);
    }

    // Fetch website content (simplified - in production you'd want proper scraping)
    let websiteContent = '';
    try {
      const response = await fetch(websiteUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SourcrBot/1.0)',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      if (response.ok) {
        const html = await response.text();
        // Extract text content (very basic - strips HTML tags)
        websiteContent = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 3000); // Limit to first 3000 chars
      }
    } catch (fetchError) {
      console.log(`Failed to fetch website ${websiteUrl}:`, fetchError);
      websiteContent = 'Unable to fetch website content';
    }

    // Use AI to analyze the website and generate personalized email content
    const analysisPrompt = `You are an expert sales analyst for Covera, a company that sells premium websites, redesigns, and AI chat agents to local businesses.

Business Details:
- Name: ${businessName}
- Location: ${city}
- Category: ${category}
- Website: ${websiteUrl}

Website Content (first 3000 chars):
${websiteContent}

IMPORTANT: Analyze the website status and recommend the RIGHT service:

1. IF NO WEBSITE EXISTS (404, parking page, or domain not working):
   → Recommend: Covera Website ($4,000 one-time)
   → Payment Link: https://buy.stripe.com/eVadT8aBYaud75udR1
   → Pitch: Professional website that converts visitors into customers

2. IF WEBSITE EXISTS BUT LOOKS OLD/OUTDATED (poor design, dated UI, not mobile-friendly, unprofessional):
   → Recommend: Covera Redesign ($6,000 one-time)
   → Payment Link: https://buy.stripe.com/aEUcP4h0m0TDfC0eV3
   → Pitch: Modern redesign that increases trust and conversions

3. IF WEBSITE IS GOOD BUT MISSING CHAT WIDGET:
   → Recommend: Covera AI Agent ($299/month)
   → Payment Link: https://buy.stripe.com/6oUdR84VScAOd668gs3ks0f
   → Pitch: 24/7 AI chat that never misses a lead

Now analyze this business and create a hyper-personalized email using the "High-Pain" structure:

1. THE HOOK: Identify the specific problem based on website status
2. THE PAIN: Calculate the financial cost (e.g., lost credibility, missed leads, slow response time)
3. THE SOLUTION: Pitch the appropriate Covera service with the correct pricing and payment link

Return a JSON object with this structure:
{
  "hasChatWidget": boolean,
  "hasContactForm": boolean,
  "websiteStatus": "missing" | "outdated" | "good",
  "recommendedService": "website" | "redesign" | "ai_agent",
  "servicePrice": "$4,000" | "$6,000" | "$299/mo",
  "paymentLink": "appropriate stripe link",
  "businessType": "hvac" | "auto" | "restaurant" | "real_estate" | "home_services" | "other",
  "painPoints": ["specific pain point 1", "specific pain point 2"],
  "estimatedValue": "$X,XXX per missed opportunity",
  "hook": "One sentence hook that calls out their specific problem",
  "pain": "2-3 sentences explaining the financial cost of their problem",
  "solution": "2-3 sentences pitching the recommended service with price and value"
}`;

    let aiResult;
    try {
      aiResult = await generateAI({
        messages: [
          { role: 'system', content: 'You are an expert sales analyst. Always return valid JSON only, no markdown or code blocks.' },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.7,
        maxTokens: 800,
        jsonMode: true,
      });
    } catch (aiErr: any) {
      console.error('AI API error:', aiErr.message);
      return c.json({ error: 'Failed to analyze website with AI' }, 500);
    }

    const analysisText = aiResult.text.trim();
    
    // Parse the JSON response
    let analysis: WebsiteAnalysis;
    try {
      // Remove markdown code blocks if present
      const cleanedText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', analysisText);
      return c.json({ error: 'Failed to parse AI analysis' }, 500);
    }

    return c.json({
      success: true,
      analysis,
      websiteUrl,
      businessName,
    });

  } catch (error) {
    console.error('Error in analyzeWebsiteForAI:', error);
    return c.json({ error: 'Internal server error during website analysis' }, 500);
  }
}

/**
 * Generate a complete personalized email using the analysis
 */
export async function generateFastMoneyEmail(c: Context) {
  try {
    const { analysis, businessName, recipientName, senderName } = await c.req.json();

    if (!analysis || !businessName) {
      return c.json({ error: 'Analysis and business name are required' }, 400);
    }

    const aiKey = Deno.env.get('OPENAI_API_KEY');
    if (!aiKey) {
      return c.json({ error: 'OPENAI_API_KEY not configured' }, 500);
    }

    // Determine sender info - default to Sales team
    const actualSenderName = senderName || 'Covera Sales Team';
    const senderFirstName = actualSenderName === 'Covera Sales Team' ? 'Sales Team' : actualSenderName.split(' ')[0];

    // Get the service details from analysis
    const serviceName = analysis.recommendedService === 'website' ? 'Covera Website' 
      : analysis.recommendedService === 'redesign' ? 'Covera Redesign'
      : 'Covera AI Agent';
    const servicePrice = analysis.servicePrice || '$299/mo';
    const paymentLink = analysis.paymentLink || 'https://buy.stripe.com/6oUdR84VScAOd668gs3ks0f';

    const emailPrompt = `Create a personalized sales email for ${businessName} (Contact: ${recipientName || 'there'}) using this analysis:

Recommended Service: ${serviceName} (${servicePrice})
Payment Link: ${paymentLink}

Hook: ${analysis.hook}
Pain: ${analysis.pain}
Solution: ${analysis.solution}

Business Type: ${analysis.businessType}
Estimated Lost Value: ${analysis.estimatedValue}

The email should follow the "3-step play" for high-converting cold emails:
1. Greeting: Start with "Hi [Name],".
2. STRICTLY under 80 words total. This is a hard limit.
3. Structure: VERTICAL LIST. Put every sentence on a new line with a double space (\n\n) between them.
4. Use the Hook to grab attention immediately.
5. Briefly mention the Pain (financial cost).
6. Present the Solution (${serviceName} at ${servicePrice}) and the payment link: ${paymentLink}.
7. Voice: Use the customer's language. No corporate jargon.
8. Clean Text: DO NOT use hyphens, dashes, or em-dashes. Use commas or periods instead.
- CRITICAL: Do NOT clump sentences together. Use line breaks.
9. End with a professional signature:

---

${senderFirstName}

Covera - Premium Websites & AI Agents for Local Businesses
Website: https://covera.co
Phone: 323-333-9600
Get Started: ${paymentLink}

Subject line should be punchy and pain-focused (e.g., "You're losing $5,000 every time this happens" or "Your website is costing you money")

Return JSON:
{
  "subject": "email subject line",
  "body": "full email body with \\\\n for line breaks and signature INCLUDING the payment link"
}`;

    let aiResult;
    try {
      aiResult = await generateAI({
        messages: [
          { role: 'system', content: 'You are an expert email copywriter. Always return valid JSON only.' },
          { role: 'user', content: emailPrompt },
        ],
        temperature: 0.8,
        maxTokens: 1000,
        jsonMode: true,
      });
    } catch (aiErr: any) {
      console.error('AI API error:', aiErr.message);
      return c.json({ error: 'Failed to generate email with AI' }, 500);
    }

    const emailText = aiResult.text.trim();
    
    // Parse the JSON response
    let emailData: { subject: string; body: string };
    try {
      const cleanedText = emailText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      emailData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('Failed to parse AI email response:', emailText);
      return c.json({ error: 'Failed to parse AI email generation' }, 500);
    }

    return c.json({
      success: true,
      subject: emailData.subject.replace(/—/g, ','),  // Remove em dashes
      body: emailData.body.replace(/—/g, ','),  // Remove em dashes
    });

  } catch (error) {
    console.error('Error in generateFastMoneyEmail:', error);
    return c.json({ error: 'Internal server error during email generation' }, 500);
  }
}

/**
 * Batch analyze multiple leads and generate personalized emails
 */
export async function batchAnalyzeLeads(c: Context) {
  try {
    const { leads, senderName } = await c.req.json();

    if (!Array.isArray(leads) || leads.length === 0) {
      return c.json({ error: 'Leads array is required' }, 400);
    }

    if (leads.length > 50) {
      return c.json({ error: 'Maximum 50 leads per batch' }, 400);
    }

    const results = [];

    // Process leads sequentially to avoid rate limits
    for (const lead of leads) {
      try {
        // Analyze website
        const analysisRes = await analyzeWebsiteForAI(c);
        if (!analysisRes.ok) {
          results.push({
            leadId: lead.id,
            businessName: lead.business_name,
            success: false,
            error: 'Failed to analyze website',
          });
          continue;
        }

        const analysisData = await analysisRes.json();

        // Generate email
        const emailRes = await generateFastMoneyEmail(c);
        if (!emailRes.ok) {
          results.push({
            leadId: lead.id,
            businessName: lead.business_name,
            success: false,
            error: 'Failed to generate email',
          });
          continue;
        }

        const emailData = await emailRes.json();

        results.push({
          leadId: lead.id,
          businessName: lead.business_name,
          success: true,
          analysis: analysisData.analysis,
          subject: emailData.subject,
          body: emailData.body,
        });

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (leadError) {
        console.error(`Error processing lead ${lead.id}:`, leadError);
        results.push({
          leadId: lead.id,
          businessName: lead.business_name,
          success: false,
          error: 'Processing error',
        });
      }
    }

    return c.json({
      success: true,
      total: leads.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });

  } catch (error) {
    console.error('Error in batchAnalyzeLeads:', error);
    return c.json({ error: 'Internal server error during batch analysis' }, 500);
  }
}