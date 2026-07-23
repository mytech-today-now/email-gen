import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createShutdownError } from "../utils/errors.js";
import { isUnsafeMethod, validateUnsafeRequestHeaders } from "../security/requestPolicy.js";

function isApiPath(req) {
  const path = String(req?.originalUrl ?? req?.url ?? "");
  return path === "/api" || path.startsWith("/api/");
}

function securityEventMetadata(req, { outcome, reasonCode, policy = null, stage = null, error = null } = {}) {
  return {
    requestId: req.id ?? null,
    route: String(req?.originalUrl ?? req?.url ?? ""),
    method: String(req?.method ?? "").toUpperCase(),
    outcome,
    reasonCode,
    stage,
    host: policy?.host?.authority ?? null,
    origin: policy?.origin?.origin ?? null,
    webhook: Boolean(policy?.isWebhook),
    status: error?.status ?? null,
    errorCode: error?.code ?? null
  };
}

function logSecurityDecision(logger, req, details) {
  const payload = securityEventMetadata(req, details);
  const level = details.outcome === "rejected" ? "warn" : "info";
  logger?.[level]?.(
    {
      event: "security_request",
      ...payload
    },
    details.outcome === "rejected" ? "Unsafe request rejected" : "Unsafe request accepted"
  );
}

function rejectDuringShutdown(lifecycle) {
  return createShutdownError(
    lifecycle?.reason ?? lifecycle?.phase ?? "shutdown",
    lifecycle?.phase ?? "UNKNOWN"
  );
}

export function applySecurity(app, config, { csrfToken, logger, lifecycle } = {}) {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "style-src-attr": ["'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "upgrade-insecure-requests": null,
          "frame-src": ["'self'", "blob:"],
          "object-src": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.limits.apiRequestsPerMinute,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use((req, _res, next) => {
    if (!isApiPath(req) || !isUnsafeMethod(req.method)) return next();
    if (lifecycle?.phase && lifecycle.phase !== "RUNNING") {
      const error = rejectDuringShutdown(lifecycle);
      logSecurityDecision(logger, req, {
        outcome: "rejected",
        reasonCode: error.code,
        error,
        stage: "pre-body"
      });
      next(error);
      return;
    }
    try {
      const policy = validateUnsafeRequestHeaders(req, {
        config,
        csrfToken,
        allowWebhook: true,
        bodyParsed: false
      });
      req.securityPolicy = policy;
      next();
    } catch (error) {
      logSecurityDecision(logger, req, {
        outcome: "rejected",
        reasonCode: error.code || "SECURITY_POLICY_REJECTED",
        error,
        stage: "pre-body"
      });
      next(error);
    }
  });
  app.use(
    express.json({
      limit: config.limits.uploadBytes,
      verify(req, _res, buffer) {
        req.rawBody = buffer.toString("utf8");
      }
    })
  );
  app.use(express.urlencoded({ extended: false, limit: config.limits.uploadBytes }));
  app.use((req, _res, next) => {
    if (!isApiPath(req) || !isUnsafeMethod(req.method)) return next();
    if (lifecycle?.phase && lifecycle.phase !== "RUNNING") {
      const error = rejectDuringShutdown(lifecycle);
      logSecurityDecision(logger, req, {
        outcome: "rejected",
        reasonCode: error.code,
        error,
        stage: "post-body"
      });
      next(error);
      return;
    }
    try {
      validateUnsafeRequestHeaders(req, {
        config,
        csrfToken,
        allowWebhook: true,
        bodyParsed: true
      });
      logSecurityDecision(logger, req, {
        outcome: "accepted",
        reasonCode: "SECURITY_POLICY_ACCEPTED",
        policy: req.securityPolicy ?? null,
        stage: "post-body"
      });
      next();
    } catch (error) {
      logSecurityDecision(logger, req, {
        outcome: "rejected",
        reasonCode: error.code || "SECURITY_POLICY_REJECTED",
        error,
        stage: "post-body"
      });
      next(error);
    }
  });
}
