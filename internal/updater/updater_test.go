package updater

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"easy-proxies/internal/version"
)

func TestCheckOnlySelectsNewestStableRelease(t *testing.T) {
	originalVersion := version.Version
	defer func() { version.Version = originalVersion }()
	version.Version = "v1.0.0"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/owner/repo/releases/latest" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(releaseInfo{
			TagName: "v1.4.0",
			Assets:  []assetInfo{},
		})
	}))
	defer server.Close()
	withGitHubAPIBaseURL(t, server.URL)

	u := testUpdater(Config{
		Channel:      "stable",
		ProxyBaseURL: "https://proxy.invalid",
		Repo:         "owner/repo",
	})

	result, err := u.CheckOnly(context.Background())
	if err != nil {
		t.Fatalf("CheckOnly returned error: %v", err)
	}
	if !result.HasUpdate {
		t.Fatalf("expected update to be available")
	}
	if result.LatestVersion != "v1.4.0" {
		t.Fatalf("expected latest version v1.4.0, got %q", result.LatestVersion)
	}
}

func TestCheckOnlySelectsNewestPrerelease(t *testing.T) {
	originalVersion := version.Version
	originalCommit := version.Commit
	defer func() { version.Version = originalVersion }()
	defer func() { version.Commit = originalCommit }()
	version.Version = "dev-0007-20260401-aaaaaaa"
	version.Commit = "aaaaaaa"
	remoteVersion := "dev-0042-20260425-bbbbbbb"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/owner/repo/releases/download/dev/version.json" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(releaseVersionInfo{
			Version:   remoteVersion,
			Commit:    "bbbbbbb",
			BuildTime: "2026-04-25T00:00:00Z",
			Tag:       "dev",
		})
	}))
	defer server.Close()
	withGitHubBaseURL(t, server.URL)

	u := testUpdater(Config{
		Channel:      "dev",
		ProxyBaseURL: "https://proxy.invalid",
		Repo:         "owner/repo",
	})

	result, err := u.CheckOnly(context.Background())
	if err != nil {
		t.Fatalf("CheckOnly returned error: %v", err)
	}
	if !result.HasUpdate {
		t.Fatalf("expected prerelease update to be available")
	}
	if result.LatestVersion != remoteVersion {
		t.Fatalf("expected latest prerelease, got %q", result.LatestVersion)
	}
}

func TestCheckOnlyUsesFastestDialer(t *testing.T) {
	originalVersion := version.Version
	defer func() { version.Version = originalVersion }()
	version.Version = "v1.0.0"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/owner/repo/releases/latest" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(releaseInfo{
			TagName: "v1.4.0",
			Assets:  []assetInfo{},
		})
	}))
	defer server.Close()
	withGitHubAPIBaseURL(t, server.URL)

	dialer := &recordingDialer{}
	u := testUpdater(Config{
		Channel:        "stable",
		Repo:           "owner/repo",
		UseFastestNode: true,
		ProxyDialerTag: "proxy-pool",
	})
	u.SetDialerProvider(func(tag string, fastest bool) (NetDialer, bool) {
		if tag != "proxy-pool" {
			t.Fatalf("unexpected dialer tag: %s", tag)
		}
		if !fastest {
			t.Fatalf("expected fastest dialer request")
		}
		return dialer, true
	})

	result, err := u.CheckOnly(context.Background())
	if err != nil {
		t.Fatalf("CheckOnly returned error: %v", err)
	}
	if !result.HasUpdate {
		t.Fatalf("expected update to be available")
	}
	if dialer.calls.Load() == 0 {
		t.Fatalf("expected HTTP request to use injected dialer")
	}
}

func TestPerformUpdateDownloadsAndVerifiesPrerelease(t *testing.T) {
	originalVersion := version.Version
	originalCommit := version.Commit
	defer func() { version.Version = originalVersion }()
	defer func() { version.Commit = originalCommit }()
	version.Version = "dev-0007-20260401-aaaaaaa"
	version.Commit = "aaaaaaa"

	cfg := Config{
		Channel: "dev",
		Repo:    "owner/repo",
	}
	dataDir := t.TempDir()
	u := New(
		func() Config { return cfg },
		func() string { return dataDir },
		log.New(io.Discard, "", 0),
		RestartHooks{},
	)

	tag := "dev"
	remoteVersion := "dev-0042-20260425-bbbbbbb"
	targetName := u.targetName()
	binary := []byte("new binary")
	sum := fmt.Sprintf("%x", sha256.Sum256(binary))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/owner/repo/releases/download/" + tag + "/version.json":
			_ = json.NewEncoder(w).Encode(releaseVersionInfo{
				Version:   remoteVersion,
				Commit:    "bbbbbbb",
				BuildTime: "2026-04-25T00:00:00Z",
				Tag:       tag,
			})
		case "/owner/repo/releases/download/" + tag + "/" + targetName:
			_, _ = w.Write(binary)
		case "/owner/repo/releases/download/" + tag + "/" + targetName + ".sha256":
			_, _ = w.Write([]byte(sum + "  " + targetName + "\n"))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	withGitHubBaseURL(t, server.URL)
	cfg.ProxyBaseURL = "https://proxy.invalid"

	u.performUpdate(context.Background())

	status := u.Status()
	if status.State != "ready" {
		t.Fatalf("expected update to be ready, got %q: %s", status.State, status.Error)
	}
	if status.LatestVersion != remoteVersion || u.pendingTag != tag {
		t.Fatalf("expected pending latest tag %q, got status=%q pending=%q", tag, status.LatestVersion, u.pendingTag)
	}
	if status.Progress != progressVerifyDone {
		t.Fatalf("expected overall progress %d, got %.0f", progressVerifyDone, status.Progress)
	}
	got, err := os.ReadFile(u.pendingBinaryPath)
	if err != nil {
		t.Fatalf("read pending binary: %v", err)
	}
	if string(got) != string(binary) {
		t.Fatalf("pending binary content mismatch")
	}
}

func TestApplyPendingMovesToApplyingBeforeAsyncRestart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	u := testUpdater(Config{})
	u.bgCtx = ctx
	u.hooks.BeforeExec = func(tag string) error {
		return context.Canceled
	}
	u.status.State = "ready"
	u.pendingBinaryPath = t.TempDir() + "/easy-proxies-new"
	u.pendingTag = "v1.2.0"

	if err := os.WriteFile(u.pendingBinaryPath, []byte("binary"), 0o755); err != nil {
		t.Fatalf("write pending binary: %v", err)
	}

	if err := u.ApplyPending(context.Background()); err != nil {
		t.Fatalf("ApplyPending returned error: %v", err)
	}

	status := u.Status()
	if status.State != "applying" {
		t.Fatalf("expected state applying immediately, got %q", status.State)
	}
	if status.Progress != progressApplying {
		t.Fatalf("expected applying progress %d, got %.0f", progressApplying, status.Progress)
	}
	if u.pendingBinaryPath != "" || u.pendingTag != "" {
		t.Fatalf("expected pending update to be consumed")
	}

	err := u.ApplyPending(context.Background())
	if err == nil || !strings.Contains(err.Error(), "no pending update") {
		t.Fatalf("expected duplicate apply to be rejected, got %v", err)
	}

	time.Sleep(250 * time.Millisecond)
}

type recordingDialer struct {
	calls atomic.Int32
}

func (d *recordingDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	d.calls.Add(1)
	var nd net.Dialer
	return nd.DialContext(ctx, network, address)
}

func testUpdater(cfg Config) *Updater {
	return New(
		func() Config { return cfg },
		func() string { return "" },
		log.New(io.Discard, "", 0),
		RestartHooks{},
	)
}

func withGitHubBaseURL(t *testing.T, baseURL string) {
	t.Helper()
	original := githubBaseURL
	githubBaseURL = baseURL
	t.Cleanup(func() {
		githubBaseURL = original
	})
}

func withGitHubAPIBaseURL(t *testing.T, baseURL string) {
	t.Helper()
	original := githubAPIBaseURL
	githubAPIBaseURL = baseURL
	t.Cleanup(func() {
		githubAPIBaseURL = original
	})
}
