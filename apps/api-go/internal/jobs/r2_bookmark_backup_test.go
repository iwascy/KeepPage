package jobs

import (
	"testing"
	"time"
)

func TestNormalizePrefix(t *testing.T) {
	if got := normalizePrefix("\\keeppage-backups\\bookmarks/"); got != "keeppage-backups/bookmarks/" {
		t.Fatalf("normalizePrefix() = %q", got)
	}
	if got := normalizePrefix("/"); got != "" {
		t.Fatalf("empty prefix = %q", got)
	}
}

func TestMillisecondsUntilNextLocalTime(t *testing.T) {
	if got := millisecondsUntilNextLocalTime("03:30"); got <= 0 || got > 24*time.Hour {
		t.Fatalf("unexpected delay: %s", got)
	}
}
