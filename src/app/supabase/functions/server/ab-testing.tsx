/**
 * A/B TESTING ENGINE MODULE
 * 
 * Features:
 * - Split test 2-5 email variations
 * - Auto-select winner after threshold
 * - Test subject lines, body, CTAs separately
 * - Real-time performance tracking
 */

import * as kv from "./kv-retry.tsx";

export interface ABTestVariant {
  id: string;
  name: string;
  subjectLine: string;
  emailBody: string;
  ctaText?: string;
  ctaUrl?: string;
  
  // Performance metrics
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  
  // Calculated rates
  openRate: number;
  clickRate: number;
  replyRate: number;
  conversionRate: number;
  
  // Statistical significance
  confidence: number; // 0-100
}

export interface ABTest {
  id: string;
  campaignId: string;
  name: string;
  description?: string;
  brand: 'roadr' | 'sourcr';
  
  // Test configuration
  testType: 'subject' | 'body' | 'cta' | 'full'; // What's being tested
  variants: ABTestVariant[];
  
  // Test settings
  sampleSize: number; // How many emails before picking winner
  winnerMetric: 'open_rate' | 'click_rate' | 'reply_rate'; // What defines success
  minConfidence: number; // Minimum confidence level (80-95%)
  
  // Test status
  status: 'draft' | 'running' | 'completed' | 'paused';
  startedAt?: string;
  completedAt?: string;
  winnerId?: string;
  
  // Distribution
  leadAssignments: { [leadId: string]: string }; // leadId -> variantId
  
  createdAt: string;
  updatedAt: string;
}

/**
 * Create new A/B test
 */
export async function createABTest(testData: {
  campaignId: string;
  name: string;
  description?: string;
  brand: 'roadr' | 'sourcr';
  testType: 'subject' | 'body' | 'cta' | 'full';
  variants: Array<{
    name: string;
    subjectLine: string;
    emailBody: string;
    ctaText?: string;
    ctaUrl?: string;
  }>;
  sampleSize?: number;
  winnerMetric?: 'open_rate' | 'click_rate' | 'reply_rate';
  minConfidence?: number;
}): Promise<ABTest> {
  try {
    const testId = `abtest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Validate variants
    if (testData.variants.length < 2 || testData.variants.length > 5) {
      throw new Error('Must have 2-5 variants');
    }

    // Create variants with IDs and initial metrics
    const variants: ABTestVariant[] = testData.variants.map((v, index) => ({
      id: `variant_${testId}_${index}`,
      name: v.name,
      subjectLine: v.subjectLine,
      emailBody: v.emailBody,
      ctaText: v.ctaText,
      ctaUrl: v.ctaUrl,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      replied: 0,
      bounced: 0,
      openRate: 0,
      clickRate: 0,
      replyRate: 0,
      conversionRate: 0,
      confidence: 0,
    }));

    const abTest: ABTest = {
      id: testId,
      campaignId: testData.campaignId,
      name: testData.name,
      description: testData.description,
      brand: testData.brand,
      testType: testData.testType,
      variants,
      sampleSize: testData.sampleSize || 100, // Default: pick winner after 100 sends
      winnerMetric: testData.winnerMetric || 'open_rate',
      minConfidence: testData.minConfidence || 85, // 85% confidence
      status: 'draft',
      leadAssignments: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`abtest:${testId}`, abTest);
    
    // Index by campaign
    await indexABTestByCampaign(testData.campaignId, testId);

    console.log(`A/B test created: ${testId}`);
    return abTest;
  } catch (error) {
    console.error('Error creating A/B test:', error);
    throw error;
  }
}

/**
 * Assign lead to variant (round-robin or weighted distribution)
 */
export async function assignLeadToVariant(
  testId: string, 
  leadId: string
): Promise<ABTestVariant> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (!test) {
      throw new Error('A/B test not found');
    }

    // Check if lead already assigned
    if (test.leadAssignments[leadId]) {
      const variantId = test.leadAssignments[leadId];
      return test.variants.find(v => v.id === variantId)!;
    }

    // Assign to variant with least sends (ensures even distribution)
    const sortedVariants = [...test.variants].sort((a, b) => a.sent - b.sent);
    const selectedVariant = sortedVariants[0];

    // Update assignment
    test.leadAssignments[leadId] = selectedVariant.id;
    test.updatedAt = new Date().toISOString();
    await kv.set(`abtest:${testId}`, test);

    return selectedVariant;
  } catch (error) {
    console.error('Error assigning lead to variant:', error);
    throw error;
  }
}

/**
 * Get variant for a specific lead
 */
export async function getVariantForLead(
  testId: string,
  leadId: string
): Promise<ABTestVariant | null> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (!test || !test.leadAssignments[leadId]) {
      return null;
    }

    const variantId = test.leadAssignments[leadId];
    return test.variants.find(v => v.id === variantId) || null;
  } catch (error) {
    console.error('Error getting variant for lead:', error);
    return null;
  }
}

/**
 * Track email event for variant
 */
export async function trackVariantEvent(
  testId: string,
  variantId: string,
  event: 'sent' | 'delivered' | 'opened' | 'clicked' | 'replied' | 'bounced'
): Promise<void> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (!test) {
      throw new Error('A/B test not found');
    }

    const variant = test.variants.find(v => v.id === variantId);
    if (!variant) {
      throw new Error('Variant not found');
    }

    // Increment counter
    variant[event]++;

    // Recalculate rates
    if (variant.sent > 0) {
      variant.openRate = (variant.opened / variant.sent) * 100;
      variant.clickRate = (variant.clicked / variant.sent) * 100;
      variant.replyRate = (variant.replied / variant.sent) * 100;
      
      // Conversion rate = replies / sent (can customize this)
      variant.conversionRate = variant.replyRate;
    }

    test.updatedAt = new Date().toISOString();
    await kv.set(`abtest:${testId}`, test);

    // Check if we should pick a winner
    const totalSent = test.variants.reduce((sum, v) => sum + v.sent, 0);
    if (test.status === 'running' && totalSent >= test.sampleSize) {
      await determineWinner(testId);
    }
  } catch (error) {
    console.error('Error tracking variant event:', error);
  }
}

/**
 * Determine winner based on statistical significance
 */
async function determineWinner(testId: string): Promise<void> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (!test) return;

    // Get metric to compare
    const metricKey = test.winnerMetric === 'open_rate' ? 'openRate' :
                      test.winnerMetric === 'click_rate' ? 'clickRate' :
                      'replyRate';

    // Calculate statistical significance
    const variantsWithConfidence = test.variants.map(variant => {
      const confidence = calculateConfidence(
        variant,
        test.variants,
        metricKey
      );
      return { ...variant, confidence };
    });

    // Find variant with highest performance
    const sortedByPerformance = [...variantsWithConfidence].sort(
      (a, b) => b[metricKey] - a[metricKey]
    );

    const winner = sortedByPerformance[0];

    // Check if winner meets confidence threshold
    if (winner.confidence >= test.minConfidence) {
      test.winnerId = winner.id;
      test.status = 'completed';
      test.completedAt = new Date().toISOString();
      test.variants = variantsWithConfidence;
      
      await kv.set(`abtest:${testId}`, test);

      console.log(`A/B test ${testId} completed. Winner: ${winner.name} (${winner.confidence}% confidence)`);
    }
  } catch (error) {
    console.error('Error determining winner:', error);
  }
}

/**
 * Calculate statistical confidence for a variant
 * Using simplified z-test for proportions
 */
function calculateConfidence(
  variant: ABTestVariant,
  allVariants: ABTestVariant[],
  metric: 'openRate' | 'clickRate' | 'replyRate'
): number {
  try {
    // Need at least 30 samples for statistical significance
    if (variant.sent < 30) return 0;

    // Compare against other variants
    const otherVariants = allVariants.filter(v => v.id !== variant.id);
    if (otherVariants.length === 0) return 0;

    const thisRate = variant[metric] / 100;
    const avgOtherRate = otherVariants.reduce((sum, v) => sum + v[metric], 0) / 
                         otherVariants.length / 100;

    // Simple confidence calculation (0-100)
    const difference = Math.abs(thisRate - avgOtherRate);
    const sampleSize = variant.sent;
    
    // Rough confidence based on sample size and difference
    let confidence = 0;
    
    if (sampleSize >= 30 && difference > 0.05) confidence = 70;
    if (sampleSize >= 50 && difference > 0.10) confidence = 80;
    if (sampleSize >= 100 && difference > 0.10) confidence = 85;
    if (sampleSize >= 200 && difference > 0.15) confidence = 90;
    if (sampleSize >= 500 && difference > 0.20) confidence = 95;

    return Math.min(confidence, 99);
  } catch (error) {
    console.error('Error calculating confidence:', error);
    return 0;
  }
}

/**
 * Get A/B test by ID
 */
export async function getABTest(testId: string): Promise<ABTest | null> {
  try {
    return await kv.get(`abtest:${testId}`) as ABTest | null;
  } catch (error) {
    console.error('Error getting A/B test:', error);
    return null;
  }
}

/**
 * Get all A/B tests for a campaign
 */
export async function getABTestsForCampaign(campaignId: string): Promise<ABTest[]> {
  try {
    const indexKey = `abtest:index:campaign:${campaignId}`;
    const testIds = await kv.get(indexKey) as string[] || [];
    
    const tests: ABTest[] = [];
    for (const testId of testIds) {
      const test = await kv.get(`abtest:${testId}`) as ABTest;
      if (test) tests.push(test);
    }

    return tests;
  } catch (error) {
    console.error('Error getting A/B tests for campaign:', error);
    return [];
  }
}

/**
 * Get all A/B tests
 */
export async function getAllABTests(): Promise<ABTest[]> {
  try {
    const allTests = await kv.getByPrefix('abtest:');
    return allTests.filter(t => {
      const test = t as any;
      return test.id && test.variants; // Filter out index entries
    }) as ABTest[];
  } catch (error) {
    console.error('Error getting all A/B tests:', error);
    return [];
  }
}

/**
 * Start A/B test
 */
export async function startABTest(testId: string): Promise<void> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (!test) {
      throw new Error('A/B test not found');
    }

    test.status = 'running';
    test.startedAt = new Date().toISOString();
    test.updatedAt = new Date().toISOString();

    await kv.set(`abtest:${testId}`, test);
    console.log(`A/B test ${testId} started`);
  } catch (error) {
    console.error('Error starting A/B test:', error);
    throw error;
  }
}

/**
 * Pause A/B test
 */
export async function pauseABTest(testId: string): Promise<void> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (!test) {
      throw new Error('A/B test not found');
    }

    test.status = 'paused';
    test.updatedAt = new Date().toISOString();

    await kv.set(`abtest:${testId}`, test);
    console.log(`A/B test ${testId} paused`);
  } catch (error) {
    console.error('Error pausing A/B test:', error);
    throw error;
  }
}

/**
 * Delete A/B test
 */
export async function deleteABTest(testId: string): Promise<void> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (test) {
      // Remove from campaign index
      await removeABTestFromCampaignIndex(test.campaignId, testId);
    }

    await kv.del(`abtest:${testId}`);
    console.log(`A/B test ${testId} deleted`);
  } catch (error) {
    console.error('Error deleting A/B test:', error);
    throw error;
  }
}

/**
 * Index A/B test by campaign
 */
async function indexABTestByCampaign(campaignId: string, testId: string): Promise<void> {
  try {
    const indexKey = `abtest:index:campaign:${campaignId}`;
    let testIds = await kv.get(indexKey) as string[] || [];
    
    if (!testIds.includes(testId)) {
      testIds.push(testId);
      await kv.set(indexKey, testIds);
    }
  } catch (error) {
    console.error('Error indexing A/B test:', error);
  }
}

/**
 * Remove A/B test from campaign index
 */
async function removeABTestFromCampaignIndex(campaignId: string, testId: string): Promise<void> {
  try {
    const indexKey = `abtest:index:campaign:${campaignId}`;
    let testIds = await kv.get(indexKey) as string[] || [];
    
    testIds = testIds.filter(id => id !== testId);
    await kv.set(indexKey, testIds);
  } catch (error) {
    console.error('Error removing A/B test from index:', error);
  }
}

/**
 * Get A/B test statistics
 */
export async function getABTestStats(testId: string): Promise<{
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  avgOpenRate: number;
  avgClickRate: number;
  avgReplyRate: number;
  leader: ABTestVariant | null;
  winner: ABTestVariant | null;
}> {
  try {
    const test = await kv.get(`abtest:${testId}`) as ABTest;
    if (!test) {
      throw new Error('A/B test not found');
    }

    const totalSent = test.variants.reduce((sum, v) => sum + v.sent, 0);
    const totalOpened = test.variants.reduce((sum, v) => sum + v.opened, 0);
    const totalClicked = test.variants.reduce((sum, v) => sum + v.clicked, 0);
    const totalReplied = test.variants.reduce((sum, v) => sum + v.replied, 0);

    const avgOpenRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0;
    const avgClickRate = totalSent > 0 ? (totalClicked / totalSent) * 100 : 0;
    const avgReplyRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;

    // Get current leader
    const metricKey = test.winnerMetric === 'open_rate' ? 'openRate' :
                      test.winnerMetric === 'click_rate' ? 'clickRate' :
                      'replyRate';
    const sortedByMetric = [...test.variants].sort((a, b) => b[metricKey] - a[metricKey]);
    const leader = sortedByMetric[0];

    // Get winner if test is completed
    const winner = test.winnerId ? 
      test.variants.find(v => v.id === test.winnerId) || null : 
      null;

    return {
      totalSent,
      totalOpened,
      totalClicked,
      totalReplied,
      avgOpenRate,
      avgClickRate,
      avgReplyRate,
      leader,
      winner,
    };
  } catch (error) {
    console.error('Error getting A/B test stats:', error);
    return {
      totalSent: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalReplied: 0,
      avgOpenRate: 0,
      avgClickRate: 0,
      avgReplyRate: 0,
      leader: null,
      winner: null,
    };
  }
}