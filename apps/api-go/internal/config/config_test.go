package config

import "testing"

func TestValidateRejectsDefaultSecretInProduction(t *testing.T) {
	cfg := Config{
		NodeEnv:             Production,
		APIPort:             8788,
		StorageDriver:       "memory",
		ObjectStorageDriver: "localfs",
		AuthTokenSecret:     "keeppage-dev-secret",
		AuthTokenTTLDays:    30,
		UploadBodyLimitMB:   32,
		BackupR2Time:        "03:30",
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected production default secret to be rejected")
	}
}

func TestValidateRejectsBackupR2EnabledWithoutR2Settings(t *testing.T) {
	cfg := Config{
		NodeEnv:             Development,
		APIPort:             8788,
		StorageDriver:       "memory",
		ObjectStorageDriver: "localfs",
		AuthTokenSecret:     "keeppage-dev-secret",
		AuthTokenTTLDays:    30,
		UploadBodyLimitMB:   32,
		BackupR2Enabled:     true,
		BackupR2Time:        "03:30",
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected missing R2 settings to be rejected")
	}
}

func TestValidateAcceptsBackupR2EnabledWithR2Settings(t *testing.T) {
	cfg := Config{
		NodeEnv:             Development,
		APIPort:             8788,
		StorageDriver:       "memory",
		ObjectStorageDriver: "localfs",
		AuthTokenSecret:     "keeppage-dev-secret",
		AuthTokenTTLDays:    30,
		UploadBodyLimitMB:   32,
		BackupR2Enabled:     true,
		BackupR2Time:        "03:30",
		R2Endpoint:          "https://r2.example.test",
		R2Bucket:            "keeppage",
		R2AccessKeyID:       "access",
		R2SecretAccessKey:   "secret",
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateAcceptsProductionWithCustomSecret(t *testing.T) {
	cfg := Config{
		NodeEnv:             Production,
		APIPort:             8788,
		StorageDriver:       "memory",
		ObjectStorageDriver: "localfs",
		AuthTokenSecret:     "production-secret-value",
		AuthTokenTTLDays:    30,
		UploadBodyLimitMB:   32,
		BackupR2Time:        "03:30",
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestReadBrowserTokenTTL(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("AUTH_ACCESS_TOKEN_TTL_MINUTES", "7")
	t.Setenv("AUTH_REFRESH_TOKEN_TTL_DAYS", "14")
	cfg, err := Read()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AccessTokenTTL().Minutes() != 7 || cfg.RefreshTokenTTL().Hours() != 14*24 {
		t.Fatal("browser TTL settings ignored")
	}
	for _, key := range []string{"AUTH_ACCESS_TOKEN_TTL_MINUTES", "AUTH_REFRESH_TOKEN_TTL_DAYS"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, "0")
			if _, err := Read(); err == nil {
				t.Fatal("zero lifetime accepted")
			}
		})
	}
}
