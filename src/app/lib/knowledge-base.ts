/**
 * Knowledge Base for Contndr Email Generation
 * 
 * This file contains product information, pricing, benefits, and tone guidelines
 * used by the AI email generation system to create personalized outreach emails.
 */

export interface ProductKnowledge {
  name: string;
  tagline: string;
  description: string;
  pricing: {
    monthly?: string;
    yearly?: string;
    savings?: string;
  };
  targetAudience: string[];
  keyFeatures: string[];
  uniqueSellingPoints: string[];
  callToAction: {
    url: string;
    text: string;
  };
  toneGuidelines: string[];
  prohibitedElements: string[];
}

export const ROADR_PROVIDER_KNOWLEDGE: ProductKnowledge = {
  name: "Roadr Service Provider Subscription",
  tagline: "Simplifying Auto Repair Business",
  description: "The Roadr Service Provider Subscription is the monthly or yearly membership that allows automotive service providers to be listed, discovered, and hired inside the Roadr app. Providers who subscribe unlock full access to customer jobs and become verified on the platform.",
  
  pricing: {
    monthly: "$149 per month",
    yearly: "$1,499 per year",
    savings: "two months free with yearly subscription"
  },
  
  targetAudience: [
    "towing companies",
    "mechanics",
    "mobile mechanics",
    "tire technicians",
    "detailers",
    "locksmiths",
    "glass repair shops",
    "roadside assistance technicians",
    "body shops",
    "window tinting specialists",
    "all vehicle related service providers"
  ],
  
  keyFeatures: [
    "Verified badge in the app which increases trust and job conversions",
    "Full access to the Roadr network allowing you to receive service requests from thousands of drivers nearby",
    "Ability to get booked directly through the app for 24 different vehicle related services",
    "Listing inside the marketplace where customers browse service providers",
    "Business profile including photos, ratings, service categories, coverage areas, pricing, and contact details",
    "Frictionless communication with customers through in app messaging and job updates",
    "Opportunity to earn more by responding quickly to new requests as Roadr prioritizes verified providers",
    "Local and nationwide visibility depending on the provider's service radius",
    "Qualifies for future benefit programs such as priority jobs, badges, discounts, and partnerships"
  ],
  
  uniqueSellingPoints: [
    "One flat monthly or yearly subscription unlocks everything",
    "No hidden fees",
    "Roadr does not take a percentage of completed jobs",
    "No pay per lead system",
    "No bidding system required",
    "Steady customer flow without variable costs",
    "Simple, predictable pricing model"
  ],
  
  callToAction: {
    url: "https://roadr.com/earn-with-us",
    text: "Visit https://roadr.com/earn-with-us to learn more and subscribe"
  },
  
  toneGuidelines: [
    "Friendly and approachable",
    "Clear and direct",
    "Professional but conversational",
    "Focus on benefits and outcomes",
    "Empathize with business challenges",
    "Highlight simplicity and ease of use",
    "Emphasize value and predictable costs",
    "Use specific numbers and concrete examples"
  ],
  
  prohibitedElements: [
    "Never use dashes in the output",
    "Avoid overly salesy or pushy language",
    "Do not make unrealistic promises",
    "Do not use technical jargon unnecessarily"
  ]
};

export const SOURCR_WEB_KNOWLEDGE: ProductKnowledge = {
  name: "Sourcr Premium Websites",
  tagline: "Premium websites that convert visitors into customers",
  description: "Sourcr creates custom, high-performance websites designed to showcase your business and drive conversions. Built with modern technology, optimized for search engines, and designed to impress your customers.",
  
  pricing: {
    // Add pricing when available
  },
  
  targetAudience: [
    "small businesses",
    "local service providers",
    "professional services",
    "retail businesses",
    "restaurants and hospitality",
    "healthcare providers",
    "any business needing a professional online presence"
  ],
  
  keyFeatures: [
    "Custom design tailored to your brand",
    "Mobile responsive and fast loading",
    "Search engine optimized (SEO)",
    "Easy content management",
    "Contact forms and lead capture",
    "Integration with your existing tools",
    "Professional hosting and maintenance",
    "Analytics and performance tracking"
  ],
  
  uniqueSellingPoints: [
    "Premium quality at affordable prices",
    "Fast turnaround time",
    "No technical knowledge required",
    "Ongoing support and updates",
    "Designed to convert visitors into customers"
  ],
  
  callToAction: {
    url: "https://sourcr.net",
    text: "Learn more at https://sourcr.net"
  },
  
  toneGuidelines: [
    "Professional and sophisticated",
    "Focus on business growth and ROI",
    "Highlight design quality and performance",
    "Emphasize ease of use and support",
    "Appeal to business owners who value quality"
  ],
  
  prohibitedElements: [
    "Never use dashes in the output",
    "Avoid generic web design clichés",
    "Do not oversimplify the value of professional web design"
  ]
};

export const SOURCR_APP_KNOWLEDGE: ProductKnowledge = {
  name: "Sourcr Mobile Apps",
  tagline: "Premium mobile apps that delight your customers",
  description: "Sourcr builds custom mobile applications for iOS and Android that help businesses engage customers, streamline operations, and grow revenue. Professional, polished, and designed for real business results.",
  
  pricing: {
    // Add pricing when available
  },
  
  targetAudience: [
    "businesses with loyal customer bases",
    "service providers needing booking systems",
    "retail businesses wanting mobile commerce",
    "restaurants and food services",
    "fitness and wellness businesses",
    "membership-based organizations",
    "any business wanting a branded mobile presence"
  ],
  
  keyFeatures: [
    "Native iOS and Android apps",
    "Custom design matching your brand",
    "Push notifications for customer engagement",
    "In-app booking and scheduling",
    "Payment processing integration",
    "User accounts and profiles",
    "Real-time updates and synchronization",
    "Analytics and usage insights"
  ],
  
  uniqueSellingPoints: [
    "Full-service development from concept to launch",
    "App Store and Google Play submission handled",
    "Ongoing maintenance and updates",
    "No coding required from your team",
    "Built for scale and performance"
  ],
  
  callToAction: {
    url: "https://sourcr.net",
    text: "Discover what's possible at https://sourcr.net"
  },
  
  toneGuidelines: [
    "Forward-thinking and innovative",
    "Focus on customer experience and engagement",
    "Highlight competitive advantages of mobile presence",
    "Professional and aspirational",
    "Emphasize partnership and collaboration"
  ],
  
  prohibitedElements: [
    "Never use dashes in the output",
    "Avoid overpromising on features",
    "Do not diminish the complexity of app development"
  ]
};

/**
 * Helper function to get knowledge base by product type
 */
export function getProductKnowledge(product: string): ProductKnowledge | null {
  switch (product) {
    case 'roadr_provider':
      return ROADR_PROVIDER_KNOWLEDGE;
    case 'sourcr_web':
      return SOURCR_WEB_KNOWLEDGE;
    case 'sourcr_app':
      return SOURCR_APP_KNOWLEDGE;
    default:
      return null;
  }
}

/**
 * Format knowledge base into a prompt-friendly string for AI email generation
 */
export function formatKnowledgeForPrompt(knowledge: ProductKnowledge): string {
  let prompt = `Product Information:\n`;
  prompt += `Name: ${knowledge.name}\n`;
  prompt += `Tagline: ${knowledge.tagline}\n`;
  prompt += `Description: ${knowledge.description}\n\n`;
  
  if (knowledge.pricing.monthly || knowledge.pricing.yearly) {
    prompt += `Pricing:\n`;
    if (knowledge.pricing.monthly) prompt += `- Monthly: ${knowledge.pricing.monthly}\n`;
    if (knowledge.pricing.yearly) prompt += `- Yearly: ${knowledge.pricing.yearly}\n`;
    if (knowledge.pricing.savings) prompt += `- Savings: ${knowledge.pricing.savings}\n`;
    prompt += `\n`;
  }
  
  prompt += `Target Audience:\n`;
  knowledge.targetAudience.forEach(audience => {
    prompt += `- ${audience}\n`;
  });
  prompt += `\n`;
  
  prompt += `Key Features:\n`;
  knowledge.keyFeatures.forEach(feature => {
    prompt += `- ${feature}\n`;
  });
  prompt += `\n`;
  
  prompt += `Unique Selling Points:\n`;
  knowledge.uniqueSellingPoints.forEach(usp => {
    prompt += `- ${usp}\n`;
  });
  prompt += `\n`;
  
  prompt += `Call to Action:\n`;
  prompt += `${knowledge.callToAction.text}\n\n`;
  
  prompt += `Tone Guidelines:\n`;
  knowledge.toneGuidelines.forEach(guideline => {
    prompt += `- ${guideline}\n`;
  });
  prompt += `\n`;
  
  prompt += `Important Restrictions:\n`;
  knowledge.prohibitedElements.forEach(restriction => {
    prompt += `- ${restriction}\n`;
  });
  
  return prompt;
}

/**
 * Example email context that combines knowledge base with lead information
 */
export interface EmailContext {
  lead: {
    businessName: string;
    category?: string;
    city?: string;
    email: string;
  };
  product: string;
  tone: 'casual' | 'professional' | 'enthusiastic';
  priceSummary: string;
  landingUrl: string;
}

/**
 * Build a complete email generation prompt
 */
export function buildEmailPrompt(context: EmailContext): string {
  const knowledge = getProductKnowledge(context.product);
  
  if (!knowledge) {
    throw new Error(`No knowledge base found for product: ${context.product}`);
  }
  
  let prompt = `You are writing a personalized sales email for ${knowledge.name}.\n\n`;
  
  prompt += formatKnowledgeForPrompt(knowledge);
  
  prompt += `\n\nLead Information:\n`;
  prompt += `Business Name: ${context.lead.businessName}\n`;
  if (context.lead.category) prompt += `Category: ${context.lead.category}\n`;
  if (context.lead.city) prompt += `City: ${context.lead.city}\n`;
  
  prompt += `\n\nEmail Requirements:\n`;
  prompt += `- Tone: ${context.tone}\n`;
  prompt += `- Include pricing: ${context.priceSummary}\n`;
  prompt += `- Include call to action URL: ${context.landingUrl}\n`;
  prompt += `- Personalize based on business name, category, and location\n`;
  prompt += `- Focus on how this product solves their specific business challenges\n`;
  prompt += `- Keep it concise and scannable\n`;
  prompt += `- End with a clear call to action\n`;
  prompt += `- CRITICAL: Never use dashes anywhere in the email body\n`;
  prompt += `- Sign off with:\n`;
  prompt += `  Best Regards,\n`;
  prompt += `  [Your Name]\n`;
  prompt += `  [Your Position]\n`;
  if (context.product === 'roadr_provider') {
    prompt += `  Roadr - Simplifying Auto Repair Business\n`;
  } else {
    prompt += `  Sourcr\n`;
  }
  
  prompt += `\n\nGenerate a complete email (subject line and body) that follows all the guidelines above.`;
  
  return prompt;
}