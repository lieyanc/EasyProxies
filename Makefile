BINARY_NAME ?= easy_proxies
CMD ?= ./cmd/easy_proxies
CONFIG ?= config.yaml
BUILD_DIR ?= dist
PREFIX ?= /usr/local
SYSCONFDIR ?= /etc/easy_proxies
GOOS ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT ?= $(shell git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)
BUILD_TIME ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
TARGET ?= $(GOOS)-$(GOARCH)
OTA_BINARY ?= easy-proxies-$(TARGET)
VERSION_PKG ?= easy_proxies/internal/version
BUILD_TAGS ?= with_utls with_quic with_grpc with_wireguard with_gvisor with_clash_api
LDFLAGS ?= -s -w -X $(VERSION_PKG).Version=$(VERSION) -X $(VERSION_PKG).Commit=$(COMMIT) -X $(VERSION_PKG).BuildTime=$(BUILD_TIME)

.PHONY: all build run test clean package install install-systemd docker-build

all: build

build:
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -trimpath -tags "$(BUILD_TAGS)" -ldflags "$(LDFLAGS)" -o $(BINARY_NAME) $(CMD)

run: build
	./$(BINARY_NAME) -config $(CONFIG)

test:
	go test ./...

clean:
	rm -f $(BINARY_NAME)
	rm -rf $(BUILD_DIR)

package: build
	mkdir -p $(BUILD_DIR)
	cp $(BINARY_NAME) $(BUILD_DIR)/$(OTA_BINARY)
	(cd $(BUILD_DIR) && sha256sum $(OTA_BINARY) > $(OTA_BINARY).sha256)
	rm -rf $(BUILD_DIR)/package
	mkdir -p $(BUILD_DIR)/package/easy-proxies-$(VERSION)-$(TARGET)
	cp $(BINARY_NAME) config.example.yaml nodes.example README.md README_ZH.md contrib/systemd/easy_proxies.service $(BUILD_DIR)/package/easy-proxies-$(VERSION)-$(TARGET)/
	tar -C $(BUILD_DIR)/package -czf $(BUILD_DIR)/easy-proxies-$(TARGET).tar.gz easy-proxies-$(VERSION)-$(TARGET)
	(cd $(BUILD_DIR) && sha256sum easy-proxies-$(TARGET).tar.gz > easy-proxies-$(TARGET).tar.gz.sha256)
	rm -rf $(BUILD_DIR)/package

install: build
	install -Dm755 $(BINARY_NAME) $(DESTDIR)$(PREFIX)/bin/easy_proxies
	install -d $(DESTDIR)$(SYSCONFDIR)
	@if [ ! -f "$(DESTDIR)$(SYSCONFDIR)/config.yaml" ]; then \
		install -m644 config.example.yaml "$(DESTDIR)$(SYSCONFDIR)/config.yaml"; \
	fi
	@if [ ! -f "$(DESTDIR)$(SYSCONFDIR)/nodes.txt" ]; then \
		install -m644 nodes.example "$(DESTDIR)$(SYSCONFDIR)/nodes.txt"; \
	fi

install-systemd:
	install -Dm644 contrib/systemd/easy_proxies.service $(DESTDIR)/etc/systemd/system/easy_proxies.service

docker-build:
	docker build -t easy-proxies:local .
