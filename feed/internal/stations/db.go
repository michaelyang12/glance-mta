package stations

import (
    "encoding/csv"
    "os"
    "strings"
)

type StationDB struct {
    stations    map[string]StationInfo
    allStations []StationInfo
    lineToFeed  map[string]string
}

func LoadStationDB(csvPath string) (*StationDB, error) {
    f, err := os.Open(csvPath)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    reader := csv.NewReader(f)
    records, err := reader.ReadAll()
    if err != nil {
        return nil, err
    }

    db := &StationDB{
        stations:   make(map[string]StationInfo),
        lineToFeed: makeLineToFeedMap(),
    }

    // Skip header
    for i, record := range records {
        if i == 0 {
            continue
        }
        
        // Ensure we have enough columns
        if len(record) < 13 {
            continue
        }

        stopID := record[2]
        name := record[5]
        linesStr := record[7]
        northLabel := record[11]
        southLabel := record[12]

        lines := strings.Fields(linesStr)
        
        // Derive feeds
        feedsSet := make(map[string]bool)
        for _, line := range lines {
            if feed, ok := db.lineToFeed[line]; ok {
                feedsSet[feed] = true
            }
        }
        var feeds []string
        for feed := range feedsSet {
            feeds = append(feeds, feed)
        }

        info := StationInfo{
            StopID:     stopID,
            Name:       name,
            Lines:      lines,
            NorthLabel: northLabel,
            SouthLabel: southLabel,
            Feeds:      feeds,
        }

        db.stations[stopID] = info
        db.allStations = append(db.allStations, info)
    }

    return db, nil
}

func (db *StationDB) GetAllStations() []StationInfo {
    return db.allStations
}

func (db *StationDB) GetStation(stopID string) (StationInfo, bool) {
    s, ok := db.stations[stopID]
    return s, ok
}

func (db *StationDB) Search(query string) []StationInfo {
    query = strings.ToLower(query)
    var results []StationInfo
    seen := make(map[string]bool)

    for _, s := range db.allStations {
        if seen[s.StopID] {
            continue
        }
        nameMatch := strings.Contains(strings.ToLower(s.Name), query)
        lineMatch := false
        for _, l := range s.Lines {
            if strings.ToLower(l) == query {
                lineMatch = true
                break
            }
        }
        if nameMatch || lineMatch {
            results = append(results, s)
            seen[s.StopID] = true
        }
    }
    return results
}

func (db *StationDB) GetFeedsForStops(stopIDs []string) []string {
    feedsSet := make(map[string]bool)
    for _, stopID := range stopIDs {
        if s, ok := db.stations[stopID]; ok {
            for _, feed := range s.Feeds {
                feedsSet[feed] = true
            }
        }
    }
    var feeds []string
    for feed := range feedsSet {
        feeds = append(feeds, feed)
    }
    return feeds
}

func makeLineToFeedMap() map[string]string {
    m := make(map[string]string)
    
    // L
    m["L"] = "L"
    
    // G
    m["G"] = "G"
    
    // ACE
    for _, l := range []string{"A", "C", "E"} {
        m[l] = "ACE"
    }
    
    // BDFM
    for _, l := range []string{"B", "D", "F", "M"} {
        m[l] = "BDFM"
    }
    
    // NQRW
    for _, l := range []string{"N", "Q", "R", "W"} {
        m[l] = "NQRW"
    }
    
    // JZ
    for _, l := range []string{"J", "Z"} {
        m[l] = "JZ"
    }
    
    // 1-7, S
    for _, l := range []string{"1", "2", "3", "4", "5", "6", "7", "S"} {
        m[l] = "1234567"
    }
    
    // SIR
    m["SIR"] = "SIR"
    
    return m
}
