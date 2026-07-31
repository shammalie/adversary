package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/shammalie/adversary/apps/api/internal/generate"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

// GenerateHandlers serves generate + per-target route endpoints.
type GenerateHandlers struct {
	Svc *generate.Service
}

type generateAccepted struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

// PostGenerate godoc
// @Summary      Generate demo/random scenario
// @Description  Async planner job. Reads geo catalogue from Postgres; empty catalogue kicks reseed when possible else synthetic soft-fail. Result saved as draft (or ready when valid).
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        body body generate.GenerateRequest false "Generate options"
// @Success      202 {object} generateAccepted
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/generate [post]
func (h *GenerateHandlers) PostGenerate(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxScenarioBody))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	var req generate.GenerateRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
			return
		}
	}
	job, err := h.Svc.StartGenerate(r.Context(), req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, generateAccepted{JobID: job.ID, Status: job.Status})
}

// GetGenerateJob godoc
// @Summary      Generate job status
// @Description  Poll progress; on success includes scenarioId
// @Tags         scenarios
// @Produce      json
// @Param        id path string true "Job ID"
// @Success      200 {object} generate.Job
// @Failure      404 {object} errorBody
// @Router       /v1/scenarios/generate/jobs/{id} [get]
func (h *GenerateHandlers) GetGenerateJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	job, ok := h.Svc.GetJob(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "job not found"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

// PostTargetRoute godoc
// @Summary      Plan authentic route for one target
// @Description  Persists generated events into the scenario draft. Soft-fails to synthetic wander when routing fails or catalogue is empty (kicks reseed when possible).
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        id path string true "Scenario ID"
// @Param        tid path string true "Target ID"
// @Param        body body generate.RouteRequest false "Route options"
// @Success      200 {object} generate.RouteTargetResult
// @Failure      400 {object} errorBody
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/{id}/targets/{tid}/route [post]
func (h *GenerateHandlers) PostTargetRoute(w http.ResponseWriter, r *http.Request) {
	sid, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	tid := strings.TrimSpace(chi.URLParam(r, "tid"))
	if tid == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "target id required"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxScenarioBody))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	var req generate.RouteRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
			return
		}
	}
	result, err := h.Svc.RouteTarget(r.Context(), sid, tid, req)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
			return
		}
		if strings.Contains(err.Error(), "target not found") {
			writeJSON(w, http.StatusNotFound, errorBody{Error: "target not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}
