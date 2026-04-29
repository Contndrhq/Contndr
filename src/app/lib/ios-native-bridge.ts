export const isNativeApp =
  typeof window !== "undefined" &&
  !!(window as any).webkit?.messageHandlers?.native;

export function sendNativeMessage(type: string, data: any = {}) {
  if (!isNativeApp) return false;
  try {
    (window as any).webkit.messageHandlers.native.postMessage({ type, data });
    return true;
  } catch {
    return false;
  }
}
