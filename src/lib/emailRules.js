// Server only: the throwaway-domain list is large (about 120k domains).
import disposableDomains from "disposable-email-domains/index.json" with { type: "json" };

const DISPOSABLE = new Set(disposableDomains);
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

// One person's addresses collapse to one key: "+tags" are dropped for
// every provider (most deliver them to the same inbox), and Gmail also
// ignores dots, so n.ame+1@googlemail.com and name@gmail.com match.
export function normalizeEmail(email) {
  const [rawLocal = "", rawDomain = ""] = String(email || "").trim().toLowerCase().split("@");
  let local = rawLocal.split("+")[0];
  let domain = rawDomain;
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

export function isDisposableEmail(email) {
  const domain = String(email || "").trim().toLowerCase().split("@")[1] || "";
  const parts = domain.split(".");
  // Also catches subdomains of a listed domain (x.mailinator.com).
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  }
  return false;
}
