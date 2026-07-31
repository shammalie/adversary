package handler

import (
	"encoding/json"
	"net/http"
)

// HealthResponse is the JSON body for GET /healthz.
type HealthResponse struct {
	Status string `json:"status" example:"ok"`
}

// Healthz godoc
// @Summary      Health check
// @Description  Returns 200 when the API process is up
// @Tags         system
// @Produce      json
// @Success      200 {object} HealthResponse
// @Router       /healthz [get]
func Healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(HealthResponse{Status: "ok"})
}
