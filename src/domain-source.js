const https = require("node:https");
const { isIP } = require("node:net");

const DEFAULT_DOMAIN_SOURCE_URL = "https://bestcf.pages.dev/domain/all.txt";
const SPEED_TEST_HOST = "speed.cloudflare.com";

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

function parseBestCfSource(text) {
  const unique = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const endpoint = parseEndpoint(line);
    if (endpoint) unique.set(`${endpoint.address}:${endpoint.port}`, endpoint);
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

async function benchmarkTarget(target) {
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

async function buildBestCfNodes(text, probe = benchmarkTarget, concurrency = 8) {
  const endpoints = parseBestCfSource(text);
  const measured = await mapWithConcurrency(endpoints, concurrency, async (endpoint) => ({ ...endpoint, ...(await probe(endpoint)) }));
  const order = { v4: 0, v6: 1, domain: 2 };
  measured.sort((a, b) => order[a.version] - order[b.version] || (a.latency || Infinity) - (b.latency || Infinity) || b.speed - a.speed || a.ip.localeCompare(b.ip));
  const ranks = { v4: 0, v6: 0, domain: 0 };
  return measured.map((endpoint) => {
    const rank = ++ranks[endpoint.version];
    return { version: endpoint.version, carrier: "BESTCF", ip: endpoint.ip, latency: endpoint.latency, speed: endpoint.speed, rank, selected: rank === 1 };
  });
}

module.exports = { DEFAULT_DOMAIN_SOURCE_URL, benchmarkTarget, buildBestCfNodes, parseBestCfSource, parseEndpoint };
