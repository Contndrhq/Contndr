// API Diagnostics Tool for Contndr
// Tests Icypeas and Serper connectivity and functionality

import { runSerpDiagnostics } from "./serp-adapter.tsx";
import { testIcypeas } from "./icypeas.tsx";

interface ApiTestResult {
  service: string;
  status: 'success' | 'error' | 'warning' | 'not_configured';
  message: string;
  details?: any;
  credits_remaining?: number;
  rate_limit?: string;
  response_time_ms?: number;
}

interface DiagnosticReport {
  timestamp: string;
  overall_status: 'healthy' | 'degraded' | 'critical';
  results: ApiTestResult[];
  recommendations: string[];
}

/**
 * Hunter.io is intentionally disabled. Email enrichment should use Icypeas
 * plus the mailbox verification gate.
 */
async function testHunterIO(): Promise<ApiTestResult> {
  return {
    service: "Hunter.io",
    status: "not_configured",
    message: "Disabled by Contndr configuration; Icypeas is the active enrichment provider"
  };
}

/**
 * Test Icypeas API connectivity and functionality
 */
async function testIcypeasProvider(): Promise<ApiTestResult> {
  const apiKey = Deno.env.get("ICYPEAS_API_KEY");
  
  if (!apiKey) {
    return {
      service: "Icypeas",
      status: "not_configured",
      message: "ICYPEAS_API_KEY not configured in environment variables"
    };
  }

  const startTime = Date.now();
  
  try {
    const result = await testIcypeas();
    const responseTime = Date.now() - startTime;
    
    if (result.status === 402) {
      return {
        service: "Icypeas",
        status: "error",
        message: "API key has exhausted all credits (HTTP 402 Payment Required)",
        credits_remaining: 0,
        response_time_ms: responseTime
      };
    }

    if (result.status === 429) {
      return {
        service: "Icypeas",
        status: "warning",
        message: "Rate limit exceeded. Wait before making more requests.",
        response_time_ms: responseTime,
        rate_limit: "Unknown"
      };
    }

    if (result.status === 401 || result.status === 403) {
      return {
        service: "Icypeas",
        status: "error",
        message: `API key is invalid or does not have permission (HTTP ${result.status})`,
        response_time_ms: responseTime
      };
    }

    if (!result.ok) {
      return {
        service: "Icypeas",
        status: "error",
        message: result.status ? `API returned HTTP ${result.status}` : `Connection failed: ${result.error || "unknown error"}`,
        response_time_ms: responseTime,
        details: result.data
      };
    }

    // Test was successful - the API is working
    return {
      service: "Icypeas",
      status: "success",
      message: "✅ Fully functional (verification endpoint responding)",
      response_time_ms: responseTime,
      details: {
        testResult: result.data,
        note: "Cannot determine exact credit balance via API. Monitor usage in Icypeas dashboard."
      }
    };

  } catch (error) {
    return {
      service: "Icypeas",
      status: "error",
      message: `Connection failed: ${(error as Error).message}`,
      response_time_ms: Date.now() - startTime
    };
  }
}

/**
 * Test SerpAPI connectivity and functionality
 */
async function testSerpAPI(): Promise<ApiTestResult> {
  const startTime = Date.now();
  
  try {
    const diag = await runSerpDiagnostics();
    const responseTime = Date.now() - startTime;

    if (!diag.SERPER_API_KEY_set && !diag.SERPAPI_API_KEY_set) {
      return {
        service: "Serper",
        status: "not_configured",
        message: "SERPER_API_KEY not configured in environment variables",
        response_time_ms: responseTime,
        details: diag,
      };
    }

    return {
      service: "Serper",
      status: diag.verdict?.startsWith("Adapter working") ? "success" : "warning",
      message: diag.verdict || "Serper diagnostics completed",
      response_time_ms: responseTime,
      details: diag,
    };

  } catch (error) {
    return {
      service: "Serper",
      status: "error",
      message: `Connection failed: ${(error as Error).message}`,
      response_time_ms: Date.now() - startTime
    };
  }
}

/**
 * Run all API diagnostics and generate a comprehensive report
 */
export async function runFullDiagnostics(): Promise<DiagnosticReport> {
  console.log('[DIAGNOSTICS] Starting API diagnostics...');
  
  const [hunterResult, icypeasResult, serpApiResult] = await Promise.all([
    testHunterIO(),
    testIcypeasProvider(),
    testSerpAPI()
  ]);

  const results = [hunterResult, icypeasResult, serpApiResult];
  
  // Determine overall health status
  const hasErrors = results.some(r => r.status === 'error');
  const hasWarnings = results.some(r => r.status === 'warning');
  const hasNotConfigured = results.some(r => r.status === 'not_configured');
  
  let overallStatus: 'healthy' | 'degraded' | 'critical';
  if (hasErrors) {
    overallStatus = 'critical';
  } else if (hasWarnings || hasNotConfigured) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  // Generate recommendations
  const recommendations: string[] = [];
  
  for (const result of results) {
    if (result.service === 'Hunter.io') continue;
    if (result.status === 'not_configured') {
      recommendations.push(`Configure ${result.service} API key in environment variables`);
    } else if (result.status === 'error') {
      if (result.credits_remaining === 0) {
        recommendations.push(`${result.service}: Purchase additional credits or upgrade plan`);
      } else {
        recommendations.push(`${result.service}: ${result.message}`);
      }
    } else if (result.status === 'warning') {
      recommendations.push(`${result.service}: Review and resolve warning - ${result.message}`);
    }
  }

  // Check if at least one enrichment provider is working
  const enrichmentProviders = [icypeasResult];
  const hasWorkingEnrichmentProvider = enrichmentProviders.some(r => r.status === 'success');
  
  if (!hasWorkingEnrichmentProvider) {
    recommendations.push('⚠️ CRITICAL: Icypeas is not working. Email enrichment will fail.');
  }

  if (recommendations.length === 0) {
    recommendations.push('✅ All systems operational');
  }

  const report: DiagnosticReport = {
    timestamp: new Date().toISOString(),
    overall_status: overallStatus,
    results,
    recommendations
  };

  console.log('[DIAGNOSTICS] Diagnostic report generated:', {
    overall_status: overallStatus,
    results_summary: results.map(r => ({ service: r.service, status: r.status }))
  });

  return report;
}

/**
 * Quick health check - returns simplified status
 */
export async function quickHealthCheck(): Promise<{
  healthy: boolean;
  services: { name: string; status: string }[];
}> {
  const report = await runFullDiagnostics();
  
  return {
    healthy: report.overall_status === 'healthy',
    services: report.results.map(r => ({
      name: r.service,
      status: r.status
    }))
  };
}
