export class AppError extends Error {
  constructor(code, message, status = 500, details = undefined, options = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.publicDetails = Boolean(options.publicDetails);
  }
}

export function createShutdownError(reason = "shutdown", phase = "DRAINING") {
  return new AppError(
    "SERVER_SHUTTING_DOWN",
    "The server is shutting down and is not accepting new mutable work.",
    503,
    { reason, phase },
    { publicDetails: true }
  );
}

export function isAppError(error) {
  return error instanceof AppError;
}

export function toSafeError(error, requestId, includeDetails = false) {
  if (isAppError(error)) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...((includeDetails || error.publicDetails) && error.details ? { details: error.details } : {})
        }
      }
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected server error occurred.",
        requestId
      }
    }
  };
}

export function assertFound(value, message = "Resource not found.") {
  if (value === undefined || value === null) {
    throw new AppError("NOT_FOUND", message, 404);
  }
  return value;
}
