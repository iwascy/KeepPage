package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

const shareMaxItems = 100
const shareMaxActivePerUser = 50

type ImportShareService struct {
	repo             repository.ImportShareRepository
	webPublicBaseURL string
}

func NewImportShareService(repo repository.Repository, webPublicBaseURL string) (*ImportShareService, error) {
	capable, ok := repo.(repository.ImportShareRepository)
	if !ok {
		return nil, fmt.Errorf("repository does not implement import/share operations")
	}
	return &ImportShareService{repo: capable, webPublicBaseURL: strings.TrimRight(strings.TrimSpace(webPublicBaseURL), "/")}, nil
}

func (s *ImportShareService) PreviewImport(ctx context.Context, userID string, request domain.ImportRequest) (domain.ImportPreviewResponse, error) {
	input, err := normalizeImportRequest(request)
	if err != nil {
		return domain.ImportPreviewResponse{}, err
	}
	items, err := parseImportContent(input.SourceType, input.Content)
	if err != nil {
		return domain.ImportPreviewResponse{}, err
	}
	matches, err := s.repo.FindImportBookmarkMatches(ctx, userID, hashesOf(items))
	if err != nil {
		return domain.ImportPreviewResponse{}, err
	}
	return buildPreview(input.SourceType, input.FileName, input.Options, items, matches), nil
}

func (s *ImportShareService) CreateImportTask(ctx context.Context, userID string, request domain.ImportRequest) (domain.ImportTaskCreateResponse, error) {
	input, err := normalizeImportRequest(request)
	if err != nil {
		return domain.ImportTaskCreateResponse{}, err
	}
	items, err := parseImportContent(input.SourceType, input.Content)
	if err != nil {
		return domain.ImportTaskCreateResponse{}, err
	}
	matches, err := s.repo.FindImportBookmarkMatches(ctx, userID, hashesOf(items))
	if err != nil {
		return domain.ImportTaskCreateResponse{}, err
	}
	preview := buildPreview(input.SourceType, input.FileName, input.Options, items, matches)
	name := strings.TrimSpace(input.TaskName)
	if name == "" {
		name = defaultImportTaskName(input.SourceType, input.FileName)
	}
	detail, err := s.repo.CreateImportTask(ctx, userID, domain.CreateImportTaskInput{TaskName: name, SourceType: input.SourceType, FileName: input.FileName, Options: input.Options, Preview: preview, Items: items})
	if err != nil {
		return domain.ImportTaskCreateResponse{}, err
	}
	return domain.ImportTaskCreateResponse{TaskID: detail.Task.ID, Task: detail.Task, Items: detail.Items}, nil
}

func (s *ImportShareService) ListImportTasks(ctx context.Context, userID string) (domain.ImportTaskListResponse, error) {
	items, err := s.repo.ListImportTasks(ctx, userID)
	return domain.ImportTaskListResponse{Items: items}, err
}
func (s *ImportShareService) GetImportTaskDetail(ctx context.Context, userID, taskID string) (domain.ImportTaskDetailResponse, error) {
	if strings.TrimSpace(taskID) == "" {
		return domain.ImportTaskDetailResponse{}, httperror.BadRequest("InvalidImportTaskId", "Import task id is required.", nil)
	}
	detail, err := s.repo.GetImportTaskDetail(ctx, userID, taskID)
	if err != nil {
		return domain.ImportTaskDetailResponse{}, err
	}
	if detail == nil {
		return domain.ImportTaskDetailResponse{}, httperror.NotFound("ImportTaskNotFound", "Import task not found.")
	}
	return *detail, nil
}

func (s *ImportShareService) CreateShare(ctx context.Context, userID string, in domain.ShareCreateRequest) (domain.Share, error) {
	if err := validateShareCreate(in); err != nil {
		return domain.Share{}, err
	}
	ids := dedupe(in.BookmarkIDs)
	missing, err := s.repo.FindMissingOwnedBookmarkIDs(ctx, userID, ids)
	if err != nil {
		return domain.Share{}, err
	}
	if len(missing) > 0 {
		return domain.Share{}, shareInvalid(missing)
	}
	share, err := s.repo.CreateShare(ctx, userID, domain.CreateShareRecordInput{ID: randomUUID(), PublicToken: randomToken(), Title: strings.TrimSpace(in.Title), Description: trimDescription(in.Description), BookmarkIDs: ids})
	if err != nil {
		return domain.Share{}, err
	}
	return s.withURL(share), nil
}
func (s *ImportShareService) ListShares(ctx context.Context, userID string) (domain.ShareListResponse, error) {
	items, err := s.repo.ListShares(ctx, userID)
	for i := range items {
		items[i] = s.withURL(items[i])
	}
	return domain.ShareListResponse{Items: items}, err
}
func (s *ImportShareService) GetShareDetail(ctx context.Context, userID, id string) (domain.ShareDetailResponse, error) {
	if !validUUID(id) {
		return domain.ShareDetailResponse{}, httperror.BadRequest("ValidationError", "shareId must be a UUID.", nil)
	}
	v, err := s.repo.GetShareDetail(ctx, userID, id)
	if err != nil {
		return domain.ShareDetailResponse{}, err
	}
	if v == nil {
		return domain.ShareDetailResponse{}, httperror.NotFound("ShareNotFound", "分享不存在。")
	}
	v.PublicURL = s.publicURL(v.PublicToken)
	return domain.ShareDetailResponse{Share: *v}, nil
}
func (s *ImportShareService) UpdateShare(ctx context.Context, userID, id string, in domain.ShareUpdateRequest) (domain.ShareDetailResponse, error) {
	if !validUUID(id) {
		return domain.ShareDetailResponse{}, httperror.BadRequest("ValidationError", "shareId must be a UUID.", nil)
	}
	if err := validateShareUpdate(in); err != nil {
		return domain.ShareDetailResponse{}, err
	}
	if in.BookmarkIDs != nil {
		ids := dedupe(*in.BookmarkIDs)
		missing, err := s.repo.FindMissingOwnedBookmarkIDs(ctx, userID, ids)
		if err != nil {
			return domain.ShareDetailResponse{}, err
		}
		if len(missing) > 0 {
			return domain.ShareDetailResponse{}, shareInvalid(missing)
		}
		in.BookmarkIDs = &ids
	}
	v, err := s.repo.UpdateShare(ctx, userID, id, domain.UpdateShareRecordInput{Title: trimPtr(in.Title), Description: trimDescriptionPtr(in.Description), BookmarkIDs: in.BookmarkIDs})
	if err != nil {
		return domain.ShareDetailResponse{}, err
	}
	if v == nil {
		return domain.ShareDetailResponse{}, httperror.NotFound("ShareNotFound", "分享不存在。")
	}
	v.PublicURL = s.publicURL(v.PublicToken)
	return domain.ShareDetailResponse{Share: *v}, nil
}
func (s *ImportShareService) RevokeShare(ctx context.Context, userID, id string) (domain.ShareResponse, error) {
	if !validUUID(id) {
		return domain.ShareResponse{}, httperror.BadRequest("ValidationError", "shareId must be a UUID.", nil)
	}
	v, err := s.repo.RevokeShare(ctx, userID, id)
	if err != nil {
		return domain.ShareResponse{}, err
	}
	if v == nil {
		return domain.ShareResponse{}, httperror.NotFound("ShareNotFound", "分享不存在。")
	}
	return domain.ShareResponse{Share: s.withURL(*v)}, nil
}
func (s *ImportShareService) GetPublicShare(ctx context.Context, token string) (domain.PublicShareResponse, error) {
	if len(token) < 8 || len(token) > 128 {
		return domain.PublicShareResponse{}, httperror.BadRequest("ValidationError", "token is invalid.", nil)
	}
	v, err := s.repo.GetPublicShareByToken(ctx, token)
	if err != nil {
		return domain.PublicShareResponse{}, err
	}
	if v == nil {
		return domain.PublicShareResponse{}, httperror.NotFound("ShareNotFound", "链接无效或已取消分享")
	}
	return *v, nil
}

type normalizedImportRequest struct {
	TaskName, SourceType, Content string
	FileName                      *string
	Options                       domain.ImportExecutionOptions
}

func normalizeImportRequest(r domain.ImportRequest) (normalizedImportRequest, error) {
	content := r.Content
	if content == "" {
		content = r.RawInput
	}
	if strings.TrimSpace(content) == "" {
		return normalizedImportRequest{}, httperror.BadRequest("ImportContentRequired", "Import content is required.", nil)
	}
	source := normalizeSource(r.SourceType, r.FileName)
	opts := defaultOptions()
	if r.Options != nil {
		opts = *r.Options
		normalizeOptions(&opts)
	}
	var file *string
	if v := strings.TrimSpace(r.FileName); v != "" {
		if len(v) > 255 {
			return normalizedImportRequest{}, httperror.BadRequest("ValidationError", "fileName must be at most 255 characters.", nil)
		}
		file = &v
	}
	task := strings.TrimSpace(r.TaskName)
	if task == "" {
		task = strings.TrimSpace(r.Name)
	}
	if len(task) > 160 {
		return normalizedImportRequest{}, httperror.BadRequest("ValidationError", "taskName must be at most 160 characters.", nil)
	}
	return normalizedImportRequest{task, source, content, file, opts}, nil
}
func defaultOptions() domain.ImportExecutionOptions {
	return domain.ImportExecutionOptions{Mode: "links_only", TargetFolderMode: "preserve", TagStrategy: "keep_source_tags", TitleStrategy: "prefer_import_title", DedupeStrategy: "merge"}
}
func normalizeOptions(o *domain.ImportExecutionOptions) {
	d := defaultOptions()
	if o.Mode == "" {
		o.Mode = d.Mode
	}
	if o.TargetFolderMode == "" {
		o.TargetFolderMode = d.TargetFolderMode
	}
	if o.TagStrategy == "" {
		o.TagStrategy = d.TagStrategy
	}
	if o.TitleStrategy == "" {
		o.TitleStrategy = d.TitleStrategy
	}
	if o.DedupeStrategy == "" {
		o.DedupeStrategy = d.DedupeStrategy
	}
	if o.Mode != "links_only" && o.Mode != "queue_archive" && o.Mode != "start_archive" {
		o.Mode = d.Mode
	}
	if o.TargetFolderMode != "preserve" && o.TargetFolderMode != "specific" && o.TargetFolderMode != "flatten" {
		o.TargetFolderMode = d.TargetFolderMode
	}
	if o.TagStrategy != "keep_source_tags" && o.TagStrategy != "none" {
		o.TagStrategy = d.TagStrategy
	}
	if o.TitleStrategy != "prefer_import_title" && o.TitleStrategy != "prefer_page_title" && o.TitleStrategy != "update_later" {
		o.TitleStrategy = d.TitleStrategy
	}
	if o.DedupeStrategy != "merge" && o.DedupeStrategy != "skip" && o.DedupeStrategy != "update_metadata" {
		o.DedupeStrategy = d.DedupeStrategy
	}
}
func normalizeSource(v, file string) string {
	switch v {
	case "bookmark_html", "url_list", "csv_file", "text_file", "markdown_file", "browser_bookmarks":
		return v
	case "browser_html":
		return "bookmark_html"
	case "csv_txt":
		l := strings.ToLower(file)
		if strings.HasSuffix(l, ".csv") {
			return "csv_file"
		}
		if strings.HasSuffix(l, ".md") {
			return "markdown_file"
		}
		return "text_file"
	case "browser_extension":
		return "browser_bookmarks"
	}
	return "url_list"
}

func parseImportContent(source, content string) ([]domain.PreparedImportItem, error) {
	if source == "bookmark_html" {
		return parseHTML(content), nil
	}
	if source == "csv_file" {
		return parseCSV(content), nil
	}
	if source == "browser_bookmarks" {
		return nil, httperror.BadRequest("ImportSourceUnsupported", "当前版本暂不支持直接读取浏览器书签树，请先导出书签 HTML 文件。", nil)
	}
	return parseText(content), nil
}
func parseText(content string) []domain.PreparedImportItem {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	items := make([]domain.PreparedImportItem, 0, len(lines))
	seen := map[string]bool{}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		title, url := markdownOrURL(line)
		item := makeItem(len(items), title, url, "", nil)
		markDuplicate(&item, seen)
		items = append(items, item)
	}
	return items
}

var markdownRE = regexp.MustCompile(`^\s*\[([^\]]+)\]\((https?://[^)\s]+)\)`)
var urlRE = regexp.MustCompile(`https?://[^\s<>"')\]]+`)

func markdownOrURL(line string) (string, string) {
	if m := markdownRE.FindStringSubmatch(line); len(m) > 0 {
		return strings.TrimSpace(m[1]), m[2]
	}
	url := urlRE.FindString(line)
	if url == "" {
		url = line
	}
	title := strings.TrimSpace(strings.Replace(line, url, "", 1))
	title = strings.TrimLeft(title, "-*+0123456789. \t")
	return title, url
}
func parseCSV(content string) []domain.PreparedImportItem {
	rows, err := csv.NewReader(strings.NewReader(content)).ReadAll()
	if err != nil {
		return parseText(content)
	}
	if len(rows) == 0 {
		return []domain.PreparedImportItem{}
	}
	header := map[string]int{}
	for i, v := range rows[0] {
		header[strings.ToLower(strings.TrimSpace(v))] = i
	}
	has := header["url"] >= 0 || header["link"] >= 0 || header["href"] >= 0 || header["title"] >= 0
	start := 0
	if has {
		start = 1
	}
	items := []domain.PreparedImportItem{}
	seen := map[string]bool{}
	get := func(row []string, keys []string, fallback int) string {
		for _, k := range keys {
			if i, ok := header[k]; ok && i < len(row) {
				return row[i]
			}
		}
		if fallback < len(row) {
			return row[fallback]
		}
		return ""
	}
	for _, row := range rows[start:] {
		if len(row) == 0 {
			continue
		}
		u := get(row, []string{"url", "link", "href"}, 0)
		title := get(row, []string{"title", "name"}, 1)
		folder := get(row, []string{"folder", "path"}, 2)
		tags := splitTags(get(row, []string{"tags", "labels"}, 3))
		item := makeItem(len(items), title, u, folder, tags)
		markDuplicate(&item, seen)
		items = append(items, item)
	}
	return items
}

var htmlFolderRE = regexp.MustCompile(`(?is)<DT><H3[^>]*>(.*?)</H3>|<DL[^>]*>|</DL>|<DT><A([^>]*)>(.*?)</A>`)
var hrefRE = regexp.MustCompile(`(?is)\bhref\s*=\s*["']([^"']+)["']`)
var tagsRE = regexp.MustCompile(`(?is)\btags\s*=\s*["']([^"']+)["']`)
var tagsStripRE = regexp.MustCompile(`(?is)<[^>]+>`)

func parseHTML(content string) []domain.PreparedImportItem {
	items := []domain.PreparedImportItem{}
	seen := map[string]bool{}
	stack := []string{}
	pending := ""
	for _, m := range htmlFolderRE.FindAllStringSubmatch(content, -1) {
		if m[1] != "" {
			pending = strings.TrimSpace(tagsStripRE.ReplaceAllString(m[1], ""))
			continue
		}
		token := strings.ToLower(m[0])
		if strings.HasPrefix(token, "<dl") {
			if pending != "" {
				stack = append(stack, pending)
				pending = ""
			}
			continue
		}
		if strings.HasPrefix(token, "</dl") {
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
			pending = ""
			continue
		}
		href := hrefRE.FindStringSubmatch(m[2])
		u := ""
		if len(href) > 1 {
			u = href[1]
		}
		title := strings.TrimSpace(tagsStripRE.ReplaceAllString(m[3], ""))
		tagm := tagsRE.FindStringSubmatch(m[2])
		var tags []string
		if len(tagm) > 1 {
			tags = splitTags(tagm[1])
		}
		item := makeItem(len(items), title, u, strings.Join(stack, "/"), tags)
		markDuplicate(&item, seen)
		items = append(items, item)
	}
	return items
}
func makeItem(index int, title, raw, folder string, tags []string) domain.PreparedImportItem {
	if tags == nil {
		tags = []string{}
	}
	candidate := strings.Trim(strings.TrimSpace(raw), `"'<([`)
	candidate = strings.TrimRight(candidate, `>"').,;]`)
	if strings.HasPrefix(strings.ToLower(candidate), "www.") {
		candidate = "https://" + candidate
	}
	p, err := url.Parse(candidate)
	if err != nil || p.Scheme == "" || p.Host == "" || (p.Scheme != "http" && p.Scheme != "https") {
		return invalidItemWith(index, title, folder, tags, "链接协议不受支持或格式无效。")
	}
	p.Fragment = ""
	p.Host = strings.ToLower(p.Host)
	if p.Path != "/" {
		p.Path = strings.TrimSuffix(p.Path, "/")
	}
	q := p.Query()
	p.RawQuery = q.Encode()
	normalized := p.String()
	hash := sha256.Sum256([]byte(normalized))
	if strings.TrimSpace(title) == "" {
		title = p.Hostname() + p.Path
	}
	var fp *string
	if strings.TrimSpace(folder) != "" {
		v := strings.Trim(strings.TrimSpace(folder), "/")
		fp = &v
	}
	domainName := p.Hostname()
	return domain.PreparedImportItem{Index: index, Title: title, URL: &normalized, NormalizedURL: &normalized, NormalizedURLHash: ptr(hex.EncodeToString(hash[:])), Domain: &domainName, FolderPath: fp, SourceTags: tags, Valid: true}
}
func invalidItemWith(index int, title, folder string, tags []string, reason string) domain.PreparedImportItem {
	if title == "" {
		title = fmt.Sprintf("条目 %d", index+1)
	}
	var fp *string
	if folder != "" {
		fp = &folder
	}
	return domain.PreparedImportItem{Index: index, Title: title, FolderPath: fp, SourceTags: tags, Valid: false, Reason: &reason}
}
func markDuplicate(i *domain.PreparedImportItem, seen map[string]bool) {
	if !i.Valid || i.NormalizedURLHash == nil {
		return
	}
	if seen[*i.NormalizedURLHash] {
		i.DuplicateInFile = true
		v := "与本次导入中的更早条目重复。"
		i.Reason = &v
		return
	}
	seen[*i.NormalizedURLHash] = true
}
func hashesOf(items []domain.PreparedImportItem) []string {
	r := []string{}
	for _, i := range items {
		if i.NormalizedURLHash != nil {
			r = append(r, *i.NormalizedURLHash)
		}
	}
	return r
}
func buildPreview(source string, file *string, o domain.ImportExecutionOptions, items []domain.PreparedImportItem, matches []domain.ImportBookmarkMatch) domain.ImportPreviewResponse {
	m := map[string]domain.ImportBookmarkMatch{}
	for _, v := range matches {
		m[v.NormalizedURLHash] = v
	}
	s := domain.ImportPreviewSummary{TotalCount: len(items)}
	folders := map[string]int{}
	domains := map[string]int{}
	for _, i := range items {
		if !i.Valid {
			s.InvalidCount++
			s.EstimatedSkipCount++
			continue
		}
		s.ValidCount++
		if i.FolderPath != nil {
			folders[*i.FolderPath]++
		}
		if i.Domain != nil {
			domains[*i.Domain]++
		}
		if i.DuplicateInFile {
			s.DuplicateInFileCount++
			s.EstimatedSkipCount++
			continue
		}
		if i.NormalizedURLHash != nil {
			if _, ok := m[*i.NormalizedURLHash]; ok {
				s.DuplicateExistingCount++
				if o.DedupeStrategy == "skip" {
					s.EstimatedSkipCount++
				} else {
					s.EstimatedMergeCount++
				}
				continue
			}
		}
		s.EstimatedCreateCount++
	}
	samples := items
	if len(samples) > 12 {
		samples = samples[:12]
	}
	return domain.ImportPreviewResponse{SourceType: source, FileName: file, Summary: s, Folders: distribution(folders), Domains: distribution(domains), Samples: samples}
}
func distribution(m map[string]int) []domain.ImportPreviewDistribution {
	r := make([]domain.ImportPreviewDistribution, 0, len(m))
	for k, v := range m {
		r = append(r, domain.ImportPreviewDistribution{Value: k, Count: v})
	}
	sort.Slice(r, func(i, j int) bool {
		if r[i].Count == r[j].Count {
			return r[i].Value < r[j].Value
		}
		return r[i].Count > r[j].Count
	})
	if len(r) > 8 {
		r = r[:8]
	}
	return r
}
func defaultImportTaskName(source string, file *string) string {
	if file != nil {
		return "导入 " + *file
	}
	return map[string]string{"bookmark_html": "导入书签 HTML", "csv_file": "导入 CSV 链接", "text_file": "导入 TXT 链接", "markdown_file": "导入 Markdown 链接", "browser_bookmarks": "导入浏览器书签"}[source]
}
func splitTags(v string) []string {
	r := []string{}
	for _, s := range strings.FieldsFunc(v, func(r rune) bool { return r == ';' || r == ',' }) {
		if s = strings.TrimSpace(s); s != "" {
			r = append(r, s)
		}
	}
	return r
}
func ptr(v string) *string { return &v }

func validateShareCreate(in domain.ShareCreateRequest) error {
	if v := strings.TrimSpace(in.Title); v == "" || len(v) > 80 {
		return httperror.BadRequest("ValidationError", "title must be between 1 and 80 characters.", nil)
	}
	if in.Description != nil && len(strings.TrimSpace(*in.Description)) > 500 {
		return httperror.BadRequest("ValidationError", "description must be at most 500 characters.", nil)
	}
	if len(in.BookmarkIDs) == 0 || len(in.BookmarkIDs) > shareMaxItems {
		return httperror.BadRequest("ValidationError", "bookmarkIds must contain 1 to 100 items.", nil)
	}
	for _, id := range in.BookmarkIDs {
		if strings.TrimSpace(id) == "" {
			return httperror.BadRequest("ValidationError", "bookmarkIds must not contain empty values.", nil)
		}
	}
	return nil
}
func validateShareUpdate(in domain.ShareUpdateRequest) error {
	if in.Title == nil && in.Description == nil && in.BookmarkIDs == nil {
		return httperror.BadRequest("ValidationError", "At least one field must be updated.", nil)
	}
	if in.Title != nil && (strings.TrimSpace(*in.Title) == "" || len(strings.TrimSpace(*in.Title)) > 80) {
		return httperror.BadRequest("ValidationError", "title must be between 1 and 80 characters.", nil)
	}
	if in.Description != nil && len(strings.TrimSpace(*in.Description)) > 500 {
		return httperror.BadRequest("ValidationError", "description must be at most 500 characters.", nil)
	}
	if in.BookmarkIDs != nil && (len(*in.BookmarkIDs) == 0 || len(*in.BookmarkIDs) > shareMaxItems) {
		return httperror.BadRequest("ValidationError", "bookmarkIds must contain 1 to 100 items.", nil)
	}
	return nil
}
func (s *ImportShareService) withURL(v domain.Share) domain.Share {
	v.PublicURL = s.publicURL(v.PublicToken)
	return v
}
func (s *ImportShareService) publicURL(t string) string {
	if s.webPublicBaseURL == "" {
		return "/s/" + url.PathEscape(t)
	}
	return s.webPublicBaseURL + "/s/" + url.PathEscape(t)
}
func shareInvalid(ids []string) error {
	return httperror.BadRequest("ShareBookmarkInvalid", "部分书签不存在、不属于当前账号，或无法分享（例如私密书签）。", map[string]any{"missingIds": ids})
}
func dedupe(ids []string) []string {
	seen := map[string]bool{}
	r := []string{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			r = append(r, id)
		}
	}
	return r
}
func trimDescription(v *string) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}
func trimDescriptionPtr(v *string) *string {
	if v == nil {
		return nil
	}
	x := strings.TrimSpace(*v)
	return &x
}
func trimPtr(v *string) *string {
	if v == nil {
		return nil
	}
	x := strings.TrimSpace(*v)
	return &x
}
func randomToken() string {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return strings.TrimRight(strings.NewReplacer("+", "-", "/", "_").Replace(hex.EncodeToString(b)), "=")
}
func randomUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func validUUID(v string) bool { return uuidRE.MatchString(v) }
