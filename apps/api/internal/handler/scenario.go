package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/shammalie/adversary/apps/api/internal/scenario"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

const maxScenarioBody = 8 << 20 // 8 MiB

// ScenarioHandlers serves /v1/scenarios.
type ScenarioHandlers struct {
	Store *store.ScenarioStore
}

type scenarioResponse struct {
	ID            string                     `json:"id"`
	Name          string                     `json:"name"`
	Status        string                     `json:"status"`
	Payload       json.RawMessage            `json:"payload"`
	SchemaVersion int                        `json:"schemaVersion"`
	CreatedAt     time.Time                  `json:"createdAt"`
	UpdatedAt     time.Time                  `json:"updatedAt"`
	Issues        []scenario.ValidationIssue `json:"issues,omitempty"`
}

type createScenarioRequest struct {
	Name    string          `json:"name"`
	Payload json.RawMessage `json:"payload"`
}

type patchScenarioRequest struct {
	Name *string `json:"name"`
}

type validateResponse struct {
	Valid  bool                       `json:"valid"`
	Issues []scenario.ValidationIssue `json:"issues"`
}

func rowToResponse(row *store.ScenarioRow, issues []scenario.ValidationIssue) scenarioResponse {
	resp := scenarioResponse{
		ID:            row.ID.String(),
		Name:          row.Name,
		Status:        row.Status,
		Payload:       row.Payload,
		SchemaVersion: row.SchemaVersion,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
	if len(issues) > 0 {
		resp.Issues = issues
	}
	return resp
}

// ListScenarios godoc
// @Summary      List scenarios
// @Description  Includes drafts by default; use status=ready for the run picker
// @Tags         scenarios
// @Produce      json
// @Param        status query string false "Filter: draft or ready"
// @Success      200 {array} store.ScenarioSummary
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios [get]
func (h *ScenarioHandlers) ListScenarios(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && status != scenario.StatusDraft && status != scenario.StatusReady {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "status must be draft or ready"})
		return
	}
	items, err := h.Store.List(r.Context(), store.ListFilter{Status: status})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// CreateScenario godoc
// @Summary      Create scenario draft
// @Description  Creates an empty draft or seeds payload when provided. AUTH_MODE=session sets owner_user_id from the session cookie.
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        body body createScenarioRequest false "Optional name/payload"
// @Success      201 {object} scenarioResponse
// @Failure      400 {object} errorBody
// @Failure      401 {object} errorBody
// @Failure      500 {object} errorBody
// @Security     CookieAuth
// @Router       /v1/scenarios [post]
func (h *ScenarioHandlers) CreateScenario(w http.ResponseWriter, r *http.Request) {
	body, err := readLimitedJSON(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	var req createScenarioRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
			return
		}
	}

	id := uuid.New()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Untitled operation"
	}

	var payload any
	if len(req.Payload) > 0 && string(req.Payload) != "null" {
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid payload"})
			return
		}
		payload = scenario.EnsurePayloadID(payload, id.String())
		if n := scenario.ExtractName(payload); n != "Untitled import" {
			name = n
		}
	} else {
		payload = map[string]any{
			"schemaVersion": 2,
			"id":            id.String(),
			"name":          name,
			"description":   "",
			"createdAt":     now,
			"updatedAt":     now,
			"priorityTerms": []any{},
			"targets":       []any{},
			"events":        []any{},
		}
	}

	row, err := h.Store.CreateDraft(r.Context(), id, name, payload, 2)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	issues := scenario.ValidateBytes(row.Payload)
	writeJSON(w, http.StatusCreated, rowToResponse(row, issues))
}

// GetScenario godoc
// @Summary      Get scenario
// @Tags         scenarios
// @Produce      json
// @Param        id path string true "Scenario ID"
// @Success      200 {object} scenarioResponse
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/{id} [get]
func (h *ScenarioHandlers) GetScenario(w http.ResponseWriter, r *http.Request) {
	id, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	row, err := h.Store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	issues := scenario.ValidateBytes(row.Payload)
	writeJSON(w, http.StatusOK, rowToResponse(row, issues))
}

// PatchScenario godoc
// @Summary      Patch scenario metadata
// @Description  Currently supports renaming (updates denormalized name + payload.name)
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        id path string true "Scenario ID"
// @Param        body body patchScenarioRequest true "Patch"
// @Success      200 {object} scenarioResponse
// @Failure      400 {object} errorBody
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/{id} [patch]
func (h *ScenarioHandlers) PatchScenario(w http.ResponseWriter, r *http.Request) {
	id, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	var req patchScenarioRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxScenarioBody)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return
	}
	if req.Name == nil || strings.TrimSpace(*req.Name) == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "name is required"})
		return
	}
	row, err := h.Store.PatchName(r.Context(), id, strings.TrimSpace(*req.Name))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	issues := scenario.ValidateBytes(row.Payload)
	writeJSON(w, http.StatusOK, rowToResponse(row, issues))
}

// DeleteScenario godoc
// @Summary      Delete scenario
// @Tags         scenarios
// @Param        id path string true "Scenario ID"
// @Success      204 "No Content"
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/{id} [delete]
func (h *ScenarioHandlers) DeleteScenario(w http.ResponseWriter, r *http.Request) {
	id, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	err := h.Store.Delete(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PutDraft godoc
// @Summary      Autosave scenario draft
// @Description  Accepts incomplete JSON (mirrors saveScenarioDraft); never rejects for validation. Returns optional issues for UI badges. Reverts ready→draft.
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        id path string true "Scenario ID"
// @Param        body body object true "Builder document (any JSON object)"
// @Success      200 {object} scenarioResponse
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/{id}/draft [put]
func (h *ScenarioHandlers) PutDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxScenarioBody))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "failed to read body"})
		return
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON"})
		return
	}
	if _, ok := payload.(map[string]any); !ok {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "payload must be a JSON object"})
		return
	}

	migrated, err := scenario.MigrateToV2(payload)
	if err != nil {
		// Keep raw draft if migration fails — still accept.
		migrated = payload
	}
	migrated = scenario.EnsurePayloadID(migrated, id.String())
	migrated = scenario.StampUpdatedAt(migrated, time.Now().UTC())
	name := scenario.ExtractName(migrated)
	sv := scenario.ExtractSchemaVersion(migrated)
	if sv == 0 {
		sv = 2
	}

	row, err := h.Store.UpsertDraft(r.Context(), id, name, migrated, sv)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	issues := scenario.ValidateBytes(row.Payload)
	writeJSON(w, http.StatusOK, rowToResponse(row, issues))
}

// ValidateScenario godoc
// @Summary      Validate scenario payload
// @Description  Full schema checks against stored payload (or optional body override); does not change status
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        id path string true "Scenario ID"
// @Param        body body object false "Optional payload override"
// @Success      200 {object} validateResponse
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/{id}/validate [post]
func (h *ScenarioHandlers) ValidateScenario(w http.ResponseWriter, r *http.Request) {
	id, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	payload, err := h.loadPayloadOrBody(r, id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	issues := scenario.Validate(payload)
	writeJSON(w, http.StatusOK, validateResponse{Valid: len(issues) == 0, Issues: issues})
}

// PublishScenario godoc
// @Summary      Publish scenario
// @Description  Full validation; on success sets status=ready and writes normalized targets/events
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        id path string true "Scenario ID"
// @Param        body body object false "Optional payload override to publish"
// @Success      200 {object} scenarioResponse
// @Failure      400 {object} errorBody
// @Failure      404 {object} errorBody
// @Failure      422 {object} validateResponse
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/{id}/publish [post]
func (h *ScenarioHandlers) PublishScenario(w http.ResponseWriter, r *http.Request) {
	id, ok := parseScenarioID(w, r)
	if !ok {
		return
	}
	payload, err := h.loadPayloadOrBody(r, id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}

	migrated, err := scenario.MigrateToV2(payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "v1 migration failed: " + err.Error()})
		return
	}
	migrated = scenario.EnsurePayloadID(migrated, id.String())

	doc, issues := scenario.ParseValid(migrated)
	if len(issues) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, validateResponse{Valid: false, Issues: issues})
		return
	}
	// Align id field with path.
	doc.ID = id.String()

	row, err := h.Store.Publish(r.Context(), id, doc)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "scenario not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, rowToResponse(row, nil))
}

// ImportScenario godoc
// @Summary      Import scenario JSON
// @Description  Accepts v2 (or v1, migrated server-side). Lands as ready when valid, otherwise draft.
// @Tags         scenarios
// @Accept       json
// @Produce      json
// @Param        body body object true "Scenario document"
// @Success      200 {object} scenarioResponse
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/scenarios/import [post]
func (h *ScenarioHandlers) ImportScenario(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxScenarioBody))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "failed to read body"})
		return
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON"})
		return
	}
	if _, ok := payload.(map[string]any); !ok {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "payload must be a JSON object"})
		return
	}

	migrated, err := scenario.MigrateToV2(payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "v1 migration failed: " + err.Error()})
		return
	}

	idStr := scenario.ExtractID(migrated)
	var id uuid.UUID
	if idStr == "" {
		id = uuid.New()
	} else {
		parsed, err := uuid.Parse(idStr)
		if err != nil {
			id = uuid.New()
		} else {
			id = parsed
		}
	}
	migrated = scenario.EnsurePayloadID(migrated, id.String())
	migrated = scenario.StampUpdatedAt(migrated, time.Now().UTC())
	name := scenario.ExtractName(migrated)
	sv := scenario.ExtractSchemaVersion(migrated)
	if sv == 0 {
		sv = 2
	}

	doc, issues := scenario.ParseValid(migrated)
	var ready *scenario.SimulationScenario
	if len(issues) == 0 {
		doc.ID = id.String()
		ready = doc
	}

	row, err := h.Store.ImportUpsert(r.Context(), id, name, migrated, sv, ready)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	if ready == nil {
		issues = scenario.ValidateBytes(row.Payload)
	} else {
		issues = nil
	}
	writeJSON(w, http.StatusOK, rowToResponse(row, issues))
}

func (h *ScenarioHandlers) loadPayloadOrBody(r *http.Request, id uuid.UUID) (any, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxScenarioBody))
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(raw))) > 0 {
		var payload any
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, errors.New("invalid JSON body")
		}
		return payload, nil
	}
	row, err := h.Store.Get(r.Context(), id)
	if err != nil {
		return nil, err
	}
	var payload any
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func parseScenarioID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := chi.URLParam(r, "id")
	id, err := uuid.Parse(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid scenario id"})
		return uuid.UUID{}, false
	}
	return id, true
}

func readLimitedJSON(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	return io.ReadAll(io.LimitReader(r.Body, maxScenarioBody))
}
