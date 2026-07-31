package subscription

import (
	"testing"

	"easy-proxies/internal/config"
)

func TestMergeSubscriptionNodesPreservesInlineWARP(t *testing.T) {
	current := []config.NodeConfig{
		{Name: "WARP-01", URI: "warp://private@example.com:2408#WARP-01", Source: config.NodeSourceInline},
		{Name: "old-sub", URI: "socks5://old:1080", Source: config.NodeSourceSubscription},
	}
	incoming := []config.NodeConfig{{Name: "new-sub", URI: "socks5://new:1080"}}

	merged := mergeSubscriptionNodes(current, incoming)
	if len(merged) != 2 {
		t.Fatalf("len = %d, want 2: %+v", len(merged), merged)
	}
	if merged[0].Name != "WARP-01" || merged[0].Source != config.NodeSourceInline {
		t.Fatalf("inline node was not preserved: %+v", merged)
	}
	if merged[1].Name != "new-sub" || merged[1].Source != config.NodeSourceSubscription {
		t.Fatalf("subscription node was not replaced/tagged: %+v", merged)
	}
}
