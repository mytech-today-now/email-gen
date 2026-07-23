import { describe, expect, it } from "vitest";
import { resolveTestCredential } from "../../src/security/testCredentialResolver.js";

describe("test credential resolver", () => {
  it("prefers protected process credentials over the OS credential store", async () => {
    const resolved = await resolveTestCredential("openai", {
      env: { EMAIL_GEN_E2E_OPENAI_API_KEY: "sk-env-credential" },
      store: {
        async get() {
          return "sk-store-credential";
        }
      }
    });

    expect(resolved).toMatchObject({
      available: true,
      source: "env",
      providerId: "openai",
      credentialId: "email-gen-e2e-openai",
      value: "sk-env-credential"
    });
  });

  it("falls back to the OS credential store and otherwise reports the credential as unavailable", async () => {
    const fromStore = await resolveTestCredential("anthropic", {
      env: {},
      store: {
        async get(providerId) {
          return providerId === "anthropic" ? "sk-store-credential" : "";
        }
      }
    });
    expect(fromStore).toMatchObject({
      available: true,
      source: "os-credential-store",
      providerId: "anthropic"
    });

    const missing = await resolveTestCredential("venice", {
      env: {},
      store: {
        async get() {
          return "";
        }
      }
    });
    expect(missing).toMatchObject({
      available: false,
      source: "unavailable",
      providerId: "venice",
      value: ""
    });
  });
});
