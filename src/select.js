const VERSIONS = ["v4", "v6"];
const CARRIERS = ["CM", "CU", "CT"];

function normalizeCandidate(candidate) {
  const ip = typeof candidate?.ip === "string" ? candidate.ip.trim() : "";
  const latency = Number(candidate?.latency);
  if (!ip || !Number.isFinite(latency) || latency < 0) return null;
  return { ip, latency };
}

function selectCandidates(data, retainPerCarrier = 3) {
  const nodes = [];
  const selected = { v4: {}, v6: {} };

  for (const version of VERSIONS) {
    const versionNodes = [];
    for (const carrier of CARRIERS) {
      const ranked = (Array.isArray(data?.[version]?.[carrier]) ? data[version][carrier] : [])
        .map(normalizeCandidate)
        .filter(Boolean)
        .sort((a, b) => a.latency - b.latency)
        .slice(0, retainPerCarrier);
      if (!ranked.length) throw new Error(`No valid ${version === "v4" ? "IPv4" : "IPv6"} candidates for ${carrier}`);
      selected[version][carrier] = ranked[0].ip;
      ranked.forEach((candidate, index) => {
        const result = { version, carrier, ip: candidate.ip, latency: candidate.latency, rank: index + 1, selected: index === 0 };
        nodes.push(result);
        versionNodes.push(result);
      });
    }
    selected[version].DEFAULT = versionNodes.reduce((best, node) => node.latency < best.latency ? node : best).ip;
  }

  return { nodes, selected };
}

module.exports = { CARRIERS, VERSIONS, normalizeCandidate, selectCandidates };
