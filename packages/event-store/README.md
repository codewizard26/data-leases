# Event store

`EventStore` requires Node.js 22.13 or later for `node:sqlite`. It owns one SQLite WAL index and one immutable Parquet dataset per configured directory. A second active writer is rejected. A dead writer's PID lock is recovered on restart.

```ts
const store = new EventStore({ directory: 'data/parquet' });
const event = store.append({ /* ConversationEvent fields except generated fields */ payload: { /* public-safe structured data */ } });
store.list(event.sessionId, 0); // Sequence cursor; first committed event has sequence 1.
await store.flush();
await store.close();
```

`append` commits synchronously to SQLite before returning. The store assigns sequence, ingestion timestamp, canonical redacted payload JSON, and payload SHA-256. Retrying the same event ID and content returns the original event; changed content produces `EVENT_ID_CONFLICT`. Generate stable event IDs at the producer. `sessions`, `getState`, and `putState` provide durable history and JSON state. State is redacted before persistence too.

Flush commits each batch identity to the outbox before writing at most 20 events for one UTC event date and session. Each new file is written to a temporary path, closed, fsynced, and atomically renamed. Already sealed files are never appended to. Restart removes abandoned Parquet temporary files; a finalized file whose export marker was not committed is validated and marked exported without being rewritten. Corrupt or contradictory finalized files fail explicitly.

Dataset layout: `conversation_events/event_date=YYYY-MM-DD/session_id=<encoded-id>/part-<batch-id>.parquet`. SQLite remains the transactional source of truth. `inspectParquetDataset(directory, sessionId?)` opens actual Parquet files without acquiring the writer lock, validates payload hashes and duplicate event IDs, and returns session order. It can run while the gateway is active; flush first when the most recent events must be included.

Supply only public-safe payloads. Redaction blocks common credential and prompt fields, bearer strings, API key patterns, and PEM private keys. It cannot infer whether arbitrary free text contains proprietary information. Parquet events retain structured answer values and evidence modes; a stored answer is not proof of correctness, CRE execution, or payment.
