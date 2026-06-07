BINARY_NAME ?= easy-proxies
CMD ?= ./cmd/easy-proxies
CONFIG ?= config.yaml
BUILD_DIR ?= dist
INSTALL_DIR ?= /opt/easy-proxies
GOOS ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT ?= $(shell git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)
BUILD_TIME ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
TARGET ?= $(GOOS)-$(GOARCH)
OTA_BINARY ?= easy-proxies-$(TARGET)
VERSION_PKG ?= easy-proxies/internal/version
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
	cp $(BINARY_NAME) config.example.yaml nodes.example README.md README_ZH.md contrib/systemd/easy-proxies.service $(BUILD_DIR)/package/easy-proxies-$(VERSION)-$(TARGET)/
	cp config.example.yaml $(BUILD_DIR)/package/easy-proxies-$(VERSION)-$(TARGET)/config.yaml
	cp nodes.example $(BUILD_DIR)/package/easy-proxies-$(VERSION)-$(TARGET)/nodes.txt
	tar -C $(BUILD_DIR)/package -czf $(BUILD_DIR)/easy-proxies-$(TARGET).tar.gz easy-proxies-$(VERSION)-$(TARGET)
	(cd $(BUILD_DIR) && sha256sum easy-proxies-$(TARGET).tar.gz > easy-proxies-$(TARGET).tar.gz.sha256)
	rm -rf $(BUILD_DIR)/package

install: build
	install -d $(DESTDIR)$(INSTALL_DIR)
	install -m755 $(BINARY_NAME) $(DESTDIR)$(INSTALL_DIR)/easy-proxies
	@if [ ! -f "$(DESTDIR)$(INSTALL_DIR)/config.yaml" ]; then \
		install -m644 config.example.yaml "$(DESTDIR)$(INSTALL_DIR)/config.yaml"; \
	fi
	@if [ ! -f "$(DESTDIR)$(INSTALL_DIR)/nodes.txt" ]; then \
		install -m644 nodes.example "$(DESTDIR)$(INSTALL_DIR)/nodes.txt"; \
	fi
	install -d $(DESTDIR)$(INSTALL_DIR)/logs

install-systemd:
	install -Dm644 contrib/systemd/easy-proxies.service $(DESTDIR)/etc/systemd/system/easy-proxies.service

docker-build:
	docker build -t easy-proxies:local .
