import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { AUTHENTICATION_PROVIDERS } from "../src/lib/authentication";
import { authenticationCallbackURL, authenticationOrigin, authenticationReadiness, type AuthenticationEnvironment } from "../src/lib/authentication-config";

const google: AuthenticationEnvironment = {
  AUTH_ORIGIN: "https://collection.example",
  AUTH_GOOGLE_CLIENT_ID: "fixture-web.apps.googleusercontent.com",
  AUTH_GOOGLE_CLIENT_SECRET: "synthetic-secret-do-not-use",
};
function appleKey(curve = "prime256v1") {
  return generateKeyPairSync("ec", { namedCurve: curve }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
function completeConfiguration(): AuthenticationEnvironment {
  return {
    ...google,
    AUTH_APPLE_CLIENT_ID: "example.collection.web",
    AUTH_APPLE_TEAM_ID: "ABC123XYZ9",
    AUTH_APPLE_KEY_ID: "XYZ123ABC9",
    AUTH_APPLE_PRIVATE_KEY: appleKey(),
  };
}

test("device-only setup needs no credentials and leaves both providers unavailable", () => {
  const result = authenticationReadiness({});
  assert.equal(result.integration, "not-connected");
  assert.equal(result.signInEnabled, false);
  assert.deepEqual(result.providers.map(({ id, enabled, configurationValid }) => ({ id, enabled, configurationValid })), [
    { id: "google", enabled: false, configurationValid: false },
    { id: "apple", enabled: false, configurationValid: false },
  ]);
  assert.deepEqual(result.providers[0]!.issues, [
    { field: "AUTH_ORIGIN", reason: "missing" },
    { field: "AUTH_GOOGLE_CLIENT_ID", reason: "missing" },
    { field: "AUTH_GOOGLE_CLIENT_SECRET", reason: "missing" },
  ]);
});

test("complete Google and Apple settings validate without enabling sign-in or returning secrets", () => {
  const environment = completeConfiguration();
  const original = { ...environment };
  const result = authenticationReadiness(environment);
  assert.deepEqual(result, {
    integration: "not-connected", signInEnabled: false,
    providers: [
      { id: "google", configurationValid: true, enabled: false, issues: [] },
      { id: "apple", configurationValid: true, enabled: false, issues: [] },
    ],
  });
  assert.deepEqual(environment, original);
  const output = JSON.stringify(result);
  for (const value of Object.values(environment)) assert.ok(!output.includes(value), "Readiness must not return any configured value");
  assert.doesNotMatch(output, /BEGIN PRIVATE KEY|synthetic-secret/);
});

test("provider readiness is independent and unknown activation settings cannot enable accounts", () => {
  const result = authenticationReadiness({ ...google, AUTH_ENABLED: "true", NEXT_PUBLIC_AUTH_ENABLED: "true" } as AuthenticationEnvironment);
  assert.equal(result.providers[0]!.configurationValid, true);
  assert.equal(result.providers[1]!.configurationValid, false);
  assert.ok(result.providers.every(({ enabled }) => enabled === false));
  assert.equal(result.signInEnabled, false);
  assert.deepEqual(AUTHENTICATION_PROVIDERS.map(({ id, scopes }) => ({ id, scopes })), [
    { id: "google", scopes: ["openid", "email", "profile"] },
    { id: "apple", scopes: ["name", "email"] },
  ]);
});

test("callback contracts use a configured exact HTTPS origin and fixed provider paths", () => {
  assert.equal(authenticationOrigin("https://collection.example/"), "https://collection.example");
  assert.equal(authenticationCallbackURL("google", "https://collection.example/"), "https://collection.example/api/auth/callback/google");
  assert.equal(authenticationCallbackURL("apple", "https://collection.example"), "https://collection.example/api/auth/callback/apple");
  assert.equal(authenticationCallbackURL("//attacker.example" as "google", "https://collection.example"), null);
  for (const origin of [
    undefined, "", "https://collection.example ", " https://collection.example", "http://collection.example",
    "javascript:alert(1)", "//collection.example", "https://user:synthetic-secret@collection.example",
    "https://collection.example/path", "https://collection.example/?code=synthetic-secret",
    "https://collection.example/#synthetic-secret", "https://collection.example?", "https://collection.example#",
    "https://collection.example/../", "https://collection.example/%2e%2e", "https://collection.example\\",
    "https://" + "a".repeat(2040) + ".example",
  ]) {
    assert.equal(authenticationOrigin(origin), null, `Rejected an unsafe origin shape`);
    assert.equal(authenticationCallbackURL("google", origin), null);
    const result = authenticationReadiness({ ...google, AUTH_ORIGIN: origin });
    assert.equal(result.providers[0]!.configurationValid, false);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|collection\.example|attacker/);
  }
});

test("local HTTP callback preparation is explicit and never accepted in production", () => {
  for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"]) {
    assert.equal(authenticationOrigin(origin), null);
    assert.equal(authenticationOrigin(origin, true), null);
    assert.equal(authenticationOrigin(origin, false), origin);
    assert.equal(authenticationCallbackURL("google", origin, false), `${origin}/api/auth/callback/google`);
    const result = authenticationReadiness({ ...google, AUTH_ORIGIN: origin }, false);
    assert.equal(result.providers[0]!.configurationValid, true);
    assert.equal(result.providers[0]!.enabled, false);
  }
  for (const origin of ["http://localhost.attacker.example", "http://192.168.1.1", "http://127.0.0.2", "http://2130706433"]) {
    assert.equal(authenticationOrigin(origin, false), null);
  }
});

test("malformed Google configuration reports fields without echoing credential contents", () => {
  for (const patch of [
    { AUTH_GOOGLE_CLIENT_ID: "synthetic-secret.apps.googleusercontent.com.attacker.example" },
    { AUTH_GOOGLE_CLIENT_ID: "synthetic-secret" },
    { AUTH_GOOGLE_CLIENT_ID: `${"a".repeat(500)}.apps.googleusercontent.com` },
    { AUTH_GOOGLE_CLIENT_SECRET: " \n " },
    { AUTH_GOOGLE_CLIENT_SECRET: "synthetic-secret".repeat(1000) },
  ]) {
    const result = authenticationReadiness({ ...google, ...patch });
    assert.equal(result.providers[0]!.configurationValid, false);
    assert.equal(result.providers[0]!.enabled, false);
    assert.equal(result.providers[0]!.issues.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|attacker/);
  }
});

test("Apple configuration requires its service and key IDs plus a real P-256 PKCS8 key", () => {
  const environment = completeConfiguration();
  const wrongCurve = appleKey("secp384r1");
  const rsaKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  for (const patch of [
    { AUTH_APPLE_CLIENT_ID: "example/invalid-service" },
    { AUTH_APPLE_TEAM_ID: "abc123xyz9" },
    { AUTH_APPLE_KEY_ID: "too-short" },
    { AUTH_APPLE_PRIVATE_KEY: "synthetic-secret-invalid-key" },
    { AUTH_APPLE_PRIVATE_KEY: wrongCurve },
    { AUTH_APPLE_PRIVATE_KEY: rsaKey },
    { AUTH_APPLE_PRIVATE_KEY: environment.AUTH_APPLE_PRIVATE_KEY!.replaceAll("\n", "\\n") },
    { AUTH_APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\n" + "x".repeat(8200) + "\n-----END PRIVATE KEY-----" },
  ]) {
    const result = authenticationReadiness({ ...environment, ...patch });
    assert.equal(result.providers[0]!.configurationValid, true);
    assert.equal(result.providers[1]!.configurationValid, false);
    assert.equal(result.providers[1]!.enabled, false);
    assert.equal(result.providers[1]!.issues.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /BEGIN PRIVATE KEY|synthetic-secret|OpenSSL/);
  }
  const crlf = authenticationReadiness({ ...environment, AUTH_APPLE_PRIVATE_KEY: environment.AUTH_APPLE_PRIVATE_KEY!.replaceAll("\n", "\r\n") });
  assert.equal(crlf.providers[1]!.configurationValid, true);
});

test("inherited or non-string settings cannot count as configured credentials", () => {
  const inherited = Object.create(google) as AuthenticationEnvironment;
  assert.equal(authenticationReadiness(inherited).providers[0]!.configurationValid, false);
  const wrongType = { ...google, AUTH_GOOGLE_CLIENT_SECRET: true } as unknown as AuthenticationEnvironment;
  assert.deepEqual(authenticationReadiness(wrongType).providers[0]!.issues, [{ field: "AUTH_GOOGLE_CLIENT_SECRET", reason: "missing" }]);
});
