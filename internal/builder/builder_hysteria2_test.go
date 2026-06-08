package builder

import (
	"fmt"
	"net/url"
	"testing"
	"time"

	"easy-proxies/internal/config"
	"easy-proxies/internal/geoip"
	poolout "easy-proxies/internal/outbound/pool"

	"github.com/sagernet/sing-box/option"
)

func TestBuildNodeOutbound_Hysteria2PortRangeInRawURI(t *testing.T) {
	outbound, err := buildNodeOutbound("test-hy2", "hysteria2://secret@example.com:10000-20000?sni=hy2.example.com", false)
	if err != nil {
		t.Fatalf("build node outbound failed: %v", err)
	}

	opts, ok := outbound.Options.(*option.Hysteria2OutboundOptions)
	if !ok {
		t.Fatalf("expected *option.Hysteria2OutboundOptions, got %T", outbound.Options)
	}

	if opts.Server != "example.com" {
		t.Fatalf("expected server example.com, got %q", opts.Server)
	}
	if opts.ServerPort != 443 {
		t.Fatalf("expected default server port 443, got %d", opts.ServerPort)
	}
	if len(opts.ServerPorts) != 1 || opts.ServerPorts[0] != "10000:20000" {
		t.Fatalf("expected server ports [10000:20000], got %v", opts.ServerPorts)
	}
}

func TestBuildHysteria2Options_PortsFromQuery(t *testing.T) {
	u, err := url.Parse("hysteria2://secret@example.com:443?ports=10000-20000,30000")
	if err != nil {
		t.Fatalf("parse uri failed: %v", err)
	}

	opts, err := buildHysteria2Options(u, false)
	if err != nil {
		t.Fatalf("build hysteria2 options failed: %v", err)
	}

	if len(opts.ServerPorts) != 2 {
		t.Fatalf("expected 2 server ports, got %d (%v)", len(opts.ServerPorts), opts.ServerPorts)
	}
	if opts.ServerPorts[0] != "10000:20000" || opts.ServerPorts[1] != "30000" {
		t.Fatalf("unexpected server ports: %v", opts.ServerPorts)
	}
}

func TestBuildNodeOutbound_ShadowSocksPlainUserinfo(t *testing.T) {
	outbound, err := buildNodeOutbound("test-ss", "ss://aes-128-gcm:secret@example.com:8388#plain", false)
	if err != nil {
		t.Fatalf("build node outbound failed: %v", err)
	}

	opts, ok := outbound.Options.(*option.ShadowsocksOutboundOptions)
	if !ok {
		t.Fatalf("expected *option.ShadowsocksOutboundOptions, got %T", outbound.Options)
	}
	if opts.Method != "aes-128-gcm" {
		t.Fatalf("expected method aes-128-gcm, got %q", opts.Method)
	}
	if opts.Password != "secret" {
		t.Fatalf("expected password secret, got %q", opts.Password)
	}
}

func TestBuildGeoIPAuthUserRegionRouting(t *testing.T) {
	cfg := &config.Config{
		Mode: "pool",
		Listener: config.ListenerConfig{
			Address:  "127.0.0.1",
			Port:     2323,
			Username: "user",
			Password: "pass",
		},
		Pool: config.PoolConfig{
			Mode:              "sequential",
			FailureThreshold:  3,
			BlacklistDuration: 24 * time.Hour,
			RetryAttempts:     3,
		},
		GeoIP: config.GeoIPConfig{
			Enabled: true,
		},
		Nodes: []config.NodeConfig{
			{Name: "one", URI: "ss://aes-128-gcm:secret@example.com:8388#one"},
		},
	}

	opts, err := Build(cfg)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}

	if len(opts.Inbounds) != 1 {
		t.Fatalf("expected one inbound, got %d", len(opts.Inbounds))
	}
	inboundOptions, ok := opts.Inbounds[0].Options.(*option.HTTPMixedInboundOptions)
	if !ok {
		t.Fatalf("expected mixed inbound options, got %T", opts.Inbounds[0].Options)
	}
	wantUsers := map[string]bool{
		"user": true,
	}
	for _, region := range geoip.AllRegions() {
		wantUsers[fmt.Sprintf("user-%s", region)] = true
	}
	if len(inboundOptions.Users) != len(wantUsers) {
		t.Fatalf("expected %d auth users, got %d: %#v", len(wantUsers), len(inboundOptions.Users), inboundOptions.Users)
	}
	for _, user := range inboundOptions.Users {
		if !wantUsers[user.Username] {
			t.Fatalf("unexpected auth user %q", user.Username)
		}
		if user.Password != "pass" {
			t.Fatalf("expected password pass for %q, got %q", user.Username, user.Password)
		}
	}

	jpPool := findOutbound(t, opts.Outbounds, "pool-jp")
	jpPoolOptions, ok := jpPool.Options.(*poolout.Options)
	if !ok {
		t.Fatalf("expected pool options, got %T", jpPool.Options)
	}
	if jpPoolOptions.Mode != "latency" {
		t.Fatalf("expected region pool latency mode, got %q", jpPoolOptions.Mode)
	}
	if jpPoolOptions.RegionFilter != geoip.RegionJP {
		t.Fatalf("expected jp region filter, got %q", jpPoolOptions.RegionFilter)
	}

	if opts.Route == nil {
		t.Fatal("expected route options")
	}
	for _, rule := range opts.Route.Rules {
		ruleOptions := rule.DefaultOptions
		if len(ruleOptions.AuthUser) != 1 || ruleOptions.AuthUser[0] != "user-jp" {
			continue
		}
		if len(ruleOptions.Inbound) != 1 || ruleOptions.Inbound[0] != poolInboundTag {
			t.Fatalf("expected GeoIP rule to be scoped to %q, got %v", poolInboundTag, ruleOptions.Inbound)
		}
		if ruleOptions.RouteOptions.Outbound != "pool-jp" {
			t.Fatalf("expected user-jp to route to pool-jp, got %q", ruleOptions.RouteOptions.Outbound)
		}
		return
	}
	t.Fatal("missing auth_user route for user-jp")
}

func findOutbound(t *testing.T, outbounds []option.Outbound, tag string) option.Outbound {
	t.Helper()
	for _, outbound := range outbounds {
		if outbound.Tag == tag {
			return outbound
		}
	}
	t.Fatalf("missing outbound %q", tag)
	return option.Outbound{}
}
