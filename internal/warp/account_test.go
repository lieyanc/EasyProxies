package warp

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testKey(fill byte) string {
	return base64.StdEncoding.EncodeToString(bytesOf(fill, 32))
}

func bytesOf(value byte, count int) []byte {
	result := make([]byte, count)
	for i := range result {
		result[i] = value
	}
	return result
}

func TestEncodeParseURIRoundTrip(t *testing.T) {
	original := Account{
		Name:          "WARP 东京 #1",
		PrivateKey:    testKey(0xfb),
		PeerPublicKey: testKey(0x7f),
		Endpoint:      "engage.cloudflareclient.com",
		EndpointPort:  2408,
		IPv4:          "172.16.0.2/32",
		IPv6:          "2606:4700:110:8c4f:1::2/128",
		Reserved:      []uint8{12, 34, 255},
		MTU:           1280,
	}
	rawURI, err := EncodeURI(original)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rawURI, "warp://") {
		t.Fatalf("unexpected uri: %s", rawURI)
	}
	parsed, err := ParseURI(rawURI)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Name != original.Name || parsed.PrivateKey != original.PrivateKey || parsed.PeerPublicKey != original.PeerPublicKey {
		t.Fatalf("key/name mismatch: %#v", parsed)
	}
	if parsed.Endpoint != original.Endpoint || parsed.EndpointPort != original.EndpointPort {
		t.Fatalf("endpoint mismatch: %#v", parsed)
	}
	if parsed.IPv4 != original.IPv4 || parsed.IPv6 != original.IPv6 || parsed.MTU != original.MTU {
		t.Fatalf("network values mismatch: %#v", parsed)
	}
	if got := formatReserved(parsed.Reserved); got != "12,34,255" {
		t.Fatalf("reserved = %s", got)
	}
}

func TestEncodeURIAppliesWARPDefaults(t *testing.T) {
	rawURI, err := EncodeURI(Account{
		PrivateKey:    testKey(1),
		PeerPublicKey: testKey(2),
		IPv4:          "172.16.0.2",
		Reserved:      []uint8{1, 2, 3},
	})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseURI(rawURI)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Endpoint != DefaultEndpoint || parsed.EndpointPort != DefaultEndpointPort || parsed.MTU != DefaultMTU {
		t.Fatalf("defaults not applied: %#v", parsed)
	}
	if parsed.IPv4 != "172.16.0.2/32" {
		t.Fatalf("IPv4 = %q", parsed.IPv4)
	}
}

func TestParseURIRejectsUnsafeValues(t *testing.T) {
	validPrivate := testKey(1)
	validPeer := testKey(2)
	tests := []struct {
		name string
		uri  string
	}{
		{"short private key", "warp://bad@example.com:2408?peer_public_key=" + validPeer + "&ipv4=172.16.0.2%2F32&reserved=1%2C2%2C3"},
		{"missing peer", "warp://" + validPrivate + "@example.com:2408?ipv4=172.16.0.2%2F32&reserved=1%2C2%2C3"},
		{"wrong address family", "warp://" + validPrivate + "@example.com:2408?peer_public_key=" + validPeer + "&ipv4=2606%3A4700%3A%3A1%2F128&reserved=1%2C2%2C3"},
		{"non-host prefix", "warp://" + validPrivate + "@example.com:2408?peer_public_key=" + validPeer + "&ipv4=172.16.0.0%2F24&reserved=1%2C2%2C3"},
		{"bad reserved", "warp://" + validPrivate + "@example.com:2408?peer_public_key=" + validPeer + "&ipv4=172.16.0.2%2F32&reserved=1%2C2"},
		{"path", "warp://" + validPrivate + "@example.com:2408/path?peer_public_key=" + validPeer + "&ipv4=172.16.0.2%2F32&reserved=1%2C2%2C3"},
		{"raw base64 key", "warp://" + strings.TrimRight(validPrivate, "=") + "@example.com:2408?peer_public_key=" + validPeer + "&ipv4=172.16.0.2%2F32&reserved=1%2C2%2C3"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := ParseURI(test.uri); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}
