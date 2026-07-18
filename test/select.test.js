const test = require("node:test");
const assert = require("node:assert/strict");
const { annotateLiveness, limitCandidatesByVersion, selectCandidates } = require("../src/select");

function candidates(offset, version = "v4") {
  const ip = (suffix) => version === "v6" ? `2606:4700:${offset}::${suffix}` : `10.0.${offset}.${suffix}`;
  return [{ ip: ip(3), latency: 38 }, { ip: ip(1), latency: 18 }, { ip: ip(2), latency: 27 }];
}

test("ranks each carrier and preserves the correct carrier mapping", () => {
  const result = selectCandidates({
    v4: { CM: candidates(1), CU: candidates(2), CT: candidates(3) },
    v6: { CM: candidates(4, "v6"), CU: candidates(5, "v6"), CT: candidates(6, "v6") },
  }, 2);
  assert.equal(result.nodes.length, 12);
  assert.equal(result.selected.v4.CM, "10.0.1.1");
  assert.equal(result.selected.v4.CU, "10.0.2.1");
  assert.equal(result.selected.v4.CT, "10.0.3.1");
  assert.equal(result.selected.v6.DEFAULT, "2606:4700:4::1");
  assert.equal(result.nodes.filter((node) => node.selected).length, 6);
});

test("retains IPv6 candidates when the source omits latency", () => {
  const ipv6 = [
    { ip: "2606:4700:57::1", speed: 420 },
    { ip: "2606:4700:57::2", latency: 0, speed: 640 },
    { ip: "2606:4700:57::3", latency: 12, speed: 300 },
  ];
  const result = selectCandidates({
    v4: { CM: candidates(1), CU: candidates(2), CT: candidates(3) },
    v6: { CM: ipv6, CU: ipv6, CT: ipv6 },
  }, 3);

  assert.equal(result.nodes.filter((node) => node.version === "v6").length, 3);
  assert.equal(result.selected.v6.CM, "2606:4700:57::3");
  assert.equal(result.nodes.some((node) => node.ip === "2606:4700:57::2" && node.latency === 0), true);
  assert.equal(result.nodes.find((node) => node.ip === "2606:4700:57::2")?.speed, 640);
});

test("drops duplicate addresses and keeps their strongest occurrence", () => {
  const sharedV4 = [
    { ip: "104.16.1.1", latency: 25, speed: 200 },
    { ip: "104.16.1.2", latency: 30, speed: 300 },
  ];
  const result = selectCandidates({
    v4: {
      CM: sharedV4,
      CU: [{ ip: "104.16.1.1", latency: 20, speed: 180 }, ...sharedV4.slice(1)],
      CT: [{ ip: "104.16.1.1", latency: 20, speed: 220 }, ...sharedV4.slice(1)],
    },
    v6: { CM: candidates(4, "v6"), CU: candidates(5, "v6"), CT: candidates(6, "v6") },
  }, 2);

  assert.equal(new Set(result.nodes.map((node) => `${node.version}:${node.ip.toLowerCase()}`)).size, result.nodes.length);
  assert.deepEqual(
    result.nodes.find((node) => node.ip === "104.16.1.1"),
    { version: "v4", carrier: "CT", ip: "104.16.1.1", latency: 20, speed: 220, rank: 1, selected: true },
  );
});

test("rejects an address stored under the wrong IP family", () => {
  assert.throws(() => selectCandidates({
    v4: { CM: candidates(1), CU: candidates(2), CT: candidates(3) },
    v6: { CM: candidates(4), CU: candidates(5, "v6"), CT: candidates(6, "v6") },
  }), /No valid IPv6 candidates for CM/);
});

test("rejects an incomplete carrier result instead of publishing bad data", () => {
  assert.throws(() => selectCandidates({ v4: { CM: candidates(1), CU: [], CT: candidates(3) } }), /No valid IPv4 candidates for CU/);
});

test("keeps at most ten per sector ordered by latency then speed", () => {
  const candidates = ["v4", "v6", "domain"].flatMap((version) => Array.from({ length: 12 }, (_, index) => ({
    version,
    carrier: "BESTCF",
    ip: version === "v4" ? `192.0.2.${index + 1}` : version === "v6" ? `2606:4700::${index + 1}` : `node-${index + 1}.example.com`,
    latency: index === 0 || index === 1 ? 10 : 10 + index,
    speed: index === 1 ? 700 : 300,
    rank: index + 1,
    selected: false,
  })));
  const result = limitCandidatesByVersion(candidates, 10);
  assert.equal(result.length, 30);
  for (const version of ["v4", "v6", "domain"]) {
    const sector = result.filter((node) => node.version === version);
    assert.equal(sector.length, 10);
    assert.equal(sector[0].speed, 700);
    assert.deepEqual(sector.map((node) => node.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  }
});

test("preserves live time for surviving nodes and resets it for new nodes", () => {
  const previousCompletedAt = "2026-07-18T00:15:00.000Z";
  const startedAt = "2026-07-18T00:30:00.000Z";
  const nodes = annotateLiveness([
    { version: "v4", ip: "1.1.1.1" },
    { version: "v6", ip: "2606:4700::1" },
  ], [
    { version: "v4", ip: "1.1.1.1", liveSince: "2026-07-17T23:00:00.000Z", successfulChecks: 5 },
  ], previousCompletedAt, startedAt);

  assert.deepEqual(nodes.map(({ liveSince, successfulChecks }) => ({ liveSince, successfulChecks })), [
    { liveSince: "2026-07-17T23:00:00.000Z", successfulChecks: 6 },
    { liveSince: startedAt, successfulChecks: 1 },
  ]);
});
