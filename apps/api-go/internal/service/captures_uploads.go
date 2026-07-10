package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/storage"
)

type CaptureUploadService struct {
	repo    repository.CaptureUploadRepository
	objects storage.ObjectStorage
	chunks  sync.Map
}
type chunkState struct {
	mu   sync.Mutex
	data []byte
}
type ChunkUploadResult struct {
	ReceivedBytes int64  `json:"receivedBytes"`
	UploadID      string `json:"uploadId"`
	Complete      bool
}

func NewCaptureUploadService(repo repository.CaptureUploadRepository, objects storage.ObjectStorage) *CaptureUploadService {
	return &CaptureUploadService{repo: repo, objects: objects}
}
func (s *CaptureUploadService) Init(ctx context.Context, userID string, input domain.CaptureInitRequest, private bool) (domain.CaptureInitResponse, error) {
	if err := validateCaptureInit(input); err != nil {
		return domain.CaptureInitResponse{}, err
	}
	if private {
		return s.repo.InitPrivateCapture(ctx, userID, input)
	}
	return s.repo.InitCapture(ctx, userID, input)
}
func (s *CaptureUploadService) Complete(ctx context.Context, userID string, input domain.CaptureCompleteRequest, private bool) (domain.CaptureCompleteResult, error) {
	if err := validateCaptureComplete(input); err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	if private != strings.HasPrefix(input.ObjectKey, "private-captures/") {
		return domain.CaptureCompleteResult{}, httperror.Forbidden("CaptureForbidden", "Capture object key does not match the requested mode.")
	}
	canWrite, err := s.repo.UserCanWriteObject(ctx, userID, input.ObjectKey)
	if err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	if !canWrite {
		return domain.CaptureCompleteResult{}, httperror.NotFound("PendingCaptureNotFound", "Pending capture not found for object key.")
	}
	if _, err := s.objects.StatObject(ctx, input.ObjectKey); err != nil {
		if err == storage.ErrNotFound {
			return domain.CaptureCompleteResult{}, httperror.NotFound("ObjectNotFound", "Uploaded archive object not found.")
		}
		return domain.CaptureCompleteResult{}, err
	}
	if input.ReaderHTML != nil {
		key := strings.TrimSuffix(input.ObjectKey, ".html") + ".reader.html"
		if err := s.objects.PutObject(ctx, key, []byte(*input.ReaderHTML), "text/html; charset=utf-8"); err != nil {
			return domain.CaptureCompleteResult{}, err
		}
		input.ReaderHTMLObjectKey = &key
	}
	if private {
		return s.repo.CompletePrivateCapture(ctx, userID, input)
	}
	return s.repo.CompleteCapture(ctx, userID, input)
}
func (s *CaptureUploadService) Get(ctx context.Context, userID, key string, public bool) ([]byte, string, error) {
	if err := validObjectKey(key); err != nil {
		return nil, "", err
	}
	if public {
		if !isPublicAssetObjectKey(key) {
			return nil, "", httperror.NotFound("ObjectNotFound", "Object not found.")
		}
	} else {
		ok, err := s.repo.UserCanReadObject(ctx, userID, key)
		if err != nil {
			return nil, "", err
		}
		if !ok {
			return nil, "", httperror.NotFound("ObjectNotFound", "Object not found.")
		}
	}
	body, err := s.objects.GetObject(ctx, key)
	if err == storage.ErrNotFound {
		return nil, "", httperror.NotFound("ObjectNotFound", "Object not found.")
	}
	return body, contentType(key), err
}
func (s *CaptureUploadService) Put(ctx context.Context, userID, key string, body []byte, contentType, encoding string) error {
	if err := validObjectKey(key); err != nil {
		return err
	}
	ok, err := s.repo.UserCanWriteObject(ctx, userID, key)
	if err != nil {
		return err
	}
	if !ok {
		return httperror.Forbidden("UploadForbidden", "Current user cannot upload to this object key.")
	}
	body, err = decodeBody(body, encoding)
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return httperror.BadRequest("EmptyUploadBody", "Upload body is empty.", nil)
	}
	return s.objects.PutObject(ctx, key, body, contentType)
}
func (s *CaptureUploadService) PutChunk(ctx context.Context, userID, key, uploadID string, body []byte, offset int64, total *int64, complete bool, contentType, encoding string) (ChunkUploadResult, error) {
	if uploadID == "" {
		return ChunkUploadResult{}, httperror.BadRequest("InvalidUploadHeader", "uploadId is required.", nil)
	}
	if err := validObjectKey(key); err != nil {
		return ChunkUploadResult{}, err
	}
	ok, err := s.repo.UserCanWriteObject(ctx, userID, key)
	if err != nil {
		return ChunkUploadResult{}, err
	}
	if !ok {
		return ChunkUploadResult{}, httperror.Forbidden("UploadForbidden", "Current user cannot upload to this object key.")
	}
	if len(body) == 0 {
		return ChunkUploadResult{}, httperror.BadRequest("EmptyUploadBody", "Upload chunk body is empty.", nil)
	}
	stateAny, _ := s.chunks.LoadOrStore(userID+"\x00"+key+"\x00"+uploadID, &chunkState{})
	state := stateAny.(*chunkState)
	state.mu.Lock()
	defer state.mu.Unlock()
	if int64(len(state.data)) != offset {
		return ChunkUploadResult{}, httperror.New(409, "UploadOffsetMismatch", "Upload offset mismatch.", map[string]int64{"expectedOffset": int64(len(state.data)), "receivedOffset": offset})
	}
	state.data = append(state.data, body...)
	result := ChunkUploadResult{UploadID: uploadID, ReceivedBytes: int64(len(state.data)), Complete: complete}
	if !complete {
		return result, nil
	}
	if total != nil && *total != result.ReceivedBytes {
		return ChunkUploadResult{}, httperror.New(409, "UploadSizeMismatch", "Upload size mismatch.", map[string]int64{"expectedSize": *total, "receivedBytes": result.ReceivedBytes})
	}
	if err := s.Put(ctx, userID, key, state.data, contentType, encoding); err != nil {
		return ChunkUploadResult{}, err
	}
	s.chunks.Delete(userID + "\x00" + key + "\x00" + uploadID)
	return result, nil
}
func validateCaptureInit(in domain.CaptureInitRequest) error {
	if strings.TrimSpace(in.URL) == "" || strings.TrimSpace(in.Title) == "" || in.FileSize <= 0 || strings.TrimSpace(in.HTMLSHA256) == "" || strings.TrimSpace(in.DeviceID) == "" {
		return httperror.BadRequest("ValidationError", "Invalid capture initialization request.", nil)
	}
	switch in.Profile {
	case "standard", "complete", "dynamic", "lightweight":
	default:
		return httperror.BadRequest("ValidationError", "Invalid capture profile.", nil)
	}
	return nil
}
func validateCaptureComplete(in domain.CaptureCompleteRequest) error {
	if strings.TrimSpace(in.ObjectKey) == "" || strings.TrimSpace(in.HTMLSHA256) == "" || strings.TrimSpace(in.Source.URL) == "" || strings.TrimSpace(in.Source.Title) == "" || strings.TrimSpace(in.DeviceID) == "" || in.Quality.Score < 0 || in.Quality.Score > 100 {
		return httperror.BadRequest("ValidationError", "Invalid capture completion request.", nil)
	}
	return nil
}
func validObjectKey(key string) error {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimPrefix(key, "/")))
	if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
		return httperror.BadRequest("InvalidUploadObjectKey", "Invalid upload object key.", nil)
	}
	return nil
}
func decodeBody(body []byte, encoding string) ([]byte, error) {
	if !strings.EqualFold(strings.TrimSpace(encoding), "gzip") {
		return body, nil
	}
	reader, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, httperror.BadRequest("InvalidUploadBody", "Invalid gzip upload body.", nil)
	}
	defer reader.Close()
	decoded, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("decode gzip upload: %w", err)
	}
	return decoded, nil
}
func isPublicAssetObjectKey(key string) bool {
	if strings.HasPrefix(key, "private-captures/") {
		return false
	}
	switch strings.ToLower(filepath.Ext(key)) {
	case ".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp", ".mp4", ".webm", ".mov":
		return true
	}
	return false
}
func contentType(key string) string {
	if guessed := mime.TypeByExtension(filepath.Ext(key)); guessed != "" {
		return guessed
	}
	return "application/octet-stream"
}
func ParseNonNegativeHeader(raw, name string, required bool) (int64, error) {
	if strings.TrimSpace(raw) == "" {
		if required {
			return 0, httperror.BadRequest("InvalidUploadHeader", "Missing required header: "+name, nil)
		}
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, httperror.BadRequest("InvalidUploadHeader", name+" must be a non-negative integer.", nil)
	}
	return value, nil
}
