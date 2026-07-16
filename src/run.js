const crypto = require("node:crypto");
const { buildBestCfNodes, DEFAULT_TEXT_SOURCES } = require("./domain-source");
const { limitCandidatesByVersion, selectCandidates } = require("./select");

const sourceUrl = process.env.BEST_CF_IP_URL?.trim() || "https://api.4ce.cn/api/bestCFIP";
const configuredSourceUrls = process.env.BESTCF_SOURCE_URLS?.split(",").map((value) => value.trim()).filter(Boolean);
const textSources = configuredSourceUrls?.length
  ? configuredSourceUrls.map((url, index) => ({ name: `Configured text source ${index + 1}`, url }))
  : DEFAULT_TEXT_SOURCES.map((source, index) => index === 0 && process.env.BESTCF_DOMAIN_URL?.trim()
    ? { ...source, url: process.env.BESTCF_DOMAIN_URL.trim() }
    : source);
const startedAt = new Date().toISOString();
const runId = `${startedAt.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;

async function fetchCandidates() {
  const response = await fetch(sourceUrl, { headers: { accept: "application/json", "user-agent": "cloudflare-node-radar/2.0" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Candidate source returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.success || !payload?.data) throw new Error("Candidate source returned an invalid response");
  return payload.data;
}

async function fetchTextSources() {
  const results = await Promise.allSettled(textSources.map(async (source) => {
    const response = await fetch(source.url, { headers: { accept: "text/plain", "user-agent": "cloudflare-node-radar/4.0" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${source.name} returned HTTP ${response.status}`);
    return { ...source, text: await response.text() };
  }));
  const loaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const warnings = results.flatMap((result) => result.status === "rejected" ? [String(result.reason?.message || result.reason)] : []);
  if (!loaded.length) throw new Error(`All text sources failed: ${warnings.join("; ")}`);
  return { loaded, warnings };
}

async function sendToDashboard(result) {
  const baseUrl = process.env.SITES_INGEST_URL?.trim()?.replace(/\/$/, "");
  const token = process.env.SITES_RUNNER_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new Error("SITES_INGEST_URL or SITES_RUNNER_TOKEN is missing");
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
    const [candidates, textResult] = await Promise.all([fetchCandidates(), fetchTextSources()]);
    const selection = selectCandidates(candidates, 3);
    const bestCfNodes = await buildBestCfNodes(textResult.loaded);
    nodes = limitCandidatesByVersion([...selection.nodes, ...bestCfNodes], 10);
    const sourceSummary = `${textResult.loaded.length + 1}/${textSources.length + 1} sources`;
    const warningSummary = textResult.warnings.length ? `; ${textResult.warnings.length} unavailable` : "";
    const result = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      status: "success",
      message: `${nodes.length} top IPv4, IPv6, and domain endpoints measured from ${sourceSummary}${warningSummary}`,
      dnsUpdated: false,
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
