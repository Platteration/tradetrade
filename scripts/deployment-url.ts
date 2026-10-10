/** Require an explicit origin so a release check cannot quietly test localhost. */
export function deploymentURL(value: string | undefined): string {
  if (!value?.trim()) throw new Error("Set DEPLOYMENT_URL to the deployed site's HTTPS origin.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DEPLOYMENT_URL must be a valid absolute URL.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("DEPLOYMENT_URL must contain only an origin, without credentials, a path, query, or fragment.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("DEPLOYMENT_URL must use HTTPS; HTTP is allowed only for local loopback verification.");
  }
  return url.origin;
}
