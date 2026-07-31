package monitor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"

	"easy-proxies/internal/config"
	"easy-proxies/internal/warp"
)

type warpTestRegistrar struct {
	account     warp.Account
	registerErr error
	deleteCalls int
}

func (r *warpTestRegistrar) Register(context.Context, string, string, uint16) (warp.Account, error) {
	return r.account, r.registerErr
}

func (r *warpTestRegistrar) Delete(context.Context, string, string) error {
	r.deleteCalls++
	return nil
}

type warpTestNodeManager struct {
	created   config.NodeConfig
	createErr error
	reloaded  bool
}

func validWarpTestAccount(t *testing.T) warp.Account {
	t.Helper()
	privateKey, err := warp.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	peerKey, err := warp.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	return warp.Account{
		ID:            "device-id",
		Token:         "device-token",
		Name:          "WARP-01",
		PrivateKey:    privateKey.PrivateKey,
		PeerPublicKey: peerKey.PublicKey,
		Endpoint:      warp.DefaultEndpoint,
		EndpointPort:  warp.DefaultEndpointPort,
		IPv4:          "172.16.0.2/32",
		IPv6:          "2606:4700:110:8765::2/128",
		Reserved:      []uint8{1, 2, 3},
		MTU:           warp.DefaultMTU,
	}
}

func (m *warpTestNodeManager) ListConfigNodes(context.Context) ([]config.NodeConfig, error) {
	return nil, nil
}

func (m *warpTestNodeManager) CreateNode(_ context.Context, node config.NodeConfig) (config.NodeConfig, error) {
	if m.createErr != nil {
		return config.NodeConfig{}, m.createErr
	}
	m.created = node
	return node, nil
}

func (m *warpTestNodeManager) UpdateNode(context.Context, string, config.NodeConfig) (config.NodeConfig, error) {
	return config.NodeConfig{}, nil
}

func (m *warpTestNodeManager) DeleteNode(context.Context, string) error { return nil }

func (m *warpTestNodeManager) TriggerReload(context.Context) error {
	m.reloaded = true
	return nil
}

func TestHandleWarpRegisterCreatesNodeAndReloads(t *testing.T) {
	registrar := &warpTestRegistrar{account: validWarpTestAccount(t)}
	nodeManager := &warpTestNodeManager{}
	server := &Server{
		nodeMgr:       nodeManager,
		warpRegistrar: registrar,
		logger:        log.New(io.Discard, "", 0),
	}

	req := httptest.NewRequest(http.MethodPost, "/api/warp/register", bytes.NewBufferString(
		`{"name":"WARP-01","endpoint":"engage.cloudflareclient.com","endpoint_port":2408}`,
	))
	resp := httptest.NewRecorder()
	server.handleWarpRegister(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", resp.Code, resp.Body.String())
	}
	if nodeManager.created.Name != "WARP-01" || !config.IsProxyURI(nodeManager.created.URI) {
		t.Fatalf("unexpected created node: %+v", nodeManager.created)
	}
	if nodeManager.created.Source != config.NodeSourceInline {
		t.Fatalf("source = %q, want inline", nodeManager.created.Source)
	}
	if _, err := warp.ParseURI(nodeManager.created.URI); err != nil {
		t.Fatalf("created URI is invalid: %v", err)
	}
	if !nodeManager.reloaded {
		t.Fatal("expected core reload")
	}
	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["message"] == "" {
		t.Fatalf("missing success message: %v", body)
	}
}

func TestHandleWarpRegisterCleansUpRemoteAccountWhenNodeCreateFails(t *testing.T) {
	registrar := &warpTestRegistrar{account: validWarpTestAccount(t)}
	server := &Server{
		nodeMgr:       &warpTestNodeManager{createErr: ErrNodeConflict},
		warpRegistrar: registrar,
		logger:        log.New(io.Discard, "", 0),
	}
	req := httptest.NewRequest(http.MethodPost, "/api/warp/register", bytes.NewBufferString(`{"name":"duplicate"}`))
	resp := httptest.NewRecorder()
	server.handleWarpRegister(resp, req)

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", resp.Code, resp.Body.String())
	}
	if registrar.deleteCalls != 1 {
		t.Fatalf("delete calls = %d, want 1", registrar.deleteCalls)
	}
}

func TestHandleWarpRegisterReportsRegistrationFailure(t *testing.T) {
	server := &Server{
		nodeMgr:       &warpTestNodeManager{},
		warpRegistrar: &warpTestRegistrar{registerErr: errors.New("rate limited")},
		logger:        log.New(io.Discard, "", 0),
	}
	req := httptest.NewRequest(http.MethodPost, "/api/warp/register", bytes.NewBufferString(`{"name":"WARP-01"}`))
	resp := httptest.NewRecorder()
	server.handleWarpRegister(resp, req)

	if resp.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", resp.Code, resp.Body.String())
	}
}
