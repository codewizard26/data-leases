# Recurring lease extension

The dashboard supports Run once or Recurring lease. A recurring authorization includes frequency, expiry, per-request price cap, total budget and eligible providers. These settings are included in the signed local lease policy. Comparing quotes never starts a schedule. The user must explicitly authorize the recurring lease.

The existing gateway owns a durable SQLite scheduler and invokes the existing run orchestrator. Every occurrence rediscovers and negotiates before using the existing Hedera x402 adapter. One occurrence per lease can be active; deterministic occurrence IDs and persisted dispatch state prevent replay after restart. Missed intervals are skipped, not charged in a catch-up burst. Unknown payment outcomes pause the schedule until reconciliation. Cancellation and expiry prevent subsequent payment attempts. A transfer already submitted may still settle.

Discovery results use compact agent cards showing the requested capability, actual quote, round, source and response status. The landing page remains at `/`; the dashboard remains at `/dashboard`.

Acceptance: recurring controls persist in the signed policy; two scheduled occurrences use distinct run IDs and the same total budget; budget, expiry, cancellation and uncertain settlement prevent further dispatch; restart resumes a persisted dispatch with its original ID; overlapping ticks do not duplicate a run. Tests inject payment adapters and do not transfer tokens. No Arkiv or CRE implementation is changed.
