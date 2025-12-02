// Minimal, safe polyfills for React Native/Expo with Hermes.
// Ensures global environment and module loading compatibility across Expo Go,
// Dev Client, and bare RN builds.
(function () {
  const g = typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : typeof window !== 'undefined' ? window : {};

  if (!g) {
    try { console.error('[polyfills] No global object found'); } catch (_) {}
    return;
  }

  // Ensure globalThis exists
  if (typeof g.globalThis === 'undefined') {
    try {
      Object.defineProperty(g, 'globalThis', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: g,
      });
    } catch (e) {
      g.globalThis = g;
    }
  }

  // process.env shim
  if (typeof g.process === 'undefined') {
    g.process = { env: {} };
  } else if (typeof g.process.env === 'undefined') {
    g.process.env = {};
  }

  // Safe global require shim: delegate to Metro's __r when available.
  if (typeof g.require !== 'function') {
    const safeRequire = function (moduleId) {
      try {
        if (typeof g.__r === 'function') {
          const module = g.__r(moduleId);
          return module && typeof module === 'object' && 'default' in module
            ? module.default
            : module;
        }
      } catch (_) {}
      return null;
    };
    try {
      Object.defineProperty(g, 'require', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: safeRequire,
      });
    } catch (_) {
      g.require = safeRequire;
    }
  }

  // Minimal AppRegistry shim (noop) if missing so secondary surfaces don't crash.
  if (typeof g.AppRegistry === 'undefined') {
    g.AppRegistry = {
      registerComponent: () => {},
    };
  }
})();

