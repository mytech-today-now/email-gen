import { AppError, toSafeError } from "../utils/errors.js";

export function notFoundHandler(_req, _res, next) {
  next(new AppError("ROUTE_NOT_FOUND", "Route not found.", 404));
}

export function errorHandler({ logger, config }) {
  return (error, req, res, _next) => {
    const includeDetails = config.nodeEnv !== "production" && config.diagnosticLogging;
    const requestId = req.id ?? "unknown";
    const safe = error.code
      ? toSafeError(error, requestId, includeDetails)
      : {
          status: error.status || 500,
          body: {
            error: {
              code: error.code || (error.status === 404 ? "ROUTE_NOT_FOUND" : "INTERNAL_ERROR"),
              message: error.status === 404 ? "Route not found." : "An unexpected server error occurred.",
              requestId
            }
          }
        };

    logger.error({ err: error, requestId, route: req.originalUrl }, "Request failed");
    res.status(safe.status).json(safe.body);
  };
}
