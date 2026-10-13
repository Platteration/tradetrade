import assert from "node:assert/strict";
import test from "node:test";
import { deploymentURL } from "../scripts/deployment-url";

test("release checks require an explicit HTTPS origin", () => {
  assert.equal(deploymentURL("https://example.vercel.app/"), "https://example.vercel.app");
  assert.throws(() => deploymentURL(undefined), /Set DEPLOYMENT_URL/);
  assert.throws(() => deploymentURL(""), /Set DEPLOYMENT_URL/);
  assert.throws(() => deploymentURL("example.vercel.app"), /absolute URL/);
  assert.throws(() => deploymentURL("http://example.vercel.app"), /HTTPS/);
  assert.throws(() => deploymentURL("file:///tmp/site"), /only an origin/);
});

test("credentials and URL suffixes are rejected without exposing their contents", () => {
  for (const target of [
    "https://user:private-test-value@example.vercel.app",
    "https://example.vercel.app/alternate",
    "https://example.vercel.app/?token=private-test-value",
    "https://example.vercel.app/#private-test-value",
  ]) {
    assert.throws(() => deploymentURL(target), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /only an origin/);
      assert.doesNotMatch(error.message, /private-test-value/);
      return true;
    });
  }
});

test("loopback HTTP can exercise the deployment configuration locally", () => {
  for (const target of ["http://127.0.0.1:3120", "http://localhost:3120", "http://[::1]:3120"]) {
    assert.equal(deploymentURL(target), target);
  }
  assert.throws(() => deploymentURL("http://localhost.example.com"), /HTTPS/);
});
