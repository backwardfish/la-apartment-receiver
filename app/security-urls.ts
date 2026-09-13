import origins from './trusted-origins.json' with { type: 'json' };

export function trustedUrl(value: unknown, purpose: 'sources' | 'images'): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return undefined;
    if (!origins[purpose].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return undefined;
    if (url.pathname === '/' || /\.(?:svg|html?)(?:$|\/)/i.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}
