import { vi } from "vitest";

export function createFakeBrowserLauncher({
  html = "<html><head><title>Example</title></head><body>Example</body></html>",
  finalUrl = "https://example.com/",
  status = 200,
  contentType = "text/html; charset=utf-8",
  onGoto
} = {}) {
  let routeHandler;
  const page = {
    goto: vi.fn(async (url) => {
      await onGoto?.({ url, routeHandler });
      return {
        status: () => status,
        headers: () => ({ "content-type": contentType }),
        request: () => ({ redirectedFrom: () => null })
      };
    }),
    url: vi.fn(() => finalUrl),
    waitForTimeout: vi.fn(async () => {}),
    content: vi.fn(async () => html)
  };
  const context = {
    route: vi.fn(async (_pattern, handler) => {
      routeHandler = handler;
    }),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {})
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {})
  };
  const launcher = {
    launch: vi.fn(async () => browser)
  };

  return { launcher, browser, context, page, getRouteHandler: () => routeHandler };
}

export function createFakeRoute({ url, resourceType = "script" }) {
  return {
    request: () => ({
      url: () => url,
      resourceType: () => resourceType
    }),
    abort: vi.fn(async () => {}),
    continue: vi.fn(async () => {})
  };
}
