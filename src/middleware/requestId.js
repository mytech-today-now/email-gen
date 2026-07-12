import { makeId } from "../utils/helpers.js";

export function requestId() {
  return (req, res, next) => {
    const existing = req.get("x-request-id");
    req.id = existing && existing.length <= 128 ? existing : makeId("req");
    res.setHeader("x-request-id", req.id);
    next();
  };
}
