package warp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientRegister(t *testing.T) {
	peerKey := testKey(9)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/reg" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("CF-Client-Version") != clientVersion {
			t.Fatalf("missing client version header")
		}
		var request registerRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if err := validateWireGuardKey("generated public key", request.Key); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "device-id", "token": "device-token",
			"config": map[string]any{
				"client_id": base64.StdEncoding.EncodeToString([]byte{7, 8, 9}),
				"peers":     []map[string]any{{"public_key": peerKey}},
				"interface": map[string]any{"addresses": map[string]string{
					"v4": "172.16.0.2", "v6": "2606:4700:110:8c4f:1::2",
				}},
			},
		})
	}))
	defer server.Close()

	client := NewClientWithHTTP(server.Client(), server.URL+"/reg")
	account, err := client.Register(context.Background(), "test warp", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if account.ID != "device-id" || account.Token != "device-token" || account.PeerPublicKey != peerKey {
		t.Fatalf("unexpected account: %#v", account)
	}
	if account.IPv4 != "172.16.0.2/32" || account.IPv6 != "2606:4700:110:8c4f:1::2/128" {
		t.Fatalf("addresses not normalized: %#v", account)
	}
	if got := formatReserved(account.Reserved); got != "7,8,9" {
		t.Fatalf("reserved = %s", got)
	}
	if _, err := account.URI(); err != nil {
		t.Fatalf("registered account did not encode: %v", err)
	}
}

func TestClientRegisterRejectsInsecureRemoteAPI(t *testing.T) {
	client := NewClientWithHTTP(http.DefaultClient, "http://api.cloudflareclient.com/reg")
	if _, err := client.Register(context.Background(), "test", "", 0); err == nil {
		t.Fatal("expected insecure API URL error")
	}
}

func TestClientRegisterValidatesResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":"id","token":"token","config":{"client_id":"AQI=","peers":[]}}`))
	}))
	defer server.Close()
	client := NewClientWithHTTP(server.Client(), server.URL)
	if _, err := client.Register(context.Background(), "test", "", 0); err == nil {
		t.Fatal("expected malformed response error")
	}
}
