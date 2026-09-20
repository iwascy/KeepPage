package repository

import (
	"html"
	"regexp"
	"sort"
	"strings"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

var searchHTMLTag = regexp.MustCompile(`<[^>]*>`)

func escapeSearchLike(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}

func bookmarkOrderSQL(prefix, ordering, searchPlaceholder string) string {
	stable := prefix + "created_at desc, " + prefix + "id desc"
	switch ordering {
	case "updated":
		return prefix + "updated_at desc, " + stable
	case "title":
		return "lower(" + prefix + "title) asc, " + stable
	case "relevance":
		if searchPlaceholder != "" {
			return "case when " + prefix + "title ilike " + searchPlaceholder + " then 4 when " + prefix + "domain ilike " + searchPlaceholder + " or " + prefix + "source_url ilike " + searchPlaceholder + " then 2 when " + prefix + "note ilike " + searchPlaceholder + " then 1 else 0 end desc, " + stable
		}
	}
	return stable
}

func bookmarkSearchFields(bookmark domain.Bookmark) []string {
	fields := []string{bookmark.Title, bookmark.Note, bookmark.SourceURL, bookmark.Domain}
	if bookmark.Folder != nil {
		fields = append(fields, bookmark.Folder.Path)
	}
	for _, tag := range bookmark.Tags {
		fields = append(fields, tag.Name)
	}
	return fields
}

func plainSearchSnippet(value, query string) string {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return ""
	}
	value = strings.Join(strings.Fields(html.UnescapeString(searchHTMLTag.ReplaceAllString(value, " "))), " ")
	chars := []rune(value)
	lower := []rune(strings.ToLower(value))
	match := []rune(needle)
	start := -1
	for i := 0; i+len(match) <= len(lower); i++ {
		if string(lower[i:i+len(match)]) == needle {
			start = i
			break
		}
	}
	if start < 0 {
		return ""
	}
	from := max(0, start-50)
	end := min(len(chars), max(from+180, start+len(match)))
	snippet := string(chars[from:end])
	if from > 0 {
		snippet = "…" + snippet
	}
	if end < len(chars) {
		snippet += "…"
	}
	return snippet
}

func bookmarkSearchSnippet(bookmark domain.Bookmark, query, text string) string {
	for _, value := range append(bookmarkSearchFields(bookmark), text) {
		if snippet := plainSearchSnippet(value, query); snippet != "" {
			return snippet
		}
	}
	return ""
}

func searchRank(bookmark domain.Bookmark, query string) int {
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return 0
	}
	if strings.Contains(strings.ToLower(bookmark.Title), needle) {
		return 4
	}
	if strings.Contains(strings.ToLower(bookmark.Domain), needle) || strings.Contains(strings.ToLower(bookmark.SourceURL), needle) {
		return 2
	}
	if strings.Contains(strings.ToLower(bookmark.Note), needle) {
		return 1
	}
	return 0
}

func sortBookmarks(items []domain.Bookmark, query domain.BookmarkSearchQuery) {
	sort.SliceStable(items, func(i, j int) bool {
		left, right := items[i], items[j]
		switch query.Sort {
		case "updated":
			if !left.UpdatedAt.Equal(right.UpdatedAt) {
				return left.UpdatedAt.After(right.UpdatedAt)
			}
		case "title":
			if strings.ToLower(left.Title) != strings.ToLower(right.Title) {
				return strings.ToLower(left.Title) < strings.ToLower(right.Title)
			}
		case "relevance":
			if searchRank(left, query.Q) != searchRank(right, query.Q) {
				return searchRank(left, query.Q) > searchRank(right, query.Q)
			}
		}
		if !left.CreatedAt.Equal(right.CreatedAt) {
			return left.CreatedAt.After(right.CreatedAt)
		}
		return left.ID > right.ID
	})
}

func (r *MemoryRepository) memoryBookmarkText(userID string, bookmark domain.Bookmark, private bool) string {
	if bookmark.LatestVersionID == nil {
		return ""
	}
	versions := r.captureState().versions
	if private {
		versions = r.captureState().privateVersions
	}
	for _, version := range versions {
		if version.userID == userID && version.bookmarkID == bookmark.ID && version.versionID == *bookmark.LatestVersionID {
			return version.extractedText
		}
	}
	return ""
}
