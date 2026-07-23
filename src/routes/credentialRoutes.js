import express from "express";
import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { credentialDefinitionById } from "../security/credentialCatalog.js";

const SaveCredentialSchema = z.object({
  credential: z.string().trim().min(1).max(4096)
});

const TestCredentialSchema = z.object({
  baseUrl: z.string().trim().max(2000).optional().default(""),
  customProviderType: z.string().trim().max(80).optional().default("openai-compatible"),
  confirmedCustomProviderHost: z.boolean().optional().default(false)
});

function credentialState(context, id) {
  const state = context.runtimeCredentials.publicState(id);
  if (!state) throw new AppError("CREDENTIAL_NOT_SUPPORTED", "This credential is not supported.", 404);
  return state;
}

function customProviderBaseUrl({ baseUrl, confirmedCustomProviderHost }) {
  let parsed;
  try {
    parsed = new URL(String(baseUrl || ""));
  } catch {
    throw new AppError("CUSTOM_PROVIDER_URL_INVALID", "Custom provider base URL is invalid.", 400);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["http:", "https:"].includes(parsed.protocol)
  ) {
    throw new AppError(
      "CUSTOM_PROVIDER_URL_INVALID",
      "Custom provider URL must be a clean HTTP(S) origin and path.",
      400
    );
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!loopback && parsed.protocol !== "https:") {
    throw new AppError("CUSTOM_PROVIDER_HTTPS_REQUIRED", "Remote custom providers must use HTTPS.", 400);
  }
  if (!loopback && !confirmedCustomProviderHost) {
    throw new AppError(
      "CUSTOM_PROVIDER_CONFIRMATION_REQUIRED",
      "Explicitly trust the custom provider endpoint before testing it.",
      400
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

async function testResponse(response, code) {
  if (response.ok) return;
  throw new AppError(
    code,
    `Connection test returned HTTP ${response.status}.`,
    response.status === 429 ? 429 : 502
  );
}

async function testCredentialConnection(context, providerId, body) {
  const runtimeCredentials = context.runtimeCredentials;
  const fetchImpl = context.fetchImpl;
  const apiKey = runtimeCredentials.get(providerId, { required: true });

  switch (providerId) {
    case "openai":
    case "xai":
    case "venice": {
      const baseUrls = {
        openai: "https://api.openai.com/v1/models",
        xai: "https://api.x.ai/v1/models",
        venice: "https://api.venice.ai/api/v1/models"
      };
      const response = await fetchImpl(baseUrls[providerId], {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000)
      });
      await testResponse(response, "PROVIDER_CONNECTION_FAILED");
      return { ok: true };
    }
    case "anthropic": {
      const response = await fetchImpl("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(10_000)
      });
      await testResponse(response, "PROVIDER_CONNECTION_FAILED");
      return { ok: true };
    }
    case "custom": {
      const baseUrl = customProviderBaseUrl(body);
      const response = await fetchImpl(
        baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`,
        {
          headers: body.customProviderType === "ollama" ? {} : { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000)
        }
      );
      await testResponse(response, "CUSTOM_PROVIDER_CONNECTION_FAILED");
      return { ok: true, baseUrl };
    }
    case "openrouter": {
      const response = await fetchImpl("https://openrouter.ai/api/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000)
      });
      await testResponse(response, "OPENROUTER_CONNECTION_FAILED");
      return { ok: true };
    }
    case "resend": {
      const response = await fetchImpl("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${apiKey}`, "user-agent": "ai-batch-personalizer/2.0" },
        signal: AbortSignal.timeout(10_000)
      });
      await testResponse(response, "RESEND_CONNECTION_FAILED");
      return { ok: true };
    }
    case "brave-search": {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", "example");
      url.searchParams.set("count", "1");
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey,
          "Api-Version": "2023-01-01"
        },
        signal: AbortSignal.timeout(10_000)
      });
      await testResponse(response, "SEARCH_PROVIDER_FAILED");
      return { ok: true };
    }
    case "lumaai":
      throw new AppError(
        "CREDENTIAL_TEST_UNSUPPORTED",
        "Luma AI credential testing is not available in-app yet. Save the credential and verify it in the supported workflow.",
        400
      );
    default:
      throw new AppError("CREDENTIAL_TEST_UNSUPPORTED", "This credential cannot be tested here yet.", 400);
  }
}

export function credentialRoutes(context) {
  const router = express.Router();

  router.get("/credentials", (_req, res) => {
    res.json({
      credentials: context.runtimeCredentials.publicStates(),
      ai: context.providerRegistry.publicConfig()
    });
  });

  router.put("/credentials/:id", (req, res, next) => {
    try {
      context.requireGatewayRequest(req);
      const definition = credentialDefinitionById(req.params.id);
      if (!definition?.secretName) {
        throw new AppError("CREDENTIAL_NOT_SUPPORTED", "This credential is not supported.", 404);
      }
      const parsed = SaveCredentialSchema.parse(req.body ?? {});
      const credential = context.runtimeCredentials.set(req.params.id, parsed.credential);
      context.logger.info(
        { event: "runtime_credential_saved", credentialId: req.params.id, category: definition.category },
        "Runtime credential saved"
      );
      res.json({
        credential,
        credentials: context.runtimeCredentials.publicStates(),
        ai: context.providerRegistry.publicConfig()
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/credentials/:id", (req, res, next) => {
    try {
      context.requireGatewayRequest(req);
      const credential = context.runtimeCredentials.clear(req.params.id);
      context.logger.info(
        { event: "runtime_credential_cleared", credentialId: req.params.id },
        "Runtime credential cleared"
      );
      res.json({
        credential,
        credentials: context.runtimeCredentials.publicStates(),
        ai: context.providerRegistry.publicConfig()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/credentials/:id/test", async (req, res, next) => {
    try {
      context.requireGatewayRequest(req);
      credentialState(context, req.params.id);
      const parsed = TestCredentialSchema.parse(req.body ?? {});
      const result = await testCredentialConnection(context, req.params.id, parsed);
      const credential = context.runtimeCredentials.markValidation(req.params.id, { ok: true, code: null });
      res.json({
        ok: true,
        result,
        credential,
        credentials: context.runtimeCredentials.publicStates(),
        ai: context.providerRegistry.publicConfig()
      });
    } catch (error) {
      if (credentialDefinitionById(req.params.id)) {
        context.runtimeCredentials.markValidation(req.params.id, {
          ok: false,
          code: error.code ?? "CREDENTIAL_TEST_FAILED"
        });
      }
      next(error);
    }
  });

  return router;
}
