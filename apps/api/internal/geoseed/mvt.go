package geoseed

import (
	"fmt"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/encoding/mvt"
)

// Feature is a decoded vector-tile feature in WGS84 (JS miner shape).
type Feature struct {
	Type       int // 1=Point, 2=LineString, 3=Polygon
	Properties map[string]any
	Geometry   [][]LngLat // rings / lines of points
}

func decodeLayer(buf []byte, z, x, y int, layerName string) ([]Feature, error) {
	if len(buf) == 0 {
		return nil, nil
	}
	var (
		layers mvt.Layers
		err    error
	)
	if len(buf) >= 2 && buf[0] == 0x1f && buf[1] == 0x8b {
		layers, err = mvt.UnmarshalGzipped(buf)
	} else {
		layers, err = mvt.Unmarshal(buf)
	}
	if err != nil {
		return nil, fmt.Errorf("mvt unmarshal: %w", err)
	}

	var layer *mvt.Layer
	for _, l := range layers {
		if l.Name == layerName {
			layer = l
			break
		}
	}
	if layer == nil {
		return nil, nil
	}

	extent := float64(layer.Extent)
	if extent == 0 {
		extent = Extent
	}

	out := make([]Feature, 0, len(layer.Features))
	for _, f := range layer.Features {
		if f == nil || f.Geometry == nil {
			continue
		}
		geom, typ := projectGeometry(f.Geometry, z, x, y, extent)
		if len(geom) == 0 {
			continue
		}
		props := map[string]any{}
		for k, v := range f.Properties {
			props[k] = v
		}
		out = append(out, Feature{Type: typ, Properties: props, Geometry: geom})
	}
	return out, nil
}

func projectGeometry(g orb.Geometry, z, x, y int, extent float64) ([][]LngLat, int) {
	switch geom := g.(type) {
	case orb.Point:
		lng, lat := tileLocalToLngLat(z, x, y, geom[0], geom[1], extent)
		return [][]LngLat{{LngLat{lng, lat}}}, 1
	case orb.MultiPoint:
		rings := make([][]LngLat, 0, len(geom))
		for _, p := range geom {
			lng, lat := tileLocalToLngLat(z, x, y, p[0], p[1], extent)
			rings = append(rings, []LngLat{{lng, lat}})
		}
		return rings, 1
	case orb.LineString:
		return [][]LngLat{projectLine(geom, z, x, y, extent)}, 2
	case orb.MultiLineString:
		lines := make([][]LngLat, 0, len(geom))
		for _, ls := range geom {
			lines = append(lines, projectLine(ls, z, x, y, extent))
		}
		return lines, 2
	case orb.Ring:
		return [][]LngLat{projectLine(orb.LineString(geom), z, x, y, extent)}, 3
	case orb.Polygon:
		rings := make([][]LngLat, 0, len(geom))
		for _, r := range geom {
			rings = append(rings, projectLine(orb.LineString(r), z, x, y, extent))
		}
		return rings, 3
	case orb.MultiPolygon:
		rings := make([][]LngLat, 0)
		for _, poly := range geom {
			for _, r := range poly {
				rings = append(rings, projectLine(orb.LineString(r), z, x, y, extent))
			}
		}
		return rings, 3
	case orb.Collection:
		var all [][]LngLat
		typ := 0
		for _, part := range geom {
			g2, t := projectGeometry(part, z, x, y, extent)
			all = append(all, g2...)
			if typ == 0 {
				typ = t
			}
		}
		return all, typ
	default:
		return nil, 0
	}
}

func projectLine(ls orb.LineString, z, x, y int, extent float64) []LngLat {
	out := make([]LngLat, 0, len(ls))
	for _, p := range ls {
		lng, lat := tileLocalToLngLat(z, x, y, p[0], p[1], extent)
		out = append(out, LngLat{lng, lat})
	}
	return out
}

func propString(p map[string]any, key string) string {
	v, ok := p[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

func propNumber(p map[string]any, key string) (float64, bool) {
	v, ok := p[key]
	if !ok || v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int32:
		return float64(t), true
	case int64:
		return float64(t), true
	case uint64:
		return float64(t), true
	default:
		return 0, false
	}
}
