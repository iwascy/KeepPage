package config

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Environment string

const (
	Development Environment = "development"
	Test        Environment = "test"
	Production  Environment = "production"
)

type Config struct {
	NodeEnv             Environment
	APIHost             string
	APIPort             int
	APIPublicBaseURL    string
	WebPublicBaseURL    string
	StorageDriver       string
	ObjectStorageDriver string
	ObjectStorageRoot   string
	R2Endpoint          string
	R2Bucket            string
	R2PublicBucket      string
	R2AccessKeyID       string
	R2SecretAccessKey   string
	R2PublicBaseURL     string
	R2Region            string
	BackupR2Enabled     bool
	BackupR2Prefix      string
	BackupR2Time        string
	BackupR2RunOnStart  bool
	AuthTokenSecret     string
	AuthTokenTTLDays    int
	UploadBodyLimitMB   int
	DebugMode           bool
	LogLevel            slog.Level
	DatabaseURL         string
}

func Read() (Config, error) {
	defaultObjectRoot := filepath.Join("apps", "api", "data", "object-storage")
	debugMode := readBool("DEBUG_MODE", false)
	logLevel, err := parseLogLevel(readString("LOG_LEVEL", ""))
	if err != nil {
		return Config{}, err
	}
	if readString("LOG_LEVEL", "") == "" && debugMode {
		logLevel = slog.LevelDebug
	}

	cfg := Config{
		NodeEnv:             Environment(readString("NODE_ENV", string(Development))),
		APIHost:             readString("API_HOST", "127.0.0.1"),
		APIPort:             readInt("API_PORT", 8788),
		APIPublicBaseURL:    readString("API_PUBLIC_BASE_URL", ""),
		WebPublicBaseURL:    readString("WEB_PUBLIC_BASE_URL", ""),
		StorageDriver:       readString("STORAGE_DRIVER", "memory"),
		ObjectStorageDriver: readString("OBJECT_STORAGE_DRIVER", "localfs"),
		ObjectStorageRoot:   readString("OBJECT_STORAGE_ROOT", defaultObjectRoot),
		R2Endpoint:          readString("R2_ENDPOINT", ""),
		R2Bucket:            readString("R2_BUCKET", ""),
		R2PublicBucket:      readString("R2_PUBLIC_BUCKET", ""),
		R2AccessKeyID:       readString("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:   readString("R2_SECRET_ACCESS_KEY", ""),
		R2PublicBaseURL:     readString("R2_PUBLIC_BASE_URL", ""),
		R2Region:            readString("R2_REGION", "auto"),
		BackupR2Enabled:     readBool("BACKUP_R2_ENABLED", false),
		BackupR2Prefix:      strings.TrimSpace(readString("BACKUP_R2_PREFIX", "keeppage-backups/bookmarks")),
		BackupR2Time:        readString("BACKUP_R2_TIME", "03:30"),
		BackupR2RunOnStart:  readBool("BACKUP_R2_RUN_ON_STARTUP", false),
		AuthTokenSecret:     readString("AUTH_TOKEN_SECRET", "keeppage-dev-secret"),
		AuthTokenTTLDays:    readInt("AUTH_TOKEN_TTL_DAYS", 30),
		UploadBodyLimitMB:   readInt("UPLOAD_BODY_LIMIT_MB", 32),
		DebugMode:           debugMode,
		LogLevel:            logLevel,
		DatabaseURL:         readString("DATABASE_URL", ""),
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.APIHost, c.APIPort)
}

func (c Config) AuthTokenTTL() time.Duration {
	return time.Duration(c.AuthTokenTTLDays) * 24 * time.Hour
}

func (c Config) UploadBodyLimitBytes() int64 {
	return int64(c.UploadBodyLimitMB) * 1024 * 1024
}

func (c Config) Validate() error {
	switch c.NodeEnv {
	case Development, Test, Production:
	default:
		return fmt.Errorf("NODE_ENV must be development, test, or production")
	}
	if c.APIPort <= 0 {
		return fmt.Errorf("API_PORT must be positive")
	}
	if c.StorageDriver != "memory" && c.StorageDriver != "postgres" {
		return fmt.Errorf("STORAGE_DRIVER must be memory or postgres")
	}
	if c.StorageDriver == "postgres" && strings.TrimSpace(c.DatabaseURL) == "" {
		return fmt.Errorf("DATABASE_URL is required when STORAGE_DRIVER=postgres")
	}
	if c.ObjectStorageDriver != "localfs" && c.ObjectStorageDriver != "r2" {
		return fmt.Errorf("OBJECT_STORAGE_DRIVER must be localfs or r2")
	}
	if c.ObjectStorageDriver == "r2" {
		if strings.TrimSpace(c.R2Endpoint) == "" || strings.TrimSpace(c.R2Bucket) == "" || strings.TrimSpace(c.R2AccessKeyID) == "" || strings.TrimSpace(c.R2SecretAccessKey) == "" {
			return fmt.Errorf("R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required when OBJECT_STORAGE_DRIVER=r2")
		}
	}
	if c.AuthTokenTTLDays <= 0 {
		return fmt.Errorf("AUTH_TOKEN_TTL_DAYS must be positive")
	}
	if c.UploadBodyLimitMB <= 0 {
		return fmt.Errorf("UPLOAD_BODY_LIMIT_MB must be positive")
	}
	if c.NodeEnv == Production && (strings.TrimSpace(c.AuthTokenSecret) == "" || c.AuthTokenSecret == "keeppage-dev-secret") {
		return fmt.Errorf("AUTH_TOKEN_SECRET must be set to a non-default value when NODE_ENV=production")
	}
	if c.BackupR2Enabled {
		// Scheduled R2 bookmark backups are not implemented in the Go vertical slice yet.
		return fmt.Errorf("BACKUP_R2_ENABLED is not supported by the Go API yet; disable it or use the TypeScript API")
	}
	if _, err := time.Parse("15:04", c.BackupR2Time); err != nil {
		return fmt.Errorf("BACKUP_R2_TIME must be HH:mm: %w", err)
	}
	return nil
}

func readString(key string, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func readInt(key string, fallback int) int {
	value := strings.TrimSpace(readString(key, ""))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func readBool(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(readString(key, "")))
	switch value {
	case "":
		return fallback
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func parseLogLevel(raw string) (slog.Level, error) {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "", "info":
		return slog.LevelInfo, nil
	case "debug", "trace":
		return slog.LevelDebug, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error", "fatal":
		return slog.LevelError, nil
	case "silent":
		return slog.LevelError + 8, nil
	default:
		return slog.LevelInfo, fmt.Errorf("LOG_LEVEL must be fatal, error, warn, info, debug, trace, or silent")
	}
}
