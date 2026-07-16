const tencentcloud = require("tencentcloud-sdk-nodejs-dnspod");

const lineToCarrier = { "移动": "CM", "联通": "CU", "电信": "CT", "默认": "DEFAULT" };

function getConfig() {
  return {
    secretId: process.env.DNSPOD_SECRET_ID?.trim(),
    secretKey: process.env.DNSPOD_SECRET_KEY?.trim(),
    domain: process.env.DNSPOD_DOMAIN?.trim(),
    subdomain: process.env.DNSPOD_SUBDOMAIN?.trim(),
  };
}

async function updateDnsPod(selected) {
  const config = getConfig();
  if (!config.secretId || !config.secretKey || !config.domain || !config.subdomain) {
    return { configured: false, updatedCount: 0, message: "Candidates selected; DNSPod secrets are not configured" };
  }

  const DnspodClient = tencentcloud.dnspod.v20210323.Client;
  const client = new DnspodClient({
    credential: { secretId: config.secretId, secretKey: config.secretKey },
    profile: { httpProfile: { endpoint: "dnspod.tencentcloudapi.com" } },
  });
  const response = await client.DescribeRecordList({ Domain: config.domain });
  const records = (response.RecordList ?? []).filter((record) =>
    record.Name === config.subdomain &&
    (record.Type === "A" || record.Type === "AAAA") &&
    Object.hasOwn(lineToCarrier, record.Line)
  );
  if (!records.length) throw new Error(`No A or AAAA records found for ${config.subdomain}.${config.domain}`);

  const results = await Promise.allSettled(records.map((record) => {
    const version = record.Type === "A" ? "v4" : "v6";
    const carrier = lineToCarrier[record.Line];
    const value = selected[version]?.[carrier];
    if (!value) throw new Error(`No selected ${version} address for DNSPod line ${record.Line}`);
    return client.ModifyRecord({
      Domain: config.domain,
      RecordType: record.Type,
      RecordLine: record.Line,
      RecordLineId: record.LineId,
      Value: value,
      RecordId: record.RecordId,
      SubDomain: config.subdomain,
    });
  }));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    const details = failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join("; ");
    throw new Error(`${results.length - failures.length}/${results.length} DNSPod records updated: ${details}`);
  }
  return { configured: true, updatedCount: results.length, message: `${results.length} DNSPod records updated` };
}

module.exports = { getConfig, lineToCarrier, updateDnsPod };
