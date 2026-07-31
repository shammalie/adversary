package bus_test

import (
	"sync"
	"testing"

	"go.uber.org/goleak"

	"github.com/shammalie/adversary/apps/api/internal/bus"
)

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

func TestLocalHubPublishSubscribe(t *testing.T) {
	t.Parallel()
	h := bus.NewLocalHub()
	ch, cancel := h.Subscribe("run-1")
	defer cancel()

	h.Publish("run-1", bus.Message{Type: "target.updated", RunID: "run-1"})
	msg, ok := <-ch
	if !ok {
		t.Fatal("channel closed")
	}
	if msg.Type != "target.updated" || msg.RunID != "run-1" {
		t.Fatalf("msg=%+v", msg)
	}
}

func TestLocalHubConcurrentFanout(t *testing.T) {
	t.Parallel()
	h := bus.NewLocalHub()
	const nSubs = 8
	const nPubs = 50

	var wg sync.WaitGroup
	cancels := make([]func(), 0, nSubs)
	received := make([]int, nSubs)
	for i := 0; i < nSubs; i++ {
		ch, cancel := h.Subscribe("run-race")
		cancels = append(cancels, cancel)
		idx := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range ch {
				received[idx]++
			}
		}()
	}

	var pubWG sync.WaitGroup
	for i := 0; i < nPubs; i++ {
		pubWG.Add(1)
		go func() {
			defer pubWG.Done()
			h.Publish("run-race", bus.Message{Type: "event.ingested", RunID: "run-race"})
		}()
	}
	pubWG.Wait()
	for _, c := range cancels {
		c()
	}
	wg.Wait()

	for i, n := range received {
		if n == 0 {
			t.Fatalf("subscriber %d received 0 messages", i)
		}
	}
}
