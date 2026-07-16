# Cloudflare Node Radar runner

This one-shot runner consolidates optimized IPv4 and IPv6 candidates with the BestCF domain source, measures latency and transfer speed, and publishes one dashboard result. GitHub Actions starts it every 15 minutes; it does not modify DNS records.

## Required GitHub Actions secrets

- `SITES_INGEST_URL` — the deployed Site base URL
- `SITES_RUNNER_TOKEN` — authorizes the private Site and its ingestion endpoint

The workflow can optionally use repository variables `BEST_CF_IP_URL` and `BESTCF_DOMAIN_URL` to replace the default optimized-node and BestCF feeds.

## Behavior

- Runs once per invocation so scheduled jobs cannot overlap indefinitely.
- Retains the top three IPv4 and IPv6 candidates for China Mobile (`CM`), China Unicom (`CU`), and China Telecom (`CT`).
- Classifies the BestCF feed into IPv4, IPv6, and domain endpoints, then performs bounded HTTPS latency and 128 KiB transfer-speed probes.
- Posts success and failure results to the dashboard.
- Requires no DNS provider, domain, or DNS credentials.
