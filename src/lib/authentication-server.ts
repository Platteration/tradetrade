import "server-only";
import { AUTHENTICATION_PROVIDERS, type AccountProvider } from "./authentication";
import { AUTHENTICATION_SETTINGS, authenticationReadiness, type AuthenticationEnvironment } from "./authentication-config";

/** Keep credential reads on the server and avoid serializing unrelated environment settings. */
export function readAuthenticationReadiness() {
  const environment: AuthenticationEnvironment = Object.fromEntries(
    AUTHENTICATION_SETTINGS.map((field) => [field, process.env[field]]),
  );
  return authenticationReadiness(environment, process.env.NODE_ENV === "production");
}

/** The public account page receives only fixed labels and the fail-closed availability flag. */
export function accountProviders(): AccountProvider[] {
  const readiness = readAuthenticationReadiness();
  return AUTHENTICATION_PROVIDERS.map(({ id, name }) => ({
    id, name, enabled: readiness.providers.find((provider) => provider.id === id)!.enabled,
  }));
}
