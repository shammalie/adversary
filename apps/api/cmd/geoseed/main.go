package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/cobra"

	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/geoseed"
)

func main() {
	var (
		mbtilesPath    string
		databaseURL    string
		exportJSON     string
		exportFixtures string
		skipDB         bool
	)

	root := &cobra.Command{
		Use:   "geoseed",
		Short: "Mine OpenMapTiles MBTiles into the Postgres geo catalogue",
		Long: `Port of scripts/build-geo-seeds.mjs.

By default mines MBTILES_PATH and upserts PostGIS tables.
Optional --export-json / --export-fixtures keep web fixtures warm during FE transition.`,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			if mbtilesPath == "" {
				mbtilesPath = cfg.MBTilesPath
			}
			if databaseURL == "" {
				databaseURL = cfg.DatabaseURL
			}
			if skipDB && exportJSON == "" && exportFixtures == "" {
				return fmt.Errorf("--skip-db requires --export-json and/or --export-fixtures")
			}

			log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
			log.Info("opening mbtiles", "path", mbtilesPath)

			ctx, cancel := context.WithTimeout(cmd.Context(), 4*time.Hour)
			defer cancel()

			var store *geoseed.Store
			if !skipDB {
				pool, err := pgxpool.New(ctx, databaseURL)
				if err != nil {
					return fmt.Errorf("postgres: %w", err)
				}
				defer pool.Close()
				if err := pool.Ping(ctx); err != nil {
					return fmt.Errorf("postgres ping: %w", err)
				}
				store = &geoseed.Store{Pool: pool}
			}

			cat, err := geoseed.RunSync(ctx, store, mbtilesPath, log)
			if err != nil {
				return err
			}

			if exportJSON != "" {
				if err := geoseed.WriteJSON(exportJSON, cat); err != nil {
					return fmt.Errorf("export json: %w", err)
				}
				log.Info("wrote json", "path", exportJSON)
			}

			if exportFixtures != "" {
				mb, err := geoseed.OpenMBTiles(mbtilesPath)
				if err != nil {
					return err
				}
				defer mb.Close()
				if err := geoseed.WriteFixtures(mb, exportFixtures); err != nil {
					return fmt.Errorf("export fixtures: %w", err)
				}
				log.Info("wrote fixtures", "dir", exportFixtures)
			}

			log.Info("geoseed complete",
				"aerodromes", len(cat.Aerodromes),
				"ports", len(cat.Ports),
				"sea_lanes", len(cat.SeaLanes),
				"road_anchors", len(cat.RoadAnchors),
				"regions", len(cat.Regions),
			)
			return nil
		},
	}

	root.Flags().StringVar(&mbtilesPath, "mbtiles", "", "Path to openmaptiles.mbtiles (default: MBTILES_PATH)")
	root.Flags().StringVar(&databaseURL, "database-url", "", "Postgres URL (default: DATABASE_URL)")
	root.Flags().StringVar(&exportJSON, "export-json", "", "Write columnar geo-seeds.json to this path")
	root.Flags().StringVar(&exportFixtures, "export-fixtures", "", "Write terrain PBF fixtures to this directory")
	root.Flags().BoolVar(&skipDB, "skip-db", false, "Mine only; do not write Postgres")

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
