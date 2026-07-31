package boxmgr

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easy-proxies/internal/config"
)

func TestCreateNodeRespectsExplicitInlineSource(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	nodesPath := filepath.Join(dir, "nodes.txt")
	if err := os.WriteFile(nodesPath, []byte("socks5://127.0.0.1:1080#file-node\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	configYAML := `
mode: pool
management:
  enabled: false
nodes_file: nodes.txt
nodes:
  - name: inline-node
    uri: socks5://127.0.0.1:1081#inline-node
`
	if err := os.WriteFile(configPath, []byte(configYAML), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	manager := &Manager{cfg: cfg}
	created, err := manager.CreateNode(context.Background(), config.NodeConfig{
		Name:   "WARP-01",
		URI:    "warp://private@example.com:2408#WARP-01",
		Source: config.NodeSourceInline,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Source != config.NodeSourceInline {
		t.Fatalf("source = %q, want inline", created.Source)
	}

	savedConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(savedConfig), "WARP-01") {
		t.Fatalf("inline WARP node not saved to config.yaml:\n%s", savedConfig)
	}
	savedNodes, err := os.ReadFile(nodesPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(savedNodes), "WARP-01") {
		t.Fatalf("inline WARP node leaked into nodes file:\n%s", savedNodes)
	}
}
