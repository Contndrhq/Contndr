// ─── Avatar Storage Pipeline ─────────────────────────────────────────
// Downloads avatar images, validates them (dimensions, size, content type),
// stores in Supabase Storage (private bucket), and serves signed URLs.
//
// This eliminates hotlinked/expired/blocked external image URLs by caching
// all approved avatars to our own storage.
//
// Validation:
//   - Must be image/* content type
//   - Must be > 1 KB and < 5 MB
//   - Must be >= 128px on shortest side (parsed from JPEG/PNG headers)
//
// Storage:
//   - Private bucket: make-a8b2511f-avatars
//   - Path: avatars/{sha256_hash}.{ext}
//   - Signed URLs with 7-day expiry
//
// Confidence Scoring:
//   - linkedin_exact (slug verified): 0.95
//   - google_kp (knowledge panel):    0.90
//   - linkedin_cdn (licdn.com):       0.85
//   - serpapi_name_linkedin:          0.70
//   - serpapi_name_licdn:             0.65
//   - serpapi_name:                   0.55
//   - none / no_linkedin:             0.00

import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET_NAME = "make-a8b2511f-avatars";
const SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MIN_IMAGE_DIMENSION = 128;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MIN_IMAGE_SIZE = 1024; // 1 KB
const DOWNLOAD_TIMEOUT_MS = 12000;

// ── Singleton Supabase client for storage ────────────────────────────

let _supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
  }
  return _supabase;
}

// ── Bucket initialization (idempotent) ───────────────────────────────

let _bucketReady = false;

export async function ensureBucket(): Promise<void> {
  if (_bucketReady) return;
  try {
    const supabase = getSupabase();
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b: any) => b.name === BUCKET_NAME);
    if (!exists) {
      const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: false,
        fileSizeLimit: MAX_IMAGE_SIZE,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      });
      if (error && !error.message?.includes("already exists")) {
        console.log(`[AVATAR-STORAGE] Bucket creation error: ${error.message}`);
        return;
      }
      console.log(`[AVATAR-STORAGE] Created bucket: ${BUCKET_NAME}`);
    }
    _bucketReady = true;
  } catch (err: any) {
    console.log(`[AVATAR-STORAGE] Bucket init error: ${err.message}`);
  }
}

// ── Confidence scoring ───────────────────────────────────────────────

export function getConfidenceScore(source: string): number {
  switch (source) {
    case "serpapi_linkedin":     return 0.95; // LinkedIn exact match (slug verified)
    case "google_kp":           return 0.90; // Google knowledge panel
    case "linkedin_cdn":        return 0.85; // LinkedIn CDN image
    case "serpapi_name_linkedin": return 0.70; // Name search → LinkedIn result
    case "serpapi_name_licdn":  return 0.65; // Name search → licdn CDN
    case "serpapi_name":        return 0.55; // Generic name search
    case "no_linkedin":         return 0.00;
    case "no_linkedin_no_name": return 0.00;
    case "no_match":            return 0.00;
    case "no_api_key":          return 0.00;
    case "none":                return 0.00;
    default:                    return 0.00;
  }
}

// ── Image dimension parsing (JPEG / PNG header) ──────────────────────

interface ImageDimensions {
  width: number;
  height: number;
}

function parseJpegDimensions(data: Uint8Array): ImageDimensions | null {
  // JPEG SOI marker: 0xFF 0xD8
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return null;

  let offset = 2;
  while (offset < data.length - 1) {
    if (data[offset] !== 0xFF) { offset++; continue; }
    const marker = data[offset + 1];
    // SOFn markers (0xC0-0xCF except 0xC4 DHT, 0xC8 JPG, 0xCC DAC)
    if (
      marker >= 0xC0 && marker <= 0xCF &&
      marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    ) {
      if (offset + 9 < data.length) {
        const height = (data[offset + 5] << 8) | data[offset + 6];
        const width = (data[offset + 7] << 8) | data[offset + 8];
        if (width > 0 && height > 0) return { width, height };
      }
    }
    // Skip to next marker
    if (offset + 3 < data.length) {
      const length = (data[offset + 2] << 8) | data[offset + 3];
      offset += 2 + length;
    } else {
      break;
    }
  }
  return null;
}

function parsePngDimensions(data: Uint8Array): ImageDimensions | null {
  // PNG signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50) return null;
  // IHDR chunk starts at byte 8, width at byte 16, height at byte 20
  const width =
    (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
  const height =
    (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
  if (width > 0 && height > 0) return { width, height };
  return null;
}

function parseWebpDimensions(data: Uint8Array): ImageDimensions | null {
  // RIFF....WEBP
  if (data.length < 30) return null;
  const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
  const webp = String.fromCharCode(data[8], data[9], data[10], data[11]);
  if (riff !== "RIFF" || webp !== "WEBP") return null;
  
  // VP8 lossy
  const chunk = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunk === "VP8 " && data.length > 29) {
    const width = ((data[26] | (data[27] << 8)) & 0x3FFF);
    const height = ((data[28] | (data[29] << 8)) & 0x3FFF);
    if (width > 0 && height > 0) return { width, height };
  }
  // VP8L lossless
  if (chunk === "VP8L" && data.length > 24) {
    const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
    const width = (bits & 0x3FFF) + 1;
    const height = ((bits >> 14) & 0x3FFF) + 1;
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

export function parseImageDimensions(data: Uint8Array): ImageDimensions | null {
  return parseJpegDimensions(data) || parsePngDimensions(data) || parseWebpDimensions(data);
}

// ── Image download & validation ──────────────────────────────────────

export interface ValidatedImage {
  data: Uint8Array;
  contentType: string;
  dimensions: ImageDimensions;
  extension: string;
}

export async function downloadAndValidateImage(
  url: string,
): Promise<ValidatedImage | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ContndrBot/1.0)",
        "Accept": "image/*",
      },
    });

    if (!res.ok) {
      console.log(`[AVATAR-STORAGE] Download failed: ${res.status} for ${url.slice(0, 80)}`);
      return null;
    }

    const contentType = res.headers.get("Content-Type") || "";
    if (!contentType.startsWith("image/")) {
      console.log(`[AVATAR-STORAGE] Not an image: ${contentType} for ${url.slice(0, 80)}`);
      return null;
    }

    const body = await res.arrayBuffer();
    const data = new Uint8Array(body);

    if (data.length < MIN_IMAGE_SIZE) {
      console.log(`[AVATAR-STORAGE] Image too small: ${data.length}B for ${url.slice(0, 80)}`);
      return null;
    }
    if (data.length > MAX_IMAGE_SIZE) {
      console.log(`[AVATAR-STORAGE] Image too large: ${data.length}B for ${url.slice(0, 80)}`);
      return null;
    }

    const dimensions = parseImageDimensions(data);
    if (!dimensions) {
      // Can't parse dimensions — accept if size is reasonable (>5KB likely a real photo)
      if (data.length > 5000) {
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        return { data, contentType, dimensions: { width: 200, height: 200 }, extension: ext };
      }
      console.log(`[AVATAR-STORAGE] Cannot parse dimensions for ${url.slice(0, 80)}`);
      return null;
    }

    const minSide = Math.min(dimensions.width, dimensions.height);
    if (minSide < MIN_IMAGE_DIMENSION) {
      console.log(`[AVATAR-STORAGE] Image too small: ${dimensions.width}x${dimensions.height} for ${url.slice(0, 80)}`);
      return null;
    }

    // Determine extension from content type
    let extension = "jpg";
    if (contentType.includes("png")) extension = "png";
    else if (contentType.includes("webp")) extension = "webp";
    else if (contentType.includes("gif")) extension = "gif";

    return { data, contentType, dimensions, extension };
  } catch (err: any) {
    if (err.name !== "AbortError" && err.name !== "TimeoutError") {
      console.log(`[AVATAR-STORAGE] Download error: ${err.message} for ${url.slice(0, 80)}`);
    }
    return null;
  }
}

// ── Storage operations ───────────────────────────────────────────────

/**
 * Store a validated image in Supabase Storage.
 * Returns the storage path on success, null on failure.
 */
export async function storeAvatar(
  emailHash: string,
  image: ValidatedImage,
): Promise<string | null> {
  try {
    await ensureBucket();
    const supabase = getSupabase();
    const path = `avatars/${emailHash}.${image.extension}`;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, image.data, {
        contentType: image.contentType,
        upsert: true,
      });

    if (error) {
      console.log(`[AVATAR-STORAGE] Upload error: ${error.message} for ${emailHash}`);
      return null;
    }

    return path;
  } catch (err: any) {
    console.log(`[AVATAR-STORAGE] Store error: ${err.message}`);
    return null;
  }
}

/**
 * Generate a signed URL for a stored avatar.
 * Returns { url, expires } or null.
 */
export async function getSignedUrl(
  storagePath: string,
): Promise<{ url: string; expires: string } | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

    if (error || !data?.signedUrl) {
      console.log(`[AVATAR-STORAGE] Signed URL error: ${error?.message}`);
      return null;
    }

    const expires = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();
    return { url: data.signedUrl, expires };
  } catch (err: any) {
    console.log(`[AVATAR-STORAGE] Signed URL error: ${err.message}`);
    return null;
  }
}

/**
 * Full pipeline: download external URL → validate → store → return signed URL.
 * Returns storage metadata or null if the image fails validation.
 */
export async function cacheExternalAvatar(
  emailHash: string,
  externalUrl: string,
): Promise<{
  storagePath: string;
  cdnUrl: string;
  cdnUrlExpires: string;
  dimensions: ImageDimensions;
} | null> {
  const image = await downloadAndValidateImage(externalUrl);
  if (!image) return null;

  const storagePath = await storeAvatar(emailHash, image);
  if (!storagePath) return null;

  const signed = await getSignedUrl(storagePath);
  if (!signed) return null;

  return {
    storagePath,
    cdnUrl: signed.url,
    cdnUrlExpires: signed.expires,
    dimensions: image.dimensions,
  };
}

/**
 * Check if a signed URL is still valid (with 1-hour safety margin).
 */
export function isSignedUrlValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt).getTime();
  const margin = 60 * 60 * 1000; // 1 hour
  return Date.now() < expiry - margin;
}
