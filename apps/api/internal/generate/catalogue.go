package generate

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shammalie/adversary/apps/api/internal/geo"
	"github.com/shammalie/adversary/apps/api/internal/geoseed"
)

// Catalogue is the planner-facing geo seed snapshot loaded from Postgres.
type Catalogue struct {
	Regions    []DemoRegion
	Aerodromes []geo.Aerodrome
	Ports      []geo.SeaPort
	SeaLanes   []geo.LngLat
}

// CatalogueLoader reads Phase 2 geo tables.
type CatalogueLoader struct {
	Pool *pgxpool.Pool
}

// IsEmpty reports whether the catalogue has no regions (empty seed).
func (c Catalogue) IsEmpty() bool {
	return len(c.Regions) == 0
}

// Load reads regions + all seed points (bounded) from Postgres.
func (l *CatalogueLoader) Load(ctx context.Context) (Catalogue, error) {
	store := &geoseed.Store{Pool: l.Pool}
	regions, err := store.ListRegions(ctx)
	if err != nil {
		return Catalogue{}, fmt.Errorf("list regions: %w", err)
	}
	out := Catalogue{Regions: make([]DemoRegion, 0, len(regions))}
	for _, r := range regions {
		out.Regions = append(out.Regions, DemoRegion{
			ID: r.ID, Name: r.Name, BBox: [4]float64(r.BBox), Supports: r.Supports,
		})
	}
	if len(regions) == 0 {
		return out, nil
	}

	// World bbox for seed load (soft cap).
	const west, south, east, north = -180.0, -85.0, 180.0, 85.0
	aero, err := store.ListAerodromesInBBox(ctx, west, south, east, north, 5000)
	if err != nil {
		return Catalogue{}, fmt.Errorf("aerodromes: %w", err)
	}
	for _, a := range aero {
		ad := geo.Aerodrome{
			ICAO: a.ICAO, IATA: a.IATA, Name: a.Name, Class: a.Class,
			ElevationFt: float64(a.EleFt),
			Position:    geo.LngLat{Lng: a.Lng, Lat: a.Lat},
		}
		if len(a.Runways) > 0 {
			var raw [][2]any
			if err := json.Unmarshal(a.Runways, &raw); err == nil {
				for _, rw := range raw {
					ref, _ := rw[0].(string)
					hdg := 0.0
					switch v := rw[1].(type) {
					case float64:
						hdg = v
					case int:
						hdg = float64(v)
					}
					ad.Runways = append(ad.Runways, geo.AerodromeRunway{Ref: ref, HeadingDeg: hdg})
				}
			}
		}
		out.Aerodromes = append(out.Aerodromes, ad)
	}

	ports, err := store.ListPortsInBBox(ctx, west, south, east, north, 10000)
	if err != nil {
		return Catalogue{}, fmt.Errorf("ports: %w", err)
	}
	for _, p := range ports {
		out.Ports = append(out.Ports, geo.SeaPort{
			Position: geo.LngLat{Lng: p.Lng, Lat: p.Lat},
			Name:     p.Name, Kind: p.Kind,
		})
	}

	lanes, err := store.ListSeaLanesInBBox(ctx, west, south, east, north, 10000)
	if err != nil {
		return Catalogue{}, fmt.Errorf("sea lanes: %w", err)
	}
	for _, p := range lanes {
		out.SeaLanes = append(out.SeaLanes, geo.LngLat{Lng: p.Lng, Lat: p.Lat})
	}
	return out, nil
}

// RegionByID looks up a catalogue region.
func (c Catalogue) RegionByID(id string) *DemoRegion {
	for i := range c.Regions {
		if c.Regions[i].ID == id {
			return &c.Regions[i]
		}
	}
	return nil
}
