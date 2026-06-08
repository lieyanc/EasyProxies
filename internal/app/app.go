package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"easy-proxies/internal/boxmgr"
	"easy-proxies/internal/config"
	"easy-proxies/internal/monitor"
	"easy-proxies/internal/outbound/pool"
	"easy-proxies/internal/subscription"
	"easy-proxies/internal/updater"
)

// Run builds the runtime components from config and blocks until shutdown.
func Run(ctx context.Context, cfg *config.Config) error {
	// Build monitor config
	proxyUsername := cfg.Listener.Username
	proxyPassword := cfg.Listener.Password
	if cfg.Mode == "multi-port" || cfg.Mode == "hybrid" {
		proxyUsername = cfg.MultiPort.Username
		proxyPassword = cfg.MultiPort.Password
	}

	monitorCfg := monitor.Config{
		Enabled:                cfg.ManagementEnabled(),
		Listen:                 cfg.Management.Listen,
		ProbeTarget:            cfg.Management.ProbeTarget,
		HealthCheckInterval:    cfg.Management.HealthCheckInterval,
		HealthCheckConcurrency: cfg.Management.HealthCheckConcurrency,
		Password:               cfg.Management.Password,
		ProxyUsername:          proxyUsername,
		ProxyPassword:          proxyPassword,
		ExternalIP:             cfg.ExternalIP,
		ExitIPProbeMode:        cfg.GeoIP.ExitIPProbeMode,
		ExitIPProbeInterval:    cfg.GeoIP.ExitIPProbeInterval,
	}

	// Create and start BoxManager
	boxMgr := boxmgr.New(cfg, monitorCfg)
	if err := boxMgr.Start(ctx); err != nil {
		return fmt.Errorf("start box manager: %w", err)
	}
	defer boxMgr.Close()

	// Wire up config to monitor server for settings API
	if server := boxMgr.MonitorServer(); server != nil {
		server.SetConfig(cfg)
	}

	// Always create SubscriptionManager so WebUI can hot-reload subscription config
	subMgr := subscription.New(cfg, boxMgr)
	defer subMgr.Stop()

	// Start refresh loop only if subscriptions are already configured
	if cfg.SubscriptionRefresh.Enabled && len(cfg.Subscriptions) > 0 {
		subMgr.Start()
	}

	// Wire up subscription manager to monitor server for API endpoints
	if server := boxMgr.MonitorServer(); server != nil {
		server.SetSubscriptionRefresher(subMgr)
	}

	var updateShutdownOnce sync.Once
	updateShutdown := func(tag string) error {
		var closeErr error
		updateShutdownOnce.Do(func() {
			fmt.Printf("Preparing OTA restart for %s...\n", tag)
			if subMgr != nil {
				subMgr.Stop()
			}
			closeErr = boxMgr.Close()
		})
		return closeErr
	}
	upd := updater.New(
		func() updater.Config { return updaterConfig(cfg.Update) },
		func() string { return cfg.ConfigDir() },
		log.Default(),
		updater.RestartHooks{
			BeforeExec: updateShutdown,
			OnExecFailure: func(err error) {
				log.Printf("update: restart failed: %v", err)
			},
		},
	)
	upd.SetDialerProvider(func(tag string, fastest bool) (updater.NetDialer, bool) {
		if fastest {
			return pool.GetFastestDialer(tag)
		}
		return pool.GetDialer(tag)
	})
	if server := boxMgr.MonitorServer(); server != nil {
		server.SetUpdater(upd)
	}
	upd.StartBackground(ctx)

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	select {
	case <-ctx.Done():
		fmt.Println("Context cancelled, initiating graceful shutdown...")
	case sig := <-sigCh:
		fmt.Printf("Received %s, initiating graceful shutdown...\n", sig)
	}

	// Create shutdown context with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Graceful shutdown sequence
	fmt.Println("Stopping subscription manager...")
	if subMgr != nil {
		subMgr.Stop()
	}

	fmt.Println("Stopping box manager...")
	if err := boxMgr.Close(); err != nil {
		fmt.Printf("Error closing box manager: %v\n", err)
	}

	// Wait for connections to drain
	fmt.Println("Waiting for connections to drain...")
	select {
	case <-time.After(2 * time.Second):
		fmt.Println("Graceful shutdown completed")
	case <-shutdownCtx.Done():
		fmt.Println("Shutdown timeout exceeded, forcing exit")
	}

	return nil
}

func updaterConfig(cfg config.UpdateConfig) updater.Config {
	return updater.Config{
		Enabled:        cfg.Enabled,
		Channel:        cfg.Channel,
		CheckInterval:  cfg.CheckInterval,
		ProxyBaseURL:   cfg.ProxyBaseURL,
		Repo:           cfg.Repo,
		UseFastestNode: cfg.UseFastestNode,
		ProxyDialerTag: pool.Tag,
	}
}
