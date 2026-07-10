package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/url"
	"sort"
	"strings"
)

func normalizeSourceURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	parsed.Fragment = ""
	parsed.Host = normalizeHost(parsed)
	if parsed.Path != "/" && strings.HasSuffix(parsed.Path, "/") {
		parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	}
	query := parsed.Query()
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
		sort.Strings(query[key])
	}
	sort.Strings(keys)
	values := url.Values{}
	for _, key := range keys {
		for _, value := range query[key] {
			values.Add(key, value)
		}
	}
	parsed.RawQuery = values.Encode()
	return parsed.String(), nil
}

func hashNormalizedURL(normalizedURL string) string {
	sum := sha256.Sum256([]byte(normalizedURL))
	return hex.EncodeToString(sum[:])
}

func normalizeHost(parsed *url.URL) string {
	hostname := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if (parsed.Scheme == "https" && port == "443") || (parsed.Scheme == "http" && port == "80") {
		port = ""
	}
	if port == "" {
		return hostname
	}
	return net.JoinHostPort(hostname, port)
}
