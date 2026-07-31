package engine

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/samber/do/v2"

	"github.com/shammalie/adversary/apps/api/internal/bus"
	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/lease"
	"github.com/shammalie/adversary/apps/api/internal/scenario"
	"github.com/shammalie/adversary/apps/api/internal/simulation"
	"github.com/shammalie/adversary/apps/api/internal/store"
	"github.com/shammalie/adversary/apps/api/internal/viewport"
)

// Ops wire message types.
const (
	MsgEventIngested = "event.ingested"
	MsgAlertRaised   = "alert.raised"
	MsgTargetUpdated = "target.updated"
	MsgRunCompleted  = "run.completed"
	MsgRunStopped    = "run.stopped"
	MsgCatchUp       = "catchup.target.updated"
)

// LeaseHolder is the acquire/renew/release surface used by the run ticker.
// *lease.Store implements this; tests may inject fakes.
type LeaseHolder interface {
	Acquire(ctx context.Context, runID uuid.UUID, instanceID string) (bool, error)
	Renew(ctx context.Context, runID uuid.UUID, instanceID string) error
	Release(ctx context.Context, runID uuid.UUID, instanceID string) error
}

// Manager owns local tickers for leased runs.
type Manager struct {
	Runs       *store.RunStore
	Scenarios  *store.ScenarioStore
	Leases     LeaseHolder
	Bus        *bus.Bus
	Log        *slog.Logger
	InstanceID string

	mu      sync.Mutex
	runners map[uuid.UUID]context.CancelFunc
	wg      sync.WaitGroup
	rootCtx context.Context
	cancel  context.CancelFunc
}

// Package registers the run engine manager.
var Package = do.Package(
	do.Lazy(Provide),
)

// Provide wires the manager and starts reclaim on a background context.
func Provide(i do.Injector) (*Manager, error) {
	cfg := do.MustInvoke[*config.Config](i)
	pool := do.MustInvoke[*pgxpool.Pool](i)
	log := do.MustInvoke[*slog.Logger](i)
	b := do.MustInvoke[*bus.Bus](i)
	leases := do.MustInvoke[*lease.Store](i)

	instanceID := cfg.InstanceID
	if instanceID == "" {
		instanceID = uuid.NewString()
	}

	m := &Manager{
		Runs:       &store.RunStore{Pool: pool},
		Scenarios:  &store.ScenarioStore{Pool: pool},
		Leases:     leases,
		Bus:        b,
		Log:        log,
		InstanceID: instanceID,
		runners:    make(map[uuid.UUID]context.CancelFunc),
	}
	m.rootCtx, m.cancel = context.WithCancel(context.Background())

	go func() {
		// Brief delay so migrations/health settle in compose.
		time.Sleep(500 * time.Millisecond)
		if err := m.ReclaimActive(m.rootCtx); err != nil {
			log.Warn("reclaim active runs", "err", err)
		}
	}()

	return m, nil
}

// Shutdown stops all local runners.
func (m *Manager) Shutdown(ctx context.Context) error {
	m.cancel()
	m.mu.Lock()
	for id, cancel := range m.runners {
		cancel()
		delete(m.runners, id)
	}
	m.mu.Unlock()
	done := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// StartRun creates a run from a ready scenario and tries to acquire the lease.
func (m *Manager) StartRun(ctx context.Context, scenarioID uuid.UUID, startAt time.Time) (*store.RunRow, error) {
	doc, err := m.Runs.LoadScenarioDocument(ctx, scenarioID)
	if err != nil {
		return nil, err
	}
	offset := simulation.ScheduleOffsetMs(doc.Events, startAt)
	runID := uuid.New()
	rt := simulation.CreateRuntime(*doc, startAt, offset)
	// Fast-forward to now if startAt is in the past (or delay pushes due times).
	rt = simulation.ReconcileRuntime(rt, time.Now().UTC())

	row, err := m.Runs.CreateRun(ctx, runID, scenarioID, startAt, offset, rt)
	if err != nil {
		return nil, err
	}
	if rt.Status == simulation.StatusCompleted {
		now := time.Now().UTC()
		_ = m.Runs.UpdateStatus(ctx, runID, store.RunStatusCompleted, nil, &now)
		_ = m.Bus.PublishOps(ctx, runID.String(), MsgCatchUp, map[string]any{
			"targetStates": simulation.CloneTargetStates(rt.TargetStates),
			"asOf":         now.Format(time.RFC3339Nano),
		})
		_ = m.Bus.PublishOps(ctx, runID.String(), MsgRunCompleted, map[string]any{
			"completedAt": now.Format(time.RFC3339Nano),
		})
		return m.Runs.Get(ctx, runID)
	}

	acquired, err := m.Leases.Acquire(ctx, runID, m.InstanceID)
	if err != nil {
		return row, err
	}
	if acquired {
		m.spawn(runID)
	} else {
		m.Log.Info("run created without local lease", "runId", runID.String())
	}
	return row, nil
}

// StopRun stops a running simulation.
func (m *Manager) StopRun(ctx context.Context, runID uuid.UUID) (*store.RunRow, error) {
	row, err := m.Runs.Get(ctx, runID)
	if err != nil {
		return nil, err
	}
	if row.Status != store.RunStatusRunning {
		return row, nil
	}

	m.stopLocal(runID)

	rt, err := m.Runs.BuildRuntimeFromCheckpoint(ctx, row)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	rt = simulation.StopRuntime(rt, now)
	if err := m.Runs.SaveCheckpoint(ctx, runID, rt); err != nil {
		return nil, err
	}
	if err := m.Runs.UpdateStatus(ctx, runID, store.RunStatusStopped, &now, nil); err != nil {
		return nil, err
	}
	_ = m.Bus.PublishOps(ctx, runID.String(), MsgRunStopped, map[string]any{
		"stoppedAt": now.Format(time.RFC3339Nano),
	})
	_ = m.Leases.Release(ctx, runID, m.InstanceID)
	_ = m.Scenarios.EmitUsage(ctx, "run.stopped", &row.ScenarioID, &runID, nil)
	return m.Runs.Get(ctx, runID)
}

// Snapshot returns the full due-set as of now (REST cold load).
func (m *Manager) Snapshot(ctx context.Context, runID uuid.UUID) (*Snapshot, error) {
	row, err := m.Runs.Get(ctx, runID)
	if err != nil {
		return nil, err
	}
	rt, err := m.Runs.BuildRuntimeFromCheckpoint(ctx, row)
	if err != nil {
		return nil, err
	}
	if rt.Status == simulation.StatusRunning {
		rt = simulation.ReconcileRuntime(rt, time.Now().UTC())
	}
	return &Snapshot{
		Run:            row.ToSummary(),
		Status:         string(rt.Status),
		ProcessedIDs:   rt.ProcessedEventIDs,
		IngestedEvents: rt.IngestedEvents,
		TargetStates:   simulation.CloneTargetStates(rt.TargetStates),
		CriticalIDs:    rt.CriticalAlertIDs,
		AsOf:           time.Now().UTC(),
	}, nil
}

// Snapshot is the REST due-set payload.
type Snapshot struct {
	Run            store.RunSummary                          `json:"run"`
	Status         string                                    `json:"status"`
	ProcessedIDs   []string                                  `json:"processedEventIds"`
	IngestedEvents []scenario.SimulationEvent                `json:"ingestedEvents"`
	TargetStates   map[string]*simulation.RuntimeTargetState `json:"targetStates"`
	CriticalIDs    []string                                  `json:"criticalAlertIds"`
	AsOf           time.Time                                 `json:"asOf"`
}

// ViewportSnapshot is the bbox-filtered map cold-load payload.
type ViewportSnapshot struct {
	Run              store.RunSummary                          `json:"run"`
	Status           string                                    `json:"status"`
	BBox             viewport.BBox                             `json:"bbox"`
	Zoom             float64                                   `json:"zoom,omitempty"`
	IncludeTargetIDs []string                                  `json:"includeTargetIds,omitempty"`
	TargetStates     map[string]*simulation.RuntimeTargetState `json:"targetStates"`
	AsOf             time.Time                                 `json:"asOf"`
}

// Viewport returns targets/trails in bbox ∪ includeTargetIds via PostGIS envelope.
// Best-effort: EnsureLocal so a lease holder may catch up before the spatial read.
// Does not apply events in the HTTP path (lease holder remains source of truth).
func (m *Manager) Viewport(ctx context.Context, runID uuid.UUID, f viewport.Filter) (*ViewportSnapshot, error) {
	if !f.BBox.Valid() {
		return nil, ErrInvalidBBox
	}
	row, err := m.Runs.Get(ctx, runID)
	if err != nil {
		return nil, err
	}
	if row.Status == store.RunStatusRunning {
		_ = m.EnsureLocal(ctx, runID)
		// Re-load after possible catch-up tick.
		row, err = m.Runs.Get(ctx, runID)
		if err != nil {
			return nil, err
		}
	}
	// Ensure indexed positions exist (e.g. runs created before migration or empty sync).
	rt, err := m.Runs.BuildRuntimeFromCheckpoint(ctx, row)
	if err != nil {
		return nil, err
	}
	if err := m.Runs.SyncTargetPositions(ctx, runID, rt.TargetStates); err != nil {
		return nil, err
	}
	states, err := m.Runs.QueryViewport(ctx, runID, f)
	if err != nil {
		return nil, err
	}
	return &ViewportSnapshot{
		Run:              row.ToSummary(),
		Status:           row.Status,
		BBox:             f.BBox,
		Zoom:             f.Zoom,
		IncludeTargetIDs: f.IncludeTargetIDs,
		TargetStates:     states,
		AsOf:             time.Now().UTC(),
	}, nil
}

// ErrInvalidBBox is returned when west>east, south>north, or out of WGS84 range.
var ErrInvalidBBox = errors.New("invalid bbox")

// ReclaimActive tries to acquire leases for all running runs and spawn tickers.
func (m *Manager) ReclaimActive(ctx context.Context) error {
	ids, err := m.Runs.ListRunningIDs(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		ok, err := m.Leases.Acquire(ctx, id, m.InstanceID)
		if err != nil {
			m.Log.Warn("lease acquire", "runId", id.String(), "err", err)
			continue
		}
		if ok {
			m.spawn(id)
		}
	}
	return nil
}

// EnsureLocal tries to acquire and spawn if this instance does not already tick the run.
func (m *Manager) EnsureLocal(ctx context.Context, runID uuid.UUID) error {
	m.mu.Lock()
	_, local := m.runners[runID]
	m.mu.Unlock()
	if local {
		return nil
	}
	ok, err := m.Leases.Acquire(ctx, runID, m.InstanceID)
	if err != nil {
		return err
	}
	if ok {
		m.spawn(runID)
	}
	return nil
}

func (m *Manager) spawn(runID uuid.UUID) {
	m.mu.Lock()
	if _, exists := m.runners[runID]; exists {
		m.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(m.rootCtx)
	m.runners[runID] = cancel
	m.mu.Unlock()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer func() {
			m.mu.Lock()
			delete(m.runners, runID)
			m.mu.Unlock()
		}()
		m.runLoop(ctx, runID)
	}()
}

func (m *Manager) stopLocal(runID uuid.UUID) {
	m.mu.Lock()
	cancel, ok := m.runners[runID]
	if ok {
		cancel()
		delete(m.runners, runID)
	}
	m.mu.Unlock()
}

func (m *Manager) runLoop(ctx context.Context, runID uuid.UUID) {
	log := m.Log.With("runId", runID.String(), "instance", m.InstanceID)
	log.Info("run ticker started")

	heartbeat := time.NewTicker(5 * time.Second)
	defer heartbeat.Stop()

	// Initial fast-forward + catch-up wire (latest target.updated set only).
	if err := m.tickOnce(ctx, runID, true); err != nil {
		if !errors.Is(err, lease.ErrNotHeld) && !errors.Is(err, context.Canceled) {
			log.Warn("initial tick", "err", err)
		}
		if errors.Is(err, lease.ErrNotHeld) {
			log.Info("lost lease on start; stopping")
			return
		}
	}

	timer := time.NewTimer(0)
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	defer timer.Stop()

	for {
		delay, done, err := m.nextWait(ctx, runID)
		if err != nil {
			if errors.Is(err, lease.ErrNotHeld) || errors.Is(err, context.Canceled) {
				log.Info("run ticker exit", "err", err)
				return
			}
			log.Warn("next wait", "err", err)
			delay = 2 * time.Second
		}
		if done {
			log.Info("run completed locally")
			return
		}
		if delay < 0 {
			delay = 0
		}
		if delay > time.Minute {
			// Cap sleep; renew lease and re-check.
			delay = time.Minute
		}
		timer.Reset(delay)

		select {
		case <-ctx.Done():
			log.Info("run ticker cancelled")
			return
		case <-heartbeat.C:
			if err := m.Leases.Renew(ctx, runID, m.InstanceID); err != nil {
				log.Info("lease lost on renew; stopping immediately", "err", err)
				return
			}
		case <-timer.C:
			if err := m.Leases.Renew(ctx, runID, m.InstanceID); err != nil {
				log.Info("lease lost before tick; stopping immediately", "err", err)
				return
			}
			if err := m.tickOnce(ctx, runID, false); err != nil {
				if errors.Is(err, lease.ErrNotHeld) {
					log.Info("lease lost during tick; stopping immediately")
					return
				}
				if !errors.Is(err, context.Canceled) {
					log.Warn("tick", "err", err)
				}
			}
		}
	}
}

func (m *Manager) nextWait(ctx context.Context, runID uuid.UUID) (time.Duration, bool, error) {
	if err := m.Leases.Renew(ctx, runID, m.InstanceID); err != nil {
		return 0, false, err
	}
	row, err := m.Runs.Get(ctx, runID)
	if err != nil {
		return 0, false, err
	}
	if row.Status != store.RunStatusRunning {
		return 0, true, nil
	}
	rt, err := m.Runs.BuildRuntimeFromCheckpoint(ctx, row)
	if err != nil {
		return 0, false, err
	}
	if rt.Status != simulation.StatusRunning {
		return 0, true, nil
	}
	next := simulation.NextEventAt(rt)
	if next == nil {
		return 0, true, nil
	}
	return time.Until(*next), false, nil
}

// tickOnce applies due events. When catchUp is true, suppress per-event floods
// and publish a single catchup.target.updated set (latest target states).
func (m *Manager) tickOnce(ctx context.Context, runID uuid.UUID, catchUp bool) error {
	if err := m.Leases.Renew(ctx, runID, m.InstanceID); err != nil {
		return err
	}
	row, err := m.Runs.Get(ctx, runID)
	if err != nil {
		return err
	}
	if row.Status != store.RunStatusRunning {
		return nil
	}
	rt, err := m.Runs.BuildRuntimeFromCheckpoint(ctx, row)
	if err != nil {
		return err
	}
	if rt.Status != simulation.StatusRunning {
		return nil
	}

	before := len(rt.ProcessedEventIDs)
	beforeCritical := len(rt.CriticalAlertIDs)
	now := time.Now().UTC()
	next := simulation.ReconcileRuntime(rt, now)
	applied := next.ProcessedEventIDs[before:]

	if err := m.Runs.SaveCheckpoint(ctx, runID, next); err != nil {
		return err
	}

	if next.Status == simulation.StatusCompleted {
		completedAt := now
		_ = m.Runs.UpdateStatus(ctx, runID, store.RunStatusCompleted, nil, &completedAt)
		_ = m.Scenarios.EmitUsage(ctx, "run.completed", &row.ScenarioID, &runID, nil)
	}

	if len(applied) == 0 && next.Status != simulation.StatusCompleted {
		return nil
	}

	if catchUp {
		states := simulation.CloneTargetStates(next.TargetStates)
		_ = m.Bus.PublishOps(ctx, runID.String(), MsgCatchUp, map[string]any{
			"targetStates": states,
			"asOf":         now.Format(time.RFC3339Nano),
		})
		if next.Status == simulation.StatusCompleted {
			_ = m.Bus.PublishOps(ctx, runID.String(), MsgRunCompleted, map[string]any{
				"completedAt": now.Format(time.RFC3339Nano),
			})
		}
		return nil
	}

	// Live path: publish each fire + target.updated for touched targets.
	ingestedByID := map[string]scenario.SimulationEvent{}
	for _, e := range next.IngestedEvents {
		ingestedByID[e.ID] = e
	}
	touched := map[string]struct{}{}
	for _, id := range applied {
		ev, ok := ingestedByID[id]
		if !ok {
			continue
		}
		_ = m.Bus.PublishOps(ctx, runID.String(), MsgEventIngested, ev)
		touched[ev.TargetID] = struct{}{}
	}
	if len(next.CriticalAlertIDs) > beforeCritical {
		for _, id := range next.CriticalAlertIDs[beforeCritical:] {
			_ = m.Bus.PublishOps(ctx, runID.String(), MsgAlertRaised, map[string]any{"eventId": id})
		}
	}
	for targetID := range touched {
		st := next.TargetStates[targetID]
		if st == nil {
			continue
		}
		payload, _ := json.Marshal(simulation.CloneTargetStates(map[string]*simulation.RuntimeTargetState{targetID: st})[targetID])
		_ = m.Bus.PublishOps(ctx, runID.String(), MsgTargetUpdated, json.RawMessage(payload))
	}
	if next.Status == simulation.StatusCompleted {
		_ = m.Bus.PublishOps(ctx, runID.String(), MsgRunCompleted, map[string]any{
			"completedAt": now.Format(time.RFC3339Nano),
		})
	}
	return nil
}
