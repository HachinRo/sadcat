const crypto = require("node:crypto");
const {
  buildBestCfNodes,
  CLOUDFLARE_IPV6_URL,
  CLOUDFLARE_JDCLOUD_IPS_URL,
  DEFAULT_TEXT_SOURCES,
  keepWorkingNodes,
  sampleOfficialIpCandidates,
} = require("./domain-source");
const { annotateLiveness, limitCandidatesByVersion, selectCandidates } = require("./select");

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

function dashboardConfig() {
  const baseUrl = process.env.SITES_INGEST_URL?.trim()?.replace(/\/$/, "");
  const token = process.env.SITES_RUNNER_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("SITES_INGEST_URL or SITES_RUNNER_TOKEN is missing");
  return { baseUrl, token };
}

function dashboardHeaders(token) {
  return {
    "authorization": `Bearer ${token}`,
    "OAI-Sites-Authorization": `Bearer ${token}`,
  };
}

async function fetchPreviousNodes() {
  try {
    const { baseUrl, token } = dashboardConfig();
    const response = await fetch(`${baseUrl}/api/runs`, {
      headers: { ...dashboardHeaders(token), accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Dashboard history returned HTTP ${response.status}`);
    const payload = await response.json();
    return {
      nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
      completedAt: payload?.nodesUpdatedAt || payload?.latest?.completedAt || startedAt,
      warning: "",
    };
  } catch (error) {
    return { nodes: [], completedAt: startedAt, warning: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchOfficialIpSample() {
  try {
    const [ipv6Response, jdCloudResponse] = await Promise.all([
      fetch(CLOUDFLARE_IPV6_URL, { headers: { accept: "text/plain", "user-agent": "cloudflare-node-radar/5.0" }, signal: AbortSignal.timeout(20_000) }),
      fetch(CLOUDFLARE_JDCLOUD_IPS_URL, { headers: { accept: "application/json", "user-agent": "cloudflare-node-radar/5.0" }, signal: AbortSignal.timeout(20_000) }),
    ]);
    if (!ipv6Response.ok) throw new Error(`Cloudflare IPv6 ranges returned HTTP ${ipv6Response.status}`);
    if (!jdCloudResponse.ok) throw new Error(`Cloudflare China ranges returned HTTP ${jdCloudResponse.status}`);
    const endpoints = sampleOfficialIpCandidates(await ipv6Response.text(), await jdCloudResponse.json(), 30);
    if (endpoints.length !== 30) throw new Error(`Official range sampler produced ${endpoints.length}/30 candidates`);
    return { endpoints, warning: "" };
  } catch (error) {
    return { endpoints: [], warning: error instanceof Error ? error.message : String(error) };
  }
}

function nodesAsText(nodes) {
  return nodes.map((node) => node.ip).filter((value) => typeof value === "string" && value.trim()).join("\n");
}

async function sendToDashboard(result) {
  const { baseUrl, token } = dashboardConfig();
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...dashboardHeaders(token),
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
    const [candidates, textResult, officialResult, previousResult] = await Promise.all([
      fetchCandidates(),
      fetchTextSources(),
      fetchOfficialIpSample(),
      fetchPreviousNodes(),
    ]);
    const selection = selectCandidates(candidates, 3);
    const probeSources = [
      ...textResult.loaded,
      { name: "Optimized-node API", text: nodesAsText(selection.nodes) },
      { name: "Previously working nodes", text: nodesAsText(previousResult.nodes) },
      { name: "Official Cloudflare random sample", text: officialResult.endpoints.map((endpoint) => endpoint.ip).join("\n") },
    ];
    const measuredNodes = await buildBestCfNodes(probeSources);
    const workingNodes = keepWorkingNodes(measuredNodes);
    const rankedNodes = limitCandidatesByVersion(workingNodes, 10);
    nodes = annotateLiveness(rankedNodes, previousResult.nodes, previousResult.completedAt, startedAt);
    if (!nodes.length) throw new Error("No candidates passed the HTTPS and 300 KB/s minimum-speed checks");
    const sourceSummary = `${textResult.loaded.length + 1}/${textSources.length + 1} sources`;
    const warnings = [
      ...textResult.warnings,
      ...(officialResult.warning ? [`Official Cloudflare sample: ${officialResult.warning}`] : []),
      ...(previousResult.warning ? [`Previous pool: ${previousResult.warning}`] : []),
    ];
    const warningSummary = warnings.length ? `; ${warnings.length} unavailable` : "";
    const dropped = measuredNodes.length - workingNodes.length;
    const result = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      status: "success",
      message: `${nodes.length} top endpoints; ${workingNodes.length} passed and ${dropped} failed connectivity/speed checks (minimum 300 KB/s); ${officialResult.endpoints.length}/30 official random IPs sampled from ${sourceSummary}${warningSummary}`,
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
