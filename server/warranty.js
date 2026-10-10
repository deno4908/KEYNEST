export function warrantyInfo(item, status, now = Date.now()) {
  const expires =
    item.delivered_at && item.warranty_days > 0
      ? new Date(
          Date.parse(item.delivered_at) + item.warranty_days * 86400000,
        ).toISOString()
      : null;
  return {
    warranty_expires_at: expires,
    warranty_status:
      !["processing", "completed"].includes(status) || !item.keys?.length
        ? "unavailable"
        : item.warranty_days === 0
          ? "none"
          : !expires
            ? "verify"
            : Date.parse(expires) <= now
              ? "expired"
              : "active",
  };
}
