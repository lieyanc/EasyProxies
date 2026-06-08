package pool

import (
	"context"
	"net"
	"sync"

	M "github.com/sagernet/sing/common/metadata"
)

// NetDialer provides standard Go net.Conn dialing through a pool outbound.
type NetDialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

var dialerRegistry sync.Map // map[string]NetDialer

// poolDialerAdapter wraps a poolOutbound to satisfy NetDialer.
type poolDialerAdapter struct {
	pool         *poolOutbound
	modeOverride string
}

func (a *poolDialerAdapter) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	dest := M.ParseSocksaddr(address)
	return a.pool.dialContext(ctx, network, dest, a.modeOverride)
}

// registerDialer adds a pool outbound to the global dialer registry.
func registerDialer(tag string, p *poolOutbound) {
	dialerRegistry.Store(tag, &poolDialerAdapter{pool: p})
}

// GetDialer returns a NetDialer for the given pool tag.
func GetDialer(tag string) (NetDialer, bool) {
	v, ok := dialerRegistry.Load(tag)
	if !ok {
		return nil, false
	}
	return v.(NetDialer), true
}

// GetFastestDialer returns a dialer that forces lowest-latency member selection
// for each request without changing the pool's configured mode.
func GetFastestDialer(tag string) (NetDialer, bool) {
	v, ok := dialerRegistry.Load(tag)
	if !ok {
		return nil, false
	}
	adapter, ok := v.(*poolDialerAdapter)
	if !ok || adapter.pool == nil {
		return nil, false
	}
	return &poolDialerAdapter{pool: adapter.pool, modeOverride: modeLatency}, true
}

// ResetDialerRegistry clears the dialer registry (called during config reload).
func ResetDialerRegistry() {
	dialerRegistry.Range(func(key, _ any) bool {
		dialerRegistry.Delete(key)
		return true
	})
}
