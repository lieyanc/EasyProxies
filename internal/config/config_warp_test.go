package config

import "testing"

func TestIsProxyURIRecognizesWARP(t *testing.T) {
	if !IsProxyURI("warp://private-key@example.com:2408?peer_public_key=peer") {
		t.Fatal("warp URI was not recognized")
	}
	if !IsProxyURI("WARP://private-key@example.com:2408") {
		t.Fatal("uppercase warp URI was not recognized")
	}
}
