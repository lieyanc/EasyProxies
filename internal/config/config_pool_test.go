package config

import "testing"

func TestRoundRobinAuthUsername(t *testing.T) {
	cases := []struct {
		name     string
		pool     PoolConfig
		base     string
		expected string
	}{
		{name: "derived from base", pool: PoolConfig{}, base: "user", expected: "user-rr"},
		{name: "empty base", pool: PoolConfig{}, base: "", expected: "rr"},
		{name: "override", pool: PoolConfig{RoundRobinUsername: "spin"}, base: "user", expected: "spin"},
		{name: "override trimmed", pool: PoolConfig{RoundRobinUsername: "  spin "}, base: "user", expected: "spin"},
		{name: "base trimmed", pool: PoolConfig{}, base: " user ", expected: "user-rr"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.pool.RoundRobinAuthUsername(tc.base); got != tc.expected {
				t.Fatalf("RoundRobinAuthUsername(%q) = %q, want %q", tc.base, got, tc.expected)
			}
		})
	}
}
