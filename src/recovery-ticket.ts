// Transfer the reset capability between React screens, never via URL/storage.
let pending: { ticket: string; expires: number } | null = null;
export function setRecoveryTicket(ticket: string) { pending = { ticket, expires: Date.now() + 600000 }; }
export function readRecoveryTicket() { return pending && pending.expires > Date.now() ? pending.ticket : null; }
export function clearRecoveryTicket() { pending = null; }
