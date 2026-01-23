package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"

	"feed/internal/api"
	"feed/internal/config"
	"feed/internal/feeds"
	"feed/internal/stations"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	stationDB, err := stations.LoadStationDB("data/stations.csv")
	if err != nil {
		log.Fatalf("Failed to load stations: %v", err)
	}

	cache := feeds.NewArrivalCache()
	broadcast := make(chan struct{}, 1) // buffered to avoid blocking fetcher if hub is busy?

	hub := api.NewSSEHub(cache, broadcast)
	fetcher := feeds.NewFeedFetcher(cfg, cache, stationDB, broadcast)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	go hub.Run()
	go fetcher.Start(ctx)

	server := api.NewServer(cfg.Server.Port, hub, stationDB, cache)

	go func() {
		fmt.Printf("Server listening on port %d\n", cfg.Server.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	<-ctx.Done()
	fmt.Println("Shutting down...")

	// Cleanup
	server.Shutdown(context.Background())
}
