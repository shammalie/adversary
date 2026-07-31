package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	// CookieName is the HttpOnly session cookie.
	CookieName = "adversary_session"

	minPasswordLen = 8
	bcryptCost     = bcrypt.DefaultCost
)

// Sentinel errors for auth flows.
var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrEmailTaken         = errors.New("email already registered")
	ErrInvalidEmail       = errors.New("invalid email")
	ErrWeakPassword       = errors.New("password must be at least 8 characters")
	ErrSessionNotFound    = errors.New("session not found")
)

// Service persists users and opaque session tokens.
type Service struct {
	Pool       *pgxpool.Pool
	SessionTTL time.Duration
	CookieSec  bool
}

// User is a public user record (no password hash).
type User struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}

// SessionInfo is returned after login/register.
type SessionInfo struct {
	Token     string
	ExpiresAt time.Time
	User      User
}

// Register creates a user and a session.
func (s *Service) Register(ctx context.Context, email, password string) (*SessionInfo, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return nil, err
	}
	if len(password) < minPasswordLen {
		return nil, ErrWeakPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}
	id := uuid.New()
	now := time.Now().UTC()
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, created_at)
		VALUES ($1, $2, $3, $4)
	`, id, email, string(hash), now)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}
	return s.createSession(ctx, User{ID: id, Email: email, CreatedAt: now})
}

// Login verifies credentials and creates a session.
func (s *Service) Login(ctx context.Context, email, password string) (*SessionInfo, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	var (
		id   uuid.UUID
		hash string
		createdAt time.Time
	)
	err = s.Pool.QueryRow(ctx, `
		SELECT id, password_hash, created_at FROM users WHERE email = $1
	`, email).Scan(&id, &hash, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("lookup user: %w", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}
	return s.createSession(ctx, User{ID: id, Email: email, CreatedAt: createdAt})
}

// Logout deletes the session identified by raw token (best-effort).
func (s *Service) Logout(ctx context.Context, rawToken string) error {
	if rawToken == "" {
		return nil
	}
	sum := hashToken(rawToken)
	_, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, sum[:])
	return err
}

// LogoutSession deletes by session row id.
func (s *Service) LogoutSession(ctx context.Context, sessionID uuid.UUID) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, sessionID)
	return err
}

// LookupToken resolves a raw cookie token to user + session id.
func (s *Service) LookupToken(ctx context.Context, rawToken string) (userID, sessionID uuid.UUID, err error) {
	if s == nil || s.Pool == nil || rawToken == "" {
		return uuid.Nil, uuid.Nil, ErrSessionNotFound
	}
	sum := hashToken(rawToken)
	now := time.Now().UTC()
	err = s.Pool.QueryRow(ctx, `
		SELECT id, user_id FROM sessions
		WHERE token_hash = $1 AND expires_at > $2
	`, sum[:], now).Scan(&sessionID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, uuid.Nil, ErrSessionNotFound
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("lookup session: %w", err)
	}
	return userID, sessionID, nil
}

// GetUser loads a user by id.
func (s *Service) GetUser(ctx context.Context, id uuid.UUID) (*User, error) {
	var u User
	err := s.Pool.QueryRow(ctx, `
		SELECT id, email, created_at FROM users WHERE id = $1
	`, id).Scan(&u.ID, &u.Email, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Service) createSession(ctx context.Context, user User) (*SessionInfo, error) {
	ttl := s.SessionTTL
	if ttl <= 0 {
		ttl = 168 * time.Hour
	}
	raw, err := randomToken()
	if err != nil {
		return nil, err
	}
	sum := hashToken(raw)
	sid := uuid.New()
	exp := time.Now().UTC().Add(ttl)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`, sid, user.ID, sum[:], exp, time.Now().UTC())
	if err != nil {
		return nil, fmt.Errorf("insert session: %w", err)
	}
	return &SessionInfo{Token: raw, ExpiresAt: exp, User: user}, nil
}

func normalizeEmail(email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !strings.Contains(email, "@") || strings.Contains(email, " ") {
		return "", ErrInvalidEmail
	}
	return email, nil
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashToken(raw string) [32]byte {
	return sha256.Sum256([]byte(raw))
}

func isUniqueViolation(err error) bool {
	// pgx wraps pgconn; string match avoids importing pgconn in every build.
	return err != nil && strings.Contains(err.Error(), "duplicate key")
}
