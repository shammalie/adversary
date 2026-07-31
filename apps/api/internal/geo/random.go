package geo

import "strconv"

// CreateSeededRandom returns the Numerical Recipes deterministic [0,1) LCG stream.
func CreateSeededRandom(seed uint32) func() float64 {
	state := seed
	return func() float64 {
		state = state*1664525 + 1013904223
		return float64(state) / 4294967296.0
	}
}

// CreateSeededIDFactory returns deterministic base-36 IDs derived from seed.
func CreateSeededIDFactory(seed uint32) func() string {
	prefix := "s" + strconv.FormatUint(uint64(seed), 36)
	var n uint64
	return func() string {
		id := prefix + "-" + strconv.FormatUint(n, 36)
		n++
		return id
	}
}
