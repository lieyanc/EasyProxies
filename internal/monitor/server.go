package monitor

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	mathrand "math/rand"
	"net"
	"net/http"
	"net/url"
	"path"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"easy-proxies/internal/config"
	"easy-proxies/internal/geoip"
	"easy-proxies/internal/updater"
	"easy-proxies/internal/version"
	"easy-proxies/internal/warp"
	"golang.org/x/sync/semaphore"
)

//go:embed assets
var embeddedFS embed.FS

// Session represents a user session with expiration.
type Session struct {
	Token     string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// NodeManager exposes config node CRUD and reload operations.
type NodeManager interface {
	ListConfigNodes(ctx context.Context) ([]config.NodeConfig, error)
	CreateNode(ctx context.Context, node config.NodeConfig) (config.NodeConfig, error)
	UpdateNode(ctx context.Context, name string, node config.NodeConfig) (config.NodeConfig, error)
	DeleteNode(ctx context.Context, name string) error
	TriggerReload(ctx context.Context) error
}

// WarpRegistrar creates a normal, single-layer Cloudflare WARP account.
// Gool/WARP-in-WARP pairing is intentionally outside EasyProxies' scope.
type WarpRegistrar interface {
	Register(ctx context.Context, name, endpoint string, endpointPort uint16) (warp.Account, error)
	Delete(ctx context.Context, id, token string) error
}

// Sentinel errors for node operations.
var (
	ErrNodeNotFound = errors.New("节点不存在")
	ErrNodeConflict = errors.New("节点名称或端口已存在")
	ErrInvalidNode  = errors.New("无效的节点配置")
)

// SubscriptionRefresher interface for subscription manager.
type SubscriptionRefresher interface {
	RefreshNow() error
	Status() SubscriptionStatus
	UpdateConfig(urls []string, enabled bool, interval time.Duration)
	UpdateConfigAndRefresh(urls []string, enabled bool, interval time.Duration) error
}

// SubscriptionStatus represents subscription refresh status.
type SubscriptionStatus struct {
	LastRefresh   time.Time `json:"last_refresh"`
	NextRefresh   time.Time `json:"next_refresh"`
	NodeCount     int       `json:"node_count"`
	LastError     string    `json:"last_error,omitempty"`
	RefreshCount  int       `json:"refresh_count"`
	IsRefreshing  bool      `json:"is_refreshing"`
	NodesModified bool      `json:"nodes_modified"` // True if nodes.txt was modified since last refresh
}

// Server exposes HTTP endpoints for monitoring.
type Server struct {
	cfg    Config
	cfgMu  sync.RWMutex   // 保护动态配置字段
	cfgSrc *config.Config // 可持久化的配置对象
	mgr    *Manager
	srv    *http.Server
	logger *log.Logger

	// Session management
	sessionMu  sync.RWMutex
	sessions   map[string]*Session
	sessionTTL time.Duration

	// Concurrency control
	probeSem *semaphore.Weighted

	subRefresher  SubscriptionRefresher
	nodeMgr       NodeManager
	warpRegistrar WarpRegistrar
	updater       *updater.Updater
	trafficHub    *trafficBroadcaster
}

const trafficAPIURL = "http://127.0.0.1:9092/traffic"

type trafficBroadcaster struct {
	mu         sync.Mutex
	clients    map[chan string]struct{}
	running    bool
	generation int64
	cancel     context.CancelFunc
	client     *http.Client
	logger     *log.Logger
}

func newTrafficBroadcaster(logger *log.Logger) *trafficBroadcaster {
	if logger == nil {
		logger = log.Default()
	}
	return &trafficBroadcaster{
		clients: make(map[chan string]struct{}),
		client:  &http.Client{},
		logger:  logger,
	}
}

func (b *trafficBroadcaster) subscribe() chan string {
	ch := make(chan string, 16)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	if !b.running {
		b.startLocked()
	}
	b.mu.Unlock()
	return ch
}

func (b *trafficBroadcaster) unsubscribe(ch chan string) {
	b.mu.Lock()
	if _, ok := b.clients[ch]; ok {
		delete(b.clients, ch)
		close(ch)
	}
	if len(b.clients) == 0 && b.cancel != nil {
		b.cancel()
		b.cancel = nil
		b.running = false
	}
	b.mu.Unlock()
}

func (b *trafficBroadcaster) stop() {
	b.mu.Lock()
	if b.cancel != nil {
		b.cancel()
		b.cancel = nil
	}
	for ch := range b.clients {
		delete(b.clients, ch)
		close(ch)
	}
	b.running = false
	b.mu.Unlock()
}

func (b *trafficBroadcaster) startLocked() {
	ctx, cancel := context.WithCancel(context.Background())
	b.generation++
	generation := b.generation
	b.cancel = cancel
	b.running = true
	go b.run(ctx, generation)
}

func (b *trafficBroadcaster) run(ctx context.Context, generation int64) {
	defer func() {
		b.mu.Lock()
		if b.generation == generation {
			b.running = false
			b.cancel = nil
		}
		b.mu.Unlock()
	}()

	for {
		if err := b.streamOnce(ctx); err != nil && ctx.Err() == nil && b.logger != nil {
			b.logger.Printf("traffic stream disconnected: %v", err)
		}
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func (b *trafficBroadcaster) streamOnce(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, trafficAPIURL, nil)
	if err != nil {
		return err
	}
	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("traffic api status %s", resp.Status)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		b.broadcast(line)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return errors.New("traffic stream closed")
}

func (b *trafficBroadcaster) broadcast(line string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.clients {
		select {
		case ch <- line:
		default:
		}
	}
}

// NewServer constructs a server; it can be nil when disabled.
func NewServer(cfg Config, mgr *Manager, logger *log.Logger) *Server {
	if !cfg.Enabled || mgr == nil {
		return nil
	}
	if logger == nil {
		logger = log.Default()
	}

	// Calculate max concurrent probes
	maxConcurrentProbes := int64(runtime.NumCPU() * 4)
	if maxConcurrentProbes < 10 {
		maxConcurrentProbes = 10
	}

	s := &Server{
		cfg:           cfg,
		mgr:           mgr,
		logger:        logger,
		sessions:      make(map[string]*Session),
		sessionTTL:    24 * time.Hour,
		probeSem:      semaphore.NewWeighted(maxConcurrentProbes),
		trafficHub:    newTrafficBroadcaster(logger),
		warpRegistrar: warp.NewClient(),
	}

	// Start session cleanup goroutine
	go s.cleanupExpiredSessions()

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/auth", s.handleAuth)
	mux.HandleFunc("/api/settings", s.withAuth(s.handleSettings))
	mux.HandleFunc("/api/nodes", s.withAuth(s.handleNodes))
	mux.HandleFunc("/api/nodes/config", s.withAuth(s.handleConfigNodes))
	mux.HandleFunc("/api/nodes/config/", s.withAuth(s.handleConfigNodeItem))
	mux.HandleFunc("/api/nodes/probe-all", s.withAuth(s.handleProbeAll))
	mux.HandleFunc("/api/nodes/", s.withAuth(s.handleNodeAction))
	mux.HandleFunc("/api/warp/register", s.withAuth(s.handleWarpRegister))
	mux.HandleFunc("/api/debug", s.withAuth(s.handleDebug))
	mux.HandleFunc("/api/addresses", s.withAuth(s.handleAddresses))
	mux.HandleFunc("/api/export", s.withAuth(s.handleExport))
	mux.HandleFunc("/api/subscription/status", s.withAuth(s.handleSubscriptionStatus))
	mux.HandleFunc("/api/subscription/refresh", s.withAuth(s.handleSubscriptionRefresh))
	mux.HandleFunc("/api/subscription/config", s.withAuth(s.handleSubscriptionConfig))
	mux.HandleFunc("/api/reload", s.withAuth(s.handleReload))
	mux.HandleFunc("/api/version", s.withAuth(s.handleVersion))
	mux.HandleFunc("/api/update/status", s.withAuth(s.handleUpdateStatus))
	mux.HandleFunc("/api/update/check", s.withAuth(s.handleUpdateCheck))
	mux.HandleFunc("/api/update/apply", s.withAuth(s.handleUpdateApply))
	mux.HandleFunc("/api/update/dismiss", s.withAuth(s.handleUpdateDismiss))
	mux.HandleFunc("/api/traffic", s.withAuth(s.handleTraffic))
	mux.HandleFunc("/api/logs", s.withAuth(s.handleLogs))
	s.srv = &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	return s
}

// SetSubscriptionRefresher sets the subscription refresher for API endpoints.
func (s *Server) SetSubscriptionRefresher(sr SubscriptionRefresher) {
	if s != nil {
		s.subRefresher = sr
	}
}

// SetNodeManager enables config-node CRUD endpoints.
func (s *Server) SetNodeManager(nm NodeManager) {
	if s != nil {
		s.nodeMgr = nm
	}
}

// SetWarpRegistrar replaces the WARP registration client, primarily for tests.
func (s *Server) SetWarpRegistrar(registrar WarpRegistrar) {
	if s != nil {
		s.warpRegistrar = registrar
	}
}

// SetUpdater enables OTA update endpoints.
func (s *Server) SetUpdater(u *updater.Updater) {
	if s != nil {
		s.updater = u
	}
}

// SetConfig binds the persistable config object for settings API.
func (s *Server) SetConfig(cfg *config.Config) {
	if s == nil {
		return
	}
	s.cfgMu.Lock()
	defer s.cfgMu.Unlock()
	// Preserve subscription config from previous cfgSrc if new config has none
	if cfg != nil && s.cfgSrc != nil {
		if len(cfg.Subscriptions) == 0 && len(s.cfgSrc.Subscriptions) > 0 {
			cfg.Subscriptions = s.cfgSrc.Subscriptions
		}
		if cfg.SubscriptionRefresh.Interval == 0 && s.cfgSrc.SubscriptionRefresh.Interval > 0 {
			cfg.SubscriptionRefresh = s.cfgSrc.SubscriptionRefresh
		}
	}
	s.cfgSrc = cfg
	if cfg != nil {
		s.cfg.ExternalIP = cfg.ExternalIP
		s.cfg.ProbeTarget = cfg.Management.ProbeTarget
		s.cfg.HealthCheckInterval = cfg.Management.HealthCheckInterval
		s.cfg.HealthCheckConcurrency = cfg.Management.HealthCheckConcurrency
		s.cfg.InitialCheckConcurrency = cfg.Management.InitialCheckConcurrency
		s.cfg.SkipCertVerify = cfg.SkipCertVerify
		s.cfg.ExitIPProbeMode = cfg.GeoIP.ExitIPProbeMode
		s.cfg.ExitIPProbeInterval = cfg.GeoIP.ExitIPProbeInterval
		// Sync proxy credentials based on mode
		if cfg.Mode == "multi-port" || cfg.Mode == "hybrid" {
			s.cfg.ProxyUsername = cfg.MultiPort.Username
			s.cfg.ProxyPassword = cfg.MultiPort.Password
		} else {
			s.cfg.ProxyUsername = cfg.Listener.Username
			s.cfg.ProxyPassword = cfg.Listener.Password
		}
	}
}

// getSettings returns current dynamic settings (thread-safe).
func (s *Server) getSettings() (externalIP, probeTarget string, skipCertVerify bool, logCfg config.LogConfig) {
	s.cfgMu.RLock()
	defer s.cfgMu.RUnlock()
	logCfg = config.LogConfig{}
	if s.cfgSrc != nil {
		logCfg = s.cfgSrc.Log
	}
	return s.cfg.ExternalIP, s.cfg.ProbeTarget, s.cfg.SkipCertVerify, logCfg
}

// Start launches the HTTP server.
func (s *Server) Start(ctx context.Context) {
	if s == nil || s.srv == nil {
		return
	}
	s.logger.Printf("Starting monitor server on %s", s.cfg.Listen)
	go func() {
		if err := s.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			s.logger.Printf("❌ Monitor server error: %v", err)
		}
	}()
	// Give server a moment to start and check for immediate errors
	time.Sleep(100 * time.Millisecond)
	s.logger.Printf("✅ Monitor server started on http://%s", s.cfg.Listen)

	go func() {
		<-ctx.Done()
		s.Shutdown(context.Background())
	}()
}

// Shutdown stops the server gracefully.
func (s *Server) Shutdown(ctx context.Context) {
	if s == nil || s.srv == nil {
		return
	}
	if s.trafficHub != nil {
		s.trafficHub.stop()
	}
	_ = s.srv.Shutdown(ctx)
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		assetName := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if assetName != "" && assetName != "." {
			if data, err := embeddedFS.ReadFile("assets/" + assetName); err == nil {
				http.ServeContent(w, r, path.Base(assetName), time.Time{}, bytes.NewReader(data))
				return
			}
		}
	}

	data, err := embeddedFS.ReadFile("assets/index.html")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	allNodes := s.mgr.Snapshot()
	totalNodes := len(allNodes)

	// Calculate region statistics
	regionStats := make(map[string]int)
	regionHealthy := make(map[string]int)
	for _, snap := range allNodes {
		region := snap.Region
		if region == "" {
			region = "other"
		}
		regionStats[region]++
		// Count healthy nodes per region
		if snap.InitialCheckDone && snap.Available && !snap.Blacklisted {
			regionHealthy[region]++
		}
	}

	payload := map[string]any{
		"nodes":          allNodes,
		"total_nodes":    totalNodes,
		"region_stats":   regionStats,
		"region_healthy": regionHealthy,
	}
	writeJSON(w, payload)
}

func (s *Server) handleDebug(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	snapshots := s.mgr.Snapshot()
	var totalCalls, totalSuccess int64
	debugNodes := make([]map[string]any, 0, len(snapshots))
	for _, snap := range snapshots {
		totalCalls += snap.SuccessCount + int64(snap.FailureCount)
		totalSuccess += snap.SuccessCount
		debugNodes = append(debugNodes, map[string]any{
			"tag":                snap.Tag,
			"name":               snap.Name,
			"mode":               snap.Mode,
			"port":               snap.Port,
			"region":             snap.Region,
			"country":            snap.Country,
			"exit_ip":            snap.ExitIP,
			"failure_count":      snap.FailureCount,
			"success_count":      snap.SuccessCount,
			"active_connections": snap.ActiveConnections,
			"last_latency_ms":    snap.LastLatencyMs,
			"last_success":       snap.LastSuccess,
			"last_failure":       snap.LastFailure,
			"last_error":         snap.LastError,
			"blacklisted":        snap.Blacklisted,
			"timeline":           snap.Timeline,
		})
	}
	var successRate float64
	if totalCalls > 0 {
		successRate = float64(totalSuccess) / float64(totalCalls) * 100
	}
	writeJSON(w, map[string]any{
		"nodes":         debugNodes,
		"total_calls":   totalCalls,
		"total_success": totalSuccess,
		"success_rate":  successRate,
	})
}

type addressEntry struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Protocol    string `json:"protocol"`
	URL         string `json:"url"`
	Port        uint16 `json:"port,omitempty"`
	Region      string `json:"region,omitempty"`
	NodeTag     string `json:"node_tag,omitempty"`
	NodeName    string `json:"node_name,omitempty"`
}

type addressesResponse struct {
	Mode    string         `json:"mode"`
	Entries []addressEntry `json:"entries"`
}

// handleAddresses returns structured proxy entry points for the WebUI.
func (s *Server) handleAddresses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	s.cfgMu.RLock()
	mode := ""
	externalIP := s.cfg.ExternalIP
	var listenerCfg config.ListenerConfig
	var multiPortCfg config.MultiPortConfig
	var geoIPCfg config.GeoIPConfig
	var poolCfg config.PoolConfig
	if s.cfgSrc != nil {
		mode = s.cfgSrc.Mode
		externalIP = s.cfgSrc.ExternalIP
		listenerCfg = s.cfgSrc.Listener
		multiPortCfg = s.cfgSrc.MultiPort
		geoIPCfg = s.cfgSrc.GeoIP
		poolCfg = s.cfgSrc.Pool
	}
	s.cfgMu.RUnlock()

	requestHost := requestHostname(r.Host)
	entries := make([]addressEntry, 0)
	showPoolEntry := mode == "pool" || mode == "hybrid"
	showMultiPort := mode == "multi-port" || mode == "hybrid"

	if showPoolEntry && listenerCfg.Port > 0 {
		host := publicProxyHost(listenerCfg.Address, externalIP, requestHost)
		poolUsername := listenerCfg.Username
		if geoIPCfg.Enabled {
			poolUsername = geoip.GlobalAuthUsername(listenerCfg.Username)
		}
		entries = append(entries,
			addressEntry{
				ID:          "pool-http",
				Kind:        "pool",
				Label:       "Pool 代理池",
				Description: "单端口入口",
				Protocol:    "http",
				URL:         proxyURL("http", poolUsername, listenerCfg.Password, host, listenerCfg.Port, ""),
				Port:        listenerCfg.Port,
			},
			addressEntry{
				ID:          "pool-socks5",
				Kind:        "pool",
				Label:       "Pool 代理池",
				Description: "单端口入口",
				Protocol:    "socks5",
				URL:         proxyURL("socks5", poolUsername, listenerCfg.Password, host, listenerCfg.Port, ""),
				Port:        listenerCfg.Port,
			},
		)
		if poolCfg.RoundRobinEntry {
			rrUsername := poolCfg.RoundRobinAuthUsername(listenerCfg.Username)
			entries = append(entries,
				addressEntry{
					ID:          "pool-rr-http",
					Kind:        "pool",
					Label:       "Pool 轮询",
					Description: "用户名轮询入口",
					Protocol:    "http",
					URL:         proxyURL("http", rrUsername, listenerCfg.Password, host, listenerCfg.Port, ""),
					Port:        listenerCfg.Port,
				},
				addressEntry{
					ID:          "pool-rr-socks5",
					Kind:        "pool",
					Label:       "Pool 轮询",
					Description: "用户名轮询入口",
					Protocol:    "socks5",
					URL:         proxyURL("socks5", rrUsername, listenerCfg.Password, host, listenerCfg.Port, ""),
					Port:        listenerCfg.Port,
				},
			)
		}
	}

	if geoIPCfg.Enabled && showPoolEntry && listenerCfg.Port > 0 {
		host := publicProxyHost(listenerCfg.Address, externalIP, requestHost)
		for _, region := range geoip.AllRegions() {
			username := geoip.RegionAuthUsername(listenerCfg.Username, region)
			label := fmt.Sprintf("GeoIP %s", strings.ToUpper(region))
			entries = append(entries,
				addressEntry{
					ID:          fmt.Sprintf("geoip-%s-http", region),
					Kind:        "geoip",
					Label:       label,
					Description: "用户名地域入口",
					Protocol:    "http",
					URL:         proxyURL("http", username, listenerCfg.Password, host, listenerCfg.Port, ""),
					Port:        listenerCfg.Port,
					Region:      region,
				},
				addressEntry{
					ID:          fmt.Sprintf("geoip-%s-socks5", region),
					Kind:        "geoip",
					Label:       label,
					Description: "用户名地域入口",
					Protocol:    "socks5",
					URL:         proxyURL("socks5", username, listenerCfg.Password, host, listenerCfg.Port, ""),
					Port:        listenerCfg.Port,
					Region:      region,
				},
			)
		}
	}

	if showMultiPort {
		for _, snap := range s.mgr.Snapshot() {
			if snap.ListenAddress == "" || snap.Port == 0 {
				continue
			}
			host := publicProxyHost(snap.ListenAddress, externalIP, requestHost)
			label := snap.Name
			if label == "" {
				label = snap.Tag
			}
			entries = append(entries,
				addressEntry{
					ID:          fmt.Sprintf("multi-%s-http", snap.Tag),
					Kind:        "multi-port",
					Label:       label,
					Description: "独立端口",
					Protocol:    "http",
					URL:         proxyURL("http", multiPortCfg.Username, multiPortCfg.Password, host, snap.Port, ""),
					Port:        snap.Port,
					NodeTag:     snap.Tag,
					NodeName:    snap.Name,
				},
				addressEntry{
					ID:          fmt.Sprintf("multi-%s-socks5", snap.Tag),
					Kind:        "multi-port",
					Label:       label,
					Description: "独立端口",
					Protocol:    "socks5",
					URL:         proxyURL("socks5", multiPortCfg.Username, multiPortCfg.Password, host, snap.Port, ""),
					Port:        snap.Port,
					NodeTag:     snap.Tag,
					NodeName:    snap.Name,
				},
			)
		}
	}

	writeJSON(w, addressesResponse{
		Mode:    mode,
		Entries: entries,
	})
}

func requestHostname(hostport string) string {
	hostport = strings.TrimSpace(hostport)
	if hostport == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(host, "[]")
	}
	if strings.HasPrefix(hostport, "[") {
		if end := strings.LastIndex(hostport, "]"); end > 0 {
			return strings.Trim(hostport[1:end], "[]")
		}
	}
	if strings.Count(hostport, ":") == 1 {
		host, _, _ := strings.Cut(hostport, ":")
		return strings.Trim(host, "[]")
	}
	return strings.Trim(hostport, "[]")
}

func publicProxyHost(listenAddress, externalIP, requestHost string) string {
	host := requestHostname(listenAddress)
	switch host {
	case "", "0.0.0.0", "::":
		if externalIP != "" {
			return requestHostname(externalIP)
		}
		if requestHost != "" {
			return requestHost
		}
		return "127.0.0.1"
	default:
		return host
	}
}

func proxyURL(scheme, username, password, host string, port uint16, urlPath string) string {
	if host == "" {
		host = "127.0.0.1"
	}
	u := url.URL{
		Scheme: scheme,
		Host:   net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(int(port))),
		Path:   urlPath,
	}
	if username != "" {
		if password != "" {
			u.User = url.UserPassword(username, password)
		} else {
			u.User = url.User(username)
		}
	}
	return u.String()
}

func (s *Server) handleNodeAction(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/nodes/"), "/")
	if len(parts) < 1 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	tag := parts[0]
	if tag == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	switch action {
	case "probe":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		latency, err := s.mgr.Probe(ctx, tag)
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, err.Error())
			return
		}
		latencyMs := latency.Milliseconds()
		if latencyMs == 0 && latency > 0 {
			latencyMs = 1 // Round up sub-millisecond latencies to 1ms
		}
		writeJSON(w, map[string]any{"message": "探测成功", "latency_ms": latencyMs})
	case "release":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if err := s.mgr.Release(tag); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, map[string]any{"message": "已解除拉黑"})
	case "blacklist":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Duration string `json:"duration"` // e.g. "1h", "24h", "30m"
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Duration == "" {
			req.Duration = "24h"
		}
		duration, err := time.ParseDuration(req.Duration)
		if err != nil || duration <= 0 {
			duration = 24 * time.Hour
		}
		if err := s.mgr.ManualBlacklist(tag, duration); err != nil {
			writeJSONError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, map[string]any{"message": fmt.Sprintf("已拉黑 %s", duration)})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// handleProbeAll probes all nodes in batches and returns results via SSE
func (s *Server) handleProbeAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	// Get all nodes
	snapshots := s.mgr.Snapshot()
	total := len(snapshots)
	if total == 0 {
		emptyData, _ := json.Marshal(map[string]any{"type": "complete", "total": 0, "success": 0, "failed": 0})
		fmt.Fprintf(w, "data: %s\n\n", emptyData)
		flusher.Flush()
		return
	}

	// Send start event
	startData, _ := json.Marshal(map[string]any{"type": "start", "total": total})
	fmt.Fprintf(w, "data: %s\n\n", startData)
	flusher.Flush()

	// Create context with timeout
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	// Probe all nodes with semaphore control
	type probeResult struct {
		tag     string
		name    string
		latency int64
		err     string
	}
	results := make(chan probeResult, total)
	var wg sync.WaitGroup

	// Launch probes with semaphore control
	for _, snap := range snapshots {
		wg.Add(1)
		go func(snap Snapshot) {
			defer wg.Done()

			// Acquire semaphore permit
			if err := s.probeSem.Acquire(ctx, 1); err != nil {
				results <- probeResult{
					tag:  snap.Tag,
					name: snap.Name,
					err:  "probe cancelled: " + err.Error(),
				}
				return
			}
			defer s.probeSem.Release(1)

			// Execute probe
			probeCtx, probeCancel := context.WithTimeout(ctx, 10*time.Second)
			defer probeCancel()

			latency, err := s.mgr.Probe(probeCtx, snap.Tag)
			if err != nil {
				results <- probeResult{
					tag:     snap.Tag,
					name:    snap.Name,
					latency: -1,
					err:     err.Error(),
				}
			} else {
				results <- probeResult{
					tag:     snap.Tag,
					name:    snap.Name,
					latency: latency.Milliseconds(),
					err:     "",
				}
			}
		}(snap)
	}

	// Wait for all probes to complete
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	successCount := 0
	failedCount := 0
	count := 0

	for result := range results {
		count++
		if result.err != "" {
			failedCount++
		} else {
			successCount++
		}

		status := "success"
		if result.err != "" {
			status = "error"
		}

		eventPayload := map[string]any{
			"type":     "progress",
			"tag":      result.tag,
			"name":     result.name,
			"latency":  result.latency,
			"status":   status,
			"error":    result.err,
			"current":  count,
			"total":    total,
			"progress": float64(count) / float64(total) * 100,
		}
		eventData, _ := json.Marshal(eventPayload)
		fmt.Fprintf(w, "data: %s\n\n", eventData)
		flusher.Flush()
	}

	// Send complete event
	completeData, _ := json.Marshal(map[string]any{"type": "complete", "total": total, "success": successCount, "failed": failedCount})
	fmt.Fprintf(w, "data: %s\n\n", completeData)
	flusher.Flush()
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": message})
}

// withAuth 认证中间件，如果配置了密码则需要验证
func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 如果没有配置密码，直接放行
		if s.cfg.Password == "" {
			next(w, r)
			return
		}

		// 检查 Cookie 中的 session token
		cookie, err := r.Cookie("session_token")
		if err == nil && s.validateSession(cookie.Value) {
			next(w, r)
			return
		}

		// 检查 Authorization header (Bearer token)
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" {
			token := strings.TrimPrefix(authHeader, "Bearer ")
			if s.validateSession(token) {
				next(w, r)
				return
			}
		}

		// 未授权
		w.WriteHeader(http.StatusUnauthorized)
		writeJSON(w, map[string]any{"error": "未授权，请先登录"})
	}
}

// handleAuth 处理登录认证
func (s *Server) handleAuth(w http.ResponseWriter, r *http.Request) {
	// 如果没有配置密码，直接返回成功（不需要token）
	if s.cfg.Password == "" {
		writeJSON(w, map[string]any{"message": "无需密码", "no_password": true})
		return
	}

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "请求格式错误"})
		return
	}

	// 使用 constant-time 比较防止时序攻击
	if !secureCompareStrings(req.Password, s.cfg.Password) {
		// 添加随机延迟防止暴力破解
		time.Sleep(time.Duration(100+mathrand.Intn(200)) * time.Millisecond)
		w.WriteHeader(http.StatusUnauthorized)
		writeJSON(w, map[string]any{"error": "密码错误"})
		return
	}

	// 创建新会话
	session, err := s.createSession()
	if err != nil {
		s.logger.Printf("Failed to create session: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		writeJSON(w, map[string]any{"error": "服务器错误"})
		return
	}

	// 设置 HttpOnly Cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    session.Token,
		Path:     "/",
		HttpOnly: true,
		Secure:   false, // 生产环境应启用 HTTPS 并设为 true
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(s.sessionTTL.Seconds()),
	})

	writeJSON(w, map[string]any{
		"message": "登录成功",
		"token":   session.Token,
	})
}

// handleExport 导出所有可用代理池节点的代理 URI，每行一个。
// query 参数:
//   - scheme=http   (默认)
//   - scheme=socks5
//   - scheme=all    (同时导出 HTTP 和 SOCKS5)
//
// 在 pool/hybrid 模式下，还会导出 Pool 代理池入口和 GeoIP 用户名分区入口。
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	scheme := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scheme")))
	if scheme == "" {
		scheme = "http"
	}
	if scheme != "http" && scheme != "socks5" && scheme != "all" {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "invalid scheme, use http/socks5/all"})
		return
	}

	// 只导出初始检查通过的可用节点
	snapshots := s.mgr.SnapshotFiltered(true)
	var lines []string

	seen := make(map[string]bool)

	// 读取运行模式和监听配置
	s.cfgMu.RLock()
	mode := ""
	var listenerCfg config.ListenerConfig
	var geoipCfg config.GeoIPConfig
	var poolCfg config.PoolConfig
	if s.cfgSrc != nil {
		mode = s.cfgSrc.Mode
		listenerCfg = s.cfgSrc.Listener
		geoipCfg = s.cfgSrc.GeoIP
		poolCfg = s.cfgSrc.Pool
	}
	s.cfgMu.RUnlock()

	// Pool 代理池入口（pool 或 hybrid 模式）
	if (mode == "pool" || mode == "hybrid") && listenerCfg.Port > 0 {
		poolAddr := listenerCfg.Address
		if poolAddr == "" || poolAddr == "0.0.0.0" || poolAddr == "::" {
			if extIP, _, _, _ := s.getSettings(); extIP != "" {
				poolAddr = extIP
			}
		}
		poolUsername := listenerCfg.Username
		if geoipCfg.Enabled {
			poolUsername = geoip.GlobalAuthUsername(listenerCfg.Username)
		}
		lines = append(lines, "# Pool 代理池入口")
		poolHTTP := proxyURL("http", poolUsername, listenerCfg.Password, poolAddr, listenerCfg.Port, "")
		poolSocks := proxyURL("socks5", poolUsername, listenerCfg.Password, poolAddr, listenerCfg.Port, "")
		switch scheme {
		case "http":
			lines = append(lines, poolHTTP)
			seen[poolHTTP] = true
		case "socks5":
			lines = append(lines, poolSocks)
			seen[poolSocks] = true
		case "all":
			lines = append(lines, poolHTTP)
			seen[poolHTTP] = true
			lines = append(lines, poolSocks)
			seen[poolSocks] = true
		}
		if poolCfg.RoundRobinEntry {
			rrUsername := poolCfg.RoundRobinAuthUsername(listenerCfg.Username)
			rrHTTP := proxyURL("http", rrUsername, listenerCfg.Password, poolAddr, listenerCfg.Port, "")
			rrSocks := proxyURL("socks5", rrUsername, listenerCfg.Password, poolAddr, listenerCfg.Port, "")
			lines = append(lines, "# Pool 轮询入口")
			switch scheme {
			case "http":
				if !seen[rrHTTP] {
					lines = append(lines, rrHTTP)
					seen[rrHTTP] = true
				}
			case "socks5":
				if !seen[rrSocks] {
					lines = append(lines, rrSocks)
					seen[rrSocks] = true
				}
			case "all":
				if !seen[rrHTTP] {
					lines = append(lines, rrHTTP)
					seen[rrHTTP] = true
				}
				if !seen[rrSocks] {
					lines = append(lines, rrSocks)
					seen[rrSocks] = true
				}
			}
		}
	}

	// GeoIP 用户名分区路由入口
	if geoipCfg.Enabled && (mode == "pool" || mode == "hybrid") && listenerCfg.Port > 0 {
		geoAddr := listenerCfg.Address
		if geoAddr == "" || geoAddr == "0.0.0.0" || geoAddr == "::" {
			if extIP, _, _, _ := s.getSettings(); extIP != "" {
				geoAddr = extIP
			}
		}
		lines = append(lines, "# GeoIP 用户名分区入口")
		for _, r := range geoip.AllRegions() {
			username := geoip.RegionAuthUsername(listenerCfg.Username, r)
			regionHTTP := proxyURL("http", username, listenerCfg.Password, geoAddr, listenerCfg.Port, "")
			regionSocks := proxyURL("socks5", username, listenerCfg.Password, geoAddr, listenerCfg.Port, "")
			switch scheme {
			case "http":
				if !seen[regionHTTP] {
					lines = append(lines, regionHTTP)
					seen[regionHTTP] = true
				}
			case "socks5":
				if !seen[regionSocks] {
					lines = append(lines, regionSocks)
					seen[regionSocks] = true
				}
			case "all":
				if !seen[regionHTTP] {
					lines = append(lines, regionHTTP)
					seen[regionHTTP] = true
				}
				if !seen[regionSocks] {
					lines = append(lines, regionSocks)
					seen[regionSocks] = true
				}
			}
		}
	}

	// Multi-port 独立节点
	if len(snapshots) > 0 && (mode == "hybrid" || mode == "multi-port" || mode == "") {
		lines = append(lines, "# Multi-port 独立节点")
	}
	for _, snap := range snapshots {
		// 只导出有监听地址和端口的节点
		if snap.ListenAddress == "" || snap.Port == 0 {
			continue
		}

		listenAddr := snap.ListenAddress
		if listenAddr == "0.0.0.0" || listenAddr == "::" {
			if extIP, _, _, _ := s.getSettings(); extIP != "" {
				listenAddr = extIP
			}
		}

		var authPart string
		if s.cfg.ProxyUsername != "" && s.cfg.ProxyPassword != "" {
			authPart = fmt.Sprintf("%s:%s@", s.cfg.ProxyUsername, s.cfg.ProxyPassword)
		}
		httpURI := fmt.Sprintf("http://%s%s:%d", authPart, listenAddr, snap.Port)
		socksURI := fmt.Sprintf("socks5://%s%s:%d", authPart, listenAddr, snap.Port)

		switch scheme {
		case "http":
			if !seen[httpURI] {
				lines = append(lines, httpURI)
				seen[httpURI] = true
			}
		case "socks5":
			if !seen[socksURI] {
				lines = append(lines, socksURI)
				seen[socksURI] = true
			}
		case "all":
			if !seen[httpURI] {
				lines = append(lines, httpURI)
				seen[httpURI] = true
			}
			if !seen[socksURI] {
				lines = append(lines, socksURI)
				seen[socksURI] = true
			}
		}
	}

	// 返回纯文本，每行一个 URI
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	filename := "proxy_pool.txt"
	if scheme == "socks5" {
		filename = "proxy_pool_socks5.txt"
	} else if scheme == "all" {
		filename = "proxy_pool_all.txt"
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	_, _ = w.Write([]byte(strings.Join(lines, "\n")))
}

// handleSettings handles GET/PUT for dynamic settings (external_ip, probe_target, skip_cert_verify, log).
func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		extIP, probeTarget, skipCertVerify, logCfg := s.getSettings()

		// Read full config for extended fields
		s.cfgMu.RLock()
		cfg := s.cfgSrc
		s.cfgMu.RUnlock()

		resp := map[string]any{
			"external_ip":      extIP,
			"probe_target":     probeTarget,
			"skip_cert_verify": skipCertVerify,
			"log": map[string]any{
				"output":      logCfg.Output,
				"file":        logCfg.File,
				"max_size":    logCfg.MaxSize,
				"max_backups": logCfg.MaxBackups,
				"max_age":     logCfg.MaxAge,
				"compress":    logCfg.Compress,
			},
			"geoip": map[string]any{
				"enabled":                false,
				"database_path":          "",
				"listen":                 "",
				"port":                   0,
				"auto_update_enabled":    false,
				"auto_update_interval":   "",
				"exit_ip_probe_mode":     config.ExitIPProbeModeInterval,
				"exit_ip_probe_interval": "",
				"download_proxies":       []string{},
			},
			"update": map[string]any{
				"enabled":          false,
				"channel":          "stable",
				"check_interval":   "1h",
				"proxy_base_url":   "",
				"repo":             "lieyanc/easy-proxies",
				"use_fastest_node": false,
			},
		}
		if cfg != nil {
			resp["mode"] = cfg.Mode
			resp["listener"] = map[string]any{
				"address":  cfg.Listener.Address,
				"port":     cfg.Listener.Port,
				"username": cfg.Listener.Username,
				"password": cfg.Listener.Password,
			}
			resp["multi_port"] = map[string]any{
				"address":   cfg.MultiPort.Address,
				"base_port": cfg.MultiPort.BasePort,
				"username":  cfg.MultiPort.Username,
				"password":  cfg.MultiPort.Password,
			}
			poolMode, ok := config.NormalizePoolMode(cfg.Pool.Mode)
			if !ok {
				poolMode = "sequential"
			}
			resp["pool"] = map[string]any{
				"mode":                 poolMode,
				"failure_threshold":    cfg.Pool.FailureThreshold,
				"blacklist_duration":   cfg.Pool.BlacklistDuration.String(),
				"round_robin_entry":    cfg.Pool.RoundRobinEntry,
				"round_robin_username": cfg.Pool.RoundRobinUsername,
			}
			resp["management"] = map[string]any{
				"listen":                    cfg.Management.Listen,
				"password":                  cfg.Management.Password,
				"health_check_interval":     cfg.Management.HealthCheckInterval.String(),
				"health_check_concurrency":  cfg.Management.HealthCheckConcurrency,
				"initial_check_concurrency": cfg.Management.InitialCheckConcurrency,
			}
			resp["geoip"] = map[string]any{
				"enabled":                cfg.GeoIP.Enabled,
				"database_path":          cfg.GeoIP.DatabasePath,
				"listen":                 cfg.GeoIP.Listen,
				"port":                   cfg.GeoIP.Port,
				"auto_update_enabled":    cfg.GeoIP.AutoUpdateEnabled,
				"auto_update_interval":   cfg.GeoIP.AutoUpdateInterval.String(),
				"exit_ip_probe_mode":     cfg.GeoIP.ExitIPProbeMode,
				"exit_ip_probe_interval": cfg.GeoIP.ExitIPProbeInterval.String(),
				"download_proxies":       cfg.GeoIP.DownloadProxies,
			}
			resp["update"] = map[string]any{
				"enabled":          cfg.Update.Enabled,
				"channel":          cfg.Update.Channel,
				"check_interval":   cfg.Update.CheckInterval.String(),
				"proxy_base_url":   cfg.Update.ProxyBaseURL,
				"repo":             cfg.Update.Repo,
				"use_fastest_node": cfg.Update.UseFastestNode,
			}
		}
		writeJSON(w, resp)
	case http.MethodPut:
		var req struct {
			ExternalIP     string `json:"external_ip"`
			ProbeTarget    string `json:"probe_target"`
			SkipCertVerify bool   `json:"skip_cert_verify"`
			Mode           string `json:"mode,omitempty"`
			Listener       *struct {
				Address  string `json:"address"`
				Port     uint16 `json:"port"`
				Username string `json:"username"`
				Password string `json:"password"`
			} `json:"listener,omitempty"`
			MultiPort *struct {
				Address  string `json:"address"`
				BasePort uint16 `json:"base_port"`
				Username string `json:"username"`
				Password string `json:"password"`
			} `json:"multi_port,omitempty"`
			Pool *struct {
				Mode               string `json:"mode"`
				FailureThreshold   int    `json:"failure_threshold"`
				BlacklistDuration  string `json:"blacklist_duration"`
				RoundRobinEntry    bool   `json:"round_robin_entry"`
				RoundRobinUsername string `json:"round_robin_username"`
			} `json:"pool,omitempty"`
			Management *struct {
				Listen                  string `json:"listen"`
				Password                string `json:"password"`
				HealthCheckInterval     string `json:"health_check_interval"`
				HealthCheckConcurrency  int    `json:"health_check_concurrency"`
				InitialCheckConcurrency int    `json:"initial_check_concurrency"`
			} `json:"management,omitempty"`
			Log *struct {
				Output     string `json:"output"`
				MaxSize    int    `json:"max_size"`
				MaxBackups int    `json:"max_backups"`
				MaxAge     int    `json:"max_age"`
				Compress   bool   `json:"compress"`
			} `json:"log"`
			GeoIP *struct {
				Enabled             bool     `json:"enabled"`
				DatabasePath        string   `json:"database_path"`
				Listen              string   `json:"listen"`
				Port                uint16   `json:"port"`
				AutoUpdateEnabled   bool     `json:"auto_update_enabled"`
				AutoUpdateInterval  string   `json:"auto_update_interval"`
				ExitIPProbeMode     string   `json:"exit_ip_probe_mode"`
				ExitIPProbeInterval string   `json:"exit_ip_probe_interval"`
				DownloadProxies     []string `json:"download_proxies"`
			} `json:"geoip"`
			Update *struct {
				Enabled        bool   `json:"enabled"`
				Channel        string `json:"channel"`
				CheckInterval  string `json:"check_interval"`
				ProxyBaseURL   string `json:"proxy_base_url"`
				Repo           string `json:"repo"`
				UseFastestNode bool   `json:"use_fastest_node"`
			} `json:"update"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{"error": "请求格式错误"})
			return
		}

		extIP := strings.TrimSpace(req.ExternalIP)
		probeTarget := strings.TrimSpace(req.ProbeTarget)

		var logCfg *config.LogConfig
		if req.Log != nil {
			logCfg = &config.LogConfig{
				Output:     req.Log.Output,
				MaxSize:    req.Log.MaxSize,
				MaxBackups: req.Log.MaxBackups,
				MaxAge:     req.Log.MaxAge,
				Compress:   req.Log.Compress,
			}
		}

		s.cfgMu.Lock()
		if s.cfgSrc == nil {
			s.cfgMu.Unlock()
			w.WriteHeader(http.StatusInternalServerError)
			writeJSON(w, map[string]any{"error": "配置存储未初始化"})
			return
		}

		nextCfg := *s.cfgSrc
		nextCfg.ExternalIP = extIP
		nextCfg.Management.ProbeTarget = probeTarget
		nextCfg.SkipCertVerify = req.SkipCertVerify

		if req.Mode != "" {
			nextCfg.Mode = req.Mode
		}
		if req.Listener != nil {
			nextCfg.Listener.Address = req.Listener.Address
			nextCfg.Listener.Port = req.Listener.Port
			nextCfg.Listener.Username = req.Listener.Username
			nextCfg.Listener.Password = req.Listener.Password
		}
		if req.MultiPort != nil {
			nextCfg.MultiPort.Address = req.MultiPort.Address
			nextCfg.MultiPort.BasePort = req.MultiPort.BasePort
			nextCfg.MultiPort.Username = req.MultiPort.Username
			nextCfg.MultiPort.Password = req.MultiPort.Password
		}
		if req.Pool != nil {
			poolMode, ok := config.NormalizePoolMode(req.Pool.Mode)
			if !ok {
				s.cfgMu.Unlock()
				w.WriteHeader(http.StatusBadRequest)
				writeJSON(w, map[string]any{"error": "不支持的调度模式"})
				return
			}
			nextCfg.Pool.Mode = poolMode
			nextCfg.Pool.FailureThreshold = req.Pool.FailureThreshold
			nextCfg.Pool.RoundRobinEntry = req.Pool.RoundRobinEntry
			nextCfg.Pool.RoundRobinUsername = strings.TrimSpace(req.Pool.RoundRobinUsername)
			if req.Pool.BlacklistDuration != "" {
				if d, err := time.ParseDuration(req.Pool.BlacklistDuration); err == nil {
					nextCfg.Pool.BlacklistDuration = d
				}
			}
		}
		if req.Management != nil {
			nextCfg.Management.Listen = req.Management.Listen
			nextCfg.Management.Password = req.Management.Password
			if req.Management.HealthCheckInterval != "" {
				if d, err := time.ParseDuration(req.Management.HealthCheckInterval); err == nil && d > 0 {
					nextCfg.Management.HealthCheckInterval = d
				}
			}
			nextCfg.Management.HealthCheckConcurrency = req.Management.HealthCheckConcurrency
			if nextCfg.Management.HealthCheckConcurrency <= 0 {
				nextCfg.Management.HealthCheckConcurrency = config.DefaultHealthCheckConcurrency()
			}
			nextCfg.Management.InitialCheckConcurrency = req.Management.InitialCheckConcurrency
			if nextCfg.Management.InitialCheckConcurrency <= 0 {
				nextCfg.Management.InitialCheckConcurrency = config.DefaultInitialCheckConcurrency()
			}
		}
		if logCfg != nil {
			nextCfg.Log.Output = logCfg.Output
			if logCfg.MaxSize > 0 {
				nextCfg.Log.MaxSize = logCfg.MaxSize
			}
			if logCfg.MaxBackups > 0 {
				nextCfg.Log.MaxBackups = logCfg.MaxBackups
			}
			if logCfg.MaxAge > 0 {
				nextCfg.Log.MaxAge = logCfg.MaxAge
			}
			nextCfg.Log.Compress = logCfg.Compress
		}
		if req.GeoIP != nil {
			nextCfg.GeoIP.Enabled = req.GeoIP.Enabled
			nextCfg.GeoIP.DatabasePath = req.GeoIP.DatabasePath
			nextCfg.GeoIP.Listen = req.GeoIP.Listen
			nextCfg.GeoIP.Port = req.GeoIP.Port
			nextCfg.GeoIP.AutoUpdateEnabled = req.GeoIP.AutoUpdateEnabled
			nextCfg.GeoIP.DownloadProxies = cleanStringList(req.GeoIP.DownloadProxies)
			if req.GeoIP.AutoUpdateInterval != "" {
				if d, err := time.ParseDuration(req.GeoIP.AutoUpdateInterval); err == nil {
					nextCfg.GeoIP.AutoUpdateInterval = d
				}
			}
			if req.GeoIP.ExitIPProbeMode != "" {
				probeMode, ok := config.NormalizeExitIPProbeMode(req.GeoIP.ExitIPProbeMode)
				if !ok {
					s.cfgMu.Unlock()
					w.WriteHeader(http.StatusBadRequest)
					writeJSON(w, map[string]any{"error": "不支持的出口 IP 探测模式"})
					return
				}
				nextCfg.GeoIP.ExitIPProbeMode = probeMode
			}
			if req.GeoIP.ExitIPProbeInterval != "" {
				if d, err := time.ParseDuration(req.GeoIP.ExitIPProbeInterval); err == nil && d > 0 {
					nextCfg.GeoIP.ExitIPProbeInterval = d
				}
			}
			if nextCfg.GeoIP.Enabled && nextCfg.GeoIP.DatabasePath == "" {
				nextCfg.GeoIP.DatabasePath = "./GeoLite2-Country.mmdb"
				nextCfg.GeoIP.AutoUpdateEnabled = true
				nextCfg.GeoIP.AutoUpdateInterval = 24 * time.Hour
			}
		}
		if req.Update != nil {
			nextCfg.Update.Enabled = req.Update.Enabled
			nextCfg.Update.Channel = strings.ToLower(strings.TrimSpace(req.Update.Channel))
			if nextCfg.Update.Channel == "" {
				nextCfg.Update.Channel = "stable"
			}
			if nextCfg.Update.Channel != "stable" {
				nextCfg.Update.Channel = "dev"
			}
			if req.Update.CheckInterval != "" {
				if d, err := time.ParseDuration(req.Update.CheckInterval); err == nil && d > 0 {
					nextCfg.Update.CheckInterval = d
				}
			}
			nextCfg.Update.ProxyBaseURL = strings.TrimRight(strings.TrimSpace(req.Update.ProxyBaseURL), "/")
			nextCfg.Update.Repo = strings.TrimSpace(req.Update.Repo)
			nextCfg.Update.UseFastestNode = req.Update.UseFastestNode
			if nextCfg.Update.CheckInterval <= 0 {
				nextCfg.Update.CheckInterval = time.Hour
			}
			if nextCfg.Update.Repo == "" {
				nextCfg.Update.Repo = "lieyanc/easy-proxies"
			}
		}

		if err := nextCfg.ValidateManagementSecurity(); err != nil {
			s.cfgMu.Unlock()
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}
		if err := nextCfg.SaveSettings(); err != nil {
			s.cfgMu.Unlock()
			w.WriteHeader(http.StatusInternalServerError)
			writeJSON(w, map[string]any{"error": fmt.Sprintf("保存配置失败: %v", err)})
			return
		}

		*s.cfgSrc = nextCfg
		s.cfg.ExternalIP = nextCfg.ExternalIP
		s.cfg.ProbeTarget = nextCfg.Management.ProbeTarget
		s.cfg.SkipCertVerify = nextCfg.SkipCertVerify
		s.cfg.Password = nextCfg.Management.Password
		s.cfg.Listen = nextCfg.Management.Listen
		s.cfg.HealthCheckInterval = nextCfg.Management.HealthCheckInterval
		s.cfg.HealthCheckConcurrency = nextCfg.Management.HealthCheckConcurrency
		s.cfg.InitialCheckConcurrency = nextCfg.Management.InitialCheckConcurrency
		s.cfg.ExitIPProbeMode = nextCfg.GeoIP.ExitIPProbeMode
		s.cfg.ExitIPProbeInterval = nextCfg.GeoIP.ExitIPProbeInterval
		if s.mgr != nil {
			s.mgr.SetHealthCheckConcurrency(nextCfg.Management.HealthCheckConcurrency)
			s.mgr.SetInitialCheckConcurrency(nextCfg.Management.InitialCheckConcurrency)
			s.mgr.SetExitIPProbeMode(nextCfg.GeoIP.ExitIPProbeMode)
			s.mgr.SetExitIPProbeInterval(nextCfg.GeoIP.ExitIPProbeInterval)
		}
		if nextCfg.Mode == "multi-port" || nextCfg.Mode == "hybrid" {
			s.cfg.ProxyUsername = nextCfg.MultiPort.Username
			s.cfg.ProxyPassword = nextCfg.MultiPort.Password
		} else {
			s.cfg.ProxyUsername = nextCfg.Listener.Username
			s.cfg.ProxyPassword = nextCfg.Listener.Password
		}
		s.cfgMu.Unlock()
		if req.Update != nil && nextCfg.Update.Enabled && s.updater != nil {
			s.updater.StartBackground(context.Background())
		}

		writeJSON(w, map[string]any{
			"message":          "设置已保存",
			"external_ip":      extIP,
			"probe_target":     probeTarget,
			"skip_cert_verify": req.SkipCertVerify,
			"need_reload":      true,
		})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	info := version.Info()
	s.cfgMu.RLock()
	if s.cfgSrc != nil {
		info["update_channel"] = s.cfgSrc.Update.Channel
		info["update_repo"] = s.cfgSrc.Update.Repo
	}
	s.cfgMu.RUnlock()
	writeJSON(w, map[string]any{"version": info})
}

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.updater == nil {
		writeJSON(w, map[string]any{"enabled": false, "message": "OTA 更新未启用"})
		return
	}
	writeJSON(w, map[string]any{
		"enabled": true,
		"status":  s.updater.Status(),
	})
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.updater == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]any{"error": "OTA 更新未启用"})
		return
	}
	result, err := s.updater.CheckOnly(r.Context())
	if err != nil {
		writeJSON(w, map[string]any{
			"ok":     false,
			"result": result,
			"error":  err.Error(),
		})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "result": result})
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.updater == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]any{"error": "OTA 更新未启用"})
		return
	}
	status := s.updater.Status()
	if status.State == "ready" {
		if err := s.updater.ApplyPending(r.Context()); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"ok": true, "status": "applying"})
		return
	}
	if status.State == "checking" || status.State == "downloading" || status.State == "applying" {
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]any{"error": "更新已在进行中"})
		return
	}
	s.updater.StartUpdate(r.Context())
	writeJSON(w, map[string]any{"ok": true, "status": "update_started"})
}

func (s *Server) handleUpdateDismiss(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.updater == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]any{"error": "OTA 更新未启用"})
		return
	}
	s.updater.DismissPending()
	writeJSON(w, map[string]any{"ok": true})
}

// handleSubscriptionStatus returns the current subscription refresh status.
func (s *Server) handleSubscriptionStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if s.subRefresher == nil {
		writeJSON(w, map[string]any{
			"enabled": false,
			"message": "订阅刷新未启用",
		})
		return
	}

	status := s.subRefresher.Status()
	writeJSON(w, map[string]any{
		"enabled":        true,
		"last_refresh":   status.LastRefresh,
		"next_refresh":   status.NextRefresh,
		"node_count":     status.NodeCount,
		"last_error":     status.LastError,
		"refresh_count":  status.RefreshCount,
		"is_refreshing":  status.IsRefreshing,
		"nodes_modified": status.NodesModified,
	})
}

// handleSubscriptionRefresh triggers an immediate subscription refresh.
func (s *Server) handleSubscriptionRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if s.subRefresher == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]any{"error": "订阅刷新未启用"})
		return
	}

	if err := s.subRefresher.RefreshNow(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}

	status := s.subRefresher.Status()
	writeJSON(w, map[string]any{
		"message":    "刷新成功",
		"node_count": status.NodeCount,
	})
}

// handleSubscriptionConfig handles GET/PUT for subscription configuration.
func (s *Server) handleSubscriptionConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.cfgMu.RLock()
		var urls []string
		var enabled bool
		var interval string
		if s.cfgSrc != nil {
			urls = s.cfgSrc.Subscriptions
			enabled = s.cfgSrc.SubscriptionRefresh.Enabled
			interval = s.cfgSrc.SubscriptionRefresh.Interval.String()
		}
		s.cfgMu.RUnlock()
		writeJSON(w, map[string]any{
			"subscriptions": urls,
			"enabled":       enabled,
			"interval":      interval,
		})

	case http.MethodPut:
		var req struct {
			Subscriptions []string `json:"subscriptions"`
			Enabled       bool     `json:"enabled"`
			Interval      string   `json:"interval"` // e.g. "1h", "30m"
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{"error": "请求格式错误"})
			return
		}

		// Parse interval
		interval, err := time.ParseDuration(req.Interval)
		if err != nil || interval < 5*time.Minute {
			interval = 1 * time.Hour // default
		}

		// Clean URLs
		var cleanURLs []string
		for _, u := range req.Subscriptions {
			u = strings.TrimSpace(u)
			if u != "" {
				cleanURLs = append(cleanURLs, u)
			}
		}

		s.cfgMu.Lock()
		if s.cfgSrc == nil {
			s.cfgMu.Unlock()
			w.WriteHeader(http.StatusInternalServerError)
			writeJSON(w, map[string]any{"error": "配置存储未初始化"})
			return
		}
		nextCfg := *s.cfgSrc
		nextCfg.Subscriptions = cleanURLs
		nextCfg.SubscriptionRefresh.Enabled = req.Enabled
		nextCfg.SubscriptionRefresh.Interval = interval
		if err := nextCfg.SaveSettings(); err != nil {
			s.cfgMu.Unlock()
			w.WriteHeader(http.StatusInternalServerError)
			writeJSON(w, map[string]any{"error": fmt.Sprintf("保存配置失败: %v", err)})
			return
		}
		*s.cfgSrc = nextCfg
		s.cfgMu.Unlock()

		// Hot-reload subscription manager and wait for refresh to complete
		if s.subRefresher != nil {
			if err := s.subRefresher.UpdateConfigAndRefresh(cleanURLs, req.Enabled, interval); err != nil {
				// Config was saved but refresh failed — report partial success
				writeJSON(w, map[string]any{
					"message":       fmt.Sprintf("订阅配置已保存，但刷新失败: %v", err),
					"subscriptions": cleanURLs,
					"enabled":       req.Enabled,
					"interval":      interval.String(),
					"refresh_error": err.Error(),
				})
				return
			}
		}

		nodeCount := 0
		if s.subRefresher != nil {
			nodeCount = s.subRefresher.Status().NodeCount
		}
		writeJSON(w, map[string]any{
			"message":       "订阅配置已更新并生效",
			"subscriptions": cleanURLs,
			"enabled":       req.Enabled,
			"interval":      interval.String(),
			"node_count":    nodeCount,
		})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// nodePayload is the JSON request body for node CRUD operations.
type nodePayload struct {
	Name     string `json:"name"`
	URI      string `json:"uri"`
	Port     uint16 `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func (p nodePayload) toConfig() config.NodeConfig {
	return config.NodeConfig{
		Name:     p.Name,
		URI:      p.URI,
		Port:     p.Port,
		Username: p.Username,
		Password: p.Password,
	}
}

type warpRegisterPayload struct {
	Name         string `json:"name"`
	Endpoint     string `json:"endpoint"`
	EndpointPort uint16 `json:"endpoint_port"`
}

// handleWarpRegister registers one ordinary Cloudflare WARP device, stores it
// as a warp:// node, and reloads the proxy core. It deliberately does not
// implement Gool Pair/WARP-in-WARP.
func (s *Server) handleWarpRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !s.ensureNodeManager(w) {
		return
	}
	if s.warpRegistrar == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]any{"error": "WARP 注册服务未启用"})
		return
	}

	var payload warpRegisterPayload
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "请求格式错误: " + err.Error()})
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	if payload.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "WARP 节点名称不能为空"})
		return
	}

	account, err := s.warpRegistrar.Register(r.Context(), payload.Name, payload.Endpoint, payload.EndpointPort)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		writeJSON(w, map[string]any{"error": err.Error()})
		return
	}
	cleanupRemote := func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := s.warpRegistrar.Delete(cleanupCtx, account.ID, account.Token); err != nil {
			s.logger.Printf("WARP registration cleanup failed for %s: %v", account.ID, err)
		}
	}

	uri, err := account.URI()
	if err != nil {
		cleanupRemote()
		w.WriteHeader(http.StatusInternalServerError)
		writeJSON(w, map[string]any{"error": "生成 WARP 节点失败: " + err.Error()})
		return
	}
	node, err := s.nodeMgr.CreateNode(r.Context(), config.NodeConfig{
		Name:   payload.Name,
		URI:    uri,
		Source: config.NodeSourceInline,
	})
	if err != nil {
		cleanupRemote()
		s.respondNodeError(w, err)
		return
	}
	if err := s.nodeMgr.TriggerReload(r.Context()); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		writeJSON(w, map[string]any{
			"error": "WARP 节点已注册并保存，但核心重载失败: " + err.Error(),
			"node":  node,
		})
		return
	}

	writeJSON(w, map[string]any{
		"node":    node,
		"message": "WARP 已注册并自动重载生效",
	})
}

// handleConfigNodes handles GET (list) and POST (create) for config nodes.
func (s *Server) handleConfigNodes(w http.ResponseWriter, r *http.Request) {
	if !s.ensureNodeManager(w) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		nodes, err := s.nodeMgr.ListConfigNodes(r.Context())
		if err != nil {
			s.respondNodeError(w, err)
			return
		}
		writeJSON(w, map[string]any{"nodes": nodes})
	case http.MethodPost:
		var payload nodePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{"error": "请求格式错误"})
			return
		}
		node, err := s.nodeMgr.CreateNode(r.Context(), payload.toConfig())
		if err != nil {
			s.respondNodeError(w, err)
			return
		}
		writeJSON(w, map[string]any{"node": node, "message": "节点已添加，请点击重载使配置生效"})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleConfigNodeItem handles PUT (update) and DELETE for a specific config node.
func (s *Server) handleConfigNodeItem(w http.ResponseWriter, r *http.Request) {
	if !s.ensureNodeManager(w) {
		return
	}

	namePart := strings.TrimPrefix(r.URL.Path, "/api/nodes/config/")
	nodeName, err := url.PathUnescape(namePart)
	if err != nil || nodeName == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "节点名称无效"})
		return
	}

	switch r.Method {
	case http.MethodPut:
		var payload nodePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{"error": "请求格式错误"})
			return
		}
		node, err := s.nodeMgr.UpdateNode(r.Context(), nodeName, payload.toConfig())
		if err != nil {
			s.respondNodeError(w, err)
			return
		}
		writeJSON(w, map[string]any{"node": node, "message": "节点已更新，请点击重载使配置生效"})
	case http.MethodDelete:
		if err := s.nodeMgr.DeleteNode(r.Context(), nodeName); err != nil {
			s.respondNodeError(w, err)
			return
		}
		writeJSON(w, map[string]any{"message": "节点已删除，请点击重载使配置生效"})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleReload triggers a configuration reload.
func (s *Server) handleReload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !s.ensureNodeManager(w) {
		return
	}

	if err := s.nodeMgr.TriggerReload(r.Context()); err != nil {
		s.respondNodeError(w, err)
		return
	}
	writeJSON(w, map[string]any{
		"message": "重载成功，现有连接已被中断",
	})
}

func (s *Server) ensureNodeManager(w http.ResponseWriter) bool {
	if s.nodeMgr == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]any{"error": "节点管理未启用"})
		return false
	}
	return true
}

func (s *Server) respondNodeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrNodeNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrNodeConflict), errors.Is(err, ErrInvalidNode):
		status = http.StatusBadRequest
	}
	w.WriteHeader(status)
	writeJSON(w, map[string]any{"error": err.Error()})
}

// handleTraffic streams real-time traffic from sing-box Clash API as SSE.
// Clash API /traffic returns newline-delimited JSON; we convert to SSE for browser EventSource.
func (s *Server) handleTraffic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	ch := s.trafficHub.subscribe()
	defer s.trafficHub.unsubscribe(ch)

	for {
		select {
		case <-r.Context().Done():
			return
		case line, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
		}
	}
}

// handleLogs returns recent console log content from the in-memory ring buffer.
func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	content := SharedLogBuffer.Content()
	writeJSON(w, map[string]any{"logs": content})
}

// Session management functions

// generateSessionToken creates a cryptographically secure random token.
func (s *Server) generateSessionToken() (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("failed to generate session token: %w", err)
	}
	return hex.EncodeToString(tokenBytes), nil
}

// createSession creates a new session with expiration.
func (s *Server) createSession() (*Session, error) {
	token, err := s.generateSessionToken()
	if err != nil {
		return nil, err
	}

	now := time.Now()
	session := &Session{
		Token:     token,
		CreatedAt: now,
		ExpiresAt: now.Add(s.sessionTTL),
	}

	s.sessionMu.Lock()
	s.sessions[token] = session
	s.sessionMu.Unlock()

	return session, nil
}

// validateSession checks if a session token is valid and not expired.
func (s *Server) validateSession(token string) bool {
	s.sessionMu.RLock()
	session, exists := s.sessions[token]
	s.sessionMu.RUnlock()

	if !exists {
		return false
	}

	// Check if expired
	if time.Now().After(session.ExpiresAt) {
		s.sessionMu.Lock()
		delete(s.sessions, token)
		s.sessionMu.Unlock()
		return false
	}

	return true
}

// cleanupExpiredSessions periodically removes expired sessions.
func (s *Server) cleanupExpiredSessions() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		s.sessionMu.Lock()
		for token, session := range s.sessions {
			if now.After(session.ExpiresAt) {
				delete(s.sessions, token)
			}
		}
		s.sessionMu.Unlock()
	}
}

// secureCompareStrings performs constant-time string comparison to prevent timing attacks.
func secureCompareStrings(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func cleanStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			cleaned = append(cleaned, value)
		}
	}
	return cleaned
}
