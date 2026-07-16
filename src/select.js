const VERSIONS = ["v4", "v6"];
const CARRIERS = ["CM", "CU", "CT"];

function normalizeCandidate(candidate, version) {
  const ip = typeof candidate?.ip === "string" ? candidate.ip.trim() : "";
  const isIpv6 = ip.includes(":");
  const rawLatency = candidate?.latency;
  const latency = rawLatency === undefined || rawLatency === null || rawLatency === "" ? 0 : Number(rawLatency);
  const speed = Number(candidate?.speed);
  if (!ip || (version === "v6") !== isIpv6 || !Number.isFinite(latency) || latency < 0) return null;
  return { ip, latency, speed: Number.isFinite(speed) && speed >= 0 ? speed : 0 };
}

function compareCandidates(a, b) {
  const aMeasured = a.latency > 0;
  const bMeasured = b.latency > 0;
  if (aMeasured && bMeasured) return a.latency - b.latency;
  if (aMeasured !== bMeasured) return aMeasured ? -1 : 1;
  return b.speed - a.speed;
}

function selectCandidates(data, retainPerCarrier = 3) {
  const nodes = [];
  const selected = { v4: {}, v6: {} };

  for (const version of VERSIONS) {
    const versionNodes = [];
    for (const carrier of CARRIERS) {
      const ranked = (Array.isArray(data?.[version]?.[carrier]) ? data[version][carrier] : [])
        .map((candidate) => normalizeCandidate(candidate, version))
        .filter(Boolean)
        .sort(compareCandidates)
        .slice(0, retainPerCarrier);
      if (!ranked.length) throw new Error(`No valid ${version === "v4" ? "IPv4" : "IPv6"} candidates for ${carrier}`);
      selected[version][carrier] = ranked[0].ip;
      ranked.forEach((candidate, index) => {
        const result = { version, carrier, ip: candidate.ip, latency: candidate.latency, speed: candidate.speed, rank: index + 1, selected: index === 0 };
        nodes.push(result);
        versionNodes.push(result);
      });
    }
    selected[version].DEFAULT = versionNodes.reduce((best, node) => node.latency < best.latency ? node : best).ip;
  }

  return { nodes, selected };
}

module.exports = { CARRIERS, VERSIONS, normalizeCandidate, selectCandidates };
