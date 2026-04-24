/**
 * Client-side helper for calling the git API.
 */
export async function gitAction(
  path: string,
  action: string,
  extra: Record<string, unknown> = {}
) {
  const res = await fetch("/api/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, path, ...extra }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `${action} failed`);
  }
  return res.json();
}
