package service

import (
	"bytes"
	"compress/gzip"
	"strings"
	"testing"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func TestValidObjectKey(t *testing.T) {
	cases := []struct {
		key   string
		valid bool
	}{
		{"captures/user/abc.html", true},
		{"private-captures/user/x.html", true},
		{"..", false},
		{"../etc/passwd", false},
		// Leading slash is stripped then cleaned to a relative key (same as localfs).
		{"/captures/user/a.html", true},
		{".", false},
		{"foo/../../bar", false},
	}
	for _, tc := range cases {
		err := validObjectKey(tc.key)
		if tc.valid && err != nil {
			t.Fatalf("key %q expected valid, got %v", tc.key, err)
		}
		if !tc.valid && err == nil {
			t.Fatalf("key %q expected invalid", tc.key)
		}
	}
}

func TestDecodeBodyGzipLimit(t *testing.T) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	payload := bytes.Repeat([]byte("A"), 1024)
	if _, err := zw.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeBody(buf.Bytes(), "gzip", 100); err == nil {
		t.Fatal("expected gzip bomb to be rejected")
	}
}

func TestDecodeBodyPlainLimit(t *testing.T) {
	if _, err := decodeBody(bytes.Repeat([]byte("x"), 50), "", 10); err == nil {
		t.Fatal("expected plain body over limit to be rejected")
	}
}

func TestRemapImportedObjectKeyNamespacesToImporter(t *testing.T) {
	key, err := remapImportedObjectKey("importer-user", "captures/other-user/evil.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(key, "captures/importer-user/") {
		t.Fatalf("key = %q, want importer namespace", key)
	}
	if !strings.HasSuffix(key, "-evil.html") {
		t.Fatalf("key = %q, want original basename suffix", key)
	}
	if err := validObjectKey(key); err != nil {
		t.Fatalf("remapped key invalid: %v", err)
	}
}

func TestRemapImportedObjectKeyRejectsTraversal(t *testing.T) {
	if _, err := remapImportedObjectKey("user", ".."); err == nil {
		t.Fatal("expected traversal key to be rejected")
	}
}

func TestRewriteRestoredVersionKeys(t *testing.T) {
	reader := "captures/old/reader.html"
	version := domain.BookmarkVersion{
		HTMLObjectKey:       "captures/old/a.html",
		ReaderHTMLObjectKey: &reader,
		MediaFiles:          []domain.CaptureMediaFile{{ObjectKey: "captures/old/m.png"}},
	}
	keyMap := map[string]string{
		"captures/old/a.html":      "captures/new/a.html",
		"captures/old/reader.html": "captures/new/reader.html",
		"captures/old/m.png":       "captures/new/m.png",
	}
	out := rewriteRestoredVersionKeys(version, keyMap)
	if out.HTMLObjectKey != "captures/new/a.html" {
		t.Fatalf("html key = %q", out.HTMLObjectKey)
	}
	if out.ReaderHTMLObjectKey == nil || *out.ReaderHTMLObjectKey != "captures/new/reader.html" {
		t.Fatalf("reader key = %#v", out.ReaderHTMLObjectKey)
	}
	if len(out.MediaFiles) != 1 || out.MediaFiles[0].ObjectKey != "captures/new/m.png" {
		t.Fatalf("media = %#v", out.MediaFiles)
	}
	// Original slice must not be mutated.
	if version.MediaFiles[0].ObjectKey != "captures/old/m.png" {
		t.Fatalf("source media mutated: %q", version.MediaFiles[0].ObjectKey)
	}
}
