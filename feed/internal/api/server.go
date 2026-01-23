package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"feed/internal/feeds"
	"feed/internal/stations"
)

type ArrivalsResponse struct {
	Arrivals []feeds.Arrival `json:"arrivals"`
	Stale    bool            `json:"stale"`
}

func NewServer(port int, hub *SSEHub, db *stations.StationDB, cache *feeds.ArrivalCache) *http.Server {
	mux := http.NewServeMux()

	mux.HandleFunc("/stream", hub.HandleStream)

	mux.HandleFunc("/arrivals", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		stopsParam := r.URL.Query().Get("stops")
		var arrivals []feeds.Arrival

		if stopsParam != "" {
			stopIDs := make(map[string]bool)
			for _, s := range strings.Split(stopsParam, ",") {
				s = strings.TrimSpace(s)
				if s != "" {
					stopIDs[s] = true
				}
			}
			arrivals = cache.GetForStops(stopIDs)
		} else {
			arrivals = cache.GetAll()
		}

		if arrivals == nil {
			arrivals = []feeds.Arrival{}
		}

		json.NewEncoder(w).Encode(ArrivalsResponse{
			Arrivals: arrivals,
			Stale:    cache.IsStale(),
		})
	})

	mux.HandleFunc("/stations", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(db.GetAllStations())
	})

	mux.HandleFunc("/stations/search", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
		if q == "" {
			json.NewEncoder(w).Encode([]stations.StationInfo{})
			return
		}
		json.NewEncoder(w).Encode(db.Search(q))
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	return &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: withCORS(mux),
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
