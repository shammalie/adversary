const WORD_BOUNDARY = /[\s,.;:!?()[\]{}'"<>/\\|@#$%^&*+=~`-]+/;

export function normalizePriorityTerm(term: string) {
  return term.trim().replace(/\s+/g, " ");
}

export function normalizePriorityTerms(terms: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const term of terms) {
    const value = normalizePriorityTerm(term);
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

/** Case-insensitive whole-word or exact-phrase matching against message body. */
export function matchPriorityTerms(message: string, terms: string[]): string[] {
  if (!message.trim() || terms.length === 0) return [];
  const normalizedMessage = message.toLocaleLowerCase();
  const matches: string[] = [];

  for (const term of normalizePriorityTerms(terms)) {
    const normalizedTerm = term.toLocaleLowerCase();
    if (normalizedTerm.includes(" ")) {
      if (normalizedMessage.includes(normalizedTerm)) matches.push(term);
      continue;
    }
    const parts = normalizedMessage.split(WORD_BOUNDARY);
    if (parts.some((part) => part === normalizedTerm)) matches.push(term);
  }

  return matches;
}

export function isPriorityMessage(message: string, terms: string[]) {
  return matchPriorityTerms(message, terms).length > 0;
}

export function addPriorityTerm(terms: string[], candidate: string) {
  return normalizePriorityTerms([...terms, candidate]);
}

export function removePriorityTerm(terms: string[], candidate: string) {
  const key = normalizePriorityTerm(candidate).toLocaleLowerCase();
  return terms.filter((term) => normalizePriorityTerm(term).toLocaleLowerCase() !== key);
}
