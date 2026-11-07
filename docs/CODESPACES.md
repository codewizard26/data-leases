# Run the backend in GitHub Codespaces

The web console is hosted on Vercel. The backend (agent-gateway + 10 provider agents, SQLite, Parquet)
needs a long-running machine with a disk, so it runs in a GitHub Codespace. No credit card needed.

```
Browser ──► data-leases.vercel.app (Next.js) ── rewrites /api/* ──► https://<codespace>-3000.app.github.dev
                                                                     gateway :3000 (public)
                                                                     providers :4101-4110 (private)
                                                                     data/ (codespace disk, kept across stops)
```

## 1. One-time: add Codespaces secrets

GitHub → repo **Settings → Secrets and variables → Codespaces → New repository secret**
(or your personal **Settings → Codespaces → Secrets**, scoped to this repo):

| Secret | Required | Notes |
|---|---|---|
| `PRIVY_APP_ID` | yes | Same value as `NEXT_PUBLIC_PRIVY_APP_ID` on Vercel |
| `PRIVY_APP_SECRET` | yes* | *or `PRIVY_VERIFICATION_KEY` |
| `WEB_ORIGINS` | no | Defaults to `https://data-leases.vercel.app` |
| `HEDERA_BUYER_ACCOUNT_ID`, `HEDERA_BUYER_PRIVATE_KEY`, `HEDERA_MAX_PAYMENT_TINYBARS`, `PAYMENTS_ENABLED`, `HEDERA_PROVIDER_*_ACCOUNT_ID` | for paid runs | Testnet only. Never real-funds keys |
| `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `COMPUTE_PROVIDER` | optional | Model suggestions |
| `ARKIV_*`, `EVIDENCE_LAYER_ENABLED`, `PROVIDER_LINK_SOURCE_ENABLED` | optional | Arkiv offers and live public sources |

Secrets become environment variables inside the codespace. They are never written to git; a local `.env`
is created from `.env.example` only for non-secret defaults, and environment variables always win over it.

## 2. Create the codespace

GitHub → **Code → Codespaces → Create codespace on main** (or `gh codespace create -R codewizard26/data-leases -b main`).

The dev container installs dependencies, then starts the backend and makes port 3000 public automatically.
Check it in the codespace terminal:

```bash
bash scripts/codespace-backend.sh status   # running · providers ready: 10 · gateway: 200
bash scripts/codespace-backend.sh url      # GATEWAY_URL to put in Vercel
```

If the port did not become public: **Ports** tab → right-click `3000` → **Port Visibility → Public**.

## 3. Point Vercel at it

```bash
vercel env add GATEWAY_URL production   # paste the URL from step 2
vercel deploy --prod                    # rewrites are fixed at build time
```

The codespace URL is stable for the life of the codespace, so this is needed only once per codespace.

## 4. Privy

In the Privy dashboard add `https://data-leases.vercel.app` as an allowed domain.

## Day to day

```bash
bash scripts/codespace-backend.sh start|stop|restart|status|url|logs
```

- **Idle timeout:** a codespace stops after 30 minutes without editor/terminal activity (traffic to the
  public port does not count). Raise it to 240 minutes in GitHub **Settings → Codespaces → Default idle timeout**
  before a demo. Reopening the codespace restarts the backend automatically (`postStartCommand`).
- **Data:** `data/` lives on the codespace disk and survives stops and restarts; it is lost only if the
  codespace is deleted (GitHub deletes codespaces after 30 days unused by default).
- **Free quota:** personal accounts get a monthly allowance of core-hours; a 2-core codespace uses 2 per hour.
  Stop the codespace when you are not demoing.
- **Not available in the codespace:** the Chainlink `cre` CLI and Bun are not installed, so CRE CLI simulation
  stays a local step; the UI keeps showing the honest evidence state.
- Local test login is forced off here (`BUYER_DEV_LOGIN=false`); use Privy.
