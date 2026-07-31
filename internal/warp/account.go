package warp

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultEndpoint     = "engage.cloudflareclient.com"
	DefaultEndpointPort = uint16(2408)
	DefaultMTU          = uint32(1280)
)

// Account contains the credentials required by a single Cloudflare WARP
// WireGuard tunnel. Registration metadata is retained for callers that want
// to manage the Cloudflare device later, but is intentionally not serialized
// into proxy URIs.
type Account struct {
	ID            string
	Name          string
	PrivateKey    string
	PublicKey     string
	PeerPublicKey string
	Endpoint      string
	EndpointPort  uint16
	IPv4          string
	IPv6          string
	Reserved      []uint8
	MTU           uint32
	Token         string
	CreatedAt     time.Time
}

// URI encodes the account as a warp:// proxy URI.
func (a Account) URI() (string, error) {
	return EncodeURI(a)
}

// EncodeURI produces:
//
//	warp://PRIVATE_KEY@endpoint:port?peer_public_key=KEY&ipv4=PREFIX&ipv6=PREFIX&reserved=A,B,C&mtu=1280#name
//
// ID, token and the generated public key are registration metadata and are
// not needed to establish the tunnel, so they are not included.
func EncodeURI(account Account) (string, error) {
	account = withDefaults(account)
	if err := ValidateAccount(account); err != nil {
		return "", err
	}

	query := make(url.Values)
	query.Set("peer_public_key", account.PeerPublicKey)
	query.Set("ipv4", account.IPv4)
	if account.IPv6 != "" {
		query.Set("ipv6", account.IPv6)
	}
	query.Set("reserved", formatReserved(account.Reserved))
	query.Set("mtu", strconv.FormatUint(uint64(account.MTU), 10))

	u := &url.URL{
		Scheme:   "warp",
		User:     url.User(account.PrivateKey),
		Host:     net.JoinHostPort(account.Endpoint, strconv.Itoa(int(account.EndpointPort))),
		RawQuery: query.Encode(),
		Fragment: account.Name,
	}
	return u.String(), nil
}

// ParseURI decodes and validates a warp:// URI.
func ParseURI(rawURI string) (Account, error) {
	u, err := url.Parse(strings.TrimSpace(rawURI))
	if err != nil {
		return Account{}, fmt.Errorf("parse warp uri: %w", err)
	}
	if !strings.EqualFold(u.Scheme, "warp") {
		return Account{}, fmt.Errorf("invalid warp uri scheme %q", u.Scheme)
	}
	if u.User == nil || u.User.Username() == "" {
		return Account{}, errors.New("warp uri missing private key")
	}
	if _, hasPassword := u.User.Password(); hasPassword {
		return Account{}, errors.New("warp uri userinfo must contain only the private key")
	}
	if u.Path != "" {
		return Account{}, errors.New("warp uri must not contain a path")
	}

	port := DefaultEndpointPort
	if rawPort := u.Port(); rawPort != "" {
		parsedPort, err := strconv.ParseUint(rawPort, 10, 16)
		if err != nil || parsedPort == 0 {
			return Account{}, fmt.Errorf("invalid warp endpoint port %q", rawPort)
		}
		port = uint16(parsedPort)
	}

	query := u.Query()
	mtu := DefaultMTU
	if rawMTU := query.Get("mtu"); rawMTU != "" {
		parsedMTU, err := strconv.ParseUint(rawMTU, 10, 32)
		if err != nil || parsedMTU < 576 || parsedMTU > 65535 {
			return Account{}, fmt.Errorf("invalid warp mtu %q", rawMTU)
		}
		mtu = uint32(parsedMTU)
	}
	reserved, err := parseReserved(query.Get("reserved"))
	if err != nil {
		return Account{}, err
	}

	account := Account{
		Name:          u.Fragment,
		PrivateKey:    u.User.Username(),
		PeerPublicKey: query.Get("peer_public_key"),
		Endpoint:      u.Hostname(),
		EndpointPort:  port,
		IPv4:          query.Get("ipv4"),
		IPv6:          query.Get("ipv6"),
		Reserved:      reserved,
		MTU:           mtu,
	}
	if err := ValidateAccount(account); err != nil {
		return Account{}, err
	}
	return account, nil
}

// ValidateAccount verifies all values consumed by the WireGuard outbound.
func ValidateAccount(account Account) error {
	if err := validateWireGuardKey("private key", account.PrivateKey); err != nil {
		return err
	}
	if err := validateWireGuardKey("peer public key", account.PeerPublicKey); err != nil {
		return err
	}
	if err := validateEndpoint(account.Endpoint); err != nil {
		return err
	}
	if account.EndpointPort == 0 {
		return errors.New("warp endpoint port must not be zero")
	}
	if _, err := parseAddress(account.IPv4, false); err != nil {
		return fmt.Errorf("invalid warp IPv4 address: %w", err)
	}
	if account.IPv6 != "" {
		if _, err := parseAddress(account.IPv6, true); err != nil {
			return fmt.Errorf("invalid warp IPv6 address: %w", err)
		}
	}
	if len(account.Reserved) != 3 {
		return fmt.Errorf("warp reserved must contain exactly 3 bytes, got %d", len(account.Reserved))
	}
	if account.MTU < 576 || account.MTU > 65535 {
		return fmt.Errorf("warp mtu must be between 576 and 65535, got %d", account.MTU)
	}
	return nil
}

func withDefaults(account Account) Account {
	account.Endpoint = strings.TrimSpace(account.Endpoint)
	if account.Endpoint == "" {
		account.Endpoint = DefaultEndpoint
	}
	if account.EndpointPort == 0 {
		account.EndpointPort = DefaultEndpointPort
	}
	if account.MTU == 0 {
		account.MTU = DefaultMTU
	}
	account.IPv4 = ensureCIDR(strings.TrimSpace(account.IPv4), "/32")
	account.IPv6 = ensureCIDR(strings.TrimSpace(account.IPv6), "/128")
	return account
}

func validateWireGuardKey(label, key string) error {
	decoded, err := decodeBase64(key)
	if err != nil {
		return fmt.Errorf("invalid warp %s: %w", label, err)
	}
	if len(decoded) != 32 {
		return fmt.Errorf("invalid warp %s: expected 32 bytes, got %d", label, len(decoded))
	}
	return nil
}

func decodeBase64(value string) ([]byte, error) {
	// sing-box 1.12's WireGuard implementation decodes keys with
	// base64.StdEncoding, so reject raw/URL-safe variants here instead of
	// accepting a URI that will fail only when the core initializes.
	return base64.StdEncoding.DecodeString(value)
}

func validateEndpoint(endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return errors.New("warp endpoint must not be empty")
	}
	if addr, err := netip.ParseAddr(endpoint); err == nil {
		if addr.IsUnspecified() {
			return errors.New("warp endpoint must not be unspecified")
		}
		return nil
	}
	if len(endpoint) > 253 || strings.ContainsAny(endpoint, " /\\\t\r\n:") {
		return fmt.Errorf("invalid warp endpoint %q", endpoint)
	}
	labels := strings.Split(endpoint, ".")
	for _, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return fmt.Errorf("invalid warp endpoint %q", endpoint)
		}
		for _, ch := range label {
			if (ch < 'a' || ch > 'z') && (ch < 'A' || ch > 'Z') && (ch < '0' || ch > '9') && ch != '-' {
				return fmt.Errorf("invalid warp endpoint %q", endpoint)
			}
		}
	}
	return nil
}

func parseAddress(raw string, wantIPv6 bool) (netip.Prefix, error) {
	prefix, err := netip.ParsePrefix(raw)
	if err != nil {
		return netip.Prefix{}, err
	}
	if prefix.Addr().Is6() != wantIPv6 {
		return netip.Prefix{}, errors.New("wrong address family")
	}
	wantBits := 32
	if wantIPv6 {
		wantBits = 128
	}
	if prefix.Bits() != wantBits {
		return netip.Prefix{}, fmt.Errorf("expected /%d host prefix, got /%d", wantBits, prefix.Bits())
	}
	return prefix, nil
}

func parseReserved(raw string) ([]uint8, error) {
	parts := strings.Split(raw, ",")
	if len(parts) != 3 {
		return nil, fmt.Errorf("warp reserved must contain exactly 3 comma-separated bytes")
	}
	reserved := make([]uint8, 3)
	for i, part := range parts {
		value, err := strconv.ParseUint(strings.TrimSpace(part), 10, 8)
		if err != nil {
			return nil, fmt.Errorf("invalid warp reserved byte %q", part)
		}
		reserved[i] = uint8(value)
	}
	return reserved, nil
}

func formatReserved(reserved []uint8) string {
	return fmt.Sprintf("%d,%d,%d", reserved[0], reserved[1], reserved[2])
}

func ensureCIDR(addr, suffix string) string {
	if addr != "" && !strings.Contains(addr, "/") {
		return addr + suffix
	}
	return addr
}
