# Cloudflare Node Radar runner

This one-shot runner copies optimized IPv4 and IPv6 candidates from the public feed used by the supplied `CloudflareIP-dnspod-ddns` project. GitHub Actions starts it every 15 minutes; it does not modify DNS records.

## Required GitHub Actions secrets

- `SITES_INGEST_URL` — the deployed Site base URL
- `SITES_RUNNER_TOKEN` — authorizes the private Site and its ingestion endpoint

The workflow can optionally use the repository variable `BEST_CF_IP_URL` to replace the default `https://api.4ce.cn/api/bestCFIP` feed.

## Behavior

- Runs once per invocation so scheduled jobs cannot overlap indefinitely.
- Retains the top three IPv4 and IPv6 candidates for China Mobile (`CM`), China Unicom (`CU`), and China Telecom (`CT`).
- Posts success and failure results to the dashboard.
- Requires no DNS provider, domain, or DNS credentials.
