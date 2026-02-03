export function getFirstParam(
  params: URLSearchParams,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null) return value;
  }
  return null;
}

export function parseBooleanParam(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function appendQueryParam(
  inputUrl: string,
  key: string,
  value: string
): string {
  if (!inputUrl) return inputUrl;
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(inputUrl, base);
    if (parsed.searchParams.has(key)) return inputUrl;
    parsed.searchParams.set(key, value);
    if (/^https?:\/\//i.test(inputUrl)) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    if (inputUrl.includes(`${key}=`)) return inputUrl;
    const joiner = inputUrl.includes("?") ? "&" : "?";
    return `${inputUrl}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(
      value
    )}`;
  }
}
