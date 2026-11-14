import type { CertMapping, CertRule } from "./pathTypes.js";

/** Lower case, punctuation (except "+" and ".") becomes a space, runs of spaces collapse: "CompTIA Network+" -> "comptia network+". */
export function normalizeCertText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+.\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** True when the keyword occurs in the text as whole words ("cka" matches "CKA exam", never "package"). */
function hasWords(normalizedText: string, keyword: string): boolean {
  const k = normalizeCertText(keyword);
  return k !== "" && ` ${normalizedText} `.includes(` ${k} `);
}

/**
 * Maps certifications the learner entered to topics, by curated rules. Pure: no I/O, no model.
 * Every certification appears once in `mappings`, in the order entered; a certification no rule matches has `topics: []`
 * and adds no skill. `topics` is the sorted union of all matched topics. The caller counts those topics as DECLARED
 * only (never verified), so the usual 40% cap still applies.
 */
export function skillsFromCertifications(certs: readonly string[], rules: readonly CertRule[]): { mappings: CertMapping[]; topics: string[] } {
  const seen = new Set<string>();
  const mappings: CertMapping[] = [];
  for (const raw of certs) {
    const cert = raw.trim();
    const key = normalizeCertText(cert);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const topics = new Set<string>();
    for (const rule of rules) {
      if (rule.keywords.some((k) => hasWords(key, k))) for (const t of rule.topics) topics.add(t);
    }
    mappings.push({ cert, topics: [...topics].sort() });
  }
  return { mappings, topics: [...new Set(mappings.flatMap((m) => m.topics))].sort() };
}
