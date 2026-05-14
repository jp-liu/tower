import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts does not set globals:true, so @testing-library/react does
// not auto-register cleanup. Unmount between tests to prevent leftover DOM
// from one test polluting queries in the next.
afterEach(() => {
  cleanup();
});

// Polyfill ResizeObserver for jsdom (used by cmdk/Popover components)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Polyfill scrollIntoView for jsdom (used by cmdk Command component)
if (typeof window !== "undefined" && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}

// Polyfill getAnimations for jsdom (used by @base-ui/react ScrollAreaViewport)
if (typeof window !== "undefined" && !window.HTMLElement.prototype.getAnimations) {
  window.HTMLElement.prototype.getAnimations = function () { return []; };
}
