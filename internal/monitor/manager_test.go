package monitor

import (
	"testing"

	"easy-proxies/internal/geoip"
)

func TestRegisterPreservesKnownGeoInfoOnDefaultOther(t *testing.T) {
	m := newTestManager(t)

	m.Register(NodeInfo{
		Tag:     "node-1",
		Name:    "JP 1",
		URI:     "vless://uuid@example.com:443#JP%201",
		Region:  geoip.RegionJP,
		Country: "Japan",
		ExitIP:  "203.0.113.10",
	})

	m.Register(NodeInfo{
		Tag:     "node-1",
		Name:    "JP 1",
		URI:     "vless://uuid@example.com:443#JP%201",
		Region:  geoip.RegionOther,
		Country: "Unknown",
	})

	snap := singleSnapshot(t, m)
	if snap.Region != geoip.RegionJP {
		t.Fatalf("expected region to stay %q, got %q", geoip.RegionJP, snap.Region)
	}
	if snap.Country != "Japan" {
		t.Fatalf("expected country to stay Japan, got %q", snap.Country)
	}
	if snap.ExitIP != "203.0.113.10" {
		t.Fatalf("expected exit IP to stay cached, got %q", snap.ExitIP)
	}
}

func TestClearNodesCachesGeoInfoForReloadedURI(t *testing.T) {
	m := newTestManager(t)

	m.Register(NodeInfo{
		Tag:     "old-tag",
		Name:    "US 1",
		URI:     "vless://uuid@example.com:443#Old",
		Region:  geoip.RegionUS,
		Country: "United States",
		ExitIP:  "198.51.100.20",
	})
	m.ClearNodes()

	m.Register(NodeInfo{
		Tag:     "new-tag",
		Name:    "US Renamed",
		URI:     "vless://uuid@example.com:443#New",
		Region:  geoip.RegionOther,
		Country: "Unknown",
	})

	snap := singleSnapshot(t, m)
	if snap.Region != geoip.RegionUS {
		t.Fatalf("expected region restored from URI cache, got %q", snap.Region)
	}
	if snap.Country != "United States" {
		t.Fatalf("expected country restored from URI cache, got %q", snap.Country)
	}
	if snap.ExitIP != "198.51.100.20" {
		t.Fatalf("expected exit IP restored from URI cache, got %q", snap.ExitIP)
	}
}

func TestUpdateExitIPDoesNotOverwriteKnownRegionWithUnknown(t *testing.T) {
	m := newTestManager(t)

	m.Register(NodeInfo{
		Tag:     "node-1",
		Name:    "SG 1",
		URI:     "vless://uuid@example.com:443#SG",
		Region:  geoip.RegionSG,
		Country: "Singapore",
		ExitIP:  "203.0.113.30",
	})

	if err := m.UpdateExitIP("node-1", "192.0.2.1"); err != nil {
		t.Fatalf("update exit IP: %v", err)
	}

	snap := singleSnapshot(t, m)
	if snap.ExitIP != "192.0.2.1" {
		t.Fatalf("expected exit IP to update, got %q", snap.ExitIP)
	}
	if snap.Region != geoip.RegionSG {
		t.Fatalf("expected region to stay %q, got %q", geoip.RegionSG, snap.Region)
	}
	if snap.Country != "Singapore" {
		t.Fatalf("expected country to stay Singapore, got %q", snap.Country)
	}
}

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	m, err := NewManager(Config{})
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}
	t.Cleanup(m.cancel)
	return m
}

func singleSnapshot(t *testing.T, m *Manager) Snapshot {
	t.Helper()
	snaps := m.Snapshot()
	if len(snaps) != 1 {
		t.Fatalf("expected one snapshot, got %d", len(snaps))
	}
	return snaps[0]
}
