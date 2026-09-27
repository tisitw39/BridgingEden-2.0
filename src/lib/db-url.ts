export const PRODUCTION_CONNECTION_LIMIT = 1;
export const DEV_CONNECTION_LIMIT = 5;

export function databaseUrl(raw: string | undefined, nodeEnv = process.env.NODE_ENV): string {
  const url = raw ?? "";
  if (!url || /(?:\?|&)connection_limit=\d+/.test(url)) return url;
  const limit = nodeEnv === "production" ? PRODUCTION_CONNECTION_LIMIT : DEV_CONNECTION_LIMIT;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=${limit}`;
}
