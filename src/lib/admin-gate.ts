// Auth.js does not apply authorized() === false when middleware passes a
// handler. This function is what the handler calls, so /admin is gated there.
export function adminEntryRedirect(pathname: string, role: unknown): "/login" | "/portfolio" | null {
  if (!pathname.startsWith("/admin")) return null;
  if (role === "ADMIN") return null;
  return role === "HOLDER" ? "/portfolio" : "/login";
}
