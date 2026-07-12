import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

export function applySecurity(app, config) {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(express.json({ limit: config.limits.uploadBytes }));
  app.use(express.urlencoded({ extended: false, limit: config.limits.uploadBytes }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.nodeEnv === "test" ? 5000 : 240,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
}
