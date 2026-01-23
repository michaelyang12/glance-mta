package feeds

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"feed/internal/config"
	"feed/internal/stations"
)

type FeedFetcher struct {
	feeds      map[string]string // feed name -> URL
	interval   time.Duration
	cache      *ArrivalCache
	stationDB  *stations.StationDB
	httpClient *http.Client
	broadcast  chan struct{}
}

func NewFeedFetcher(cfg *config.Config, cache *ArrivalCache, db *stations.StationDB, broadcast chan struct{}) *FeedFetcher {
	return &FeedFetcher{
		feeds:      cfg.Feeds,
		interval:   cfg.Polling.Interval,
		cache:      cache,
		stationDB:  db,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		broadcast:  broadcast,
	}
}

func (f *FeedFetcher) Start(ctx context.Context) {
	// Initial fetch
	f.fetchAll()

	ticker := time.NewTicker(f.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			f.fetchAll()
		}
	}
}

func (f *FeedFetcher) fetchAll() {
	var wg sync.WaitGroup

	// Temporary map to collect all results before updating cache
	// Actually, cache.Update takes a map, so we can build one big map
	// or update incrementally.
	// Since threads are disjoint, we can produce local maps and then merge.

	// Safer: Mutex protected map or channel.
	// Let's use a channel to collect results.

	type result struct {
		arrivals map[string][]Arrival
		err      error
	}

	results := make(chan result, len(f.feeds))

	for name, url := range f.feeds {
		wg.Add(1)
		go func(n, u string) {
			defer wg.Done()
			arrs, err := f.fetchOne(u)
			results <- result{arrivals: arrs, err: err}
		}(name, url)
	}

	wg.Wait()
	close(results)

	// Merge results
	allArrivals := make(map[string][]Arrival)
	for res := range results {
		if res.err != nil {
			fmt.Printf("Error fetching feed: %v\n", res.err)
			continue
		}
		for stopID, list := range res.arrivals {
			allArrivals[stopID] = append(allArrivals[stopID], list...)
		}
	}

	f.cache.Update(allArrivals)

	// Notify hub
	select {
	case f.broadcast <- struct{}{}:
	default:
	}
}

func (f *FeedFetcher) fetchOne(url string) (map[string][]Arrival, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Headers? Usually required for MTA? API Key?
	// The spec uses public URLs with `api-endpoint.mta.info`.
	// Sometimes these need an x-api-key. The user didn't provide one,
	// but the URLs look like the public proxied ones or the new api.
	// If they fail, we might need a key.
	// But let's assume they work as provided in spec.

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status code %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return ParseFeed(data, f.stationDB)
}
