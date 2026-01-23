package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"feed/internal/feeds"
)

type Client struct {
	stops map[string]bool
	send  chan []byte
}

type SSEHub struct {
	cache     *feeds.ArrivalCache
	clients   map[*Client]struct{}
	mu        sync.RWMutex
	broadcast chan struct{}
}

func NewSSEHub(cache *feeds.ArrivalCache, broadcast chan struct{}) *SSEHub {
	return &SSEHub{
		cache:     cache,
		clients:   make(map[*Client]struct{}),
		broadcast: broadcast,
	}
}

func (h *SSEHub) Run() {
	for range h.broadcast {
		h.mu.RLock()
		for client := range h.clients {
			// Check if we have data for this client
			// Optimization: Only build JSON once if stops match?
			// Since every client has different stops, we probably need per-client logic

			arrivals := h.cache.GetForStops(client.stops)
			data, err := json.Marshal(arrivals)
			if err != nil {
				continue
			}

			select {
			case client.send <- data:
			default:
				// Skip if blocked
			}
		}
		h.mu.RUnlock()
	}
}

func (h *SSEHub) HandleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	stopsParam := r.URL.Query()["stops"]
	stops := make(map[string]bool)
	for _, s := range stopsParam {
		stops[s] = true
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	client := &Client{
		stops: stops,
		send:  make(chan []byte, 10),
	}

	h.register(client)
	defer h.unregister(client)

	// Initial send
	initialArrivals := h.cache.GetForStops(stops)
	if initialData, err := json.Marshal(initialArrivals); err == nil {
		fmt.Fprintf(w, "data: %s\n\n", initialData)
		flusher.Flush()
	}

	// KeepAlive ticker to prevent timeout
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case data := <-client.send:
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func (h *SSEHub) register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

func (h *SSEHub) unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	close(c.send)
}
