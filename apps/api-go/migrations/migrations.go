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

// Apply applies pending schema migrations in lexical filename order. Each
// filename is recorded in schema_migrations and never re-executed.
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

	if _, err := pool.Exec(ctx, `
		create table if not exists schema_migrations (
			filename text primary key,
			applied_at timestamptz not null default now()
		)
	`); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	applied := map[string]bool{}
	rows, err := pool.Query(ctx, `select filename from schema_migrations`)
	if err != nil {
		return fmt.Errorf("list applied migrations: %w", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return fmt.Errorf("scan applied migration: %w", err)
		}
		applied[name] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate applied migrations: %w", err)
	}

	names, err := listMigrationFiles()
	if err != nil {
		return err
	}

	for _, name := range names {
		if applied[name] {
			continue
		}
		contents, err := files.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		for _, statement := range splitStatements(string(contents)) {
			if _, err := tx.Exec(ctx, statement); err != nil {
				var pgErr *pgconn.PgError
				// Tolerate duplicate-object noise so installs that previously
				// applied schema without a ledger can adopt the ledger safely.
				if errors.As(err, &pgErr) && duplicateErrorCodes[pgErr.Code] {
					continue
				}
				_ = tx.Rollback(ctx)
				return fmt.Errorf("apply migration %s: %w", name, err)
			}
		}
		if _, err := tx.Exec(ctx, `insert into schema_migrations (filename) values ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}

func listMigrationFiles() ([]string, error) {
	entries, err := fs.ReadDir(files, ".")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if err := validateUniquePrefixes(names); err != nil {
		return nil, err
	}
	return names, nil
}

func validateUniquePrefixes(names []string) error {
	seen := map[string]string{}
	for _, name := range names {
		prefix := strings.SplitN(name, "_", 2)[0]
		if previous, ok := seen[prefix]; ok {
			return fmt.Errorf("duplicate migration number %s: %s and %s", prefix, previous, name)
		}
		seen[prefix] = name
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
