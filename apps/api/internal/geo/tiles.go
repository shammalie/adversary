package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/encoding/mvt"
)

const DefaultTileExtent = 4096

type TileCoord struct{ Z, X, Y int }
type TileBounds struct{ West, East, North, South float64 }

// DecodedFeature is an MVT feature projected into WGS84.
type DecodedFeature struct {
	ID         uint64
	Type       int
	Properties map[string]any
	Geometry   [][]LngLat
}

func LngLatToTile(lng, lat float64, z int) TileCoord {
	n := 1 << z
	x := int(math.Floor((lng + 180) / 360 * float64(n)))
	latRad := lat * math.Pi / 180
	y := int(math.Floor((1 - math.Log(math.Tan(latRad)+1/math.Cos(latRad))/math.Pi) / 2 * float64(n)))
	return TileCoord{Z: z, X: min(max(x, 0), n-1), Y: min(max(y, 0), n-1)}
}

func TileBoundsFor(z, x, y int) TileBounds {
	n := float64(uint(1) << z)
	return TileBounds{West: float64(x)/n*360 - 180, East: float64(x+1)/n*360 - 180,
		North: math.Atan(math.Sinh(math.Pi*(1-2*float64(y)/n))) * 180 / math.Pi,
		South: math.Atan(math.Sinh(math.Pi*(1-2*float64(y+1)/n))) * 180 / math.Pi}
}

func TileLocalToLngLat(z, x, y int, px, py, extent float64) LngLat {
	n := float64(uint(1) << z)
	return LngLat{Lng: ((float64(x)+px/extent)/n)*360 - 180, Lat: math.Atan(math.Sinh(math.Pi*(1-2*(float64(y)+py/extent)/n))) * 180 / math.Pi}
}

type lruCache struct {
	max   int
	mu    sync.Mutex
	m     map[string][]DecodedFeature
	order []string
}

func (c *lruCache) get(k string) ([]DecodedFeature, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[k]
	if !ok {
		return nil, false
	}
	c.touch(k)
	return v, true
}
func (c *lruCache) touch(k string) {
	for i, v := range c.order {
		if v == k {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
	c.order = append(c.order, k)
}
func (c *lruCache) set(k string, v []DecodedFeature) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.m[k]; ok {
		c.touch(k)
	} else {
		c.order = append(c.order, k)
	}
	c.m[k] = v
	for len(c.order) > c.max {
		old := c.order[0]
		c.order = c.order[1:]
		delete(c.m, old)
	}
}
func (c *lruCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m = map[string][]DecodedFeature{}
	c.order = nil
}

// VectorTileClient loads TileJSON then fetches and decodes PBF layers.
type VectorTileClient struct {
	GeoTileJSONURL string
	httpClient     *http.Client
	cache          *lruCache
	mu             sync.Mutex
	template       string
}

func NewVectorTileClient(geoTileJSONURL string, maxEntries int, client *http.Client) *VectorTileClient {
	if maxEntries <= 0 {
		maxEntries = 64
	}
	if client == nil {
		client = http.DefaultClient
	}
	return &VectorTileClient{GeoTileJSONURL: geoTileJSONURL, httpClient: client, cache: &lruCache{max: maxEntries, m: map[string][]DecodedFeature{}}}
}
func (c *VectorTileClient) templateFor(ctx context.Context) (string, error) {
	c.mu.Lock()
	if c.template != "" {
		v := c.template
		c.mu.Unlock()
		return v, nil
	}
	c.mu.Unlock()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.GeoTileJSONURL, nil)
	if err != nil {
		return "", fmt.Errorf("create tilejson request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch tilejson: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("tilejson fetch failed (%d): %s", resp.StatusCode, c.GeoTileJSONURL)
	}
	var body struct {
		Tiles []string `json:"tiles"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("decode tilejson: %w", err)
	}
	if len(body.Tiles) == 0 || body.Tiles[0] == "" {
		return "", fmt.Errorf("tilejson response missing tiles[0] URL template")
	}
	c.mu.Lock()
	c.template = body.Tiles[0]
	c.mu.Unlock()
	return body.Tiles[0], nil
}
func (c *VectorTileClient) GetLayerFeatures(ctx context.Context, z, x, y int, layer string) ([]DecodedFeature, error) {
	key := fmt.Sprintf("%d/%d/%d/%s", z, x, y, layer)
	if v, ok := c.cache.get(key); ok {
		return v, nil
	}
	tpl, err := c.templateFor(ctx)
	if err != nil {
		return nil, err
	}
	url := strings.NewReplacer("{z}", fmt.Sprint(z), "{x}", fmt.Sprint(x), "{y}", fmt.Sprint(y)).Replace(tpl)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create tile request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch tile: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("tile fetch failed (%d): %s", resp.StatusCode, url)
	}
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read tile: %w", err)
	}
	features, err := DecodeLayerFeatures(buf, z, x, y, layer)
	if err != nil {
		return nil, err
	}
	c.cache.set(key, features)
	return features, nil
}

// LayerFeatures implements FeatureSource for the existing road and sea routers.
func (c *VectorTileClient) LayerFeatures(ctx context.Context, z, x, y int, layer string) ([]TileFeature, error) {
	features, err := c.GetLayerFeatures(ctx, z, x, y, layer)
	if err != nil {
		return nil, err
	}
	return tileFeatures(features), nil
}
func (c *VectorTileClient) ClearCache() { c.cache.clear(); c.mu.Lock(); c.template = ""; c.mu.Unlock() }

// FixtureFeatureSource supplies raw PBF tiles keyed as z/x/y.
type FixtureFeatureSource struct{ Tiles map[string][]byte }

func (f FixtureFeatureSource) GetLayerFeatures(_ context.Context, z, x, y int, layer string) ([]DecodedFeature, error) {
	b, ok := f.Tiles[fmt.Sprintf("%d/%d/%d", z, x, y)]
	if !ok {
		return nil, nil
	}
	return DecodeLayerFeatures(b, z, x, y, layer)
}

// LayerFeatures implements FeatureSource for fixture-backed router tests.
func (f FixtureFeatureSource) LayerFeatures(ctx context.Context, z, x, y int, layer string) ([]TileFeature, error) {
	features, err := f.GetLayerFeatures(ctx, z, x, y, layer)
	if err != nil {
		return nil, err
	}
	return tileFeatures(features), nil
}

func tileFeatures(features []DecodedFeature) []TileFeature {
	out := make([]TileFeature, 0, len(features))
	for _, feature := range features {
		tile := TileFeature{Properties: feature.Properties}
		switch feature.Type {
		case 1:
			tile.Type, tile.Lines = FeaturePoint, feature.Geometry
		case 2:
			tile.Type, tile.Lines = FeatureLine, feature.Geometry
		case 3:
			tile.Type, tile.Polygons = FeaturePolygon, [][][]LngLat{feature.Geometry}
		}
		out = append(out, tile)
	}
	return out
}

func DecodeLayerFeatures(buf []byte, z, x, y int, layerName string) ([]DecodedFeature, error) {
	var layers mvt.Layers
	var err error
	if len(buf) >= 2 && buf[0] == 0x1f && buf[1] == 0x8b {
		layers, err = mvt.UnmarshalGzipped(buf)
	} else {
		layers, err = mvt.Unmarshal(buf)
	}
	if err != nil {
		return nil, fmt.Errorf("mvt unmarshal: %w", err)
	}
	for _, layer := range layers {
		if layer.Name != layerName {
			continue
		}
		extent := float64(layer.Extent)
		if extent == 0 {
			extent = DefaultTileExtent
		}
		out := make([]DecodedFeature, 0, len(layer.Features))
		for _, f := range layer.Features {
			if f == nil || f.Geometry == nil {
				continue
			}
			geom, typ := projectMVTGeometry(f.Geometry, z, x, y, extent)
			if len(geom) == 0 {
				continue
			}
			props := map[string]any{}
			for k, v := range f.Properties {
				props[k] = v
			}
			out = append(out, DecodedFeature{ID: featureID(f.ID), Type: typ, Properties: props, Geometry: geom})
		}
		return out, nil
	}
	return nil, nil
}

func featureID(value any) uint64 {
	switch id := value.(type) {
	case uint64:
		return id
	case uint:
		return uint64(id)
	case int:
		return uint64(id)
	case int64:
		return uint64(id)
	default:
		return 0
	}
}
func projectMVTGeometry(g orb.Geometry, z, x, y int, extent float64) ([][]LngLat, int) {
	line := func(v orb.LineString) []LngLat {
		o := make([]LngLat, 0, len(v))
		for _, p := range v {
			o = append(o, TileLocalToLngLat(z, x, y, p[0], p[1], extent))
		}
		return o
	}
	switch v := g.(type) {
	case orb.Point:
		return [][]LngLat{{TileLocalToLngLat(z, x, y, v[0], v[1], extent)}}, 1
	case orb.MultiPoint:
		o := make([][]LngLat, 0, len(v))
		for _, p := range v {
			o = append(o, []LngLat{TileLocalToLngLat(z, x, y, p[0], p[1], extent)})
		}
		return o, 1
	case orb.LineString:
		return [][]LngLat{line(v)}, 2
	case orb.MultiLineString:
		o := make([][]LngLat, 0, len(v))
		for _, q := range v {
			o = append(o, line(q))
		}
		return o, 2
	case orb.Ring:
		return [][]LngLat{line(orb.LineString(v))}, 3
	case orb.Polygon:
		o := make([][]LngLat, 0, len(v))
		for _, q := range v {
			o = append(o, line(orb.LineString(q)))
		}
		return o, 3
	}
	return nil, 0
}
