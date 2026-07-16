# Cloudflare Node Radar runner

This one-shot runner consolidates optimized IPv4 and IPv6 candidates with six BestCF and GitHub community text feeds, measures latency and transfer speed, and publishes the top 10 results in each IPv4, IPv6, and domain sector. GitHub Actions starts it every 15 minutes; it does not modify DNS records.

## Required GitHub Actions secrets

- `SITES_INGEST_URL` — the deployed Site base URL
- `SITES_RUNNER_TOKEN` — authorizes the private Site and its ingestion endpoint

The workflow can optionally use repository variables `BEST_CF_IP_URL`, `BESTCF_DOMAIN_URL`, or comma-separated `BESTCF_SOURCE_URLS` to replace the default feeds.

## Behavior

- Runs once per invocation so scheduled jobs cannot overlap indefinitely.
- Collects candidates from the optimized-node API plus six resilient text sources; individual text-feed failures do not cancel a run.
- Classifies, deduplicates, and performs bounded HTTPS latency and 128 KiB transfer-speed probes once per unique endpoint.
- Publishes at most 10 IPv4, 10 IPv6, and 10 domain endpoints, ranked by lowest measured latency and then highest speed.
- Posts success and failure results to the dashboard.
- Requires no DNS provider, domain, or DNS credentials.
