package warp

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

const (
	defaultAPIBase = "https://api.cloudflareclient.com/v0a1922/reg"
	userAgent      = "okhttp/3.12.1"
	clientVersion  = "a-6.3-1922"
	maxResponse    = 1 << 20
)

type Client struct {
	httpClient *http.Client
	baseURL    string
}

func NewClient() *Client {
	return NewClientWithHTTP(nil, defaultAPIBase)
}

// NewClientWithHTTP allows tests and callers with a custom transport to inject
// both the HTTP client and registration endpoint. Plain HTTP is accepted only
// for loopback endpoints.
func NewClientWithHTTP(httpClient *http.Client, baseURL string) *Client {
	if httpClient == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		if transport.TLSClientConfig == nil {
			transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
		} else {
			transport.TLSClientConfig = transport.TLSClientConfig.Clone()
			transport.TLSClientConfig.MinVersion = tls.VersionTLS12
		}
		httpClient = &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	return &Client{httpClient: httpClient, baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/")}
}

func (c *Client) Register(ctx context.Context, name, endpoint string, endpointPort uint16) (Account, error) {
	if ctx == nil {
		return Account{}, errors.New("register context must not be nil")
	}
	if err := validateAPIBase(c.baseURL); err != nil {
		return Account{}, err
	}
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	if err := validateEndpoint(endpoint); err != nil {
		return Account{}, err
	}
	if endpointPort == 0 {
		endpointPort = DefaultEndpointPort
	}

	keyPair, err := GenerateKeyPair()
	if err != nil {
		return Account{}, fmt.Errorf("generate WARP key pair: %w", err)
	}
	reqBody := registerRequest{
		Key: keyPair.PublicKey, Tos: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Model: "PC", Type: "Android", Locale: "en_US",
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return Account{}, fmt.Errorf("encode WARP registration request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return Account{}, fmt.Errorf("create WARP registration request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("CF-Client-Version", clientVersion)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return Account{}, fmt.Errorf("WARP registration request: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := readLimited(resp.Body)
	if err != nil {
		return Account{}, fmt.Errorf("read WARP registration response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return Account{}, fmt.Errorf("WARP registration failed (status %d): %s", resp.StatusCode, truncate(responseBody, 4096))
	}

	var registration registerResponse
	if err := json.Unmarshal(responseBody, &registration); err != nil {
		return Account{}, fmt.Errorf("decode WARP registration response: %w", err)
	}
	if registration.ID == "" || registration.Token == "" {
		return Account{}, errors.New("invalid WARP registration response: missing id or token")
	}
	if len(registration.Config.Peers) == 0 {
		return Account{}, errors.New("invalid WARP registration response: missing peer")
	}
	reserved, err := decodeClientID(registration.Config.ClientID)
	if err != nil {
		return Account{}, fmt.Errorf("decode WARP client_id: %w", err)
	}

	account := withDefaults(Account{
		ID:            registration.ID,
		Name:          strings.TrimSpace(name),
		PrivateKey:    keyPair.PrivateKey,
		PublicKey:     keyPair.PublicKey,
		PeerPublicKey: registration.Config.Peers[0].PublicKey,
		Endpoint:      endpoint,
		EndpointPort:  endpointPort,
		IPv4:          registration.Config.Interface.Addresses.V4,
		IPv6:          registration.Config.Interface.Addresses.V6,
		Reserved:      reserved,
		Token:         registration.Token,
		CreatedAt:     time.Now().UTC(),
	})
	if err := ValidateAccount(account); err != nil {
		return Account{}, fmt.Errorf("invalid WARP registration response: %w", err)
	}
	return account, nil
}

func (c *Client) Delete(ctx context.Context, id, token string) error {
	if ctx == nil {
		return errors.New("delete context must not be nil")
	}
	if err := validateAPIBase(c.baseURL); err != nil {
		return err
	}
	if strings.TrimSpace(id) == "" || strings.TrimSpace(token) == "" {
		return errors.New("WARP device id and token are required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("CF-Client-Version", clientVersion)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("WARP delete request: %w", err)
	}
	defer resp.Body.Close()
	body, readErr := readLimited(resp.Body)
	if readErr != nil {
		return fmt.Errorf("read WARP delete response: %w", readErr)
	}
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("WARP delete failed (status %d): %s", resp.StatusCode, truncate(body, 4096))
	}
	return nil
}

func validateAPIBase(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid WARP API base URL: %w", err)
	}
	if u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("invalid WARP API base URL")
	}
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme == "http" {
		host := u.Hostname()
		if strings.EqualFold(host, "localhost") {
			return nil
		}
		if addr, err := netip.ParseAddr(host); err == nil && addr.IsLoopback() {
			return nil
		}
	}
	return errors.New("WARP API base URL must use HTTPS (HTTP is allowed only for loopback tests)")
}

func decodeClientID(clientID string) ([]uint8, error) {
	decoded, err := base64.StdEncoding.DecodeString(clientID)
	if err != nil {
		return nil, err
	}
	if len(decoded) < 3 {
		return nil, fmt.Errorf("client_id too short: %d bytes", len(decoded))
	}
	return []uint8{decoded[0], decoded[1], decoded[2]}, nil
}

func readLimited(reader io.Reader) ([]byte, error) {
	limited := io.LimitReader(reader, maxResponse+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(body) > maxResponse {
		return nil, errors.New("response exceeds 1 MiB")
	}
	return body, nil
}

func truncate(body []byte, limit int) string {
	if len(body) > limit {
		body = body[:limit]
	}
	return strings.TrimSpace(string(body))
}

type registerRequest struct {
	Key       string `json:"key"`
	InstallID string `json:"install_id"`
	FCMToken  string `json:"fcm_token"`
	Tos       string `json:"tos"`
	Model     string `json:"model"`
	Type      string `json:"type"`
	Locale    string `json:"locale"`
}

type registerResponse struct {
	ID     string `json:"id"`
	Token  string `json:"token"`
	Config struct {
		ClientID string `json:"client_id"`
		Peers    []struct {
			PublicKey string `json:"public_key"`
		} `json:"peers"`
		Interface struct {
			Addresses struct {
				V4 string `json:"v4"`
				V6 string `json:"v6"`
			} `json:"addresses"`
		} `json:"interface"`
	} `json:"config"`
}
