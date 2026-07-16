# Cloudflare Node Radar runner

This is a one-shot adaptation of `CloudflareIP-dnspod-ddns`. GitHub Actions starts it every 15 minutes; it does not keep a web server or scheduler alive.

## Required GitHub Actions secrets

- `DNSPOD_SECRET_ID`
- `DNSPOD_SECRET_KEY`
- `DNSPOD_DOMAIN`
- `DNSPOD_SUBDOMAIN`
- `SITES_INGEST_URL` — the deployed Site base URL
- `SITES_RUNNER_TOKEN` — sent to the private Site and its ingestion endpoint

The workflow can also use the repository variable `BEST_CF_IP_URL` to replace the default candidate source.

## Behavior changes from the supplied project

- Runs once per invocation so scheduled jobs cannot overlap indefinitely.
- Awaits every DNSPod mutation and fails visibly if any record update fails.
- Correctly maps China Mobile (`CM`), China Unicom (`CU`), and China Telecom (`CT`) candidates to their matching DNSPod lines.
- Chooses the default DNS line from the overall lowest-latency candidate.
- Retains the top three candidates per carrier and address family for the dashboard.
- Posts success, partial, and failure results to the Site.
