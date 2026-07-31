package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/samber/do/v2"

	"github.com/shammalie/adversary/apps/api/internal/config"
)

// Package registers the Redis bus.
var Package = do.Package(
	do.Lazy(Provide),
)

// Message is a fan-out envelope published on a run ops channel.
type Message struct {
	Type    string          `json:"type"`
	RunID   string          `json:"runId"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Bus fans out run ops events via Redis pub/sub (multi-instance).
type Bus struct {
	client *redis.Client
	log    *slog.Logger
}

// Provide opens a Redis client from config.
func Provide(i do.Injector) (*Bus, error) {
	cfg := do.MustInvoke[*config.Config](i)
	log := do.MustInvoke[*slog.Logger](i)
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	client := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &Bus{client: client, log: log}, nil
}

// New creates a Bus (for tests / manual wiring).
func New(client *redis.Client, log *slog.Logger) *Bus {
	if log == nil {
		log = slog.Default()
	}
	return &Bus{client: client, log: log}
}

// Close closes the Redis client.
func (b *Bus) Close() error {
	if b == nil || b.client == nil {
		return nil
	}
	return b.client.Close()
}

// Client exposes the underlying Redis client (lease helpers / diagnostics).
func (b *Bus) Client() *redis.Client { return b.client }

// OpsChannel returns the Redis channel name for a run's ops feed.
func OpsChannel(runID string) string {
	return "run:" + runID + ":ops"
}

// PublishOps publishes a typed ops message for a run.
func (b *Bus) PublishOps(ctx context.Context, runID, msgType string, payload any) error {
	var raw json.RawMessage
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		raw = encoded
	}
	env := Message{Type: msgType, RunID: runID, Payload: raw}
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return b.client.Publish(ctx, OpsChannel(runID), data).Err()
}

// SubscribeOps streams ops messages until ctx is cancelled.
func (b *Bus) SubscribeOps(ctx context.Context, runID string) (<-chan Message, error) {
	pubsub := b.client.Subscribe(ctx, OpsChannel(runID))
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, err
	}
	ch := make(chan Message, 64)
	go func() {
		defer close(ch)
		defer func() { _ = pubsub.Close() }()
		redisCh := pubsub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-redisCh:
				if !ok {
					return
				}
				var env Message
				if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
					b.log.Warn("ops bus decode", "err", err)
					continue
				}
				select {
				case ch <- env:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return ch, nil
}

// LocalHub is an in-process fan-out used when Redis is unavailable in unit tests.
type LocalHub struct {
	mu   sync.RWMutex
	subs map[string]map[chan Message]struct{}
}

// NewLocalHub creates an empty local hub.
func NewLocalHub() *LocalHub {
	return &LocalHub{subs: make(map[string]map[chan Message]struct{})}
}

// Publish sends to local subscribers.
func (h *LocalHub) Publish(runID string, msg Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs[runID] {
		select {
		case ch <- msg:
		default:
		}
	}
}

// Subscribe registers a subscriber; cancel removes it.
func (h *LocalHub) Subscribe(runID string) (<-chan Message, func()) {
	ch := make(chan Message, 64)
	h.mu.Lock()
	if h.subs[runID] == nil {
		h.subs[runID] = make(map[chan Message]struct{})
	}
	h.subs[runID][ch] = struct{}{}
	h.mu.Unlock()
	cancel := func() {
		h.mu.Lock()
		delete(h.subs[runID], ch)
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}
