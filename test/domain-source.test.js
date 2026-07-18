const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_TEXT_SOURCES,
  buildBestCfNodes,
  keepWorkingNodes,
  parseBestCfSource,
  parseEndpoint,
  randomAddressFromCidr,
  sampleOfficialIpCandidates,
} = require("../src/domain-source");

test("classifies BestCF IPv4, IPv6, and domain endpoints", () => {
  assert.deepEqual(parseEndpoint("162.159.198.1:443#Official"), { address: "162.159.198.1", port: 443, ip: "162.159.198.1", version: "v4" });
  assert.deepEqual(parseEndpoint("[2606:4700::1]:8443#IPv6"), { address: "2606:4700::1", port: 8443, ip: "[2606:4700::1]:8443", version: "v6" });
  assert.deepEqual(parseEndpoint("www.cloudflare.com:443#Domain"), { address: "www.cloudflare.com", port: 443, ip: "www.cloudflare.com", version: "domain" });
});

test("deduplicates source endpoints", () => {
  const endpoints = parseBestCfSource("example.com:443#One\nexample.com:443#Two\n1.1.1.1:8443#IP");
  assert.equal(endpoints.length, 2);
});

test("builds ranked nodes with measured latency and speed", async () => {
  const nodes = await buildBestCfNodes(
    "example.com:443#Domain\n1.1.1.1:443#IPv4\n[2606:4700::1]:443#IPv6",
    async (endpoint) => ({ latency: endpoint.version === "domain" ? 12 : 20, speed: endpoint.version === "domain" ? 640 : 300 }),
    2,
  );
  assert.deepEqual(nodes.map((node) => node.version), ["v4", "v6", "domain"]);
  assert.equal(nodes.every((node) => node.latency > 0 && node.speed > 0), true);
  assert.equal(nodes.every((node) => node.carrier === "BESTCF"), true);
});

test("combines sources and benchmarks duplicate endpoints once", async () => {
  let probes = 0;
  const nodes = await buildBestCfNodes([
    { text: "example.com:443#Domain\n1.1.1.1:443#IPv4" },
    { text: "example.com:443#Duplicate\n[2606:4700::1]:443#IPv6" },
  ], async () => { probes += 1; return { latency: 10, speed: 500 }; });
  assert.equal(nodes.length, 3);
  assert.equal(probes, 3);
});

test("honors version restrictions for IPv4-only feeds", () => {
  const endpoints = parseBestCfSource("ipv4.list.updated.at#Header\n1.1.1.1:443#IPv4", ["v4"]);
  assert.deepEqual(endpoints.map((endpoint) => endpoint.ip), ["1.1.1.1"]);
});

test("registers all five supplemental feeds as IPv6-only", () => {
  const ipv6Sources = DEFAULT_TEXT_SOURCES.filter((source) => source.versions?.length === 1 && source.versions[0] === "v6");
  assert.equal(ipv6Sources.length, 5);
  assert.equal(DEFAULT_TEXT_SOURCES.length, 11);
});

test("samples host addresses from Cloudflare IPv4 and IPv6 CIDRs", () => {
  const zeros = (length) => Buffer.alloc(length);
  assert.equal(randomAddressFromCidr("203.0.113.0/24", zeros), "203.0.113.1");
  assert.equal(randomAddressFromCidr("2606:4700:1234::/48", zeros), "2606:4700:1234:0:0:0:0:0");
});

test("randomly selects exactly 30 official Cloudflare candidates across both IP families", () => {
  const sampled = sampleOfficialIpCandidates(
    "2606:4700::/32\n2a06:98c0::/29\n",
    { result: { jdcloud_cidrs: ["14.204.96.224/27", "60.13.99.64/26", "2408:8719:64:50:1000::/68"] } },
    30,
  );
  assert.equal(sampled.length, 30);
  assert.equal(sampled.filter((endpoint) => endpoint.version === "v4").length, 15);
  assert.equal(sampled.filter((endpoint) => endpoint.version === "v6").length, 15);
  assert.equal(new Set(sampled.map((endpoint) => endpoint.address)).size, 30);
});

test("drops failed endpoints and every node below 300 KB/s", () => {
  const working = keepWorkingNodes([
    { ip: "1.1.1.1", latency: 20, speed: 500 },
    { ip: "1.1.1.2", latency: 20, speed: 300 },
    { ip: "1.1.1.3", latency: 20, speed: 299.9 },
    { ip: "1.0.0.1", latency: 0, speed: 0 },
    { ip: "2606:4700::1", latency: 20, speed: 0 },
  ]);
  assert.deepEqual(working.map((node) => node.ip), ["1.1.1.1", "1.1.1.2"]);
});
