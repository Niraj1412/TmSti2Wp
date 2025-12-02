export const tryRequire = (name) => {
  try {
    // Prefer global require shim if provided by polyfills/Metro
    const r = (typeof require === 'function') ? require : (globalThis && globalThis.require);
    if (!r) return null;
    const mod = r(name);
    return mod ?? null;
  } catch (_e) {
    return null;
  }
};

