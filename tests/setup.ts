import "@testing-library/jest-dom/vitest";

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
