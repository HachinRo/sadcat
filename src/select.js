const VERSIONS = ["v4", "v6"];
const CARRIERS = ["CM", "CU", "CT"];
const ALL_VERSIONS = ["v4", "v6", "domain"];
const ALL_CARRIERS = [...CARRIERS, "BESTCF"];

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
  if (aMeasured && bMeasured) {
    const latencyDifference = a.latency - b.latency;
    if (latencyDifference !== 0) return latencyDifference;
  }
  if (aMeasured !== bMeasured) return aMeasured ? -1 : 1;
  return b.speed - a.speed;
}

function compareNodes(a, b) {
  const performanceDifference = compareCandidates(a, b);
  if (performanceDifference !== 0) return performanceDifference;
  if (a.selected !== b.selected) return a.selected ? -1 : 1;
  const rankDifference = a.rank - b.rank;
  if (rankDifference !== 0) return rankDifference;
  return ALL_CARRIERS.indexOf(a.carrier) - ALL_CARRIERS.indexOf(b.carrier);
}

function deduplicateCandidates(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.version}:${candidate.ip.toLowerCase()}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, candidate);
      continue;
    }
    const winner = compareNodes(candidate, existing) < 0 ? candidate : existing;
    unique.set(key, { ...winner, selected: existing.selected || candidate.selected });
  }
  return [...unique.values()].sort((a, b) => {
    const versionDifference = ALL_VERSIONS.indexOf(a.version) - ALL_VERSIONS.indexOf(b.version);
    if (versionDifference !== 0) return versionDifference;
    const carrierDifference = ALL_CARRIERS.indexOf(a.carrier) - ALL_CARRIERS.indexOf(b.carrier);
    if (carrierDifference !== 0) return carrierDifference;
    return compareNodes(a, b);
  });
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

  return { nodes: deduplicateCandidates(nodes), selected };
}

module.exports = { CARRIERS, VERSIONS, deduplicateCandidates, normalizeCandidate, selectCandidates };
