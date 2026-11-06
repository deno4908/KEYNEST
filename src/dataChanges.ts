const eventName = "keynest:data-changed";
let channel: BroadcastChannel | undefined;

// Share invalidation paths only. Every view still fetches through its own session.
export function connectDataChanges() {
  if (channel || typeof window === "undefined" || !window.BroadcastChannel)
    return;
  channel = new BroadcastChannel("keynest:data-changes");
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (
      typeof event.data !== "string" ||
      !/^\/(?!\/)[^\s]{1,511}$/.test(event.data)
    )
      return;
    window.dispatchEvent(new CustomEvent(eventName, { detail: event.data }));
  };
}

export function publishDataChange(path: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: path }));
  // Session transitions are local; do not share authentication-related paths.
  if (path.startsWith("/auth/")) return;
  try {
    connectDataChanges();
    channel?.postMessage(path);
  } catch {
    /* Cross-tab updates are optional when browser messaging is unavailable. */
  }
}
