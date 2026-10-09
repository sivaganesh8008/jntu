export async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "include", ...options });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || data?.details || "Request failed");
  return data;
}
