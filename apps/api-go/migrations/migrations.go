package migrations

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var files embed.FS

var databaseNamePattern = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

var duplicateErrorCodes = map[string]bool{
	"42701": true, // duplicate_column
	"42710": true, // duplicate_object
	"42P07": true, // duplicate_table
}

// EnsureDatabase creates the configured database when the connecting role has
// permission. This matches the development bootstrap behavior of the former
// TypeScript service.
func EnsureDatabase(ctx context.Context, databaseURL string) error {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	targetDatabase := config.ConnConfig.Database
	if !databaseNamePattern.MatchString(targetDatabase) {
		return fmt.Errorf("DATABASE_URL database name must contain only letters, numbers, and underscores")
	}
	config.ConnConfig.Database = "postgres"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("connect to postgres database: %w", err)
	}
	defer pool.Close()

	var exists bool
	if err := pool.QueryRow(ctx, "select exists(select 1 from pg_database where datname = $1)", targetDatabase).Scan(&exists); err != nil {
		return fmt.Errorf("inspect databases: %w", err)
	}
	if exists {
		return nil
	}
	if _, err := pool.Exec(ctx, "create database \""+targetDatabase+"\""); err != nil {
		return fmt.Errorf("create database %q: %w", targetDatabase, err)
	}
	return nil
}

// Apply applies the checked-in schema migrations in lexical order. The current
// migration set is idempotent for pre-existing KeepPage installations.
func Apply(ctx context.Context, databaseURL string) error {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("connect to application database: %w", err)
	}
	defer pool.Close()

	entries, err := fs.ReadDir(files, ".")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		contents, err := files.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		for _, statement := range splitStatements(string(contents)) {
			if _, err := pool.Exec(ctx, statement); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && duplicateErrorCodes[pgErr.Code] {
					continue
				}
				return fmt.Errorf("apply migration %s: %w", name, err)
			}
		}
	}
	return nil
}

func splitStatements(sql string) []string {
	parts := strings.Split(sql, ";\n")
	statements := make([]string, 0, len(parts))
	for _, part := range parts {
		if statement := strings.TrimSpace(part); statement != "" {
			statements = append(statements, statement)
		}
	}
	return statements
}
