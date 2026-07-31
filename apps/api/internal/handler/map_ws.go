package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/bus"
	"github.com/shammalie/adversary/apps/api/internal/engine"
	"github.com/shammalie/adversary/apps/api/internal/metrics"
	"github.com/shammalie/adversary/apps/api/internal/simulation"
	"github.com/shammalie/adversary/apps/api/internal/store"
	"github.com/shammalie/adversary/apps/api/internal/viewport"
)

// mapViewportControl is the in-band client → server filter update (no reconnect).
type mapViewportControl struct {
	Type             string   `json:"type"`
	West             *float64 `json:"west,omitempty"`
	South            *float64 `json:"south,omitempty"`
	East             *float64 `json:"east,omitempty"`
	North            *float64 `json:"north,omitempty"`
	Zoom             *float64 `json:"zoom,omitempty"`
	IncludeTargetIDs []string `json:"includeTargetIds,omitempty"`
}

// MapWebSocket godoc
// @Summary      Map WebSocket channel
// @Description  Live map: target.updated / catchup.target.updated filtered by bbox ∪ includeTargetIds; run.completed/stopped. In-band control: {"type":"map.viewport","west","south","east","north","zoom?","includeTargetIds"?}. Client eviction: drop overlay when unwatched and outside bbox (server never sends evict). Redis fan-out.
// @Tags         runs
// @Param        id path string true "Run ID"
// @Param        west query number false "Initial west"
// @Param        south query number false "Initial south"
// @Param        east query number false "Initial east"
// @Param        north query number false "Initial north"
// @Param        zoom query number false "Initial zoom (advisory)"
// @Param        includeTargetIds query string false "Comma-separated target ids"
// @Success      101 {string} string "Switching Protocols"
// @Failure      400 {object} errorBody
// @Failure      401 {object} errorBody
// @Failure      404 {object} errorBody
// @Security     CookieAuth
// @Router       /v1/runs/{id}/ws/map [get]
func (h *RunHandlers) MapWebSocket(w http.ResponseWriter, r *http.Request) {
	id, ok := parseRunID(w, r)
	if !ok {
		return
	}
	if _, err := h.Manager.Runs.Get(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrRunNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "run not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}

	filter, err := parseViewportFilter(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	// Allow connect without bbox; client must send map.viewport before spatial filter applies.
	// Until a valid bbox arrives, only includeTargetIds matches (and lifecycle messages).

	_ = h.Manager.EnsureLocal(r.Context(), id)

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()

	metrics.WSInc("map")
	defer metrics.WSDec("map")

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	ch, err := h.Bus.SubscribeOps(ctx, id.String())
	if err != nil {
		_ = conn.WriteJSON(errorBody{Error: "subscribe failed: " + err.Error()})
		return
	}

	var (
		mu      sync.Mutex
		writeMu sync.Mutex
		cur     = filter
	)

	writeJSONMsg := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(v)
	}

	_ = writeJSONMsg(map[string]any{
		"type":   "map.hello",
		"runId":  id.String(),
		"filter": cur,
	})

	// Reader: in-band bbox / includeTargetIds updates (no reconnect storm).
	go func() {
		defer cancel()
		for {
			var ctrl mapViewportControl
			if err := conn.ReadJSON(&ctrl); err != nil {
				return
			}
			if ctrl.Type != "map.viewport" && ctrl.Type != "viewport.update" {
				_ = writeJSONMsg(map[string]any{
					"type":  "map.error",
					"error": "unknown control type; expected map.viewport",
				})
				continue
			}
			mu.Lock()
			next := cur
			if ctrl.West != nil {
				next.BBox.West = *ctrl.West
			}
			if ctrl.South != nil {
				next.BBox.South = *ctrl.South
			}
			if ctrl.East != nil {
				next.BBox.East = *ctrl.East
			}
			if ctrl.North != nil {
				next.BBox.North = *ctrl.North
			}
			if ctrl.Zoom != nil {
				next.Zoom = *ctrl.Zoom
			}
			if ctrl.IncludeTargetIDs != nil {
				next.IncludeTargetIDs = ctrl.IncludeTargetIDs
			}
			if !next.BBox.Valid() && (ctrl.West != nil || ctrl.South != nil || ctrl.East != nil || ctrl.North != nil) {
				mu.Unlock()
				_ = writeJSONMsg(map[string]any{
					"type":  "map.error",
					"error": "invalid bbox",
				})
				continue
			}
			cur = next
			mu.Unlock()
			_ = writeJSONMsg(map[string]any{
				"type":   "map.viewport.ok",
				"filter": next,
			})
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			mu.Lock()
			f := cur
			mu.Unlock()
			out, pass := filterMapBusMessage(f, msg)
			if !pass {
				continue
			}
			if err := writeJSONMsg(out); err != nil {
				return
			}
		}
	}
}

func filterMapBusMessage(f viewport.Filter, msg bus.Message) (bus.Message, bool) {
	switch msg.Type {
	case engine.MsgRunCompleted, engine.MsgRunStopped:
		return msg, true
	case engine.MsgTargetUpdated:
		var st simulation.RuntimeTargetState
		if err := json.Unmarshal(msg.Payload, &st); err != nil {
			return msg, false
		}
		if !viewport.MatchTarget(f, st.TargetID, st.Position) {
			return msg, false
		}
		return msg, true
	case engine.MsgCatchUp:
		var payload struct {
			TargetStates map[string]*simulation.RuntimeTargetState `json:"targetStates"`
			AsOf         string                                    `json:"asOf"`
		}
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			return msg, false
		}
		filtered := viewport.FilterTargetStates(f, payload.TargetStates)
		raw, err := json.Marshal(map[string]any{
			"targetStates": filtered,
			"asOf":         payload.AsOf,
		})
		if err != nil {
			return msg, false
		}
		msg.Payload = raw
		return msg, true
	default:
		// Ops-only: event.ingested, alert.raised, etc.
		return msg, false
	}
}

func parseViewportFilter(r *http.Request) (viewport.Filter, error) {
	q := r.URL.Query()
	f := viewport.Filter{
		IncludeTargetIDs: viewport.ParseIncludeTargetIDs(q.Get("includeTargetIds")),
	}
	if z := q.Get("zoom"); z != "" {
		v, err := strconv.ParseFloat(z, 64)
		if err != nil {
			return f, errInvalidQuery("zoom")
		}
		f.Zoom = v
	}
	hasBBox := q.Get("west") != "" || q.Get("south") != "" || q.Get("east") != "" || q.Get("north") != ""
	if !hasBBox {
		return f, nil
	}
	west, err := strconv.ParseFloat(q.Get("west"), 64)
	if err != nil {
		return f, errInvalidQuery("west")
	}
	south, err := strconv.ParseFloat(q.Get("south"), 64)
	if err != nil {
		return f, errInvalidQuery("south")
	}
	east, err := strconv.ParseFloat(q.Get("east"), 64)
	if err != nil {
		return f, errInvalidQuery("east")
	}
	north, err := strconv.ParseFloat(q.Get("north"), 64)
	if err != nil {
		return f, errInvalidQuery("north")
	}
	f.BBox = viewport.BBox{West: west, South: south, East: east, North: north}
	if !f.BBox.Valid() {
		return f, errInvalidQuery("bbox")
	}
	return f, nil
}

type queryError string

func (e queryError) Error() string { return string(e) }

func errInvalidQuery(field string) error {
	return queryError("invalid " + field)
}
