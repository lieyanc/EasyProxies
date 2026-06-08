package monitor

import "context"

type contextKey string

const managerKey contextKey = "easy-proxies.monitor"
const probeReasonKey contextKey = "easy-proxies.probe-reason"

type ProbeReason string

const (
	ProbeReasonPeriodic            ProbeReason = "periodic"
	ProbeReasonSubscriptionRefresh ProbeReason = "subscription_refresh"
)

// ContextWith attaches the manager into context so downstream components can reuse it.
func ContextWith(ctx context.Context, mgr *Manager) context.Context {
	if mgr == nil {
		return ctx
	}
	return context.WithValue(ctx, managerKey, mgr)
}

// FromContext extracts a manager if present.
func FromContext(ctx context.Context) *Manager {
	mgr, _ := ctx.Value(managerKey).(*Manager)
	return mgr
}

// ContextWithProbeReason marks why a probe was launched.
func ContextWithProbeReason(ctx context.Context, reason ProbeReason) context.Context {
	if ctx == nil || reason == "" {
		return ctx
	}
	return context.WithValue(ctx, probeReasonKey, reason)
}

// ProbeReasonFromContext extracts the probe launch reason.
func ProbeReasonFromContext(ctx context.Context) ProbeReason {
	if ctx == nil {
		return ""
	}
	reason, _ := ctx.Value(probeReasonKey).(ProbeReason)
	return reason
}
