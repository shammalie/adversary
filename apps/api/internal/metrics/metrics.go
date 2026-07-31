// Package metrics exposes Prometheus instrumentation for the API process.
package metrics

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const namespace = "adversary"

var (
	runsActiveFn  atomic.Value // func() float64
	leasesOwnedFn atomic.Value // func() float64
	reseedJobsFn  atomic.Value // func() float64
)

var (
	// Dashboard: histogram_quantile(0.99, sum by (le, route) (rate(adversary_http_request_duration_seconds_bucket[5m])))
	// Alert:     sum(rate(adversary_http_requests_total{status_class="5xx"}[5m])) / sum(rate(adversary_http_requests_total[5m])) > 0.01
	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: namespace,
		Subsystem: "http",
		Name:      "request_duration_seconds",
		Help:      "HTTP request latency in seconds.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"method", "route", "status_class"})

	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: namespace,
		Subsystem: "http",
		Name:      "requests_total",
		Help:      "Total HTTP requests.",
	}, []string{"method", "route", "status_class"})

	// Dashboard: adversary_runs_active
	_ = promauto.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: namespace,
		Name:      "runs_active",
		Help:      "Number of runs with status=running (cluster-wide via DB callback).",
	}, func() float64 { return callFloat(runsActiveFn) })

	// Dashboard: adversary_ws_clients{channel="ops|map"}
	wsClients = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: namespace,
		Name:      "ws_clients",
		Help:      "Open WebSocket connections on this instance.",
	}, []string{"channel"})

	// Dashboard: adversary_leases_owned
	_ = promauto.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: namespace,
		Name:      "leases_owned",
		Help:      "Unexpired run leases owned by this instance.",
	}, func() float64 { return callFloat(leasesOwnedFn) })

	// Dashboard: adversary_reseed_jobs_active
	_ = promauto.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: namespace,
		Name:      "reseed_jobs_active",
		Help:      "Geo reseed jobs in queued/running state.",
	}, func() float64 { return callFloat(reseedJobsFn) })
)

func callFloat(v atomic.Value) float64 {
	if fn, ok := v.Load().(func() float64); ok && fn != nil {
		return fn()
	}
	return 0
}

// SetRunsActiveFunc registers the callback for adversary_runs_active.
func SetRunsActiveFunc(fn func() float64) { runsActiveFn.Store(fn) }

// SetLeasesOwnedFunc registers the callback for adversary_leases_owned.
func SetLeasesOwnedFunc(fn func() float64) { leasesOwnedFn.Store(fn) }

// SetReseedJobsActiveFunc registers the callback for adversary_reseed_jobs_active.
func SetReseedJobsActiveFunc(fn func() float64) { reseedJobsFn.Store(fn) }

// WSInc increments the WebSocket client gauge for channel ("ops" or "map").
func WSInc(channel string) { wsClients.WithLabelValues(channel).Inc() }

// WSDec decrements the WebSocket client gauge for channel ("ops" or "map").
func WSDec(channel string) { wsClients.WithLabelValues(channel).Dec() }

// Handler returns the Prometheus scrape handler.
func Handler() http.Handler {
	return promhttp.Handler()
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response does not implement http.Hijacker")
	}
	return h.Hijack()
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Middleware records request latency/count with low-cardinality labels
// (method, chi route pattern, status_class). Skips /metrics and /swagger/*.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/metrics" || strings.HasPrefix(path, "/swagger") {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		route := routeLabel(r)
		class := statusClass(rec.status)
		method := r.Method
		dur := time.Since(start).Seconds()
		httpDuration.WithLabelValues(method, route, class).Observe(dur)
		httpRequests.WithLabelValues(method, route, class).Inc()
	})
}

func routeLabel(r *http.Request) string {
	if rctx := chi.RouteContext(r.Context()); rctx != nil {
		if p := rctx.RoutePattern(); p != "" {
			return p
		}
	}
	return "unmatched"
}

func statusClass(code int) string {
	switch {
	case code >= 500:
		return "5xx"
	case code >= 400:
		return "4xx"
	case code >= 300:
		return "3xx"
	default:
		return "2xx"
	}
}
