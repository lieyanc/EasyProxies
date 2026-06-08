package geoip

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestDownloadAttemptsUseConfiguredProxyOrder(t *testing.T) {
	opts := normalizeDownloadOptions(DownloadOptions{
		Proxies: []string{
			" ",
			" http://user:pass@127.0.0.1:7890 ",
			"socks5://127.0.0.1:7891",
		},
	})
	attempts := downloadAttempts(opts.Proxies)

	if len(attempts) != 2 {
		t.Fatalf("expected 2 attempts, got %d", len(attempts))
	}
	if attempts[0].proxyURL != "http://user:pass@127.0.0.1:7890" {
		t.Fatalf("unexpected first proxy: %q", attempts[0].proxyURL)
	}
	if attempts[1].proxyURL != "socks5://127.0.0.1:7891" {
		t.Fatalf("unexpected second proxy: %q", attempts[1].proxyURL)
	}
	if strings.Contains(attempts[0].label, "pass") || !strings.Contains(attempts[0].label, "xxxxx") {
		t.Fatalf("proxy password was not masked in label: %q", attempts[0].label)
	}
}

func TestDownloadAttemptsUseDirectWhenNoProxyConfigured(t *testing.T) {
	attempts := downloadAttempts(nil)
	if len(attempts) != 1 || attempts[0].proxyURL != "" || attempts[0].label != "direct" {
		t.Fatalf("unexpected direct attempts: %#v", attempts)
	}
}

func TestRegionAuthUsername(t *testing.T) {
	tests := []struct {
		name string
		base string
		code string
		want string
	}{
		{name: "global with base", base: "user", code: RegionAll, want: "user"},
		{name: "region with base", base: "user", code: RegionJP, want: "user-jp"},
		{name: "global without base", code: RegionAll, want: "all"},
		{name: "region without base", code: RegionUS, want: "us"},
		{name: "trim and normalize", base: " user ", code: " JP ", want: "user-jp"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RegionAuthUsername(tt.base, tt.code); got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestDownloadDatabaseWithOptionsRetriesProxiesInOrder(t *testing.T) {
	oldDownloadURL := geoIPDownloadURL
	geoIPDownloadURL = "http://geoip.test/GeoLite2-Country.mmdb"
	defer func() {
		geoIPDownloadURL = oldDownloadURL
	}()

	var (
		mu       sync.Mutex
		attempts []string
	)
	recordAttempt := func(name string) {
		mu.Lock()
		attempts = append(attempts, name)
		mu.Unlock()
	}

	failingProxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recordAttempt("first")
		http.Error(w, "proxy failed", http.StatusBadGateway)
	}))
	defer failingProxy.Close()

	successProxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recordAttempt("second")
		_, _ = w.Write(validMMDBPayload())
	}))
	defer successProxy.Close()

	dbPath := filepath.Join(t.TempDir(), "GeoLite2-Country.mmdb")
	err := downloadDatabaseWithOptions(dbPath, DownloadOptions{
		Proxies: []string{failingProxy.URL, successProxy.URL},
	})
	if err != nil {
		t.Fatalf("download failed: %v", err)
	}

	mu.Lock()
	gotAttempts := append([]string(nil), attempts...)
	mu.Unlock()
	if !reflect.DeepEqual(gotAttempts, []string{"first", "second"}) {
		t.Fatalf("unexpected proxy attempts: %#v", gotAttempts)
	}

	info, err := os.Stat(dbPath)
	if err != nil {
		t.Fatalf("downloaded db does not exist: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("downloaded db is empty")
	}
}

func validMMDBPayload() []byte {
	payload := bytes.Repeat([]byte{0}, 2048)
	copy(payload[len(payload)-len("MaxMind.com"):], "MaxMind.com")
	return payload
}
