import { useEffect } from 'react';

/**
 * Structured Data Component for SEO
 * Adds JSON-LD structured data to help search engines understand the site
 */
export function StructuredData() {
  useEffect(() => {
    // Organization Schema
    const organizationSchema = {
      '@type': 'Organization',
      name: 'Contndr',
      description: 'The comprehensive operating system for modern sales teams. Replace Salesforce, Apollo, Instantly, Calendly, and Outreach with one powerful platform.',
      url: 'https://contndr.com',
      logo: 'https://contndr.com/logo.png',
      sameAs: [
        'https://www.tiktok.com/@contndrhq',
        'https://www.instagram.com/contndrhq',
        'https://www.linkedin.com/company/contndr',
        'https://x.com/contndrhq',
      ],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'Customer Service',
        email: 'hello@contndr.com',
      },
    };

    // Software Application Schema
    const softwareSchema = {
      '@type': 'SoftwareApplication',
      name: 'Contndr',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      offers: {
        '@type': 'Offer',
        price: '99',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '99',
          priceCurrency: 'USD',
          billingIncrement: 'Month',
        },
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.9',
        reviewCount: '127',
      },
      description: 'Sales automation platform that combines CRM, email campaigns, AI calling, and analytics in one unified system.',
    };

    // Website Schema
    const websiteSchema = {
      '@type': 'WebSite',
      name: 'Contndr',
      url: 'https://contndr.com',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://contndr.com/search?q={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    };

    // Breadcrumb Schema for Homepage
    const breadcrumbSchema = {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: 'https://contndr.com',
        },
      ],
    };

    // FAQ Schema for common questions
    const faqSchema = {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is Contndr?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Contndr is a comprehensive sales automation platform that combines CRM, email campaigns, AI-powered calling, lead generation, and analytics in one unified system. It replaces multiple tools like Salesforce, Apollo, Instantly, Calendly, and Outreach.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does Contndr differ from traditional CRMs?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Unlike traditional CRMs that require multiple integrations, Contndr is an all-in-one operating system for sales teams. It includes built-in email automation, AI voice agents, real-time data enrichment, and advanced analytics without requiring third-party tools.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does Contndr support email automation?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, Contndr includes powerful email automation with multi-channel campaigns, A/B testing, personalization at scale, deliverability monitoring, and automated follow-ups. All campaigns can be tracked and analyzed in real-time.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can Contndr make AI-powered phone calls?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, Contndr includes AI Voice Agents powered by ElevenLabs that can make automated calls, qualify leads, book meetings, and handle objections. All calls are recorded, transcribed, and analyzed for insights.',
          },
        },
      ],
    };

    // Product Schema
    const productSchema = {
      '@type': 'Product',
      name: 'Contndr Sales Automation Platform',
      description: 'All-in-one sales operating system for modern teams. Replace 5+ tools with one powerful platform.',
      brand: {
        '@type': 'Brand',
        name: 'Contndr',
      },
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'USD',
        lowPrice: '49',
        highPrice: '499',
        offerCount: '3',
        priceSpecification: [
          {
            '@type': 'UnitPriceSpecification',
            price: '49',
            priceCurrency: 'USD',
            name: 'Starter Plan',
          },
          {
            '@type': 'UnitPriceSpecification',
            price: '199',
            priceCurrency: 'USD',
            name: 'Professional Plan',
          },
          {
            '@type': 'UnitPriceSpecification',
            price: '499',
            priceCurrency: 'USD',
            name: 'Growth Plan',
          },
        ],
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.9',
        reviewCount: '127',
        bestRating: '5',
        worstRating: '1',
      },
    };

    // Combine all schemas in proper JSON-LD @graph format
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        organizationSchema,
        softwareSchema,
        websiteSchema,
        breadcrumbSchema,
        faqSchema,
        productSchema,
      ],
    };

    // Add to document head
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(structuredData);
    script.id = 'structured-data';
    document.head.appendChild(script);

    // Cleanup
    return () => {
      const existingScript = document.getElementById('structured-data');
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);

  return null;
}
