/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("sync", (event: Event) => {
  const syncEvent = event as Event & { tag: string; waitUntil: (promise: Promise<void>) => void };
  if (syncEvent.tag === "nex-pending-sales") {
    syncEvent.waitUntil(notifyClientsToFlush());
  }
});

async function notifyClientsToFlush() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "FLUSH_PENDING_SALES" });
  }
}

export {};
