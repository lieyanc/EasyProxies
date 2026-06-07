package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"easy-proxies/internal/app"
	"easy-proxies/internal/config"
	"easy-proxies/internal/monitor"
	"easy-proxies/internal/version"

	"gopkg.in/natefinch/lumberjack.v2"
)

func main() {
	var configPath string
	var showVersion bool
	flag.StringVar(&configPath, "config", "", "path to config file (default: config.yaml next to executable)")
	flag.BoolVar(&showVersion, "version", false, "print version and exit")
	flag.Parse()

	if showVersion {
		fmt.Printf("easy-proxies %s (commit=%s, built=%s)\n", version.Version, version.Commit, version.BuildTime)
		return
	}
	if configPath == "" {
		configPath = defaultConfigPath()
	}

	var cfg *config.Config
	for attempt := 1; attempt <= 3; attempt++ {
		var err error
		cfg, err = config.Load(configPath)
		if err == nil {
			break
		}
		if attempt < 3 && strings.Contains(err.Error(), "config.nodes cannot be empty") {
			log.Printf("⚠️  Attempt %d/3: %v (retrying in %ds...)", attempt, err, attempt*10)
			time.Sleep(time.Duration(attempt*10) * time.Second)
			continue
		}
		log.Fatalf("load config: %v", err)
	}

	// Setup logging based on config
	setupLogging(cfg)
	log.Printf("easy-proxies %s (commit=%s, built=%s)", version.Version, version.Commit, version.BuildTime)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := app.Run(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "proxy pool exited with error: %v\n", err)
		os.Exit(1)
	}
}

func defaultConfigPath() string {
	exePath, err := os.Executable()
	if err != nil {
		return "config.yaml"
	}
	if resolved, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolved
	}
	return filepath.Join(filepath.Dir(exePath), "config.yaml")
}

func setupLogging(cfg *config.Config) {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)

	// Always include the in-memory ring buffer for dashboard console
	writers := []io.Writer{os.Stdout, monitor.LogWriter()}

	if cfg.Log.Output == "file" {
		// Ensure log directory exists
		logDir := filepath.Dir(cfg.Log.File)
		if err := os.MkdirAll(logDir, 0o755); err != nil {
			log.Printf("\u26a0\ufe0f Failed to create log dir %s: %v, falling back to stdout", logDir, err)
		} else {
			lj := &lumberjack.Logger{
				Filename:   cfg.Log.File,
				MaxSize:    cfg.Log.MaxSize, // MB
				MaxBackups: cfg.Log.MaxBackups,
				MaxAge:     cfg.Log.MaxAge, // days
				Compress:   cfg.Log.Compress,
			}
			writers = append(writers, lj)
			log.Printf("\u2705 Log rotation enabled: file=%s, maxSize=%dMB, maxBackups=%d, maxAge=%dd",
				cfg.Log.File, cfg.Log.MaxSize, cfg.Log.MaxBackups, cfg.Log.MaxAge)
		}
	}

	log.SetOutput(io.MultiWriter(writers...))
}
