const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBestCfNodes, parseBestCfSource, parseEndpoint } = require("../src/domain-source");

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
