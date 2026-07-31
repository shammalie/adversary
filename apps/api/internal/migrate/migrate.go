package migrate

import (
	"errors"
	"fmt"
	"io/fs"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// Up applies all pending migrations from the given filesystem (typically embed).
func Up(databaseURL string, migrationsFS fs.FS, dir string) error {
	m, err := newMigrator(databaseURL, migrationsFS, dir)
	if err != nil {
		return err
	}
	defer func() { _, _ = m.Close() }()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// Down rolls back one migration.
func Down(databaseURL string, migrationsFS fs.FS, dir string) error {
	m, err := newMigrator(databaseURL, migrationsFS, dir)
	if err != nil {
		return err
	}
	defer func() { _, _ = m.Close() }()

	if err := m.Steps(-1); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate down: %w", err)
	}
	return nil
}

func newMigrator(databaseURL string, migrationsFS fs.FS, dir string) (*migrate.Migrate, error) {
	src, err := iofs.New(migrationsFS, dir)
	if err != nil {
		return nil, fmt.Errorf("migration source: %w", err)
	}

	// pgx/v5 driver expects a postgres:// or pgx5:// URL.
	m, err := migrate.NewWithSourceInstance("iofs", src, toPgx5URL(databaseURL))
	if err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return m, nil
}

func toPgx5URL(databaseURL string) string {
	// golang-migrate pgx/v5 driver registers as "pgx5".
	switch {
	case strings.HasPrefix(databaseURL, "postgres://"):
		return "pgx5://" + strings.TrimPrefix(databaseURL, "postgres://")
	case strings.HasPrefix(databaseURL, "postgresql://"):
		return "pgx5://" + strings.TrimPrefix(databaseURL, "postgresql://")
	default:
		return databaseURL
	}
}
