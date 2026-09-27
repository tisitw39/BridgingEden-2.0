function rightmostHop(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  return last.slice(0, 64);
}

export function clientIp(
  request: { headers: { get(name: string): string | null } },
  env: { VERCEL?: string } = { VERCEL: process.env.VERCEL },
): string {
  if (env.VERCEL) {
    const vercel = rightmostHop(request.headers.get("x-vercel-forwarded-for"));
    if (vercel) return vercel;
  }
  return (
    rightmostHop(request.headers.get("x-forwarded-for")) ||
    rightmostHop(request.headers.get("x-real-ip")) ||
    "unknown"
  );
}
