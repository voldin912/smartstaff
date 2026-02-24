const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export const getApiBaseUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_API_URL || '';
  if (!configured) return '';

  const normalized = trimTrailingSlash(configured);

  // BrowserStack local testing uses bs-local.com instead of localhost.
  if (typeof window === 'undefined') {
    return normalized;
  }

  if (window.location.hostname !== 'bs-local.com') {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'bs-local.com';
      return trimTrailingSlash(parsed.toString());
    }
  } catch {
    return normalized;
  }

  return normalized;
};
