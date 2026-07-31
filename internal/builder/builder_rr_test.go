package builder

import (
	"testing"

	"easy-proxies/internal/config"
	poolout "easy-proxies/internal/outbound/pool"

	"github.com/sagernet/sing-box/option"
)

func rrTestConfig() *config.Config {
	return &config.Config{
		Mode:     "hybrid",
		Listener: config.ListenerConfig{Address: "127.0.0.1", Port: 2323, Username: "user", Password: "pass"},
		Pool:     config.PoolConfig{Mode: "latency", RoundRobinEntry: true},
		MultiPort: config.MultiPortConfig{
			Address:  "127.0.0.1",
			BasePort: 24000,
		},
		Nodes: []config.NodeConfig{
			{Name: "a", URI: "socks5://127.0.0.1:1080", Port: 24001},
			{Name: "b", URI: "socks5://127.0.0.1:1081", Port: 24002},
		},
	}
}

func TestBuildRoundRobinEntry(t *testing.T) {
	built, err := Build(rrTestConfig())
	if err != nil {
		t.Fatal(err)
	}

	// Round-robin pool outbound shares all members and uses sequential scheduling.
	rrOutbound := findOutbound(t, built.Outbounds, roundRobinPoolTag)
	rrOptions, ok := rrOutbound.Options.(*poolout.Options)
	if !ok {
		t.Fatalf("options type = %T", rrOutbound.Options)
	}
	if rrOptions.Mode != "sequential" || !rrOptions.SkipMonitor || len(rrOptions.Members) != 2 {
		t.Fatalf("unexpected round-robin pool options: %#v", rrOptions)
	}

	// Default pool remains the route fallback.
	if built.Route == nil || built.Route.Final != poolout.Tag {
		t.Fatalf("route final = %#v", built.Route)
	}
	defaultPool := findOutbound(t, built.Outbounds, poolout.Tag)
	if defaultOptions, ok := defaultPool.Options.(*poolout.Options); !ok || defaultOptions.Mode != "latency" {
		t.Fatalf("default pool options = %#v", defaultPool.Options)
	}

	// The pool inbound authenticates the derived round-robin user.
	var users []string
	for _, inbound := range built.Inbounds {
		if inbound.Tag != poolInboundTag {
			continue
		}
		mixed, ok := inbound.Options.(*option.HTTPMixedInboundOptions)
		if !ok {
			t.Fatalf("inbound options type = %T", inbound.Options)
		}
		for _, user := range mixed.Users {
			users = append(users, user.Username)
		}
	}
	foundUser := false
	for _, username := range users {
		if username == "user-rr" {
			foundUser = true
		}
	}
	if !foundUser {
		t.Fatalf("pool inbound users missing round-robin user: %v", users)
	}

	// An auth_user rule routes the round-robin user to the round-robin pool.
	foundRule := false
	for _, rule := range built.Route.Rules {
		for _, authUser := range rule.DefaultOptions.RawDefaultRule.AuthUser {
			if authUser == "user-rr" {
				foundRule = true
				if got := rule.DefaultOptions.RuleAction.RouteOptions.Outbound; got != roundRobinPoolTag {
					t.Fatalf("round-robin rule targets %q", got)
				}
			}
		}
	}
	if !foundRule {
		t.Fatal("missing auth_user route rule for round-robin user")
	}
}

func TestBuildRoundRobinEntryCustomUsername(t *testing.T) {
	cfg := rrTestConfig()
	cfg.Pool.RoundRobinUsername = "spin"
	built, err := Build(cfg)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, rule := range built.Route.Rules {
		for _, authUser := range rule.DefaultOptions.RawDefaultRule.AuthUser {
			if authUser == "spin" && rule.DefaultOptions.RuleAction.RouteOptions.Outbound == roundRobinPoolTag {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("custom round-robin username not routed")
	}
}

func TestBuildRoundRobinEntryRejectsConflicts(t *testing.T) {
	cfg := rrTestConfig()
	cfg.Pool.RoundRobinUsername = "user"
	if _, err := Build(cfg); err == nil {
		t.Fatal("expected listener username conflict error")
	}

	cfg = rrTestConfig()
	cfg.GeoIP.Enabled = true
	cfg.Pool.RoundRobinUsername = "user-jp"
	if _, err := Build(cfg); err == nil {
		t.Fatal("expected GeoIP region username conflict error")
	}
}
