// Mapbox Configuration
// Get your token from: https://account.mapbox.com/access-tokens/

// Priority:
// 1. Environment variable (VITE_MAPBOX_ACCESS_TOKEN)
// 2. Backend endpoint (/config/mapbox)

export const mapboxToken = (import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN || "";
