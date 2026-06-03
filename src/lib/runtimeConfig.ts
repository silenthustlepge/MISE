type RuntimeEnv = Record<string, string | undefined>;

const env = import.meta.env as RuntimeEnv;

const readRequiredEnv = (key: string) => {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required runtime config: ${key}`);
  }
  return value;
};

const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');

export const runtimeConfig = {
  apiBaseUrl: trimTrailingSlash(readRequiredEnv('VITE_API_BASE_URL')),
  liveIframeUrl: readRequiredEnv('VITE_LIVE_IFRAME_URL'),
};

export const apiUrl = (path: string) => `${runtimeConfig.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;