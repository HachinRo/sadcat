const crypto = require("node:crypto");
const { selectCandidates } = require("./select");
const { updateDnsPod } = require("./dnspod");

const sourceUrl = process.env.BEST_CF_IP_URL?.trim() || "https://api.4ce.cn/api/bestCFIP";
const startedAt = new Date().toISOString();
const runId = `${startedAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;

async function fetchCandidates() {
  const response = await fetch(sourceUrl, { headers: { accept: "application/json", "user-agent": "cloudflare-node-radar/2.0" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Candidate source returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.success || !payload?.data) throw new Error("Candidate source returned an invalid response");
  return payload.data;
}

async function sendToDashboard(result) {
  const baseUrl = process.env.SITES_INGEST_URL?.trim()?.replace(/\/$/, "");
  const token = process.env.SITES_RUNNER_TOKEN?.trim();
  if (!baseUrl || !token) {
    console.warn("Dashboard ingestion skipped: SITES_INGEST_URL or SITES_RUNNER_TOKEN is missing");
    return false;
  }
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
      "OAI-Sites-Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(result),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Dashboard ingestion failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return true;
}

async function main() {
  let nodes = [];
  try {
    const candidates = await fetchCandidates();
    const selection = selectCandidates(candidates, 3);
    nodes = selection.nodes;
    const dns = await updateDnsPod(selection.selected);
    const result = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      status: dns.configured ? "success" : "partial",
      message: dns.message,
      dnsUpdated: dns.updatedCount > 0,
      nodes,
    };
    await sendToDashboard(result);
    console.log(JSON.stringify({ ...result, nodes: `${nodes.length} ranked candidates` }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = { runId, startedAt, completedAt: new Date().toISOString(), status: "failed", message, dnsUpdated: false, nodes };
    try { await sendToDashboard(failed); } catch (ingestError) { console.error(ingestError); }
    console.error(message);
    process.exitCode = 1;
  }
}

void main();
