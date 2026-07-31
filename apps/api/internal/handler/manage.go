package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/shammalie/adversary/apps/api/internal/engine"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

// ManageHandlers serves /v1/manage/*.
type ManageHandlers struct {
	Store   *store.ScenarioStore
	Manager *engine.Manager
}

type bulkDeleteRequest struct {
	IDs []string `json:"ids"`
}

type bulkDeleteResult struct {
	Deleted []string          `json:"deleted"`
	Failed  map[string]string `json:"failed,omitempty"`
}

type manageDeleteResponse struct {
	ID          string `json:"id"`
	StoppedRuns int    `json:"stoppedRuns"`
	DeletedRuns int64  `json:"deletedRuns"`
}

// ListManageScenarios godoc
// @Summary      Manage: list scenarios (storage)
// @Description  Paginated list with payload size_bytes, target/event counts, owner, active run count. AUTH_MODE=off: ownerUserId usually null.
// @Tags         manage
// @Produce      json
// @Param        status query string false "draft or ready"
// @Param        q query string false "Name search (ILIKE)"
// @Param        limit query int false "Page size (default 50, max 200)"
// @Param        offset query int false "Offset"
// @Success      200 {object} store.ManageListResult
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/manage/scenarios [get]
func (h *ManageHandlers) ListManageScenarios(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && status != "draft" && status != "ready" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "status must be draft or ready"})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	res, err := h.Store.ListManageScenarios(r.Context(), store.ManageListFilter{
		Status: status,
		Q:      r.URL.Query().Get("q"),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// GetManageStats godoc
// @Summary      Manage: storage / run stats
// @Tags         manage
// @Produce      json
// @Success      200 {object} store.ManageStats
// @Failure      500 {object} errorBody
// @Router       /v1/manage/stats [get]
func (h *ManageHandlers) GetManageStats(w http.ResponseWriter, r *http.Request) {
	st, err := h.Store.GetManageStats(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// DeleteManageScenario godoc
// @Summary      Manage: delete scenario
// @Description  Cascade-stops active runs for the scenario, deletes all runs referencing it, then deletes the scenario.
// @Tags         manage
// @Produce      json
// @Param        id path string true "Scenario ID"
// @Success      200 {object} manageDeleteResponse
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/manage/scenarios/{id} [delete]
func (h *ManageHandlers) DeleteManageScenario(w http.ResponseWriter, r *http.Request) {
	id, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	resp, err := h.deleteOne(r, id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// BulkDeleteManageScenarios godoc
// @Summary      Manage: bulk delete scenarios
// @Description  Same cascade-stop semantics as single delete. Partial success returns 200 with failed map.
// @Tags         manage
// @Accept       json
// @Produce      json
// @Param        body body bulkDeleteRequest true "Scenario ids"
// @Success      200 {object} bulkDeleteResult
// @Failure      400 {object} errorBody
// @Router       /v1/manage/scenarios/bulk-delete [post]
func (h *ManageHandlers) BulkDeleteManageScenarios(w http.ResponseWriter, r *http.Request) {
	var req bulkDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return
	}
	if len(req.IDs) == 0 {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "ids required"})
		return
	}
	if len(req.IDs) > 100 {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "max 100 ids"})
		return
	}

	out := bulkDeleteResult{Deleted: []string{}, Failed: map[string]string{}}
	for _, raw := range req.IDs {
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			out.Failed[raw] = "invalid id"
			continue
		}
		if _, err := h.deleteOne(r, id); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				out.Failed[id.String()] = "not found"
			} else {
				out.Failed[id.String()] = err.Error()
			}
			continue
		}
		out.Deleted = append(out.Deleted, id.String())
	}
	if len(out.Failed) == 0 {
		out.Failed = nil
	}
	writeJSON(w, http.StatusOK, out)
}

// GetUsageMetrics godoc
// @Summary      Manage: product usage metrics
// @Description  Time-bucketed counts from usage_events. Filter by userId / clientId / from / to. Buckets: 15m, 1h (default), 1d. AUTH_MODE=off uses user_id=null rows; optional X-Client-Id is stored in properties.
// @Tags         manage
// @Produce      json
// @Param        from query string false "RFC3339 start (default: now-24h)"
// @Param        to query string false "RFC3339 end (default: now)"
// @Param        userId query string false "Filter by usage_events.user_id"
// @Param        clientId query string false "Filter by properties.client_id"
// @Param        bucket query string false "15m | 1h | 1d"
// @Success      200 {object} store.UsageMetricsResult
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/manage/metrics/usage [get]
func (h *ManageHandlers) GetUsageMetrics(w http.ResponseWriter, r *http.Request) {
	q := store.UsageQuery{
		Bucket:   r.URL.Query().Get("bucket"),
		ClientID: r.URL.Query().Get("clientId"),
	}
	if raw := r.URL.Query().Get("from"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid from (RFC3339)"})
			return
		}
		q.From = t
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid to (RFC3339)"})
			return
		}
		q.To = t
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("userId")); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid userId"})
			return
		}
		q.UserID = &id
	} else if owner := store.ContextOwner(r.Context()); owner != nil {
		// Session mode: default usage rollups to the authenticated user.
		q.UserID = owner
	}

	res, err := h.Store.QueryUsageMetrics(r.Context(), q)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *ManageHandlers) deleteOne(r *http.Request, id uuid.UUID) (*manageDeleteResponse, error) {
	ctx := r.Context()
	if _, err := h.Store.Get(ctx, id); err != nil {
		return nil, err
	}

	running, err := h.Store.ListRunningIDsForScenario(ctx, id)
	if err != nil {
		return nil, err
	}
	stopped := 0
	for _, runID := range running {
		if h.Manager != nil {
			if _, err := h.Manager.StopRun(ctx, runID); err != nil {
				return nil, err
			}
		} else if err := h.Store.ForceStopRun(ctx, runID); err != nil {
			return nil, err
		}
		stopped++
	}

	deletedRuns, err := h.Store.DeleteRunsForScenario(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := h.Store.Delete(ctx, id); err != nil {
		return nil, err
	}
	return &manageDeleteResponse{
		ID:          id.String(),
		StoppedRuns: stopped,
		DeletedRuns: deletedRuns,
	}, nil
}
