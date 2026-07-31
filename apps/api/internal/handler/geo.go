package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/shammalie/adversary/apps/api/internal/geoseed"
)

type reseedResponse struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

type metaResponse struct {
	geoseed.Meta
	LatestJob *geoseed.Job `json:"latestJob,omitempty"`
}

type errorBody struct {
	Error string `json:"error"`
}

// PostReseed godoc
// @Summary      Start geo catalogue reseed
// @Description  Mines MBTILES_PATH asynchronously into PostGIS; one job at a time
// @Tags         admin-geo
// @Produce      json
// @Success      202 {object} reseedResponse
// @Failure      409 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/admin/geo/reseed [post]
func (h *GeoHandlers) PostReseed(w http.ResponseWriter, r *http.Request) {
	job, err := h.Reseeder.StartReseed(r.Context())
	if errors.Is(err, geoseed.ErrReseedBusy) {
		writeJSON(w, http.StatusConflict, errorBody{Error: err.Error()})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, reseedResponse{JobID: job.ID, Status: job.Status})
}

// GetMeta godoc
// @Summary      Geo catalogue metadata
// @Description  Last seed job status, MBTiles path health, and row counts
// @Tags         admin-geo
// @Produce      json
// @Success      200 {object} metaResponse
// @Failure      500 {object} errorBody
// @Router       /v1/admin/geo/meta [get]
func (h *GeoHandlers) GetMeta(w http.ResponseWriter, r *http.Request) {
	meta, err := h.Store.GetMeta(r.Context(), h.Cfg.MBTilesPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	latest, err := h.Store.LatestJob(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, metaResponse{Meta: meta, LatestJob: latest})
}

// GetJob godoc
// @Summary      Reseed job status
// @Tags         admin-geo
// @Produce      json
// @Param        id path string true "Job ID"
// @Success      200 {object} geoseed.Job
// @Failure      404 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/admin/geo/jobs/{id} [get]
func (h *GeoHandlers) GetJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	job, err := h.Store.GetJob(r.Context(), id)
	if errors.Is(err, geoseed.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "job not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

// GetRegions godoc
// @Summary      List geo regions
// @Tags         geo
// @Produce      json
// @Success      200 {array} geoseed.Region
// @Failure      500 {object} errorBody
// @Router       /v1/geo/regions [get]
func (h *GeoHandlers) GetRegions(w http.ResponseWriter, r *http.Request) {
	regions, err := h.Store.ListRegions(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	if regions == nil {
		regions = []geoseed.Region{}
	}
	writeJSON(w, http.StatusOK, regions)
}

// GetAerodromes godoc
// @Summary      List aerodromes in bbox
// @Tags         geo
// @Produce      json
// @Param        west  query number true "West"
// @Param        south query number true "South"
// @Param        east  query number true "East"
// @Param        north query number true "North"
// @Param        limit query int false "Max rows"
// @Success      200 {array} geoseed.PointRow
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/geo/aerodromes [get]
func (h *GeoHandlers) GetAerodromes(w http.ResponseWriter, r *http.Request) {
	h.listBBox(w, r, h.Store.ListAerodromesInBBox)
}

// GetPorts godoc
// @Summary      List ports in bbox
// @Tags         geo
// @Produce      json
// @Param        west  query number true "West"
// @Param        south query number true "South"
// @Param        east  query number true "East"
// @Param        north query number true "North"
// @Param        limit query int false "Max rows"
// @Success      200 {array} geoseed.PointRow
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/geo/ports [get]
func (h *GeoHandlers) GetPorts(w http.ResponseWriter, r *http.Request) {
	h.listBBox(w, r, h.Store.ListPortsInBBox)
}

// GetSeaLanes godoc
// @Summary      List sea-lane points in bbox
// @Tags         geo
// @Produce      json
// @Param        west  query number true "West"
// @Param        south query number true "South"
// @Param        east  query number true "East"
// @Param        north query number true "North"
// @Param        limit query int false "Max rows"
// @Success      200 {array} geoseed.PointRow
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/geo/sea-lanes [get]
func (h *GeoHandlers) GetSeaLanes(w http.ResponseWriter, r *http.Request) {
	h.listBBox(w, r, h.Store.ListSeaLanesInBBox)
}

// GetRoadAnchors godoc
// @Summary      List road anchors in bbox
// @Tags         geo
// @Produce      json
// @Param        west  query number true "West"
// @Param        south query number true "South"
// @Param        east  query number true "East"
// @Param        north query number true "North"
// @Param        limit query int false "Max rows"
// @Success      200 {array} geoseed.PointRow
// @Failure      400 {object} errorBody
// @Failure      500 {object} errorBody
// @Router       /v1/geo/road-anchors [get]
func (h *GeoHandlers) GetRoadAnchors(w http.ResponseWriter, r *http.Request) {
	h.listBBox(w, r, h.Store.ListRoadAnchorsInBBox)
}

type bboxLister func(ctx context.Context, west, south, east, north float64, limit int) ([]geoseed.PointRow, error)

func (h *GeoHandlers) listBBox(w http.ResponseWriter, r *http.Request, list bboxLister) {
	west, south, east, north, ok := parseBBox(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "west,south,east,north query params required"})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := list(r.Context(), west, south, east, north, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: err.Error()})
		return
	}
	if rows == nil {
		rows = []geoseed.PointRow{}
	}
	writeJSON(w, http.StatusOK, rows)
}

func parseBBox(r *http.Request) (west, south, east, north float64, ok bool) {
	q := r.URL.Query()
	var err error
	west, err = strconv.ParseFloat(q.Get("west"), 64)
	if err != nil {
		return
	}
	south, err = strconv.ParseFloat(q.Get("south"), 64)
	if err != nil {
		return
	}
	east, err = strconv.ParseFloat(q.Get("east"), 64)
	if err != nil {
		return
	}
	north, err = strconv.ParseFloat(q.Get("north"), 64)
	if err != nil {
		return
	}
	ok = true
	return
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
