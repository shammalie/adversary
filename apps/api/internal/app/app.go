package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/samber/do/v2"

	"github.com/shammalie/adversary/apps/api/internal/bus"
	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/db"
	"github.com/shammalie/adversary/apps/api/internal/engine"
	"github.com/shammalie/adversary/apps/api/internal/handler"
	"github.com/shammalie/adversary/apps/api/internal/lease"
)

// Package is the root DI package for the API process.
var Package = do.Package(
	config.Package,
	db.Package,
	bus.Package,
	lease.Package,
	engine.Package,
	handler.Package,
	do.Lazy(ProvideLogger),
)

// ProvideLogger builds a JSON slog logger from config.
func ProvideLogger(i do.Injector) (*slog.Logger, error) {
	cfg := do.MustInvoke[*config.Config](i)
	level := slog.LevelInfo
	switch strings.ToLower(cfg.LogLevel) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})), nil
}

// RunServe starts the HTTP server until SIGINT/SIGTERM.
func RunServe(ctx context.Context) error {
	injector := do.New(Package)
	defer func() { _ = injector.Shutdown() }()

	cfg := do.MustInvoke[*config.Config](injector)
	log := do.MustInvoke[*slog.Logger](injector)
	mux := do.MustInvoke[http.Handler](injector)
	mgr := do.MustInvoke[*engine.Manager](injector)
	redisBus := do.MustInvoke[*bus.Bus](injector)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening",
			"addr", cfg.HTTPAddr,
			"auth_mode", cfg.AuthMode,
			"instance_id", mgr.InstanceID,
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	sigCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case <-sigCtx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown: %w", err)
		}
		_ = mgr.Shutdown(shutdownCtx)
		_ = redisBus.Close()
		return <-errCh
	case err := <-errCh:
		_ = mgr.Shutdown(context.Background())
		_ = redisBus.Close()
		return err
	}
}
