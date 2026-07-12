import { AppError } from "../utils/errors.js";

export function validateBody(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new AppError(
          "VALIDATION_ERROR",
          "Request body failed validation.",
          400,
          parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
        )
      );
      return;
    }
    req.body = parsed.data;
    next();
  };
}
