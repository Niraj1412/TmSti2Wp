// Minimal runtime polyfill to map global.require to Metro's __r on native.
// This avoids crashes in environments that expect a global require property.
(function () {
  var g = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof global !== 'undefined'
        ? global
        : (typeof window !== 'undefined' ? window : undefined));

  if (!g) return;

  if (typeof g.globalThis === 'undefined') {
    try { g.globalThis = g; } catch (_) {}
  }

  if (typeof g.require !== 'function') {
    var safeRequire = function (moduleId) {
      try {
        if (typeof g.__r === 'function') {
          return g.__r(moduleId);
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
})();
