package config

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestParseClashYAML_Hysteria2PortHoppingAndObfs(t *testing.T) {
	content := `proxies:
  - name: "test-hy2"
    type: "hysteria2"
    server: example.com
    ports: 10000-20000
    password: "secret"
    obfs: "salamander"
    obfs-password: "obfs-secret"
    sni: "hy2.example.com"
    skip-cert-verify: true
`

	nodes, err := parseClashYAML(content)
	if err != nil {
		t.Fatalf("parse clash yaml failed: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}

	u, err := url.Parse(nodes[0].URI)
	if err != nil {
		t.Fatalf("parse generated uri failed: %v", err)
	}
	if u.Scheme != "hysteria2" {
		t.Fatalf("expected scheme hysteria2, got %q", u.Scheme)
	}
	if u.Host != "example.com:443" {
		t.Fatalf("expected host example.com:443, got %q", u.Host)
	}

	query := u.Query()
	if query.Get("ports") != "10000:20000" {
		t.Fatalf("expected ports=10000:20000, got %q", query.Get("ports"))
	}
	if query.Get("obfs") != "salamander" {
		t.Fatalf("expected obfs=salamander, got %q", query.Get("obfs"))
	}
	if query.Get("obfs-password") != "obfs-secret" {
		t.Fatalf("expected obfs-password=obfs-secret, got %q", query.Get("obfs-password"))
	}
	if query.Get("sni") != "hy2.example.com" {
		t.Fatalf("expected sni=hy2.example.com, got %q", query.Get("sni"))
	}
	if query.Get("insecure") != "1" {
		t.Fatalf("expected insecure=1, got %q", query.Get("insecure"))
	}
}

func TestSaveSettingsPreservesNodesAndUpdatesSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	original := `mode: pool
listener:
  address: 127.0.0.1
  port: 2323
management:
  enabled: true
  listen: 127.0.0.1:9091
  probe_target: example.com:80
  password: ""
nodes:
  - name: node-a
    uri: "vless://00000000-0000-0000-0000-000000000000@example.com:443?security=tls#node-a"
`
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	cfg.ExternalIP = "203.0.113.10"
	cfg.Management.ProbeTarget = "example.org:80"
	cfg.Management.Password = "secret"
	cfg.Listener.Username = "user"
	cfg.Listener.Password = "pass"

	if err := cfg.SaveSettings(); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	reloaded, err := Load(path)
	if err != nil {
		t.Fatalf("reload config: %v", err)
	}
	if reloaded.ExternalIP != "203.0.113.10" {
		t.Fatalf("expected external_ip to be saved, got %q", reloaded.ExternalIP)
	}
	if reloaded.Management.ProbeTarget != "example.org:80" {
		t.Fatalf("expected probe target to be saved, got %q", reloaded.Management.ProbeTarget)
	}
	if reloaded.Management.Password != "secret" {
		t.Fatalf("expected management password to be saved, got %q", reloaded.Management.Password)
	}
	if len(reloaded.Nodes) != 1 || reloaded.Nodes[0].Name != "node-a" {
		t.Fatalf("expected inline nodes to be preserved, got %+v", reloaded.Nodes)
	}
}

func TestValidateManagementSecurityRejectsPublicNoPassword(t *testing.T) {
	enabled := true
	cfg := Config{
		Management: ManagementConfig{
			Enabled: &enabled,
			Listen:  "0.0.0.0:9091",
		},
	}
	if err := cfg.ValidateManagementSecurity(); err == nil {
		t.Fatal("expected public unauthenticated management listener to be rejected")
	}

	cfg.Management.Listen = "127.0.0.1:9091"
	if err := cfg.ValidateManagementSecurity(); err != nil {
		t.Fatalf("expected loopback unauthenticated management listener to be allowed: %v", err)
	}
}
