/**
 * Contndr Knowledge Base
 * Version 2.0 — 2026
 * 
 * This knowledge base is used by the AI email generator to create accurate,
 * on-brand sales emails for Contndr services.
 */

export const CONTNDR_KNOWLEDGE = {
  company: {
    name: "Contndr",
    tagline: "Global digital product studio",
    description: "Creates high performance websites, mobile apps, brand identities, and AI customer service agents",
    philosophy: "Living websites and mobile apps that adapt, evolve, and support business success",
    website: "contndr.com",
  },

  services: {
    websites: {
      starter: {
        name: "Starter Website",
        price: "$499/month",
        priceValue: 499,
        commitment: "6-month commitment",
        features: [
          "Modern design optimized for conversions",
          "Fast loading performance",
          "Premium visuals and animations",
          "Responsive across all devices",
          "SEO ready",
          "Built for future expansion and growth"
        ]
      },
      premium: {
        name: "Premium Website",
        price: "$899/month",
        priceValue: 899,
        commitment: "6-month commitment",
        features: [
          "Everything in Starter Website",
          "Advanced animations and interactions",
          "Custom content strategy",
          "Enhanced SEO optimization",
          "Priority support",
          "Continuous optimization"
        ]
      }
    },

    branding: {
      name: "Full Brand Identity Package",
      price: "$1,500",
      priceValue: 1500,
      features: [
        "Complete brand identity system",
        "Premium logo design",
        "Color palette and typography selection",
        "Assets that elevate every touch point",
        "Clear brand guidelines"
      ]
    },

    mobileApps: {
      starter: {
        name: "Starter Mobile App",
        price: "$6,000/month",
        priceValue: 6000,
        commitment: "6-month commitment",
        platforms: "iOS and Android",
        features: [
          "Fully native or cross-platform development",
          "Scalable architecture",
          "Smooth user experience",
          "Professional level security and performance",
          "Designed for growth and expansion"
        ]
      },
      premium: {
        name: "Premium Mobile App",
        price: "$8,000+/month",
        priceValue: 8000,
        commitment: "6-month commitment",
        platforms: "iOS and Android",
        features: [
          "Everything in Starter Mobile App",
          "Advanced integrations",
          "Custom backend development",
          "Enterprise-grade security",
          "Dedicated project manager",
          "6 months post-launch support"
        ]
      }
    },

    aiAgent: {
      name: "AI Customer Service Agent",
      price: "$299/month",
      priceValue: 299,
      billingType: "Monthly subscription",
      features: [
        "Automated support 24/7",
        "Lead capture and qualification",
        "Sales assistance",
        "Instant responses any time",
        "Reduces support workload",
        "Increases customer satisfaction",
        "Integrates easily with any website"
      ]
    }
  },

  process: [
    {
      name: "Immersion",
      description: "The Contndr team studies each brand's mission, values, audience, competitors, and goals"
    },
    {
      name: "Strategy and Design",
      description: "Insights become wireframes, layouts, and premium user experiences"
    },
    {
      name: "Agile Development",
      description: "Websites developed in Framer. Mobile apps built using Swift, Kotlin, or React Native"
    },
    {
      name: "Continuous Optimization",
      description: "Websites and digital products continuously improved using Growth Design"
    }
  ],

  payment: {
    structure: "Monthly subscription model with 6-month commitment",
    subscriptions: "Monthly subscriptions billed automatically"
  },

  portfolio: [
    "Roadr",
    "UpStart",
    "Go Ink",
    "Cubo Supply",
    "Iolanda",
    "Charlotte de Witte"
  ],

  testimonials: [
    {
      author: "Sarah T",
      highlight: "Speed and professionalism"
    },
    {
      author: "James L",
      highlight: "Clear communication"
    },
    {
      author: "Priya M",
      highlight: "High quality work"
    },
    {
      author: "Alex R",
      highlight: "Exceeded expectations"
    },
    {
      author: "Emily K",
      highlight: "Outstanding results"
    }
  ],

  salesGuidance: {
    tone: "Clear, confident, friendly, and premium. Reflect expertise, simplicity, and trust.",
    positioning: "Premium creative and technology partner that delivers long-term value",
    
    objectionHandling: {
      websitePrice: "You're investing in strategy, custom design, animations, optimization, and a scalable platform that grows with your business. This is not a template—it's a complete professional digital system.",
      mobileAppCost: "App development requires engineering, architecture, security, usability, and performance testing. We build apps with the same technologies used by major tech companies.",
      aiAgentCost: "The agent replaces hours of manual support, works 24/7, increases conversions, and creates higher customer satisfaction while saving money."
    },

    qualificationQuestions: [
      "What stage is your business in?",
      "Do you already have branding?",
      "What is the main goal of your website or app?",
      "What timelines do you have?",
      "What is your budget range?",
      "Do you want an AI agent included?",
      "What competitors or references do you admire?"
    ],

    callsToAction: [
      "Would you like to move forward with the Starter Website at $499/month or Premium Website at $899/month?",
      "Would you like to add the Brand Identity Package for $1,500?",
      "Should we activate your AI Customer Agent for $299 per month?",
      "Would you like us to prepare a proposal?",
      "Would you like to schedule a discovery call?"
    ]
  }
};

/**
 * Get service details based on product selection
 */
export function getContndrServiceDetails(product: string): any {
  switch (product) {
    case 'sourcr_web_starter':
    case 'contndr_web_starter':
    case 'sendlr_web_starter':
      return {
        service: CONTNDR_KNOWLEDGE.services.websites.starter,
        category: 'Starter Website',
        upsells: [
          CONTNDR_KNOWLEDGE.services.branding,
          CONTNDR_KNOWLEDGE.services.aiAgent
        ]
      };
    
    case 'sourcr_web':
    case 'contndr_web':
    case 'sendlr_web':
      return {
        service: CONTNDR_KNOWLEDGE.services.websites.premium,
        category: 'Premium Website',
        upsells: [
          CONTNDR_KNOWLEDGE.services.branding,
          CONTNDR_KNOWLEDGE.services.aiAgent
        ]
      };
    
    case 'sourcr_app':
    case 'contndr_app':
    case 'sendlr_app':
      return {
        service: CONTNDR_KNOWLEDGE.services.mobileApps.starter,
        category: 'Mobile App Development',
        upsells: [
          CONTNDR_KNOWLEDGE.services.branding,
          CONTNDR_KNOWLEDGE.services.aiAgent
        ]
      };
    
    default:
      return null;
  }
}

/**
 * Generate context for AI email generation
 */
export function getContndrEmailContext(product: string): string {
  const serviceDetails = getContndrServiceDetails(product);
  
  if (!serviceDetails) {
    return '';
  }

  const { service, category } = serviceDetails;

  let context = `
IMPORTANT: You are writing on behalf of Contndr (contndr.com), a global digital product studio.

SERVICE OFFERING:
${service.name} - ${service.price}

KEY FEATURES:
${service.features.map((f: string) => `- ${f}`).join('\n')}

COMPANY POSITIONING:
${CONTNDR_KNOWLEDGE.company.philosophy}

OUR PROCESS:
${CONTNDR_KNOWLEDGE.process.map(p => `${p.name}: ${p.description}`).join('\n')}

PORTFOLIO EXAMPLES:
${CONTNDR_KNOWLEDGE.portfolio.join(', ')}

PAYMENT TERMS:
${CONTNDR_KNOWLEDGE.payment.structure}

TONE & STYLE:
${CONTNDR_KNOWLEDGE.salesGuidance.tone}

CONTACT INFORMATION (ALWAYS INCLUDE):
Website: ${CONTNDR_KNOWLEDGE.company.website}

When writing the email:
1. Position Contndr as a premium creative and technology partner
2. Focus on long-term value, not just deliverables
3. Emphasize that websites/apps are "living" products that evolve
4. Use clear, confident, friendly language
5. Include specific pricing: ${service.price}
6. ALWAYS include a clear call to action with website (contndr.com)
7. Make it easy for prospects to get started by visiting contndr.com
8. Keep it conversational but professional
`;

  return context;
}