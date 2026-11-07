# Deploy gateway + provider agents on Oracle Cloud Always Free

The web console runs on Vercel (`apps/web`). This folder runs everything else on one
always-on VM: the agent-gateway plus all provider agents (`START_WEB=false scripts/dev.ts`).

Why one VM: the gateway reaches providers at `127.0.0.1:<port>` and needs a persistent
disk for SQLite, Parquet, payment journals and CRE artifacts (all under `data/`).

```
Browser ──► data-leases.vercel.app (Next.js)
               │  rewrites /, /about, /developer, /api/*  (GATEWAY_URL)
               ▼
          https://<ip>.sslip.io  ── Caddy (80/443, auto TLS)
               │
               ▼  127.0.0.1:3000 gateway ──► 127.0.0.1:4101..4106 providers
                  data/ (bind mount, persistent)
```

> Status: `pnpm serve` (gateway + providers, no web) was verified locally on macOS.
> The Docker image and these Oracle steps have **not** been run end-to-end yet.

## 1. Create the VM (Oracle console, one-time)

1. Sign up at https://www.oracle.com/cloud/free/. A card is needed for verification;
   Always Free resources are not charged.
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **Ampere VM.Standard.A1.Flex**, 2 OCPU / 12 GB is plenty (free up to 4 / 24).
     If you see "Out of capacity", try another availability domain or use
     **VM.Standard.E2.1.Micro** (1 GB RAM; `setup.sh` adds swap).
   - Add your SSH public key.
3. **Networking → VCN → Security Lists → Default → Add Ingress Rules**:
   source `0.0.0.0/0`, TCP, destination ports `80` and `443`.
4. Note the instance's **public IP**.

## 2. Install and start (on the VM)

```bash
ssh ubuntu@<PUBLIC_IP>
curl -fsSL https://raw.githubusercontent.com/codewizard26/data-leases/feat/verification-arkiv/deploy/oracle/setup.sh -o setup.sh
bash setup.sh            # docker, firewall 80/443, swap, clone repo, create .env
nano ~/data-leases/.env  # fill server-side settings (see checklist below)

cd ~/data-leases/deploy/oracle
sudo DOMAIN=<1-2-3-4>.sslip.io docker compose up -d --build   # IP with dashes
curl https://<1-2-3-4>.sslip.io/api/public/analytics             # expect 200 JSON
```

`sslip.io` maps `1-2-3-4.sslip.io` to `1.2.3.4`, so Caddy can get a free Let's Encrypt
certificate without buying a domain. If issuance fails or is rate-limited, create a free
DuckDNS name pointing at the IP and use that as `DOMAIN`.

Logs / restart / update:

```bash
sudo docker compose logs -f app
sudo docker compose restart app
cd ~/data-leases && git pull && cd deploy/oracle && sudo DOMAIN=... docker compose up -d --build
```

## 3. Point Vercel at the gateway

`GATEWAY_URL` is read at build time (Next.js rewrites), so redeploy after setting it:

```bash
vercel env add GATEWAY_URL production     # value: https://<1-2-3-4>.sslip.io
vercel deploy --prod
```

## `.env` checklist on the VM

- The `.env` file stays on the VM only (`chmod 600`). Never commit it or copy it into the image;
  `.dockerignore` excludes it and compose loads it at runtime via `env_file`.
- Use testnet-only keys (Hedera, Arkiv); never reuse real-funds keys on a public server.
- `WORLD_REDIRECT_URI=https://data-leases.vercel.app/api/auth/world/callback` and register
  that URL with your World client. Keep `WORLD_ALLOW_LOCAL_HTTP=false`.
- `EVIDENCE_LAYER_ENABLED` / CRE: the image does not include the `cre` CLI or Bun. Local
  CRE CLI simulation still needs to run on a machine with them installed; keep the UI
  evidence state honest (`MOCK` / `CRE_CLI_SIMULATION`) accordingly.

## Persistence

All state is in `~/data-leases/data` on the VM (bind-mounted to `/app/data`). Back it up
with `tar czf data-$(date +%F).tgz data/`. Rebuilding or restarting containers keeps it.
