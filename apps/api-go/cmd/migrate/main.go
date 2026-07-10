package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/migrations"
)

func main() {
	cfg, err := config.Read()
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to read config:", err)
		os.Exit(1)
	}
	if cfg.StorageDriver != "postgres" {
		fmt.Fprintln(os.Stderr, "STORAGE_DRIVER=postgres is required to run migrations")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := migrations.EnsureDatabase(ctx, cfg.DatabaseURL); err != nil {
		fmt.Fprintln(os.Stderr, "failed to initialize database:", err)
		os.Exit(1)
	}
	if err := migrations.Apply(ctx, cfg.DatabaseURL); err != nil {
		fmt.Fprintln(os.Stderr, "failed to apply migrations:", err)
		os.Exit(1)
	}
	fmt.Println("Postgres schema initialized.")
}
