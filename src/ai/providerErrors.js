import { AppError } from "../utils/errors.js";

function isAuthFailure(error) {
  const status = error.status ?? error.statusCode;
  if (status === 401 || status === 403) return true;
  return /incorrect api key|invalid api key|api key provided|unauthorized|authentication|permission denied/i.test(
    error.message ?? ""
  );
}

export function normalizeProviderError(error, provider = {}) {
  if (error instanceof AppError) return error;
  if (!isAuthFailure(error)) return error;

  const label = provider.label ?? provider.id ?? "Selected provider";
  return new AppError(
    "PROVIDER_AUTH_FAILED",
    `${label} rejected the configured credential. Update it in Configuration or choose another provider.`,
    502
  );
}
