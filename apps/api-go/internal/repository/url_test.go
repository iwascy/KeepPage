package repository

import "testing"

func TestNormalizeSourceURLMatchesTypeScriptRules(t *testing.T) {
	normalized, err := normalizeSourceURL("HTTPS://Example.COM:443/path/?b=2&a=1#section")
	if err != nil {
		t.Fatal(err)
	}
	if normalized != "https://example.com/path?a=1&b=2" {
		t.Fatalf("unexpected normalized URL: %s", normalized)
	}
}
