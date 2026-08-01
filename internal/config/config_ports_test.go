package config

import "testing"

// Regression test: duplicate URIs share the same portMap key, so a preserved
// port must only be applied to the first occurrence — later duplicates get a
// freshly assigned port instead of colliding.
func TestNormalizeWithPortMapDuplicateURIs(t *testing.T) {
	uri := "socks5://example.com:1080"
	cfg := &Config{
		Mode: "multi-port",
		Nodes: []NodeConfig{
			{Name: "a", URI: uri},
			{Name: "b", URI: uri},
			{Name: "c", URI: "socks5://other.example.com:1080"},
		},
	}
	portMap := map[string]uint16{
		uri: 24001,
		"socks5://other.example.com:1080": 24002,
	}
	if err := cfg.NormalizeWithPortMap(portMap); err != nil {
		t.Fatalf("NormalizeWithPortMap: %v", err)
	}

	seen := make(map[uint16]string)
	for _, node := range cfg.Nodes {
		if node.Port == 0 {
			t.Fatalf("node %q has no port assigned", node.Name)
		}
		if prev, dup := seen[node.Port]; dup {
			t.Fatalf("port %d assigned to both %q and %q", node.Port, prev, node.Name)
		}
		seen[node.Port] = node.Name
	}
	if cfg.Nodes[0].Port != 24001 {
		t.Fatalf("first duplicate should keep preserved port 24001, got %d", cfg.Nodes[0].Port)
	}
	if cfg.Nodes[2].Port != 24002 {
		t.Fatalf("unique node should keep preserved port 24002, got %d", cfg.Nodes[2].Port)
	}
}
