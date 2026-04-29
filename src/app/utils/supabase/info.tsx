const fallbackProjectId = "zylftkvcasvznhkmyzfj";
const fallbackAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5bGZ0a3ZjYXN2em5oa215emZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDUzNjMsImV4cCI6MjA4MDk4MTM2M30.a7aLtexQRJKpt3OlmYjKLLtMcQssijcEc3V3tluztPw";

const env = import.meta.env;
const configuredUrl = env.VITE_SUPABASE_URL || "";
const configuredProjectId = env.VITE_SUPABASE_PROJECT_ID || "";

function projectIdFromUrl(url: string) {
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

export const projectId = configuredProjectId || projectIdFromUrl(configuredUrl) || fallbackProjectId;
export const supabaseUrl = configuredUrl || `https://${projectId}.supabase.co`;
export const publicAnonKey = env.VITE_SUPABASE_ANON_KEY || fallbackAnonKey;
export const edgeFunctionName = env.VITE_SUPABASE_EDGE_FUNCTION || "make-server-a8b2511f";
export const edgeFunctionBaseUrl = `${supabaseUrl}/functions/v1/${edgeFunctionName}`;
