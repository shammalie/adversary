package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/samber/do/v2"
	httpSwagger "github.com/swaggo/http-swagger/v2"

	"github.com/shammalie/adversary/apps/api/internal/auth"
	"github.com/shammalie/adversary/apps/api/internal/bus"
	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/engine"
	"github.com/shammalie/adversary/apps/api/internal/generate"
	"github.com/shammalie/adversary/apps/api/internal/geoseed"
	"github.com/shammalie/adversary/apps/api/internal/metrics"
	"github.com/shammalie/adversary/apps/api/internal/store"
	"github.com/shammalie/adversary/apps/api/internal/usage"

	_ "github.com/shammalie/adversary/apps/api/docs" // register swagger spec
)

// Package registers the HTTP router in the DI container.
var Package = do.Package(
	do.Lazy(ProvideAuthHandlers),
	do.Lazy(ProvideGeoHandlers),
	do.Lazy(ProvideScenarioHandlers),
	do.Lazy(ProvideGenerateHandlers),
	do.Lazy(ProvideRunHandlers),
	do.Lazy(ProvideManageHandlers),
	do.Lazy(ProvideRouter),
)

// ProvideAuthHandlers wires session auth (used when AUTH_MODE=session).
func ProvideAuthHandlers(i do.Injector) (*AuthHandlers, error) {
	cfg := do.MustInvoke[*config.Config](i)
	pool := do.MustInvoke[*pgxpool.Pool](i)
	ttl, err := time.ParseDuration(cfg.AuthSessionTTL)
	if err != nil || ttl <= 0 {
		ttl = 168 * time.Hour
	}
	svc := &auth.Service{
		Pool:       pool,
		SessionTTL: ttl,
		CookieSec:  cfg.AuthCookieSecure,
	}
	return &AuthHandlers{
		Svc:   svc,
		Cfg:   cfg,
		Store: &store.ScenarioStore{Pool: pool},
	}, nil
}

// GeoHandlers holds geo catalogue HTTP handlers.
type GeoHandlers struct {
	Store    *geoseed.Store
	Reseeder *geoseed.Reseeder
	Cfg      *config.Config
}

// ProvideGeoHandlers wires store + reseeder.
func ProvideGeoHandlers(i do.Injector) (*GeoHandlers, error) {
	cfg := do.MustInvoke[*config.Config](i)
	pool := do.MustInvoke[*pgxpool.Pool](i)
	log := do.MustInvoke[*slog.Logger](i)
	geoStore := &geoseed.Store{Pool: pool}
	return &GeoHandlers{
		Store: geoStore,
		Reseeder: &geoseed.Reseeder{
			Store:       geoStore,
			MBTilesPath: cfg.MBTilesPath,
			Log:         log,
		},
		Cfg: cfg,
	}, nil
}

// ProvideScenarioHandlers wires the scenario store.
func ProvideScenarioHandlers(i do.Injector) (*ScenarioHandlers, error) {
	pool := do.MustInvoke[*pgxpool.Pool](i)
	return &ScenarioHandlers{Store: &store.ScenarioStore{Pool: pool}}, nil
}

// ProvideGenerateHandlers wires the generate / route service.
func ProvideGenerateHandlers(i do.Injector) (*GenerateHandlers, error) {
	cfg := do.MustInvoke[*config.Config](i)
	pool := do.MustInvoke[*pgxpool.Pool](i)
	log := do.MustInvoke[*slog.Logger](i)
	geoStore := &geoseed.Store{Pool: pool}
	reseeder := &geoseed.Reseeder{
		Store: geoStore, MBTilesPath: cfg.MBTilesPath, Log: log,
	}
	svc := generate.NewService(
		pool,
		&store.ScenarioStore{Pool: pool},
		reseeder,
		cfg.GeoTileJSONURL,
		log,
	)
	return &GenerateHandlers{Svc: svc}, nil
}

// ProvideRunHandlers wires run HTTP handlers.
func ProvideRunHandlers(i do.Injector) (*RunHandlers, error) {
	mgr := do.MustInvoke[*engine.Manager](i)
	b := do.MustInvoke[*bus.Bus](i)
	return &RunHandlers{Manager: mgr, Bus: b}, nil
}

// ProvideManageHandlers wires manage HTTP handlers.
func ProvideManageHandlers(i do.Injector) (*ManageHandlers, error) {
	mgr := do.MustInvoke[*engine.Manager](i)
	pool := do.MustInvoke[*pgxpool.Pool](i)
	return &ManageHandlers{
		Store:   &store.ScenarioStore{Pool: pool},
		Manager: mgr,
	}, nil
}

// ProvideRouter builds the Chi router.
func ProvideRouter(i do.Injector) (http.Handler, error) {
	cfg := do.MustInvoke[*config.Config](i)
	authH := do.MustInvoke[*AuthHandlers](i)
	geo := do.MustInvoke[*GeoHandlers](i)
	scenarios := do.MustInvoke[*ScenarioHandlers](i)
	gen := do.MustInvoke[*GenerateHandlers](i)
	runs := do.MustInvoke[*RunHandlers](i)
	manage := do.MustInvoke[*ManageHandlers](i)
	mgr := do.MustInvoke[*engine.Manager](i)
	pool := do.MustInvoke[*pgxpool.Pool](i)

	registerMetricCallbacks(pool, mgr.InstanceID)

	return NewRouter(cfg, authH, geo, scenarios, gen, runs, manage), nil
}

func registerMetricCallbacks(pool *pgxpool.Pool, instanceID string) {
	sc := &store.ScenarioStore{Pool: pool}
	metrics.SetRunsActiveFunc(func() float64 {
		n, err := sc.CountActiveRuns(context.Background())
		if err != nil {
			return 0
		}
		return float64(n)
	})
	metrics.SetLeasesOwnedFunc(func() float64 {
		n, err := sc.CountOwnedLeases(context.Background(), instanceID)
		if err != nil {
			return 0
		}
		return float64(n)
	})
	metrics.SetReseedJobsActiveFunc(func() float64 {
		n, err := sc.CountActiveReseedJobs(context.Background())
		if err != nil {
			return 0
		}
		return float64(n)
	})
}

// NewRouter constructs the root Chi mux.
func NewRouter(cfg *config.Config, authH *AuthHandlers, geo *GeoHandlers, scenarios *ScenarioHandlers, gen *GenerateHandlers, runs *RunHandlers, manage *ManageHandlers) http.Handler {
	r := chi.NewRouter()
	r.Use(corsMiddleware)
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(clientIDMiddleware)
	r.Use(metrics.Middleware)
	var authSvc *auth.Service
	if authH != nil {
		authSvc = authH.Svc
	}
	r.Use(auth.Middleware(cfg, authSvc))

	r.Get("/healthz", Healthz)
	r.Handle("/metrics", metrics.Handler())
	r.Get("/swagger/*", httpSwagger.Handler(
		httpSwagger.URL("/swagger/doc.json"),
	))

	r.Route("/v1", func(r chi.Router) {
		if authH != nil {
			r.Route("/auth", func(r chi.Router) {
				r.Post("/register", authH.Register)
				r.Post("/login", authH.Login)
				r.Post("/logout", authH.Logout)
				r.Get("/me", authH.Me)
			})
		}
		if geo != nil {
			r.Route("/admin/geo", func(r chi.Router) {
				r.Post("/reseed", geo.PostReseed)
				r.Get("/meta", geo.GetMeta)
				r.Get("/jobs/{id}", geo.GetJob)
			})
			r.Route("/geo", func(r chi.Router) {
				r.Get("/regions", geo.GetRegions)
				r.Get("/aerodromes", geo.GetAerodromes)
				r.Get("/ports", geo.GetPorts)
				r.Get("/sea-lanes", geo.GetSeaLanes)
				r.Get("/road-anchors", geo.GetRoadAnchors)
			})
		}
		if scenarios != nil {
			r.Get("/scenarios", scenarios.ListScenarios)
			r.Post("/scenarios", scenarios.CreateScenario)
			r.Post("/scenarios/import", scenarios.ImportScenario)
			if gen != nil {
				r.Post("/scenarios/generate", gen.PostGenerate)
				r.Get("/scenarios/generate/jobs/{id}", gen.GetGenerateJob)
			}
			r.Route("/scenarios/{id}", func(r chi.Router) {
				r.Get("/", scenarios.GetScenario)
				r.Patch("/", scenarios.PatchScenario)
				r.Delete("/", scenarios.DeleteScenario)
				r.Put("/draft", scenarios.PutDraft)
				r.Post("/validate", scenarios.ValidateScenario)
				r.Post("/publish", scenarios.PublishScenario)
				if gen != nil {
					r.Post("/targets/{tid}/route", gen.PostTargetRoute)
				}
			})
		}
		if runs != nil {
			r.Get("/runs", runs.ListRuns)
			r.Post("/runs", runs.CreateRun)
			r.Route("/runs/{id}", func(r chi.Router) {
				r.Get("/", runs.GetRun)
				r.Post("/stop", runs.StopRun)
				r.Get("/snapshot", runs.GetSnapshot)
				r.Get("/viewport", runs.GetViewport)
				r.Get("/ws/ops", runs.OpsWebSocket)
				r.Get("/ws/map", runs.MapWebSocket)
			})
		}
		if manage != nil {
			r.Route("/manage", func(r chi.Router) {
				r.Get("/scenarios", manage.ListManageScenarios)
				r.Get("/stats", manage.GetManageStats)
				r.Delete("/scenarios/{id}", manage.DeleteManageScenario)
				r.Post("/scenarios/bulk-delete", manage.BulkDeleteManageScenarios)
				r.Get("/metrics/usage", manage.GetUsageMetrics)
			})
		}
	})

	return r
}

func clientIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cid := strings.TrimSpace(r.Header.Get("X-Client-Id"))
		if cid == "" {
			cid = strings.TrimSpace(r.Header.Get("X-Client-ID"))
		}
		if cid != "" {
			r = r.WithContext(usage.WithClientID(r.Context(), cid))
		}
		next.ServeHTTP(w, r)
	})
}
