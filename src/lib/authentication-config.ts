import { createPrivateKey } from "node:crypto";
import { AUTHENTICATION_PROVIDERS, type AuthenticationProvider } from "./authentication";

export const AUTHENTICATION_SETTINGS = [
  "AUTH_ORIGIN", "AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET",
  "AUTH_APPLE_CLIENT_ID", "AUTH_APPLE_TEAM_ID", "AUTH_APPLE_KEY_ID", "AUTH_APPLE_PRIVATE_KEY",
] as const;

export type AuthenticationSetting = (typeof AUTHENTICATION_SETTINGS)[number];
export type AuthenticationEnvironment = Readonly<Partial<Record<AuthenticationSetting, string>>>;
export interface AuthenticationIssue {
  field: AuthenticationSetting;
  reason: "missing" | "invalid";
}
export interface ProviderReadiness {
  id: AuthenticationProvider;
  configurationValid: boolean;
  enabled: false;
  issues: AuthenticationIssue[];
}
export interface AuthenticationReadiness {
  integration: "not-connected";
  signInEnabled: false;
  providers: ProviderReadiness[];
}

function setting(environment: AuthenticationEnvironment, field: AuthenticationSetting): string | undefined {
  return Object.hasOwn(environment, field) && typeof environment[field] === "string"
    ? environment[field] : undefined;
}

/** Fixed origins avoid deriving future redirects from an untrusted request Host header. */
export function authenticationOrigin(value: string | undefined, production = true): string | null {
  if (!value || value.length > 2048 || value !== value.trim()) return null;
  try {
    const parsed = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback && !production)) return null;
    // Exact origin syntax also rejects normalization of dot paths, slashes and empty ?/# suffixes.
    if (value !== parsed.origin && value !== `${parsed.origin}/`) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** An integration contract only: building a URL neither installs a handler nor enables sign-in. */
export function authenticationCallbackURL(provider: AuthenticationProvider, origin: string | undefined, production = true): string | null {
  const trustedOrigin = authenticationOrigin(origin, production);
  const definition = AUTHENTICATION_PROVIDERS.find(({ id }) => id === provider);
  return trustedOrigin && definition ? `${trustedOrigin}${definition.callbackPath}` : null;
}

function validAppleKey(value: string): boolean {
  if (value.length > 8192 || !/^-----BEGIN PRIVATE KEY-----\r?\n/.test(value) || !value.trimEnd().endsWith("-----END PRIVATE KEY-----")) return false;
  try {
    const key = createPrivateKey({ key: value, format: "pem", type: "pkcs8" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    // OpenSSL errors can contain details of credentials; only the field's status leaves this function.
    return false;
  }
}

/** Syntax checks only. No network request, credential output, session, or activation switch. */
export function authenticationReadiness(environment: AuthenticationEnvironment, production = true): AuthenticationReadiness {
  function validate(field: AuthenticationSetting, acceptable: (value: string) => boolean): AuthenticationIssue[] {
    const value = setting(environment, field);
    if (!value?.trim()) return [{ field, reason: "missing" }];
    return acceptable(value) ? [] : [{ field, reason: "invalid" }];
  }
  const common = validate("AUTH_ORIGIN", (value) => authenticationOrigin(value, production) !== null);
  const issues: Record<AuthenticationProvider, AuthenticationIssue[]> = {
    google: [
      ...common,
      ...validate("AUTH_GOOGLE_CLIENT_ID", (value) => value.length <= 512 && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)),
      ...validate("AUTH_GOOGLE_CLIENT_SECRET", (value) => value.length <= 8192),
    ],
    apple: [
      ...common,
      ...validate("AUTH_APPLE_CLIENT_ID", (value) => value.length <= 255 && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)),
      ...validate("AUTH_APPLE_TEAM_ID", (value) => /^[A-Z0-9]{10}$/.test(value)),
      ...validate("AUTH_APPLE_KEY_ID", (value) => /^[A-Z0-9]{10}$/.test(value)),
      ...validate("AUTH_APPLE_PRIVATE_KEY", validAppleKey),
    ],
  };
  return {
    integration: "not-connected",
    signInEnabled: false,
    providers: AUTHENTICATION_PROVIDERS.map(({ id }) => ({
      id, configurationValid: issues[id].length === 0, enabled: false, issues: issues[id],
    })),
  };
}
