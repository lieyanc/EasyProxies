package builder

import (
	"net/url"
	"testing"

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
