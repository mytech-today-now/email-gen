import { AppError } from "../utils/errors.js";
import { publicProviderConfig } from "../../config/providers.config.js";
import { publicModelFromCatalog } from "./modelCatalog/capabilities.js";
import { selectFallbackModel } from "./modelCatalog/synchronizer.js";

function legacyCompatible(model) {
  return model.capabilities?.includes("structured");
}

export function createProviderRegistry(providerConfig, options = {}) {
  const catalogRepository = options.catalogRepository;
  const providerPreference = options.providerPreference ?? [];
  const runtimeCredentials = options.runtimeCredentials ?? null;

  return {
    publicConfig() {
      const config = publicProviderConfig(providerConfig, runtimeCredentials);
      if (!catalogRepository) return config;
      return {
        ...config,
        providers: config.providers.map((provider) => {
          const catalogModels = catalogRepository.listProviderModels(provider.id);
          if (!catalogModels.length) return provider;
          return {
            ...provider,
            models: catalogModels.map(publicModelFromCatalog)
          };
        })
      };
    },

    validate(providerId, modelId) {
      const provider = providerConfig.providers[providerId];
      if (!provider || !provider.enabled) {
        throw new AppError("PROVIDER_NOT_ENABLED", "Selected AI provider is not enabled on the server.", 400);
      }
      if (
        providerId !== "mock" &&
        providerId !== "custom" &&
        process.env.AI_MOCK !== "true" &&
        !runtimeCredentials?.has(provider.credentialId)
      ) {
        throw new AppError(
          "PROVIDER_CREDENTIAL_MISSING",
          "Selected provider is not configured. Open Configuration to save its credential.",
          400
        );
      }
      const catalogModel = catalogRepository?.getModel(providerId, modelId);
      if (catalogModel) {
        if (catalogModel.availability !== "available") {
          const fallback = selectFallbackModel({
            providerId,
            modelId,
            repository: catalogRepository,
            providerPreference
          });
          throw new AppError(
            "MODEL_UNAVAILABLE",
            "Selected AI model is no longer available.",
            400,
            { fallback },
            { publicDetails: true }
          );
        }
        if (!catalogModel.compatibility?.compatible) {
          throw new AppError(
            "MODEL_MODALITY_UNSUPPORTED",
            "Selected AI model does not support structured email generation.",
            400,
            {
              reasons: catalogModel.compatibility?.reasons ?? [],
              fallback: selectFallbackModel({
                providerId,
                modelId,
                repository: catalogRepository,
                providerPreference
              })
            },
            { publicDetails: true }
          );
        }
        return {
          provider,
          model: {
            id: catalogModel.providerModelId,
            label: catalogModel.displayName,
            capabilities: publicModelFromCatalog(catalogModel).capabilities
          }
        };
      }

      const model = provider.models.find((item) => item.id === modelId);
      if (!model) {
        throw new AppError("MODEL_NOT_ENABLED", "Selected AI model is not enabled on the server.", 400);
      }
      if (!legacyCompatible(model)) {
        throw new AppError(
          "MODEL_MODALITY_UNSUPPORTED",
          "Selected AI model does not support structured email generation.",
          400
        );
      }
      return { provider, model };
    },

    defaultSelection() {
      return {
        provider: providerConfig.defaultProvider,
        model: providerConfig.defaultModel
      };
    }
  };
}
