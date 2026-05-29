// API Diagnostics Tool for Contndr
// Tests Hunter.io, Findymail, and SerpAPI connectivity and functionality

import { runSerpDiagnostics } from "./serp-adapter.tsx";

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
 * Test Hunter.io API connectivity and functionality
 */
async function testHunterIO(): Promise<ApiTestResult> {
  const apiKey = Deno.env.get("HUNTER_API_KEY");
  
  if (!apiKey) {
    return {
      service: "Hunter.io",
      status: "not_configured",
      message: "API key not configured in environment variables"
    };
  }

  const startTime = Date.now();
  
  try {
    // Test 1: Verify API key with account info endpoint
    const accountResponse = await fetch(
      `https://api.hunter.io/v2/account?api_key=${apiKey}`
    );
    
    const responseTime = Date.now() - startTime;
    
    if (!accountResponse.ok) {
      return {
        service: "Hunter.io",
        status: "error",
        message: `API returned HTTP ${accountResponse.status}: ${accountResponse.statusText}`,
        response_time_ms: responseTime,
        details: await accountResponse.text()
      };
    }

    const accountData = await accountResponse.json();
    const data = accountData.data || {};
    
    // Check remaining requests
    const requestsRemaining = data.requests?.searches?.available || 0;
    const requestsUsed = data.requests?.searches?.used || 0;
    const requestsLimit = (data.requests?.searches?.available || 0) + (data.requests?.searches?.used || 0);
    
    if (requestsRemaining === 0) {
      return {
        service: "Hunter.io",
        status: "error",
        message: "API key has exhausted all credits",
        credits_remaining: 0,
        response_time_ms: responseTime,
        details: { requestsUsed, requestsLimit }
      };
    }

    // Test 2: Perform a simple email verification
    const testEmail = "test@example.com";
    const verifyResponse = await fetch(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(testEmail)}&api_key=${apiKey}`
    );

    if (!verifyResponse.ok) {
      return {
        service: "Hunter.io",
        status: "warning",
        message: "Account info accessible but verification endpoint failed",
        credits_remaining: requestsRemaining,
        response_time_ms: responseTime,
        details: { error: await verifyResponse.text() }
      };
    }

    return {
      service: "Hunter.io",
      status: "success",
      message: `✅ Fully functional with ${requestsRemaining.toLocaleString()} credits remaining`,
      credits_remaining: requestsRemaining,
      rate_limit: data.plan_name || "Unknown plan",
      response_time_ms: responseTime,
      details: {
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        requestsUsed,
        requestsLimit,
        resetDate: data.reset_date
      }
    };

  } catch (error) {
    return {
      service: "Hunter.io",
      status: "error",
      message: `Connection failed: ${(error as Error).message}`,
      response_time_ms: Date.now() - startTime
    };
  }
}

/**
 * Test Findymail API connectivity and functionality
 */
async function testFindymail(): Promise<ApiTestResult> {
  const apiKey = Deno.env.get("FINDYMAIL_API_KEY");
  
  if (!apiKey) {
    return {
      service: "Findymail",
      status: "not_configured",
      message: "API key not configured in environment variables"
    };
  }

  const startTime = Date.now();
  
  try {
    // Test email verification endpoint
    const testEmail = "test@example.com";
    const response = await fetch(
      `https://app.findymail.com/api/verify/single?email=${encodeURIComponent(testEmail)}`,
      {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}` }
      }
    );
    
    const responseTime = Date.now() - startTime;
    
    if (response.status === 402) {
      return {
        service: "Findymail",
        status: "error",
        message: "API key has exhausted all credits (HTTP 402 Payment Required)",
        credits_remaining: 0,
        response_time_ms: responseTime
      };
    }

    if (response.status === 429) {
      return {
        service: "Findymail",
        status: "warning",
        message: "Rate limit exceeded. Wait before making more requests.",
        response_time_ms: responseTime,
        rate_limit: response.headers.get("X-RateLimit-Remaining") || "Unknown"
      };
    }

    if (response.status === 403) {
      return {
        service: "Findymail",
        status: "error",
        message: "API key is invalid or does not have permission (HTTP 403 Forbidden)",
        response_time_ms: responseTime
      };
    }

    if (!response.ok) {
      return {
        service: "Findymail",
        status: "error",
        message: `API returned HTTP ${response.status}: ${response.statusText}`,
        response_time_ms: responseTime,
        details: await response.text()
      };
    }

    const data = await response.json();
    
    // Test was successful - the API is working
    return {
      service: "Findymail",
      status: "success",
      message: "✅ Fully functional (verification endpoint responding)",
      response_time_ms: responseTime,
      details: {
        testResult: data,
        note: "Cannot determine exact credit balance via API. Monitor usage in Findymail dashboard."
      }
    };

  } catch (error) {
    return {
      service: "Findymail",
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
  
  const [hunterResult, findymailResult, serpApiResult] = await Promise.all([
    testHunterIO(),
    testFindymail(),
    testSerpAPI()
  ]);

  const results = [hunterResult, findymailResult, serpApiResult];
  
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
  const enrichmentProviders = [hunterResult, findymailResult];
  const hasWorkingEnrichmentProvider = enrichmentProviders.some(r => r.status === 'success');
  
  if (!hasWorkingEnrichmentProvider) {
    recommendations.push('⚠️ CRITICAL: No working email enrichment provider (Hunter.io or Findymail). Lead enrichment will fail.');
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
