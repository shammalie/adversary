package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/migrate"
	"github.com/shammalie/adversary/apps/api/migrations"
)

func main() {
	root := &cobra.Command{
		Use:           "migrate",
		Short:         "Apply or roll back database migrations",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(newUpCmd(), newDownCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func newUpCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "up",
		Short: "Apply all pending migrations",
		Args:  cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			if err := migrate.Up(cfg.DatabaseURL, migrations.FS, "."); err != nil {
				return err
			}
			fmt.Println("migrate: up complete")
			return nil
		},
	}
}

func newDownCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "down",
		Short: "Roll back the most recent migration",
		Args:  cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			if err := migrate.Down(cfg.DatabaseURL, migrations.FS, "."); err != nil {
				return err
			}
			fmt.Println("migrate: down complete")
			return nil
		},
	}
}
