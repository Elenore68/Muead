/**
 * Runtime configuration, read from Vite env variables (see .env.example).
 * All values are public identifiers; no secrets belong here.
 */
const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const apiBaseUrl = clean(import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, "");
const userPoolId = clean(import.meta.env.VITE_COGNITO_USER_POOL_ID);
const clientId = clean(import.meta.env.VITE_COGNITO_CLIENT_ID);

const provided = [apiBaseUrl, userPoolId, clientId].filter(Boolean).length;
if (provided > 0 && provided < 3) {
  console.warn("[config] VITE_API_BASE_URL, VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID must all be set. Falling back to mock mode.");
}

export const config = {
  /** true = real backend + Cognito sign-in. false = static mock data (original behaviour). */
  apiEnabled: provided === 3,
  apiBaseUrl,
  userPoolId,
  clientId,
};
