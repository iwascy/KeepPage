package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
)

type R2BookmarkBackupScheduler struct {
	cfg      config.Config
	logger   *slog.Logger
	repo     repository.Repository
	taxonomy repository.TaxonomyRepository
	backups  *service.BackupService
	client   *s3.Client
	timer    *time.Timer
	mu       sync.Mutex
	running  bool
}

type uploadedUserBackup struct {
	UserID    string `json:"userId"`
	Email     string `json:"email"`
	Key       string `json:"key"`
	FileName  string `json:"fileName"`
	SizeBytes int    `json:"sizeBytes"`
}

type backupFailure struct {
	UserID  string `json:"userId"`
	Email   string `json:"email"`
	Message string `json:"message"`
}

type backupManifest struct {
	BackupType string `json:"backupType"`
	Trigger    string `json:"trigger"`
	StartedAt  string `json:"startedAt"`
	FinishedAt string `json:"finishedAt"`
	Status     string `json:"status"`
	R2Bucket   string `json:"r2Bucket"`
	R2Prefix   string `json:"r2Prefix"`
	Counts     struct {
		Users         int `json:"users"`
		UploadedUsers int `json:"uploadedUsers"`
		FailedUsers   int `json:"failedUsers"`
		TotalBytes    int `json:"totalBytes"`
	} `json:"counts"`
	UploadedUsers []uploadedUserBackup `json:"uploadedUsers"`
	Failures      []backupFailure      `json:"failures"`
}

func NewR2BookmarkBackupScheduler(cfg config.Config, repo repository.Repository, backups *service.BackupService, logger *slog.Logger) (*R2BookmarkBackupScheduler, error) {
	taxonomy, ok := repo.(repository.TaxonomyRepository)
	if !ok {
		return nil, fmt.Errorf("repository must implement taxonomy operations")
	}
	var client *s3.Client
	if cfg.BackupR2Enabled {
		awsCfg, err := awsconfig.LoadDefaultConfig(
			context.Background(),
			awsconfig.WithRegion(cfg.R2Region),
			awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.R2AccessKeyID, cfg.R2SecretAccessKey, "")),
		)
		if err != nil {
			return nil, fmt.Errorf("load R2 backup configuration: %w", err)
		}
		client = s3.NewFromConfig(awsCfg, func(options *s3.Options) {
			options.BaseEndpoint = aws.String(strings.TrimRight(cfg.R2Endpoint, "/"))
			options.UsePathStyle = true
		})
	}
	return &R2BookmarkBackupScheduler{cfg: cfg, repo: repo, taxonomy: taxonomy, backups: backups, logger: logger, client: client}, nil
}

func (s *R2BookmarkBackupScheduler) Start() {
	if !s.cfg.BackupR2Enabled {
		return
	}
	s.scheduleNextRun()
	if s.cfg.BackupR2RunOnStart {
		time.AfterFunc(time.Second, func() {
			if _, err := s.RunNow(context.Background(), "startup"); err != nil {
				s.logger.Error("startup R2 bookmark backup failed", "err", err)
			}
		})
	}
}

func (s *R2BookmarkBackupScheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
}

func (s *R2BookmarkBackupScheduler) RunNow(ctx context.Context, trigger string) (*backupManifest, error) {
	if !s.cfg.BackupR2Enabled {
		return nil, nil
	}
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return nil, nil
	}
	s.running = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()

	started := time.Now()
	runID := strings.NewReplacer(":", "-", ".", "-").Replace(started.UTC().Format(time.RFC3339Nano))
	prefix := normalizePrefix(s.cfg.BackupR2Prefix) + started.Format("2006-01-02") + "/" + runID + "/"
	users, err := s.repo.ListUsersForBackup(ctx)
	if err != nil {
		return nil, err
	}
	manifest := &backupManifest{BackupType: "keeppage-bookmarks-r2-auto", Trigger: trigger, StartedAt: started.UTC().Format(time.RFC3339Nano), R2Bucket: s.cfg.R2Bucket, R2Prefix: prefix}
	manifest.Counts.Users = len(users)
	for _, user := range users {
		if err := s.backupUser(ctx, prefix, user, manifest); err != nil {
			manifest.Failures = append(manifest.Failures, backupFailure{UserID: user.ID, Email: user.Email, Message: err.Error()})
			s.logger.Error("failed to upload user bookmark backup to R2", "userId", user.ID, "err", err)
		}
	}
	manifest.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if len(manifest.Failures) > 0 {
		manifest.Status = "warning"
	} else {
		manifest.Status = "success"
	}
	manifest.Counts.UploadedUsers = len(manifest.UploadedUsers)
	manifest.Counts.FailedUsers = len(manifest.Failures)
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	body = append(body, '\n')
	if err := s.put(ctx, prefix+"manifest.json", body, "application/json"); err != nil {
		return nil, err
	}
	if err := s.put(ctx, normalizePrefix(s.cfg.BackupR2Prefix)+"latest-manifest.json", body, "application/json"); err != nil {
		return nil, err
	}
	s.logger.Info("R2 bookmark backup completed", "status", manifest.Status, "uploadedUsers", manifest.Counts.UploadedUsers, "failedUsers", manifest.Counts.FailedUsers, "prefix", prefix)
	return manifest, nil
}

func (s *R2BookmarkBackupScheduler) backupUser(ctx context.Context, prefix string, user domain.AuthUser, manifest *backupManifest) error {
	folders, err := s.taxonomy.ListFolders(ctx, user.ID)
	if err != nil {
		return err
	}
	tags, err := s.taxonomy.ListTags(ctx, user.ID)
	if err != nil {
		return err
	}
	body, fileName, _, err := s.backups.Export(ctx, user, folders, tags)
	if err != nil {
		return err
	}
	key := prefix + "users/" + user.ID + ".kpkg"
	if err := s.put(ctx, key, body, "application/x-keeppage-package"); err != nil {
		return err
	}
	manifest.UploadedUsers = append(manifest.UploadedUsers, uploadedUserBackup{UserID: user.ID, Email: user.Email, Key: key, FileName: fileName, SizeBytes: len(body)})
	manifest.Counts.TotalBytes += len(body)
	return nil
}

func (s *R2BookmarkBackupScheduler) put(ctx context.Context, key string, body []byte, contentType string) error {
	if s.client == nil {
		return fmt.Errorf("R2 backup client is not configured")
	}
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(s.cfg.R2Bucket), Key: aws.String(key), Body: bytes.NewReader(body), ContentType: aws.String(contentType), CacheControl: aws.String("private, max-age=0, no-store")})
	return err
}

func (s *R2BookmarkBackupScheduler) scheduleNextRun() {
	s.Stop()
	delay := millisecondsUntilNextLocalTime(s.cfg.BackupR2Time)
	s.mu.Lock()
	s.timer = time.AfterFunc(delay, func() {
		if _, err := s.RunNow(context.Background(), "schedule"); err != nil {
			s.logger.Error("scheduled R2 bookmark backup failed", "err", err)
		}
		s.scheduleNextRun()
	})
	s.mu.Unlock()
	s.logger.Info("R2 bookmark backup scheduler started", "time", s.cfg.BackupR2Time, "nextRunInMs", delay.Milliseconds(), "prefix", s.cfg.BackupR2Prefix)
}

func normalizePrefix(prefix string) string {
	prefix = strings.Trim(strings.ReplaceAll(prefix, "\\", "/"), "/")
	if prefix == "" {
		return ""
	}
	return prefix + "/"
}

func millisecondsUntilNextLocalTime(value string) time.Duration {
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return time.Hour
	}
	now := time.Now()
	next := time.Date(now.Year(), now.Month(), now.Day(), parsed.Hour(), parsed.Minute(), 0, 0, now.Location())
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return next.Sub(now)
}
