const https = require("node:https");
const crypto = require("node:crypto");
const { isIP } = require("node:net");

const DEFAULT_DOMAIN_SOURCE_URL = "https://bestcf.pages.dev/domain/all.txt";
const DEFAULT_TEXT_SOURCES = [
  { name: "BestCF domains", url: DEFAULT_DOMAIN_SOURCE_URL },
  { name: "BestCF Tiancheng", url: "https://bestcf.pages.dev/tiancheng/all.txt" },
  { name: "BestCF S5GY", url: "https://bestcf.pages.dev/s5gy/all.txt" },
  { name: "BestCF Gslege", url: "https://bestcf.pages.dev/gslege/Cfxyz.txt" },
  { name: "svip-s best IPs", url: "https://raw.githubusercontent.com/svip-s/cloudflare_ip/refs/heads/main/best_ips.txt", versions: ["v4"] },
  { name: "BestCFip IPv4", url: "https://raw.githubusercontent.com/joname1/BestCFip/refs/heads/main/ipv4.txt", versions: ["v4"] },
  { name: "BestCF CFYes IPv6", url: "https://bestcf.pages.dev/cfyes/ipv6.txt", versions: ["v6"] },
  { name: "BestCF vvHan IPv6", url: "https://bestcf.pages.dev/vvhan/ipv6.txt", versions: ["v6"] },
  { name: "BestCF NiREvil IPv6", url: "https://bestcf.pages.dev/nirevil/ipv6.txt", versions: ["v6"] },
  { name: "IPDB BestCF IPv6", url: "https://raw.githubusercontent.com/ymyuuu/IPDB/refs/heads/main/BestCF/bestcfv6.txt", versions: ["v6"] },
  { name: "BestCFip IPv6", url: "https://raw.githubusercontent.com/joname1/BestCFip/refs/heads/main/ipv6.txt", versions: ["v6"] },
];
const SPEED_TEST_HOST = "speed.cloudflare.com";
const MIN_NODE_SPEED_KBPS = 300;
const CLOUDFLARE_IPV6_URL = "https://www.cloudflare.com/ips-v6";
const CLOUDFLARE_JDCLOUD_IPS_URL = "https://api.cloudflare.com/client/v4/ips?networks=jdcloud";

function randomBigInt(byteLength, randomBytes = crypto.randomBytes) {
  const hex = randomBytes(byteLength).toString("hex");
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function ipv4ToBigInt(address) {
  return address.split(".").reduce((value, octet) => (value << 8n) | BigInt(Number(octet)), 0n);
}

function bigIntToIpv4(value) {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join(".");
}

function ipv6ToBigInt(address) {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) throw new Error(`Invalid IPv6 address: ${address}`);
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) throw new Error(`Invalid IPv6 address: ${address}`);
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function bigIntToIpv6(value) {
  return Array.from({ length: 8 }, (_, index) => Number((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16)).join(":");
}

function randomAddressFromCidr(cidr, randomBytes = crypto.randomBytes) {
  const [address, prefixText] = String(cidr).trim().split("/");
  const version = isIP(address);
  const bits = version === 4 ? 32 : version === 6 ? 128 : 0;
  const prefix = Number(prefixText);
  if (!bits || !Number.isInteger(prefix) || prefix < 0 || prefix > bits) throw new Error(`Invalid CIDR: ${cidr}`);
  const source = version === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  const hostBits = BigInt(bits - prefix);
  const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  const base = source & ~hostMask;
  const size = hostMask + 1n;
  let offset = randomBigInt(version === 4 ? 4 : 16, randomBytes) % size;
  if (version === 4 && size > 2n) offset = 1n + (offset % (size - 2n));
  const sampled = base + offset;
  return version === 4 ? bigIntToIpv4(sampled) : bigIntToIpv6(sampled);
}

function sampleCidrs(cidrs, count, randomBytes = crypto.randomBytes) {
  const uniqueCidrs = [...new Set(cidrs.map((cidr) => String(cidr).trim()).filter(Boolean))];
  const sampled = new Set();
  const maxAttempts = Math.max(100, count * 30);
  for (let attempt = 0; attempt < maxAttempts && sampled.size < count && uniqueCidrs.length; attempt += 1) {
    const index = Number(randomBigInt(4, randomBytes) % BigInt(uniqueCidrs.length));
    sampled.add(randomAddressFromCidr(uniqueCidrs[index], randomBytes));
  }
  return [...sampled];
}

function sampleOfficialIpCandidates(ipv6Text, jdCloudPayload, total = 30, randomBytes = crypto.randomBytes) {
  const officialV6 = String(ipv6Text || "").split(/\r?\n/).map((value) => value.trim()).filter((value) => value.includes("/"));
  const jdCloudCidrs = Array.isArray(jdCloudPayload?.result?.jdcloud_cidrs) ? jdCloudPayload.result.jdcloud_cidrs : [];
  const ipv4Cidrs = jdCloudCidrs.filter((value) => !String(value).includes(":"));
  const ipv6Cidrs = [...officialV6, ...jdCloudCidrs.filter((value) => String(value).includes(":"))];
  if (!ipv4Cidrs.length && !ipv6Cidrs.length) throw new Error("Official Cloudflare sources returned no CIDR ranges");
  const ipv4Count = ipv4Cidrs.length && ipv6Cidrs.length ? Math.floor(total / 2) : ipv4Cidrs.length ? total : 0;
  const ipv6Count = total - ipv4Count;
  return [
    ...sampleCidrs(ipv4Cidrs, ipv4Count, randomBytes),
    ...sampleCidrs(ipv6Cidrs, ipv6Count, randomBytes),
  ].map((address) => parseEndpoint(address)).filter(Boolean);
}

function parseEndpoint(line) {
  const value = String(line || "").split("#", 1)[0].trim();
  if (!value) return null;
  let address = value;
  let port = 443;
  if (value.startsWith("[")) {
    const match = value.match(/^\[([^\]]+)](?::(\d+))?$/);
    if (!match) return null;
    address = match[1];
    port = Number(match[2] || 443);
  } else if (!isIP(value)) {
    const separator = value.lastIndexOf(":");
    if (separator > -1 && /^\d+$/.test(value.slice(separator + 1))) {
      address = value.slice(0, separator);
      port = Number(value.slice(separator + 1));
    }
  }
  address = address.trim().toLowerCase();
  const ipVersion = isIP(address);
  const version = ipVersion === 4 ? "v4" : ipVersion === 6 ? "v6" : "domain";
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (version === "domain" && (!address.includes(".") || !/^[a-z0-9.-]+$/.test(address))) return null;
  const ip = port === 443 ? address : ipVersion === 6 ? `[${address}]:${port}` : `${address}:${port}`;
  return { address, port, ip, version };
}

function parseBestCfSource(text, versions = ["v4", "v6", "domain"]) {
  const unique = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const endpoint = parseEndpoint(line);
    if (endpoint && versions.includes(endpoint.version)) unique.set(`${endpoint.address}:${endpoint.port}`, endpoint);
  }
  return [...unique.values()];
}

function requestProbe(target, { hostHeader, path, servername, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let latency = 0;
    let firstByteAt = 0;
    let bytes = 0;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) return reject(error);
      const completed = performance.now();
      const transferStarted = firstByteAt || started + latency;
      const transferSeconds = Math.max(0.001, (completed - transferStarted) / 1000);
      resolve({ latency: Math.max(0.1, Number(latency.toFixed(1))), speed: Math.max(0.1, Number(((bytes / 1024) / transferSeconds).toFixed(1))) });
    };
    const request = https.request({
      hostname: target.address,
      port: target.port,
      method: "GET",
      path,
      servername,
      rejectUnauthorized: false,
      headers: { host: hostHeader, accept: "*/*", "user-agent": "cloudflare-node-radar/3.0" },
    }, (response) => {
      latency = performance.now() - started;
      response.on("data", (chunk) => {
        if (!firstByteAt) firstByteAt = performance.now();
        bytes += chunk.length;
      });
      response.once("end", () => bytes > 0 ? finish() : finish(new Error("Empty probe response")));
      response.once("error", finish);
    });
    request.once("socket", (socket) => socket.once("secureConnect", () => { latency = performance.now() - started; }));
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Probe timed out")));
    request.once("error", finish);
    request.end();
  });
}

async function requestDashboardIpv6Probe(target) {
  const baseUrl = process.env.SITES_INGEST_URL?.trim().replace(/\/$/, "");
  const token = process.env.SITES_RUNNER_TOKEN?.trim();
  if (!baseUrl || !token) throw new Error("Dashboard IPv6 probe is not configured");
  const response = await fetch(`${baseUrl}/api/ipv6-probe`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "OAI-Sites-Authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "cloudflare-node-radar/5.0",
    },
    body: JSON.stringify({ address: target.address, port: target.port }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Dashboard IPv6 probe returned HTTP ${response.status}`);
  const result = await response.json();
  const latency = Number(result?.latency);
  const speed = Number(result?.speed);
  if (!(latency > 0) || !(speed > 0)) throw new Error("Dashboard IPv6 probe returned an invalid measurement");
  return { latency, speed };
}

async function benchmarkTarget(target) {
  if (target.version === "v6") {
    try {
      return await requestDashboardIpv6Probe(target);
    } catch {
      return { latency: 0, speed: 0 };
    }
  }
  try {
    return await requestProbe(target, { hostHeader: SPEED_TEST_HOST, servername: SPEED_TEST_HOST, path: "/__down?bytes=131072" });
  } catch {
    try {
      return await requestProbe(target, { hostHeader: target.address, servername: isIP(target.address) ? undefined : target.address, path: "/cdn-cgi/trace" });
    } catch {
      return { latency: 0, speed: 0 };
    }
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function buildBestCfNodes(sources, probe = benchmarkTarget, concurrency = 12) {
  const inputs = Array.isArray(sources) ? sources : [{ text: sources }];
  const unique = new Map();
  for (const input of inputs) {
    const versions = Array.isArray(input.versions) ? input.versions : undefined;
    for (const endpoint of parseBestCfSource(input.text, versions)) unique.set(`${endpoint.address}:${endpoint.port}`, endpoint);
  }
  const endpoints = [...unique.values()];
  const measured = await mapWithConcurrency(endpoints, concurrency, async (endpoint) => ({ ...endpoint, ...(await probe(endpoint)) }));
  const order = { v4: 0, v6: 1, domain: 2 };
  measured.sort((a, b) => order[a.version] - order[b.version] || (a.latency || Infinity) - (b.latency || Infinity) || b.speed - a.speed || a.ip.localeCompare(b.ip));
  const ranks = { v4: 0, v6: 0, domain: 0 };
  return measured.map((endpoint) => {
    const rank = ++ranks[endpoint.version];
    return { version: endpoint.version, carrier: "BESTCF", ip: endpoint.ip, latency: endpoint.latency, speed: endpoint.speed, rank, selected: rank === 1 };
  });
}

function keepWorkingNodes(nodes) {
  return nodes.filter((node) => Number.isFinite(node.latency) && node.latency > 0 && Number.isFinite(node.speed) && node.speed >= MIN_NODE_SPEED_KBPS);
}

module.exports = {
  CLOUDFLARE_IPV6_URL,
  CLOUDFLARE_JDCLOUD_IPS_URL,
  DEFAULT_DOMAIN_SOURCE_URL,
  DEFAULT_TEXT_SOURCES,
  MIN_NODE_SPEED_KBPS,
  benchmarkTarget,
  buildBestCfNodes,
  keepWorkingNodes,
  parseBestCfSource,
  parseEndpoint,
  randomAddressFromCidr,
  sampleOfficialIpCandidates,
};
