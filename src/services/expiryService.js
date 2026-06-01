const tls   = require("tls");
const whois = require("whois-json");
const axios = require("axios");

// ── SSL Check ─────────────────────────────────────────────────────────────────

const checkSSL = async (hostname) => {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      443,
      hostname,
      { servername: hostname, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || !cert.valid_to) {
          return reject("SSL certificate not found");
        }

        resolve({
          sslExpiryDate: new Date(cert.valid_to),
          sslIssuer:     cert.issuer?.O || cert.issuer?.CN || null,
        });
      },
    );

    socket.setTimeout(10000, () => {
      socket.destroy();
      reject(new Error("SSL check timed out"));
    });

    socket.on("error", (err) => reject(err.message));
  });
};

// ── RDAP fallback (HTTP-based, works when WHOIS server is unreachable) ────────

async function checkDomainViaRdap(domain, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`https://rdap.org/domain/${domain}`, { timeout: 10000 });
      const events = res.data?.events || [];
      const expiry = events.find((e) => e.eventAction === "expiration");
      if (!expiry?.eventDate) return null;
      const parsed = new Date(expiry.eventDate);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        const wait = attempt * 8000;
        console.log(`[EXPIRY] RDAP 429 for ${domain}, retry ${attempt}/${retries - 1} in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
  return null;
}

// ── Domain Check (WHOIS first, RDAP fallback) ─────────────────────────────────

const checkDomain = async (domain) => {
  // Step 1: try WHOIS
  try {
    const result = await whois(domain);

    const knownFields = [
      "registryExpiryDate",
      "registrarRegistrationExpirationDate",
      "expirationDate",
      "expiryDate",
      "expiresOn",
      "expires",
      "paidTill",
      "domainExpirationDate",
      "renewalDate",
      "renewDate",
      "validUntil",
      "registrationExpiryDate",
      "expire",
      "domainExpiry",
    ];

    let rawDate = null;

    for (const field of knownFields) {
      const val = result[field];
      if (val) {
        rawDate = Array.isArray(val) ? val[0] : val;
        break;
      }
    }

    if (!rawDate) {
      const keywords = ["expir", "expiry", "renewal", "paidtill", "validuntil", "valid_until"];
      for (const key of Object.keys(result)) {
        if (keywords.some((kw) => key.toLowerCase().includes(kw)) && result[key]) {
          rawDate = Array.isArray(result[key]) ? result[key][0] : result[key];
          break;
        }
      }
    }

    if (rawDate) {
      const parsed = new Date(rawDate);
      if (!isNaN(parsed.getTime())) return { domainExpiryDate: parsed };
    }
  } catch (_) {
    // WHOIS failed — fall through to RDAP
  }

  // Step 2: RDAP fallback
  try {
    const rdapDate = await checkDomainViaRdap(domain);
    if (rdapDate) return { domainExpiryDate: rdapDate };
  } catch (_) {
    // RDAP also failed
  }

  return { domainExpiryDate: null };
};

module.exports = { checkSSL, checkDomain };
