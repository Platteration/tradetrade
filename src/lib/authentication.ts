/** Provider contracts for a future maintained OAuth/OIDC adapter. These routes do not exist yet. */
export const AUTHENTICATION_PROVIDERS = [
  { id: "google", name: "Google", callbackPath: "/api/auth/callback/google", scopes: ["openid", "email", "profile"] },
  { id: "apple", name: "Apple", callbackPath: "/api/auth/callback/apple", scopes: ["name", "email"] },
] as const;

export type AuthenticationProvider = (typeof AUTHENTICATION_PROVIDERS)[number]["id"];

export interface AccountProvider {
  id: AuthenticationProvider;
  name: "Google" | "Apple";
  enabled: false;
}
