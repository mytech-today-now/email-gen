import { AppError } from "../utils/errors.js";

export function validateHttpUrl(value, { optional = true } = {}) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("URL must use http or https.");
    }
    if (url.username || url.password) {
      throw new Error("URL credentials are not allowed.");
    }
    return url.toString();
  } catch (error) {
    throw new AppError("INVALID_URL", error.message, 400);
  }
}

export function looksLikeUrlField(fieldName) {
  return /(?:url|website|homepage|link)$/i.test(fieldName);
}
