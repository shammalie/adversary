package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/samber/do/v2"

	"github.com/shammalie/adversary/apps/api/internal/config"
)

// Package registers the Postgres pool.
var Package = do.Package(
	do.Lazy(ProvidePool),
)

// ProvidePool opens a pgx pool from config.
func ProvidePool(i do.Injector) (*pgxpool.Pool, error) {
	cfg := do.MustInvoke[*config.Config](i)
	return NewPool(context.Background(), cfg.DatabaseURL)
}

// NewPool creates a pgxpool with sensible defaults.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	pcfg.MaxConns = 10
	pcfg.MinConns = 1
	pcfg.MaxConnLifetime = time.Hour
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}
