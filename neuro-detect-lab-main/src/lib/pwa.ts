export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  // DEV: never use a service worker. Its cache-first strategy served stale Vite modules
  // (old UI after a code update). Also remove one left over from an earlier session.
  if (!import.meta.env.PROD) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => (window.caches ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))) : undefined))
      .catch(() => undefined);   // best effort: never block the app
    return;
  }

  // PROD only (offline shell for the installed PWA)
  window.addEventListener("load", () => {
    const serviceWorkerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href);

    navigator.serviceWorker
      .register(serviceWorkerUrl, {
        scope: import.meta.env.BASE_URL,
      })
      .catch((error) => {
        console.error("Service worker registration failed", error);
      });
  });
}
