package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
	"github.com/samber/do/v2"
	"github.com/spf13/viper"
)

// Config holds process configuration loaded from env / optional config file.
type Config struct {
	HTTPAddr         string `mapstructure:"http_addr"`
	DatabaseURL      string `mapstructure:"database_url"`
	RedisURL         string `mapstructure:"redis_url"`
	AuthMode         string `mapstructure:"auth_mode"`
	AuthCookieSecure bool   `mapstructure:"auth_cookie_secure"`
	AuthSessionTTL   string `mapstructure:"auth_session_ttl"`
	MBTilesPath      string `mapstructure:"mbtiles_path"`
	GeoTileJSONURL   string `mapstructure:"geo_tilejson_url"`
	LogLevel         string `mapstructure:"log_level"`
	InstanceID       string `mapstructure:"instance_id"`
}

// Package registers config in the DI container.
var Package = do.Package(
	do.Lazy(Provide),
)

// Provide loads configuration via Viper (env > file > defaults).
func Provide(_ do.Injector) (*Config, error) {
	return Load()
}

// Load reads configuration. Process environment wins over apps/api/.env,
// repo-root .env, config.yaml, and defaults. Env vars use uppercase with
// underscores (e.g. HTTP_ADDR, DATABASE_URL, AUTH_MODE).
func Load() (*Config, error) {
	if err := loadDotenv(); err != nil {
		return nil, err
	}

	v := viper.New()

	v.SetDefault("http_addr", ":8080")
	v.SetDefault("database_url", "postgres://adversary:adversary@localhost:5432/adversary?sslmode=disable")
	v.SetDefault("redis_url", "redis://localhost:6379/0")
	v.SetDefault("auth_mode", "off")
	v.SetDefault("auth_cookie_secure", false)
	v.SetDefault("auth_session_ttl", "168h")
	v.SetDefault("mbtiles_path", "./data/tiles/openmaptiles.mbtiles")
	v.SetDefault("geo_tilejson_url", "")
	v.SetDefault("log_level", "info")
	v.SetDefault("instance_id", "")

	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	_ = v.BindEnv("http_addr", "HTTP_ADDR")
	_ = v.BindEnv("database_url", "DATABASE_URL")
	_ = v.BindEnv("redis_url", "REDIS_URL")
	_ = v.BindEnv("auth_mode", "AUTH_MODE")
	_ = v.BindEnv("auth_cookie_secure", "AUTH_COOKIE_SECURE")
	_ = v.BindEnv("auth_session_ttl", "AUTH_SESSION_TTL")
	_ = v.BindEnv("mbtiles_path", "MBTILES_PATH")
	_ = v.BindEnv("geo_tilejson_url", "GEO_TILEJSON_URL")
	_ = v.BindEnv("log_level", "LOG_LEVEL")
	_ = v.BindEnv("instance_id", "INSTANCE_ID")

	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("./apps/api")
	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) {
			return nil, fmt.Errorf("reading config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshaling config: %w", err)
	}

	cfg.AuthMode = strings.ToLower(strings.TrimSpace(cfg.AuthMode))
	if cfg.AuthMode == "" {
		cfg.AuthMode = "off"
	}
	if cfg.AuthMode != "off" && cfg.AuthMode != "session" {
		return nil, fmt.Errorf("invalid auth_mode %q (want off|session)", cfg.AuthMode)
	}
	if strings.TrimSpace(cfg.AuthSessionTTL) == "" {
		cfg.AuthSessionTTL = "168h"
	}

	return &cfg, nil
}

func loadDotenv() error {
	root, err := repoRoot()
	if err != nil {
		return err
	}

	values := map[string]string{}
	for _, path := range []string{
		filepath.Join(root, ".env"),
		filepath.Join(root, "apps", "api", ".env"),
	} {
		fileValues, err := godotenv.Read(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("loading %s: %w", path, err)
		}
		for key, value := range fileValues {
			values[key] = value
		}
	}

	for key, value := range values {
		if _, alreadySet := os.LookupEnv(key); !alreadySet {
			if err := os.Setenv(key, value); err != nil {
				return fmt.Errorf("setting environment variable %q: %w", key, err)
			}
		}
	}

	return nil
}

func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getting working directory: %w", err)
	}

	for {
		if _, err := os.Stat(filepath.Join(dir, "go.work")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("finding repository root from %q", dir)
		}
		dir = parent
	}
}
