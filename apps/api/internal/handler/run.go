package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/shammalie/adversary/apps/api/internal/bus"
	"github.com/shammalie/adversary/apps/api/internal/engine"
	"github.com/shammalie/adversary/apps/api/internal/metrics"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

// RunHandlers serves /v1/runs.
type RunHandlers struct {
	Manager *engine.Manager
	Bus     *bus.Bus
}

type createRunRequest struct {
	ScenarioID string `json:"scenarioId"`
	StartAt    string `json:"startAt,omitempty"`
}

type createRunResponse struct {
	RunID string `json:"runId"`
	store.RunSummary
}

var wsUpgrader = websocket.Upgrader{
	// Local / Compose often uses Host(`api.adversary`) without TLS; session
	// auth is enforced by middleware before upgrade when AUTH_MODE=session.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// ListRuns godoc
// @Summary      List runs (Active scenarios)
// @Description  Default: status=running plus recently completed/stopped (updated within 24h). Each row includes scenarioName. Use ?active=true for running-only.
// @Tags         runs
// @Produce      json
// @Param        active query bool false "If true, only status=running"
// @Success      200 {array} store.RunSummary
// @Failure      500 {object} errorBody
// @Router       /v1/runs [get]
func (h *RunHandlers) ListRuns(w http.ResponseWriter, r *http.Request) {
	activeOnly := r.URL.Query().Get("active") == "true"
	items, err := h.Manager.Runs.List(r.Context(), !activeOnly)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	if items == nil {
		items = []store.RunSummary{}
	}
	writeJSON(w, http.StatusOK, items)
}

// CreateRun godoc
// @Summary      Start a run
// @Description  Starts a ready scenario. startAt shifts the schedule (schedule_offset_ms); omit for now. AUTH_MODE=session requires ownership of the scenario.
// @Tags         runs
// @Accept       json
// @Produce      json
// @Param        body body createRunRequest true "scenarioId + optional startAt"
// @Success      201 {object} createRunResponse
// @Failure      400 {object} errorBody
// @Failure      401 {object} errorBody
// @Failure      404 {object} errorBody
// @Failure      409 {object} errorBody
// @Failure      500 {object} errorBody
// @Security     CookieAuth
// @Router       /v1/runs [post]
func (h *RunHandlers) CreateRun(w http.ResponseWriter, r *http.Request) {
	var req createRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return
	}
	scenarioID, err := uuid.Parse(req.ScenarioID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid scenarioId"})
		return
	}
	startAt := time.Now().UTC()
	if req.StartAt != "" {
		t, err := time.Parse(time.RFC3339Nano, req.StartAt)
		if err != nil {
			t, err = time.Parse(time.RFC3339, req.StartAt)
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid startAt (RFC3339)"})
			return
		}
		startAt = t.UTC()
	}

	row, err := h.Manager.StartRun(r.Context(), scenarioID, startAt)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if errors.Is(err, store.ErrScenarioNotReady) {
		writeJSON(w, http.StatusConflict, errorBody{Error: "scenario must be ready"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	sum := row.ToSummary()
	writeJSON(w, http.StatusCreated, createRunResponse{RunID: sum.ID, RunSummary: sum})
}

// GetRun godoc
// @Summary      Get run
// @Tags         runs
// @Produce      json
// @Param        id path string true "Run ID"
// @Success      200 {object} store.RunSummary
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/runs/{id} [get]
func (h *RunHandlers) GetRun(w http.ResponseWriter, r *http.Request) {
	id, ok := parseRunID(w, r)
	if !ok {
		return
	}
	row, err := h.Manager.Runs.Get(r.Context(), id)
	if errors.Is(err, store.ErrRunNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "run not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, row.ToSummary())
}

// StopRun godoc
// @Summary      Stop a run
// @Tags         runs
// @Produce      json
// @Param        id path string true "Run ID"
// @Success      200 {object} store.RunSummary
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/runs/{id}/stop [post]
func (h *RunHandlers) StopRun(w http.ResponseWriter, r *http.Request) {
	id, ok := parseRunID(w, r)
	if !ok {
		return
	}
	row, err := h.Manager.StopRun(r.Context(), id)
	if errors.Is(err, store.ErrRunNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "run not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, row.ToSummary())
}

// GetSnapshot godoc
// @Summary      Run snapshot (full due-set)
// @Description  Cold-load: all events due ≤ now plus current target states (not catch-up wire shape)
// @Tags         runs
// @Produce      json
// @Param        id path string true "Run ID"
// @Success      200 {object} engine.Snapshot
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/runs/{id}/snapshot [get]
func (h *RunHandlers) GetSnapshot(w http.ResponseWriter, r *http.Request) {
	id, ok := parseRunID(w, r)
	if !ok {
		return
	}
	snap, err := h.Manager.Snapshot(r.Context(), id)
	if errors.Is(err, store.ErrRunNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "run not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// GetViewport godoc
// @Summary      Map viewport snapshot
// @Description  Cold-load targets/trails in PostGIS envelope bbox ∪ includeTargetIds. zoom is advisory (LOD reserved). Eviction: client drops overlay when unwatched and outside bbox; server only sends matching targets.
// @Tags         runs
// @Produce      json
// @Param        id path string true "Run ID"
// @Param        west query number true "BBox west (WGS84)"
// @Param        south query number true "BBox south"
// @Param        east query number true "BBox east"
// @Param        north query number true "BBox north"
// @Param        zoom query number false "Map zoom (advisory)"
// @Param        includeTargetIds query string false "Comma-separated off-screen tracked target ids"
// @Success      200 {object} engine.ViewportSnapshot
// @Failure      400 {object} errorBody
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/runs/{id}/viewport [get]
func (h *RunHandlers) GetViewport(w http.ResponseWriter, r *http.Request) {
	id, ok := parseRunID(w, r)
	if !ok {
		return
	}
	f, err := parseViewportFilter(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	if !f.BBox.Valid() {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "west,south,east,north required (valid WGS84 envelope, west≤east, south≤north)"})
		return
	}
	snap, err := h.Manager.Viewport(r.Context(), id, f)
	if errors.Is(err, store.ErrRunNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "run not found"})
		return
	}
	if errors.Is(err, engine.ErrInvalidBBox) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid bbox"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// OpsWebSocket godoc
// @Summary      Ops WebSocket channel
// @Description  Live ops: event.ingested, alert.raised, target.updated, run.completed/stopped; catch-up = catchup.target.updated (latest target set). Redis pub/sub for multi-instance. AUTH_MODE=session requires cookie.
// @Tags         runs
// @Param        id path string true "Run ID"
// @Success      101 {string} string "Switching Protocols"
// @Failure      401 {object} errorBody
// @Failure      404 {object} errorBody
// @Security     CookieAuth
// @Router       /v1/runs/{id}/ws/ops [get]
func (h *RunHandlers) OpsWebSocket(w http.ResponseWriter, r *http.Request) {
	id, ok := parseRunID(w, r)
	if !ok {
		return
	}
	if _, err := h.Manager.Runs.Get(r.Context(), id); errors.Is(err, store.ErrRunNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "run not found"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}

	// Best-effort: if lease is free/expired, this instance may take over.
	_ = h.Manager.EnsureLocal(r.Context(), id)

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()

	metrics.WSInc("ops")
	defer metrics.WSDec("ops")

	ctx := r.Context()
	ch, err := h.Bus.SubscribeOps(ctx, id.String())
	if err != nil {
		_ = conn.WriteJSON(errorBody{Error: "subscribe failed: " + err.Error()})
		return
	}

	// Send a hello so clients know the channel is live.
	_ = conn.WriteJSON(map[string]any{
		"type":  "ops.hello",
		"runId": id.String(),
	})

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteJSON(msg); err != nil {
				return
			}
		}
	}
}

func parseRunID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := chi.URLParam(r, "id")
	id, err := uuid.Parse(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid run id"})
		return uuid.Nil, false
	}
	return id, true
}
