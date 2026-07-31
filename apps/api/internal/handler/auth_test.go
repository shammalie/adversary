package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/auth"
	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/handler"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

func TestAuthOffRegisterUnavailable(t *testing.T) {
	authH := &handler.AuthHandlers{
		Svc: &auth.Service{},
		Cfg: &config.Config{AuthMode: "off"},
	}
	mux := handler.NewRouter(&config.Config{AuthMode: "off"}, authH, nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewBufferString(`{"email":"a@b.co","password":"password1"}`))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d want 503", rr.Code)
	}
}

func TestAuthSessionRegisterLoginLogout(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := openPool(t, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	cfg := &config.Config{AuthMode: "session", AuthSessionTTL: "1h"}
	authH := &handler.AuthHandlers{
		Svc:   &auth.Service{Pool: pool, SessionTTL: time.Hour},
		Cfg:   cfg,
		Store: &store.ScenarioStore{Pool: pool},
	}
	sc := &handler.ScenarioHandlers{Store: &store.ScenarioStore{Pool: pool}}
	mux := handler.NewRouter(cfg, authH, nil, sc, nil, nil, nil)

	email := "phase8-" + time.Now().UTC().Format("150405.000") + "@example.com"
	body := `{"email":"` + email + `","password":"password1"}`

	reg := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewBufferString(body))
	regRR := httptest.NewRecorder()
	mux.ServeHTTP(regRR, reg)
	if regRR.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", regRR.Code, regRR.Body.String())
	}
	cookie := regRR.Result().Cookies()
	if len(cookie) == 0 || cookie[0].Name != auth.CookieName {
		t.Fatal("expected session cookie")
	}

	// Mutating without cookie → 401
	bare := httptest.NewRequest(http.MethodPost, "/v1/scenarios", bytes.NewBufferString(`{}`))
	bareRR := httptest.NewRecorder()
	mux.ServeHTTP(bareRR, bare)
	if bareRR.Code != http.StatusUnauthorized {
		t.Fatalf("unauth create: %d", bareRR.Code)
	}

	create := httptest.NewRequest(http.MethodPost, "/v1/scenarios", bytes.NewBufferString(`{}`))
	create.AddCookie(cookie[0])
	createRR := httptest.NewRecorder()
	mux.ServeHTTP(createRR, create)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", createRR.Code, createRR.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(createRR.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)

	list := httptest.NewRequest(http.MethodGet, "/v1/scenarios", nil)
	list.AddCookie(cookie[0])
	listRR := httptest.NewRecorder()
	mux.ServeHTTP(listRR, list)
	if listRR.Code != http.StatusOK {
		t.Fatalf("list: %d", listRR.Code)
	}

	get := httptest.NewRequest(http.MethodGet, "/v1/scenarios/"+id, nil)
	get.AddCookie(cookie[0])
	getRR := httptest.NewRecorder()
	mux.ServeHTTP(getRR, get)
	if getRR.Code != http.StatusOK {
		t.Fatalf("get: %d", getRR.Code)
	}

	logout := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	logout.AddCookie(cookie[0])
	logoutRR := httptest.NewRecorder()
	mux.ServeHTTP(logoutRR, logout)
	if logoutRR.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", logoutRR.Code)
	}

	after := httptest.NewRequest(http.MethodGet, "/v1/scenarios", nil)
	after.AddCookie(cookie[0])
	afterRR := httptest.NewRecorder()
	mux.ServeHTTP(afterRR, after)
	if afterRR.Code != http.StatusUnauthorized {
		t.Fatalf("after logout: %d", afterRR.Code)
	}
}
