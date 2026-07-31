package geoseed

import (
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strconv"
)

// MineOptions controls logging during a mine run.
type MineOptions struct {
	Log *slog.Logger
}

func (o MineOptions) logger() *slog.Logger {
	if o.Log != nil {
		return o.Log
	}
	return slog.Default()
}

// Mine reads MBTiles and produces a full catalogue (parity with build-geo-seeds.mjs).
func Mine(mb *MBTiles, opts MineOptions) (*Catalogue, error) {
	log := opts.logger()
	aerodromes, err := mineAerodromes(mb, log)
	if err != nil {
		return nil, err
	}
	regions, roadAnchors, err := buildRegions(mb, aerodromes, log)
	if err != nil {
		return nil, err
	}
	ports, seaLanes, err := minePortsAndFerries(mb, REGION_DEFS, log)
	if err != nil {
		return nil, err
	}
	// Supplement sea lanes with mid-bbox samples for boat-capable regions.
	seen := make(map[string]struct{}, len(seaLanes))
	for _, p := range seaLanes {
		seen[quantizeKey(p.Lng, p.Lat, 2)] = struct{}{}
	}
	for _, r := range regions {
		boat := false
		for _, s := range r.Supports {
			if s == "boat" {
				boat = true
				break
			}
		}
		if !boat {
			continue
		}
		w, s, e, n := r.BBox[0], r.BBox[1], r.BBox[2], r.BBox[3]
		cx := roundN((w+e)/2, 4)
		cy := roundN((s+n)/2, 4)
		key := quantizeKey(cx, cy, 2)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		seaLanes = append(seaLanes, SeaLanePoint{Lng: cx, Lat: cy})
	}
	return &Catalogue{
		Aerodromes:  aerodromes,
		Ports:       ports,
		SeaLanes:    seaLanes,
		RoadAnchors: roadAnchors,
		Regions:     regions,
	}, nil
}

func mineAerodromes(mb *MBTiles, log *slog.Logger) ([]Aerodrome, error) {
	log.Info("mining aerodromes", "phase", "z8+z10+runways")
	byKey := map[string]*Aerodrome{}

	ingest := func(feat Feature, lng, lat float64) {
		p := feat.Properties
		iata := propString(p, "iata")
		icao := propString(p, "icao")
		name := propString(p, "name")
		cls := propString(p, "class")
		eleFt := 0
		if v, ok := propNumber(p, "ele_ft"); ok {
			eleFt = int(math.Round(v))
		} else if v, ok := propNumber(p, "ele"); ok {
			eleFt = int(math.Round(v * 3.28084))
		}
		key := icao
		if key == "" {
			key = iata
		}
		if key == "" {
			key = name + "|" + quantizeKey(lng, lat, 2)
		}
		if prev, ok := byKey[key]; ok {
			if prev.IATA == "" && iata != "" {
				prev.IATA = iata
			}
			if prev.ICAO == "" && icao != "" {
				prev.ICAO = icao
			}
			if prev.Name == "" && name != "" {
				prev.Name = name
			}
			if prev.Class == "" && cls != "" {
				prev.Class = cls
			}
			return
		}
		byKey[key] = &Aerodrome{
			ICAO: icao, IATA: iata, Name: name, Class: cls, EleFt: eleFt,
			Lng: roundN(lng, 5), Lat: roundN(lat, 5),
			Runways: [][2]any{},
		}
	}

	z8coords, err := mb.ListZoomCols(8)
	if err != nil {
		return nil, fmt.Errorf("list z8: %w", err)
	}
	for i, c := range z8coords {
		x, tmsY := c[0], c[1]
		y := (1 << 8) - 1 - tmsY
		buf, err := mb.ReadTile(8, x, y)
		if err != nil {
			return nil, err
		}
		if buf == nil {
			continue
		}
		feats, err := decodeLayer(buf, 8, x, y, "aerodrome_label")
		if err != nil {
			return nil, err
		}
		for _, feat := range feats {
			if feat.Type != 1 || len(feat.Geometry) == 0 || len(feat.Geometry[0]) == 0 {
				continue
			}
			pt := feat.Geometry[0][0]
			ingest(feat, pt.Lng, pt.Lat)
		}
		if (i+1)%15000 == 0 {
			log.Info("aerodrome z8 progress", "i", i+1, "total", len(z8coords), "unique", len(byKey))
		}
	}
	log.Info("aerodrome z8 done", "unique", len(byKey))

	regionTiles := map[string]struct{}{}
	for _, r := range REGION_DEFS {
		for _, t := range tilesCoveringBbox(expandBbox(r.BBox, 2), 10) {
			regionTiles[strconv.Itoa(t[0])+"/"+strconv.Itoa(t[1])] = struct{}{}
		}
	}
	scanned := 0
	for key := range regionTiles {
		var x, y int
		_, _ = fmt.Sscanf(key, "%d/%d", &x, &y)
		buf, err := mb.ReadTile(10, x, y)
		if err != nil {
			return nil, err
		}
		scanned++
		if buf == nil {
			continue
		}
		feats, err := decodeLayer(buf, 10, x, y, "aerodrome_label")
		if err != nil {
			return nil, err
		}
		for _, feat := range feats {
			if feat.Type != 1 || len(feat.Geometry) == 0 || len(feat.Geometry[0]) == 0 {
				continue
			}
			pt := feat.Geometry[0][0]
			ingest(feat, pt.Lng, pt.Lat)
		}
		if scanned%5000 == 0 {
			log.Info("aerodrome z10 progress", "scanned", scanned, "total", len(regionTiles), "unique", len(byKey))
		}
	}
	log.Info("aerodrome z10 done", "unique", len(byKey))

	log.Info("attaching runway headings")
	done := 0
	for _, aero := range byKey {
		cx, cy := lngLatToTile(aero.Lng, aero.Lat, 13)
		runwaysByRef := map[string]struct {
			ref string
			hdg int
			len float64
		}{}
		for dx := -1; dx <= 1; dx++ {
			for dy := -1; dy <= 1; dy++ {
				x := cx + dx
				y := cy + dy
				if x < 0 || y < 0 || x >= (1<<13) || y >= (1<<13) {
					continue
				}
				buf, err := mb.ReadTile(13, x, y)
				if err != nil {
					return nil, err
				}
				if buf == nil {
					continue
				}
				feats, err := decodeLayer(buf, 13, x, y, "aeroway")
				if err != nil {
					return nil, err
				}
				for _, feat := range feats {
					if propString(feat.Properties, "class") != "runway" || feat.Type != 2 {
						continue
					}
					for _, line := range feat.Geometry {
						if len(line) < 2 {
							continue
						}
						mid := line[len(line)/2]
						if haversineM(LngLat{aero.Lng, aero.Lat}, mid) > 8000 {
							continue
						}
						length := lineLengthM(line)
						hdg := int(math.Round(bearingDeg(line[0], line[len(line)-1])))
						ref := propString(feat.Properties, "ref")
						if ref == "" {
							ref = "h" + strconv.Itoa(hdg)
						}
						prev, ok := runwaysByRef[ref]
						if !ok || length > prev.len {
							runwaysByRef[ref] = struct {
								ref string
								hdg int
								len float64
							}{ref: ref, hdg: hdg, len: length}
						}
						if length > aero.MaxRunwayM {
							aero.MaxRunwayM = length
						}
					}
				}
			}
		}
		type rw struct {
			ref string
			hdg int
			len float64
		}
		expanded := make([]rw, 0, len(runwaysByRef)*2)
		for _, r := range runwaysByRef {
			if idx := indexByte(r.ref, '/'); idx >= 0 {
				parts := splitSlash(r.ref)
				expanded = append(expanded, rw{ref: parts[0], hdg: r.hdg, len: r.len})
				second := parts[0]
				if len(parts) > 1 && parts[1] != "" {
					second = parts[1]
				}
				expanded = append(expanded, rw{ref: second, hdg: (r.hdg + 180) % 360, len: r.len})
			} else {
				expanded = append(expanded, rw{ref: r.ref, hdg: r.hdg, len: r.len})
			}
		}
		sort.Slice(expanded, func(i, j int) bool { return expanded[i].len > expanded[j].len })
		if len(expanded) > 8 {
			expanded = expanded[:8]
		}
		aero.Runways = make([][2]any, len(expanded))
		for i, r := range expanded {
			aero.Runways[i] = [2]any{r.ref, r.hdg}
		}
		done++
		if done%500 == 0 {
			log.Info("runway progress", "done", done, "total", len(byKey))
		}
	}

	kept := make([]Aerodrome, 0, len(byKey))
	for _, a := range byKey {
		if a.IATA != "" || a.MaxRunwayM >= MinRunwayM {
			kept = append(kept, *a)
		}
	}
	sort.Slice(kept, func(i, j int) bool {
		if kept[i].ICAO != kept[j].ICAO {
			return kept[i].ICAO < kept[j].ICAO
		}
		return kept[i].IATA < kept[j].IATA
	})
	log.Info("aerodromes kept", "kept", len(kept), "candidates", len(byKey), "min_runway_m", MinRunwayM)
	return kept, nil
}

func minePortsAndFerries(mb *MBTiles, regions []RegionDef, log *slog.Logger) ([]Port, []SeaLanePoint, error) {
	log.Info("mining ports / ferry terminals")
	ports := []Port{}
	seaLanePts := []SeaLanePoint{}
	seenPort := map[string]struct{}{}
	seenLane := map[string]struct{}{}

	addPort := func(lng, lat float64, name, kind string) {
		key := kind + "|" + quantizeKey(lng, lat, 3)
		if _, ok := seenPort[key]; ok {
			return
		}
		seenPort[key] = struct{}{}
		ports = append(ports, Port{
			Lng: roundN(lng, 5), Lat: roundN(lat, 5), Name: name, Kind: kind,
		})
	}
	addLane := func(lng, lat float64) {
		key := quantizeKey(lng, lat, 2)
		if _, ok := seenLane[key]; ok {
			return
		}
		seenLane[key] = struct{}{}
		seaLanePts = append(seaLanePts, SeaLanePoint{Lng: roundN(lng, 4), Lat: roundN(lat, 4)})
	}

	for _, region := range regions {
		tiles := tilesCoveringBbox(region.BBox, 12)
		stride := 1
		if len(tiles) > 800 {
			stride = int(math.Ceil(math.Sqrt(float64(len(tiles)) / 400)))
		}
		for i := 0; i < len(tiles); i += stride {
			x, y := tiles[i][0], tiles[i][1]
			buf, err := mb.ReadTile(12, x, y)
			if err != nil {
				return nil, nil, err
			}
			if buf == nil {
				continue
			}
			poi, err := decodeLayer(buf, 12, x, y, "poi")
			if err != nil {
				return nil, nil, err
			}
			for _, feat := range poi {
				cls := propString(feat.Properties, "class")
				sub := propString(feat.Properties, "subclass")
				isHarbor := cls == "harbor" || sub == "harbour" || sub == "marina" || sub == "dock"
				isFerry := cls == "ferry_terminal" || sub == "ferry_terminal"
				if !isHarbor && !isFerry {
					continue
				}
				if feat.Type != 1 || len(feat.Geometry) == 0 || len(feat.Geometry[0]) == 0 {
					continue
				}
				pt := feat.Geometry[0][0]
				if !pointInBbox(pt.Lng, pt.Lat, region.BBox) {
					continue
				}
				kind := "harbor"
				if isFerry {
					kind = "ferry_terminal"
				}
				addPort(pt.Lng, pt.Lat, propString(feat.Properties, "name"), kind)
			}
			trans, err := decodeLayer(buf, 12, x, y, "transportation")
			if err != nil {
				return nil, nil, err
			}
			for _, feat := range trans {
				if propString(feat.Properties, "class") != "ferry" || feat.Type != 2 {
					continue
				}
				for _, line := range feat.Geometry {
					if len(line) < 2 {
						continue
					}
					addPort(line[0].Lng, line[0].Lat, "", "ferry_endpoint")
					end := line[len(line)-1]
					addPort(end.Lng, end.Lat, "", "ferry_endpoint")
					step := max(1, len(line)/4)
					for s := 0; s < len(line); s += step {
						addLane(line[s].Lng, line[s].Lat)
					}
				}
			}
		}
	}
	log.Info("ports mined", "ports", len(ports), "sea_lanes", len(seaLanePts))
	return ports, seaLanePts, nil
}

type probeStats struct {
	RoadHits, OceanHits, LakeHits, DockHits, FerryHits, AeroCount int
}

func probeRegionSupports(mb *MBTiles, region RegionDef, aerodromes []Aerodrome) (supports []string, roadAnchors []LngLat, stats probeStats, err error) {
	supportSet := map[string]struct{}{}
	roadAnchors = []LngLat{}

	roadTiles := tilesCoveringBbox(region.BBox, 10)
	roadStride := max(1, int(math.Ceil(float64(len(roadTiles))/36)))
	for i := 0; i < len(roadTiles); i += roadStride {
		x, y := roadTiles[i][0], roadTiles[i][1]
		buf, err := mb.ReadTile(10, x, y)
		if err != nil {
			return nil, nil, stats, err
		}
		if buf == nil {
			continue
		}
		feats, err := decodeLayer(buf, 10, x, y, "transportation")
		if err != nil {
			return nil, nil, stats, err
		}
		for _, feat := range feats {
			if feat.Type != 2 {
				continue
			}
			cls := propString(feat.Properties, "class")
			if _, ok := drivAble[cls]; !ok {
				continue
			}
			stats.RoadHits++
			if len(roadAnchors) < 8 && len(feat.Geometry) > 0 {
				line := feat.Geometry[0]
				if len(line) > 0 {
					mid := line[len(line)/2]
					if pointInBbox(mid.Lng, mid.Lat, region.BBox) {
						roadAnchors = append(roadAnchors, LngLat{roundN(mid.Lng, 5), roundN(mid.Lat, 5)})
					}
				}
			}
		}
	}
	if stats.RoadHits >= 3 {
		supportSet["car"] = struct{}{}
		supportSet["truck"] = struct{}{}
	}

	waterTiles := tilesCoveringBbox(region.BBox, 8)
	waterStride := max(1, int(math.Ceil(float64(len(waterTiles))/25)))
	for i := 0; i < len(waterTiles); i += waterStride {
		x, y := waterTiles[i][0], waterTiles[i][1]
		buf, err := mb.ReadTile(8, x, y)
		if err != nil {
			return nil, nil, stats, err
		}
		if buf == nil {
			continue
		}
		feats, err := decodeLayer(buf, 8, x, y, "water")
		if err != nil {
			return nil, nil, stats, err
		}
		for _, feat := range feats {
			cls := propString(feat.Properties, "class")
			if feat.Type != 3 || len(feat.Geometry) == 0 || len(feat.Geometry[0]) < 3 {
				continue
			}
			switch cls {
			case "ocean":
				stats.OceanHits++
			case "dock":
				stats.DockHits++
			case "lake":
				stats.LakeHits++
			}
		}
	}

	ferryTiles := tilesCoveringBbox(region.BBox, 10)
	ferryStride := max(1, int(math.Ceil(float64(len(ferryTiles))/20)))
	for i := 0; i < len(ferryTiles); i += ferryStride {
		x, y := ferryTiles[i][0], ferryTiles[i][1]
		buf, err := mb.ReadTile(10, x, y)
		if err != nil {
			return nil, nil, stats, err
		}
		if buf == nil {
			continue
		}
		feats, err := decodeLayer(buf, 10, x, y, "transportation")
		if err != nil {
			return nil, nil, stats, err
		}
		for _, feat := range feats {
			if propString(feat.Properties, "class") == "ferry" {
				stats.FerryHits++
			}
		}
	}
	if stats.OceanHits >= 1 || stats.FerryHits >= 1 || stats.DockHits >= 1 {
		supportSet["boat"] = struct{}{}
	}

	pad := expandBbox(region.BBox, 0.75)
	for _, a := range aerodromes {
		if pointInBbox(a.Lng, a.Lat, pad) {
			stats.AeroCount++
		}
	}
	if stats.AeroCount >= 1 {
		supportSet["aircraft"] = struct{}{}
	}
	if _, ok := supportSet["car"]; ok {
		supportSet["other"] = struct{}{}
	} else if _, ok := supportSet["boat"]; ok {
		supportSet["other"] = struct{}{}
	}

	order := []string{"aircraft", "boat", "car", "truck", "other"}
	for _, c := range order {
		if _, ok := supportSet[c]; ok {
			supports = append(supports, c)
		}
	}
	return supports, roadAnchors, stats, nil
}

func buildRegions(mb *MBTiles, aerodromes []Aerodrome, log *slog.Logger) ([]Region, []RoadAnchor, error) {
	log.Info("deriving region supports")
	regions := make([]Region, 0, len(REGION_DEFS))
	roadAnchors := []RoadAnchor{}
	for _, def := range REGION_DEFS {
		supports, anchors, stats, err := probeRegionSupports(mb, def, aerodromes)
		if err != nil {
			return nil, nil, err
		}
		log.Info("region probed",
			"id", def.ID, "supports", supports,
			"roads", stats.RoadHits, "ocean", stats.OceanHits, "lake", stats.LakeHits,
			"dock", stats.DockHits, "ferry", stats.FerryHits, "aero", stats.AeroCount,
		)
		regions = append(regions, Region{
			ID: def.ID, Name: def.Name, BBox: def.BBox, Supports: supports,
		})
		for _, a := range anchors {
			roadAnchors = append(roadAnchors, RoadAnchor{RegionID: def.ID, Lng: a.Lng, Lat: a.Lat})
		}
	}
	return regions, roadAnchors, nil
}

func roundN(v float64, n int) float64 {
	p := math.Pow(10, float64(n))
	return math.Round(v*p) / p
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func splitSlash(s string) []string {
	out := []string{}
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}
