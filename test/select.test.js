const test = require("node:test");
const assert = require("node:assert/strict");
const { selectCandidates } = require("../src/select");

function candidates(offset) {
  return [{ ip: `10.0.${offset}.3`, latency: 38 }, { ip: `10.0.${offset}.1`, latency: 18 }, { ip: `10.0.${offset}.2`, latency: 27 }];
}

test("ranks each carrier and preserves the correct carrier mapping", () => {
  const result = selectCandidates({
    v4: { CM: candidates(1), CU: candidates(2), CT: candidates(3) },
    v6: { CM: candidates(4), CU: candidates(5), CT: candidates(6) },
  }, 2);
  assert.equal(result.nodes.length, 12);
  assert.equal(result.selected.v4.CM, "10.0.1.1");
  assert.equal(result.selected.v4.CU, "10.0.2.1");
  assert.equal(result.selected.v4.CT, "10.0.3.1");
  assert.equal(result.selected.v6.DEFAULT, "10.0.4.1");
  assert.equal(result.nodes.filter((node) => node.selected).length, 6);
});

test("rejects an incomplete carrier result instead of publishing bad data", () => {
  assert.throws(() => selectCandidates({ v4: { CM: candidates(1), CU: [], CT: candidates(3) } }), /No valid IPv4 candidates for CU/);
});
