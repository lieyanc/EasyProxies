package builder

import (
	"encoding/base64"
	"testing"

	"easy-proxies/internal/config"
	"easy-proxies/internal/warp"

	C "github.com/sagernet/sing-box/constant"
	"github.com/sagernet/sing-box/option"
)

func TestBuildWARPOutbound(t *testing.T) {
	key := func(value byte) string {
		data := make([]byte, 32)
		for i := range data {
			data[i] = value
		}
		return base64.StdEncoding.EncodeToString(data)
	}
	rawURI, err := warp.EncodeURI(warp.Account{
		Name:          "warp-test",
		PrivateKey:    key(1),
		PeerPublicKey: key(2),
		Endpoint:      "engage.cloudflareclient.com",
		EndpointPort:  2408,
		IPv4:          "172.16.0.2/32",
		IPv6:          "2606:4700:110:8c4f:1::2/128",
		Reserved:      []uint8{1, 2, 3},
		MTU:           1280,
	})
	if err != nil {
		t.Fatal(err)
	}
	outbound, err := buildNodeOutbound("warp-test", rawURI, false)
	if err != nil {
		t.Fatal(err)
	}
	if outbound.Type != C.TypeWireGuard || outbound.Tag != "warp-test" {
		t.Fatalf("unexpected outbound: %#v", outbound)
	}
	opts, ok := outbound.Options.(*option.LegacyWireGuardOutboundOptions)
	if !ok {
		t.Fatalf("options type = %T", outbound.Options)
	}
	if opts.Server != "engage.cloudflareclient.com" || opts.ServerPort != 2408 || opts.MTU != 1280 || opts.Workers != 1 {
		t.Fatalf("unexpected WireGuard options: %#v", opts)
	}
	if len(opts.LocalAddress) != 2 || len(opts.Reserved) != 3 {
		t.Fatalf("missing WARP network options: %#v", opts)
	}
	if opts.DomainResolver == nil || opts.DomainResolver.Server != "dns-warp-endpoint" {
		t.Fatalf("missing direct endpoint resolver: %#v", opts.DialerOptions)
	}

	built, err := Build(&config.Config{
		Mode:     "pool",
		Listener: config.ListenerConfig{Address: "127.0.0.1", Port: 2323},
		Pool:     config.PoolConfig{Mode: "sequential"},
		Nodes:    []config.NodeConfig{{Name: "warp-test", URI: rawURI}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if built.DNS == nil || len(built.DNS.Servers) != 1 || built.DNS.Servers[0].Tag != "dns-warp-endpoint" {
		t.Fatalf("missing WARP endpoint DNS server: %#v", built.DNS)
	}
}

func TestBuildWARPOutboundRejectsMalformedURI(t *testing.T) {
	if _, err := buildNodeOutbound("bad", "warp://bad@example.com", false); err == nil {
		t.Fatal("expected malformed warp URI error")
	}
}
