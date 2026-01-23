package feeds

import (
    "sort"
    "sync"
    "time"
)

type Arrival struct {
    StopID        string `json:"stop_id"`
    Station       string `json:"station"`
    Line          string `json:"line"`
    Direction     string `json:"direction"`       // "Manhattan", "Brooklyn", etc.
    DirectionCode string `json:"direction_code"`  // "N" or "S"
    Minutes       int    `json:"minutes"`
}

type ArrivalCache struct {
    mu        sync.RWMutex
    arrivals  map[string][]Arrival // stop_id -> arrivals
    updatedAt time.Time
}

func NewArrivalCache() *ArrivalCache {
    return &ArrivalCache{
        arrivals: make(map[string][]Arrival),
    }
}

func (c *ArrivalCache) Update(newArrivals map[string][]Arrival) {
    c.mu.Lock()
    defer c.mu.Unlock()
    
    // Merge or replace? 
    // For simplicity, we'll replace the entries for the stops we just fetched.
    // Since we fetch by feed, and feeds are disjoint sets of lines/stops mostly, 
    // we can update by iterating.
    // Actually, `newArrivals` might be a partial update (just one feed).
    // But we want to persist arrivals from other feeds.
    
    // However, the caller `fetcher` might give us the result of *one* feed.
    // We should probably just merge them into the main map.
    // If a StopID is in the update, we replace its list.
    
    for stopID, list := range newArrivals {
        // Sort by minutes
        sort.Slice(list, func(i, j int) bool {
            return list[i].Minutes < list[j].Minutes
        })
        c.arrivals[stopID] = list
    }
    c.updatedAt = time.Now()
}

func (c *ArrivalCache) GetForStops(stopIDs map[string]bool) []Arrival {
    c.mu.RLock()
    defer c.mu.RUnlock()

    var result []Arrival
    for stopID := range stopIDs {
        if list, ok := c.arrivals[stopID]; ok {
            result = append(result, list...)
        }
    }
    
    // Sort overall result? Might be nice.
    sort.Slice(result, func(i, j int) bool {
        return result[i].Minutes < result[j].Minutes
    })
    
    return result
}
