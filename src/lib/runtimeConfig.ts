const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

const readRequiredEnv = (key: string) => {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required runtime config: ${key}`);
  }
  return value;
};

const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');

const normalizeApiBaseUrl = (value: string) => {
  if (value === '__SAME_ORIGIN__') return '';
  return trimTrailingSlash(value);
};

export const runtimeConfig = {
  apiBaseUrl: normalizeApiBaseUrl(readRequiredEnv('VITE_API_BASE_URL')),
  liveIframeUrl: readRequiredEnv('VITE_LIVE_IFRAME_URL'),
  fallbackVideoUrl: readRequiredEnv('VITE_FALLBACK_VIDEO_URL'),
  directFrameUrl: readRequiredEnv('VITE_DIRECT_FRAME_URL'),
};

export const apiUrl = (path: string) => `${runtimeConfig.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;