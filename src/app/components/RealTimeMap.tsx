import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import Map, {
  NavigationControl,
  MapRef,
} from "react-map-gl";
import mapboxgl from "mapbox-gl";
import {
  Loader2,
  Focus,
  Maximize2,
  Minimize2,
  Phone,
  Mail,
  Globe,
  MapPin,
  Clock,
  Layout,
  X,
} from "lucide-react";
import { projectId } from "../utils/supabase/info";
import { authenticatedFetch } from "../lib/auth";
import { mapboxToken } from "../utils/mapbox/config";
import { useTranslation } from 'react-i18next';
import { AIQuickCall } from "./AIQuickCall";
import { SmartPhoneButton } from "./SmartPhoneButton";

type Visit = any;

/**
 * Convert visits to GeoJSON for WebGL circle layer rendering.
 * 
 * Why WebGL layers instead of DOM markers?
 * ✅ No CSS/CSP/z-index conflicts
 * ✅ No inline style blocking in production builds
 * ✅ Works identically in Safari/Chrome/Firefox
 * ✅ Survives style switches (dark/light mode)
 * ✅ No stacking context / portal issues
 * ✅ Better performance with many markers
 */
function visitsToGeoJSON(visits: Visit[]) {
  return {
    type: "FeatureCollection" as const,
    features: visits.map((v) => {
      const lat = Number(v.latitude);
      const lng = Number(v.longitude);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
        properties: {
          id: v.id,
          brand: v.brand || "Sourcr",
          // Keep all properties for click handling
          ...v,
        },
      };
    }),
  };
}

export function RealTimeMap({
  visits: propVisits,
  className,
  focusedVisitId,
  forceDarkMode,
  initialZoom,
  animateToZoom,
}: {
  visits?: Visit[];
  className?: string;
  focusedVisitId?: string;
  forceDarkMode?: boolean;
  /** Starting zoom level (default 1.5) */
  initialZoom?: number;
  /** If set, the map will smoothly fly from initialZoom to this zoom after loading */
  animateToZoom?: number;
}) {
  const { t } = useTranslation();
  const [internalVisits, setInternalVisits] = useState<Visit[]>(
    [],
  );
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [popupInfo, setPopupInfo] = useState<Visit | null>(
    null,
  );
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapKey, setMapKey] = useState(0); // forces re-mount if needed
  const [webglOk, setWebglOk] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [readyToRenderMap, setReadyToRenderMap] = useState(false);

  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstCenterRef = useRef(false);
  // Pixel position for custom popup (bypasses Mapbox popup DOM entirely)
  const [popupPixel, setPopupPixel] = useState<{ x: number; y: number } | null>(null);

  const visits = propVisits || internalVisits;

  // ---------- Ensure DOM is ready before rendering map (fixes "container must be String or HTMLElement") ----------
  useEffect(() => {
    setReadyToRenderMap(false);
    // Give the DOM a moment to settle (especially for Portals)
    const timer = setTimeout(() => {
      setReadyToRenderMap(true);
    }, 100);
    return () => clearTimeout(timer);
  }, [isExpanded]);

  // ---------- Debug log for mapLoaded state ----------
  useEffect(() => {
    console.log('[RealTimeMap] mapLoaded state changed:', mapLoaded);
  }, [mapLoaded]);

  // ---------- WebGL support guard (prevents silent black maps on some browsers/devices) ----------
  useEffect(() => {
    try {
      const supported =
        mapboxgl &&
        typeof (mapboxgl as any).supported === "function"
          ? (mapboxgl as any).supported()
          : true;
      setWebglOk(!!supported);
    } catch {
      setWebglOk(true);
    }
  }, []);

  // ---------- Dark mode tracking ----------
  useEffect(() => {
    const checkDarkMode = () => {
      const isDark = document.documentElement.classList.contains("dark");
      console.log('[RealTimeMap] Dark mode check:', isDark);
      setIsDarkMode(isDark);
    };
    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // ---------- ESC to exit fullscreen ----------
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () =>
      window.removeEventListener("keydown", handleEsc);
  }, []);

  // ---------- Prevent body scroll when fullscreen ----------
  useEffect(() => {
    if (isExpanded) {
      // Store original overflow value
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      return () => {
        // Restore original overflow when exiting fullscreen
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isExpanded]);

  // ---------- Clean up tooltips on unmount/resize ----------
  useEffect(() => {
    // Hide any lingering popups when switching modes
    const popups = document.getElementsByClassName('mapboxgl-popup');
    for (let i = 0; i < popups.length; i++) {
        (popups[i] as HTMLElement).style.display = 'none';
    }
  }, [isExpanded]);

  // ---------- Resize helpers ----------
  const hardResize = useCallback((label?: string) => {
    const m = mapRef.current?.getMap?.();
    if (!m) {
      console.log('[RealTimeMap] hardResize skipped (no map):', label);
      return;
    }
    
    // Check if the map container has dimensions
    const container = m.getContainer();
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) {
      console.log('[RealTimeMap] hardResize skipped (no dimensions):', label);
      return;
    }
    
    // Check if canvas exists and is valid
    const canvas = m.getCanvas();
    if (!canvas) {
      console.log('[RealTimeMap] hardResize skipped (no canvas):', label);
      return;
    }
    
    try {
      // Important: resize + repaint
      m.resize();
      m.triggerRepaint();
      console.log('[RealTimeMap] hardResize:', label, `${container.offsetWidth}x${container.offsetHeight}`);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn('[RealTimeMap] hardResize error:', errorMsg);
    }
  }, []);

  // ResizeObserver for container size changes
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Small delay to ensure the container is fully rendered in the DOM
    let ro: ResizeObserver | null = null;
    
    const timer = setTimeout(() => {
      if (containerRef.current) {
        ro = new ResizeObserver(() => {
          hardResize("ResizeObserver");
        });
        ro.observe(containerRef.current);
        console.log('[RealTimeMap] ResizeObserver attached, mode:', isExpanded ? 'fullscreen' : 'embedded');
      }
    }, 50);
    
    return () => {
      clearTimeout(timer);
      if (ro) {
        ro.disconnect();
        console.log('[RealTimeMap] ResizeObserver disconnected');
      }
    };
  }, [isExpanded, hardResize]); // Re-attach when mode changes (DOM node likely changes)

  // Resize on window resize
  useEffect(() => {
    const onResize = () => hardResize("window.resize");
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Resize when tab becomes visible again (fixes “blank until click”)
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) {
        setTimeout(() => hardResize("visibilitychange.50"), 50);
        setTimeout(
          () => hardResize("visibilitychange.250"),
          250,
        );
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () =>
      document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Trigger resize when fullscreen changes
  useEffect(() => {
    // Start transition
    setIsTransitioning(true);
    
    // Reset state for the new map instance
    setMapLoaded(false);
    firstCenterRef.current = false;
    
    // When entering fullscreen, give the portal time to render then force resize
    if (isExpanded) {
      // Multiple resize attempts to ensure the fullscreen container is properly detected
      setTimeout(() => hardResize("fullscreen.entry.100"), 100);
      setTimeout(() => hardResize("fullscreen.entry.250"), 250);
      setTimeout(() => hardResize("fullscreen.entry.500"), 500);
    }
    
  }, [isExpanded, hardResize]);

  // ---------- Focused visit flyTo ----------
  useEffect(() => {
    if (
      !focusedVisitId ||
      !mapRef.current ||
      visits.length === 0
    )
      return;
    const targetVisit = visits.find(
      (v) => v.id === focusedVisitId,
    );
    if (!targetVisit) return;

    const lat = parseFloat(String(targetVisit.latitude));
    const lng = parseFloat(String(targetVisit.longitude));
    if (isNaN(lat) || isNaN(lng)) return;

    setPopupInfo(targetVisit);

    // Ensure map is sized before flyTo
    hardResize("before.flyTo");
    mapRef.current.flyTo({
      center: [lng, lat],
      zoom: 11,
      duration: 1200,
      padding: { top: 120, bottom: 60, left: 60, right: 60 },
    });
  }, [focusedVisitId, visits]);

  // ---------- Brand keys ----------
  const brandKeys = useMemo(() => {
    const keys = new Set<string>();
    visits.forEach((v) => {
      if (v.brand) keys.add(v.brand);
    });
    return Array.from(keys).sort();
  }, [visits]);

  // ---------- Fix for black screen on popup open ----------
  useEffect(() => {
    if (popupInfo && mapRef.current?.getMap()) {
      const map = mapRef.current.getMap();
      
      // Force multiple repaints to ensure canvas doesn't get cleared
      requestAnimationFrame(() => {
        try {
          map.triggerRepaint();
          
          // Also ensure canvas is visible
          const canvas = map.getCanvas();
          if (canvas) {
            canvas.style.visibility = 'visible';
            canvas.style.display = 'block';
            canvas.style.opacity = '1';
          }
        } catch (err) {
          console.warn('[RealTimeMap] Repaint error:', err);
        }
      });
      
      // Additional repaint after a short delay
      setTimeout(() => {
        try {
          map.triggerRepaint();
        } catch (err) {
          // ignore
        }
      }, 50);
    }
  }, [popupInfo]);

  // ---------- Load token ----------
  useEffect(() => {
    const loadMapboxToken = async () => {
      const isValidToken =
        mapboxToken &&
        mapboxToken.startsWith("pk.") &&
        !mapboxToken.includes(".example") &&
        mapboxToken.length > 50;

      if (isValidToken) {
        setToken(mapboxToken);
        setLoading(false);
        return;
      }

      if (!projectId) {
        setError(
          "Configuration error: Project ID not found. Please update /utils/mapbox/config.tsx",
        );
        setLoading(false);
        return;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          10000,
        );

        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/config/mapbox`,
          { signal: controller.signal },
        ).finally(() => clearTimeout(timeoutId));

        if (!res.ok)
          throw new Error(
            `Backend returned HTTP ${res.status}`,
          );

        const data = await res.json();
        if (!data.token)
          throw new Error(
            "No Mapbox token in backend response",
          );

        setToken(data.token);
        setLoading(false);
      } catch (err: any) {
        if (err?.name === "AbortError") {
          setError(
            "Backend timeout. Please update the Mapbox token in /utils/mapbox/config.tsx",
          );
        } else {
          setError(
            "Unable to load Mapbox token. Update /utils/mapbox/config.tsx",
          );
        }
        setLoading(false);
      }
    };

    loadMapboxToken();

    if (!propVisits) {
      fetchVisits();
      const interval = setInterval(fetchVisits, 5000);
      return () => clearInterval(interval);
    } else {
      // When using propVisits (e.g., landing page), ensure we're not stuck in loading state
      console.log('[RealTimeMap] Using propVisits, count:', propVisits.length);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propVisits]);

  async function fetchVisits() {
    if (!projectId) {
      console.log('[RealTimeMap] fetchVisits skipped - no projectId');
      setInternalVisits([]);
      setLoading(false);
      return;
    }

    try {
      console.log('[RealTimeMap] Fetching visits from backend...');
      const res = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/live-traffic`,
      );
      if (res.ok) {
        const data = await res.json();
        console.log('[RealTimeMap] Visits fetched successfully:', data.visits?.length || 0, 'visits');
        if (data.visits && data.visits.length > 0) {
          console.log('[RealTimeMap] Sample visit data:', data.visits[0]);
        }
        setInternalVisits(data.visits || []);
        setLoading(false);
      } else {
        console.warn('[RealTimeMap] Failed to fetch visits, status:', res.status);
        setInternalVisits([]);
        setLoading(false);
      }
    } catch (err: any) {
      // Silently handle network/auth errors - map will just show no visits
      console.warn(
        "[RealTimeMap] Unable to fetch visits:",
        err?.message || "Unknown error",
      );
      setInternalVisits([]);
      setLoading(false);
    }
  }

  // ---------- Valid visits ----------
  const validVisits = useMemo(() => {
    console.log('[RealTimeMap] Total visits received:', visits.length);
    const valid = visits.filter((v) => {
      const lat = parseFloat(String(v.latitude));
      const lng = parseFloat(String(v.longitude));
      const isValid = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
      if (!isValid) {
        console.log('[RealTimeMap] Invalid visit filtered out:', { id: v.id, lat, lng, isValid });
      }
      return isValid;
    });
    console.log('[RealTimeMap] Valid visits after filtering:', valid.length);
    if (valid.length > 0) {
      console.log('[RealTimeMap] First valid visit:', valid[0]);
    }
    return valid;
  }, [visits]);

  // ---------- Fit bounds ----------
  const fitToMarkers = useCallback(() => {
    const m = mapRef.current?.getMap?.();
    if (!m || validVisits.length === 0) return;

    hardResize("before.fitBounds");

    let minLng = 180,
      maxLng = -180,
      minLat = 90,
      maxLat = -90;

    validVisits.forEach((v) => {
      const lat = parseFloat(String(v.latitude));
      const lng = parseFloat(String(v.longitude));
      if (isNaN(lat) || isNaN(lng)) return;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });

    if (
      Math.abs(maxLng - minLng) < 0.01 &&
      Math.abs(maxLat - minLat) < 0.01
    ) {
      m.flyTo({
        center: [minLng, minLat],
        zoom: 10,
        duration: 900,
      });
      return;
    }

    m.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, duration: 900 },
    );
  }, [validVisits, hardResize]);

  // Auto-center once
  useEffect(() => {
    // Skip auto-center when animateToZoom is handling the initial camera movement
    if (animateToZoom !== undefined) return;

    console.log('[RealTimeMap] Auto-center check:', { 
      firstCenterDone: firstCenterRef.current, 
      validVisitsCount: validVisits.length, 
      mapLoaded 
    });
    if (
      !firstCenterRef.current &&
      validVisits.length > 0 &&
      mapLoaded
    ) {
      console.log('[RealTimeMap] Auto-centering to markers...');
      setTimeout(() => {
        fitToMarkers();
        firstCenterRef.current = true;
      }, 350);
    }
  }, [validVisits, mapLoaded, fitToMarkers, animateToZoom]);

  // ---------- Force remount if map looks “stuck” after token changes ----------
  useEffect(() => {
    if (!token) return;
    // if needed, re-init map once after token becomes available
    setMapKey((k) => k + 1);
    // and a resize burst
    setTimeout(() => hardResize("token.150"), 150);
    setTimeout(() => hardResize("token.450"), 450);
  }, [token, hardResize]);

  // ---------- WebGL Circle Layer Markers (bulletproof, no DOM/CSS issues) ----------
  useEffect(() => {
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    const SOURCE_ID = "visits-src";
    const LAYER_ID = "visits-circle";

    const colors = ["#1ED4A7", "#10b981", "#34d399", "#6ee7b7", "#059669"];

    const ensureLayer = () => {
      if (!map.isStyleLoaded()) {
        console.log('[RealTimeMap] Style not loaded yet, skipping layer creation');
        return;
      }

      try {
        const data = visitsToGeoJSON(validVisits);

        console.log('[RealTimeMap] Ensuring WebGL circle layer with', validVisits.length, 'visits');

        // Add or update source
        const existing = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (!existing) {
          // Check if layer exists (might happen after style reload)
          const existingLayer = map.getLayer(LAYER_ID);
          if (existingLayer) {
            console.log('[RealTimeMap] Removing stale layer before recreating');
            map.removeLayer(LAYER_ID);
          }

          map.addSource(SOURCE_ID, {
            type: "geojson",
            data: data as any,
          });

          // Add circle layer with 6px radius markers
          map.addLayer({
            id: LAYER_ID,
            type: "circle",
            source: SOURCE_ID,
            paint: {
              // 6px radius (12px diameter)
              "circle-radius": 6,
              // Color based on brand - use match expression for direct mapping
              "circle-color": brandKeys.length > 0 ? [
                "match",
                ["get", "brand"],
                ...brandKeys.flatMap((brand, i) => [brand, colors[i % colors.length]]),
                colors[0] // default color
              ] : colors[0],
              "circle-stroke-width": 1,
              "circle-stroke-color": "#ffffff",
              "circle-opacity": 1,
            },
          });

          // Cursor change on hover
          map.on("mouseenter", LAYER_ID, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", LAYER_ID, () => {
            map.getCanvas().style.cursor = "";
          });

          // Click handler
          map.on("click", LAYER_ID, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const id = (f.properties as any)?.id;
            const visit = validVisits.find((v) => String(v.id) === String(id));
            if (visit) {
              console.log('[RealTimeMap] WebGL marker clicked:', visit.id);
              setPopupInfo(visit);
            }
          });

          console.log('[RealTimeMap] ✅ WebGL circle layer created');
        } else {
          // Update existing source data
          existing.setData(data as any);
          console.log('[RealTimeMap] ✅ WebGL circle layer updated');
        }
      } catch (error) {
        // Avoid circular reference when logging
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[RealTimeMap] Error creating/updating layer:', errorMsg);
      }
    };

    // Run now and after style changes (dark/light mode switches)
    ensureLayer();
    map.on("styledata", ensureLayer);
    map.on("load", ensureLayer); // Also ensure layer on load event

    return () => {
      // Safety check: map might be destroyed during cleanup
      try {
        // Clean up event listeners
        map.off("styledata", ensureLayer);
        map.off("load", ensureLayer);
        
        // Remove layer-specific event listeners if they exist
        // Check if map and style are still valid before accessing layers
        if (map.getStyle && map.getStyle() && map.isStyleLoaded && map.isStyleLoaded()) {
          if (map.getLayer(LAYER_ID)) {
            map.off("mouseenter", LAYER_ID);
            map.off("mouseleave", LAYER_ID);
            map.off("click", LAYER_ID);
          }
        }
      } catch (error) {
        // Silently ignore cleanup errors (map already destroyed)
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log('[RealTimeMap] Cleanup completed with notice:', errorMsg);
      }
    };
  }, [validVisits, brandKeys, mapLoaded]);

  // ---------- Retry resize on mount to fix initial black screen ----------
  useEffect(() => {
    // Sometimes the initial render happens before the container has final dimensions
    // This forces a resize check a bit after mount
    const timer = setTimeout(() => {
        hardResize("mount.retry");
    }, 500);
    return () => clearTimeout(timer);
  }, [hardResize]);

  // ---------- Additional check when transitioning to fullscreen ----------
  useEffect(() => {
    if (isExpanded && containerRef.current) {
      // When portal is created, ensure container is ready
      const checkAndResize = () => {
        if (containerRef.current && mapLoaded) {
          const rect = containerRef.current.getBoundingClientRect();
          console.log('[RealTimeMap] Fullscreen container dimensions:', rect.width, 'x', rect.height);
          
          if (rect.width > 0 && rect.height > 0) {
            hardResize("fullscreen.check");
          } else {
            // Container not ready, try again
            setTimeout(checkAndResize, 100);
          }
        }
      };
      
      // Give the portal time to render
      setTimeout(checkAndResize, 100);
    }
  }, [isExpanded, mapLoaded, hardResize]);

  // ---------- Custom popup pixel position tracking ----------
  // Instead of using Mapbox's <Popup> (which creates DOM elements inside the map
  // that interfere with WebGL rendering and cause black screen), we render a
  // regular React div positioned absolutely over the map container.
  useEffect(() => {
    const map = mapRef.current?.getMap?.();
    if (!map || !popupInfo) {
      setPopupPixel(null);
      return;
    }

    const lat = parseFloat(String(popupInfo.latitude));
    const lng = parseFloat(String(popupInfo.longitude));
    if (isNaN(lat) || isNaN(lng)) {
      setPopupPixel(null);
      return;
    }

    const updatePosition = () => {
      try {
        const point = map.project([lng, lat]);
        setPopupPixel({ x: point.x, y: point.y });
      } catch {
        // Map may not be ready
      }
    };

    updatePosition();
    map.on('move', updatePosition);
    map.on('zoom', updatePosition);

    return () => {
      map.off('move', updatePosition);
      map.off('zoom', updatePosition);
    };
  }, [popupInfo]);

  // ---------- Styles ----------
  const effectiveDark = forceDarkMode || isDarkMode;
  const mapStyle = useMemo(
    () =>
      effectiveDark
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11",
    [effectiveDark]
  );

  const baseClasses =
    "relative overflow-hidden outline-none ring-0";
  const defaultDimensions =
    "h-[500px] w-full rounded-xl border border-gray-200 dark:border-zinc-800";

  const containerClass = isExpanded
    ? "fixed inset-0 z-[9999] h-[100dvh] w-screen rounded-none"
    : `${baseClasses} ${className || defaultDimensions}`;

  // ---------- Error / Loading states ----------
  if (!webglOk) {
    return (
      <div
        className={`${className || defaultDimensions} flex flex-col items-center justify-center p-6 text-center bg-zinc-900`}
      >
        <p className="text-sm font-semibold text-white mb-2">
          {t('dashboard.webglNotSupported')}
        </p>
        <p className="text-xs text-zinc-400 max-w-md">
          {t('dashboard.webglNotSupportedDesc')}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`${className || defaultDimensions} flex flex-col items-center justify-center p-6 text-center bg-zinc-900`}
      >
        <p className="text-sm font-semibold text-white mb-2">
          {t('dashboard.mapConfigNeeded')}
        </p>
        <p className="text-xs text-zinc-400 max-w-md">
          {error}
        </p>
        <div className="mt-4 p-3 bg-black/40 border border-white/10 rounded-lg text-left">
          <p className="text-xs font-mono text-zinc-300">
            1. Get token: mapbox.com/tokens
            <br />
            2. Edit:{" "}
            <code className="bg-black px-1 rounded">
              /utils/mapbox/config.tsx
            </code>
          </p>
        </div>
      </div>
    );
  }

  if (!token && loading) {
    return (
      <div
        className={`${className || defaultDimensions} flex flex-col items-center justify-center gap-3 bg-zinc-900`}
      >
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
        <p className="text-xs text-zinc-500">{t('dashboard.loadingMap')}</p>
      </div>
    );
  }

  if (!token && !loading) {
    return (
      <div
        className={`${className || defaultDimensions} flex flex-col items-center justify-center p-6 text-center bg-zinc-900`}
      >
        <p className="text-sm font-semibold text-white mb-2">
          {t('dashboard.mapTokenMissing')}
        </p>
        <p className="text-xs text-zinc-400 max-w-md">
          {t('dashboard.mapTokenMissingDesc')}
        </p>
      </div>
    );
  }

  // Render the map content
  const mapContent = (
    <div
      ref={containerRef}
      className={containerClass}
      style={
        isExpanded
          ? {
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: "100vw",
              height: "100dvh",
            }
          : undefined
      }
    >
      {/* Transition overlay - smooth fade during map remount */}
      {isTransitioning && (
        <div 
          className="absolute inset-0 z-[100] bg-white dark:bg-[#050505] flex items-center justify-center transition-opacity duration-150"
          style={{
            animation: 'fadeIn 100ms ease-in-out'
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#1ED4A7]" />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {isExpanded ? t('dashboard.enteringFullscreen') : t('dashboard.exitingFullscreen')}
            </p>
          </div>
        </div>
      )}
      {/* Clean layer wrapper to prevent WebGL context loss from parent styles */}
      <div
        className="absolute inset-0 w-full h-full"
        style={{
          // Ensure the container is ready for the map
          minHeight: '100%',
          minWidth: '100%',
          opacity: isTransitioning ? 0 : 1,
          pointerEvents: 'auto'
        }}
      >
        {readyToRenderMap && (
        <Map
          key={`${mapKey}-${isExpanded ? 'fullscreen' : 'embedded'}`}
          ref={mapRef}
          initialViewState={{
            longitude: -40,
            latitude: 30,
            zoom: initialZoom || 1.5,
          }}
          style={{ width: "100%", height: "100%", minHeight: 'inherit' }}
          mapStyle={mapStyle}
          mapboxAccessToken={token!}
          mapLib={mapboxgl}
          attributionControl={false}
          reuseMaps={false}
          // Keep scroll-zoom off as you wanted
          scrollZoom={false}
          dragPan={true}
          doubleClickZoom={true}
          // preserveDrawingBuffer enabled to fix black screen issue when popup opens
          preserveDrawingBuffer={true}
          // Enable interaction with custom layers - critical for click events to work
          interactiveLayerIds={['visits-circle']}
          onError={(e) => {
            // Avoid circular reference errors when logging Mapbox errors
            const errorMsg = e?.error?.message || e?.message || String(e);
            console.error('[RealTimeMap] Map error:', errorMsg);
          }}
          onLoad={(e) => {
            console.log('[RealTimeMap] Map loaded, mode:', isExpanded ? 'fullscreen' : 'embedded');
            console.log('[RealTimeMap] Current visits count at onLoad:', validVisits.length);
            
            // Burst of resizes to ensure tiles paint correctly in real browsers
            // Use e.target directly to ensure we resize the specific instance that just loaded
            const m = e.target;
            
            // Helper for safe resize
            const safeResize = () => {
              try {
                if (m.getCanvas()) {
                  m.resize();
                }
              } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                console.warn('[RealTimeMap] Resize error in onLoad:', errorMsg);
              }
            };
            
            // Initial resize
            safeResize();

            // Aggressive resize sequence specifically for fullscreen mode
            // This ensures the map properly fills the viewport
            requestAnimationFrame(() => {
              safeResize();
              hardResize("onLoad.rAF");
            });
            
            setTimeout(() => {
              safeResize();
              hardResize("onLoad.50");
            }, 50);
            
            setTimeout(() => {
              safeResize();
              hardResize("onLoad.100");
              
              // End transition quickly once initial resize is complete
              setMapLoaded(true);
              setIsTransitioning(false);
            }, 100);
            
            // Additional resizes after transition ends to ensure tiles load
            setTimeout(() => {
              safeResize();
              hardResize("onLoad.300");
            }, 300);
            
            setTimeout(() => {
              safeResize();
              hardResize("onLoad.600");
            }, 600);

            // Immediately trigger layer creation if visits exist
            // This ensures markers appear as soon as the map loads
            if (validVisits.length > 0) {
              requestAnimationFrame(() => {
                try {
                  if (m.isStyleLoaded()) {
                    // Force layer refresh
                    m.fire('styledata');
                  }
                } catch (e) {
                  console.log('[RealTimeMap] Could not trigger immediate layer creation');
                }
              });
            }

            // In some browsers, forcing a repaint helps
            try {
              m.triggerRepaint();
              
              // Listen for when the map becomes idle and force another repaint
              // This ensures tiles are painted even in tricky CSS contexts
              m.once('idle', () => {
                console.log('[RealTimeMap] Map idle after load, forcing final repaint');
                try {
                  m.triggerRepaint();
                } catch {
                  // ignore
                }
              });
            } catch {
              // ignore
            }

            // If animateToZoom is set, smoothly fly to the specified zoom level
            if (animateToZoom !== undefined) {
              setTimeout(() => {
                m.flyTo({
                  zoom: animateToZoom,
                  duration: 2800,
                  easing: (t: number) => 1 - Math.pow(1 - t, 3), // cubic ease-out
                });
              }, 600); // brief pause so user sees the zoomed-in state first
            }
          }}
        >
          {/* Navigation Controls */}
          <div className="absolute bottom-6 right-6 z-20 hidden md:block">
            <NavigationControl
              showCompass={false}
              position="bottom-right"
            />
          </div>

          {/* Top Right controls */}
          <div 
            className="absolute right-4 z-20 flex items-center gap-2"
            style={{ top: isExpanded ? 'max(env(safe-area-inset-top, 16px), 16px)' : '16px' }}
          >
            {focusedVisitId && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPopupInfo(null);
                  fitToMarkers();
                }}
                className={`p-2 border rounded-lg shadow-sm transition-all flex items-center justify-center ${
                  isExpanded
                    ? "bg-white/95 dark:bg-zinc-900/95 border-zinc-200 dark:border-white/20 hover:bg-white dark:hover:bg-zinc-800 text-zinc-700 dark:text-white"
                    : "bg-white/95 dark:bg-zinc-900/95 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                }`}
                title={t('dashboard.resetView')}
              >
                <Focus className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={`p-2 border rounded-lg shadow-sm transition-all flex items-center justify-center ${
                isExpanded
                  ? "bg-white/95 dark:bg-zinc-900/95 border-zinc-200 dark:border-white/20 hover:bg-white dark:hover:bg-zinc-800 text-zinc-700 dark:text-white"
                  : "bg-white/95 dark:bg-zinc-900/95 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
              }`}
              title={
                isExpanded
                  ? t('dashboard.exitFullscreen')
                  : t('dashboard.enterFullscreen')
              }
            >
              {isExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* NOTE: Markers are now rendered using native Mapbox GL JS (see useEffect above) for browser compatibility */}

          {/* NOTE: Popup is now rendered OUTSIDE the <Map> component as a custom React div
              to completely avoid Mapbox GL popup DOM elements that cause black screen overlay */}
        </Map>
        )}
      </div>

      {/* Custom popup - rendered outside <Map> to avoid WebGL canvas interference */}
      {popupInfo && popupPixel && !isTransitioning && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: popupPixel.x,
            top: popupPixel.y,
            transform: 'translate(-50%, 16px)',
          }}
        >
          <div className="pointer-events-auto w-[300px] bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="h-1.5 w-full bg-[#1ED4A7]" />
            <div className="p-4">
              {popupInfo.source === 'email_open' && (
                <div className="flex items-center gap-1.5 mb-2 px-2 py-1.5 bg-[#1ED4A7]/10 rounded-lg border border-[#1ED4A7]/20">
                  <Mail className="w-3 h-3 text-[#1ED4A7] flex-shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1ED4A7]">Opened Email</span>
                </div>
              )}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1ED4A7]" />
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                    {popupInfo.brand || "CONTNDR"}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopupInfo(null);
                  }}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1 -mr-2 -mt-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-full flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="mb-4">
                {/* Derive ISP: check anonymous_lead.isp, then visit-level isp */}
                {(() => {
                  const isAnonymous = !popupInfo.lead?.id || popupInfo.lead?.id === 'anonymous';
                  const isp: string | null = popupInfo.lead?.isp || popupInfo.isp || null;
                  const businessName: string | null = popupInfo.lead?.business_name && popupInfo.lead.business_name !== 'Anonymous Visitor'
                    ? popupInfo.lead.business_name
                    : null;

                  return (
                    <>
                      <div className="flex items-start gap-2.5 mb-1">
                        {popupInfo.lead?.logo_url && (
                          <img src={popupInfo.lead.logo_url} alt="" className="w-6 h-6 rounded-md object-cover shadow-sm bg-white border border-zinc-200 mt-0.5" />
                        )}
                        <h3
                          className="font-bold text-base text-zinc-900 dark:text-white leading-tight cursor-pointer hover:text-[#1ED4A7] dark:hover:text-[#1ED4A7] transition-colors"
                          onClick={() => {
                            const leadId = popupInfo.lead?.id;
                            if (leadId && leadId !== "anonymous") {
                              window.open(`/leads/${leadId}`, "_blank");
                            }
                          }}
                        >
                          {businessName ||
                            (isp ? isp : null) ||
                            (popupInfo.lead?.contact_name && !['Unknown', 'Visitor'].includes(popupInfo.lead.contact_name) ? popupInfo.lead.contact_name : null) ||
                            (popupInfo.city ? t('dashboard.visitorFrom', { city: popupInfo.city }) : t('dashboard.anonymousVisitor'))}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 mb-3 ml-[1px]">
                        <MapPin className="w-3 h-3 text-zinc-400 dark:text-zinc-500" />
                        <span>
                          {popupInfo.city},{" "}
                          {popupInfo.country}
                        </span>
                      </div>
                    </>
                  );
                })()}

                <div className="space-y-2">
                  {popupInfo.lead?.phone ? (
                    <SmartPhoneButton
                      phone={popupInfo.lead.phone}
                      leadName={popupInfo.lead?.contact_name}
                      businessName={popupInfo.lead?.business_name}
                      leadId={popupInfo.lead?.id}
                      showNumber
                      displayNumber={popupInfo.lead.phone}
                      iconClassName="w-3.5 h-3.5"
                      numberClassName="text-xs text-zinc-600 dark:text-zinc-300 font-medium"
                      brand={popupInfo.brand || 'contndr'}
                      popoverPosition="above"
                    />
                  ) : null}

                  {popupInfo.lead?.email ? (
                    <div
                      className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 group cursor-pointer hover:text-[#1ED4A7] dark:hover:text-[#1ED4A7] transition-colors"
                      title="Click to copy"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          popupInfo.lead.email,
                        )
                      }
                    >
                      <Mail className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-[#1ED4A7] dark:group-hover:text-[#1ED4A7]" />
                      <span className="font-medium truncate">
                        {popupInfo.lead.email}
                      </span>
                    </div>
                  ) : null}

                  {popupInfo.lead?.website ||
                  popupInfo.url ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                      <Globe className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                      <a
                        href={
                          popupInfo.lead?.website ||
                          popupInfo.url
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline hover:text-zinc-900 dark:hover:text-white truncate max-w-[180px]"
                      >
                        {popupInfo.lead?.website ||
                          popupInfo.url}
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>
                    {new Date(
                      popupInfo.timestamp,
                    ).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {popupInfo.device && (
                  <div className="flex items-center gap-1 uppercase tracking-wide">
                    <Layout className="w-3 h-3" />
                    <span>{popupInfo.device}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isExpanded) {
    return createPortal(mapContent, document.body);
  }

  return mapContent;
}
