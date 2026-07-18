# Cloudflare Node Radar runner

This one-shot runner consolidates optimized IPv4 and IPv6 candidates with eleven BestCF and GitHub community text feeds, carries forward previously working nodes, and adds 30 random candidates from Cloudflare's official IPv6 and China/JD Cloud CIDR ranges. It measures latency and transfer speed, drops failed HTTPS probes, and publishes the top 10 results in each IPv4, IPv6, and domain sector. GitHub Actions starts it every 15 minutes; it does not modify DNS records.

## Required GitHub Actions secrets

- `SITES_INGEST_URL` — the deployed Site base URL
- `SITES_RUNNER_TOKEN` — authorizes the private Site and its ingestion endpoint

The workflow can optionally use repository variables `BEST_CF_IP_URL`, `BESTCF_DOMAIN_URL`, or comma-separated `BESTCF_SOURCE_URLS` to replace the default feeds.

## Behavior

- Runs once per invocation so scheduled jobs cannot overlap indefinitely.
- Collects candidates from the optimized-node API plus eleven resilient text sources; individual text-feed failures do not cancel a run.
- Classifies, deduplicates, and performs bounded HTTPS latency and 128 KiB transfer-speed probes once per unique endpoint.
- Re-tests previously published nodes, drops failures, and samples 15 IPv4 plus 15 IPv6 addresses from official Cloudflare ranges on every refresh.
- Carries consecutive live time and successful-check counts forward for nodes that remain healthy.
- Publishes at most 10 IPv4, 10 IPv6, and 10 domain endpoints, ranked by lowest measured latency and then highest speed.
- Posts success and failure results to the dashboard.
- Requires no DNS provider, domain, or DNS credentials.
