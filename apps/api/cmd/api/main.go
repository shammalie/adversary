package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/shammalie/adversary/apps/api/internal/app"
)

// @title           Adversary API
// @version         0.9.0
// @description     Adversary backend API — scenarios, geo, runs (WebSocket ops+map), manage, generate/route, AUTH_MODE=off|session. Live channels: GET /v1/runs/{id}/ws/ops and /ws/map (Upgrade). Prometheus scrape: GET /metrics (not listed as OpenAPI paths). Architecture: docs/api.md.
// @host            localhost:8080
// @BasePath        /
// @securityDefinitions.apikey CookieAuth
// @in cookie
// @name adversary_session
func main() {
	root := &cobra.Command{
		Use:           "api",
		Short:         "Adversary API server",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(newServeCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func newServeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "serve",
		Short: "Start the HTTP API server",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return app.RunServe(cmd.Context())
		},
	}
}
