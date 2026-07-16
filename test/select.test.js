const test = require("node:test");
const assert = require("node:assert/strict");
const { selectCandidates } = require("../src/select");

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

  assert.equal(result.nodes.filter((node) => node.version === "v6").length, 9);
  assert.equal(result.selected.v6.CM, "2606:4700:57::3");
  assert.equal(result.nodes.some((node) => node.ip === "2606:4700:57::2" && node.latency === 0), true);
  assert.equal(result.nodes.find((node) => node.ip === "2606:4700:57::2")?.speed, 640);
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
