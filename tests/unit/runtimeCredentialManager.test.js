import { describe, expect, it } from "vitest";
import { createRuntimeCredentialManager } from "../../src/security/runtimeCredentialManager.js";

describe("runtime credential manager", () => {
  it("stores, replaces, validates, and clears runtime credentials without exposing their values", () => {
    const manager = createRuntimeCredentialManager();

    const initial = manager.publicState("openai");
    expect(initial).toMatchObject({ configured: false, status: "not-configured" });

    manager.set("openai", "sk-test-one");
    expect(manager.get("openai")).toBe("sk-test-one");
    expect(manager.publicState("openai")).toMatchObject({
      configured: true,
      status: "configured"
    });

    manager.set("openai", "sk-test-two");
    expect(manager.get("OPENAI_API_KEY")).toBe("sk-test-two");

    manager.markValidation("openai", { ok: true });
    expect(manager.publicState("openai")).toMatchObject({
      configured: true,
      status: "valid"
    });

    manager.clear("openai");
    expect(manager.get("openai")).toBe("");
    expect(manager.publicState("openai")).toMatchObject({
      configured: false,
      status: "not-configured"
    });
  });

  it("raises a safe error when a required credential is missing", () => {
    const manager = createRuntimeCredentialManager();
    expect(() => manager.get("xai", { required: true })).toThrow(/Configuration/);
  });
});
