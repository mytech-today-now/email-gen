import { AppError } from "./errors.js";

export function createConcurrencyGate({
  name = "operation",
  limit = Number.POSITIVE_INFINITY,
  retryAfterSeconds = 1
} = {}) {
  let active = 0;

  async function run(operationName, task) {
    if (active >= limit) {
      const error = new AppError(
        "CONCURRENCY_LIMIT_REACHED",
        `${operationName || name} is temporarily busy. Try again shortly.`,
        429,
        {
          limitType: "concurrency",
          limit,
          active,
          operation: operationName || name
        },
        { publicDetails: true }
      );
      error.retryAfter = retryAfterSeconds;
      throw error;
    }

    active += 1;
    try {
      return await task();
    } finally {
      active = Math.max(0, active - 1);
    }
  }

  return {
    get active() {
      return active;
    },
    get limit() {
      return limit;
    },
    run
  };
}
