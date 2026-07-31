package simulation

import (
	"strings"
	"unicode"
)

// NormalizePriorityTerm trims and collapses whitespace.
func NormalizePriorityTerm(term string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(term)), " ")
}

// NormalizePriorityTerms dedupes case-insensitively preserving first casing.
func NormalizePriorityTerms(terms []string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(terms))
	for _, term := range terms {
		value := NormalizePriorityTerm(term)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

// MatchPriorityTerms returns terms that match as whole words or substrings for phrases.
func MatchPriorityTerms(message string, terms []string) []string {
	if strings.TrimSpace(message) == "" || len(terms) == 0 {
		return nil
	}
	normalizedMessage := strings.ToLower(message)
	var matches []string
	for _, term := range NormalizePriorityTerms(terms) {
		normalizedTerm := strings.ToLower(term)
		if strings.Contains(normalizedTerm, " ") {
			if strings.Contains(normalizedMessage, normalizedTerm) {
				matches = append(matches, term)
			}
			continue
		}
		for _, part := range splitWords(normalizedMessage) {
			if part == normalizedTerm {
				matches = append(matches, term)
				break
			}
		}
	}
	return matches
}

// IsPriorityMessage reports whether any priority term matches.
func IsPriorityMessage(message string, terms []string) bool {
	return len(MatchPriorityTerms(message, terms)) > 0
}

func splitWords(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune(",.;:!?()[]{}'\"<>/\\|@#$%^&*+=~`-", r)
	})
}
