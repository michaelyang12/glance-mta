package feeds

import (
	"math"
	"time"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"

	"feed/internal/stations"
)

func ParseFeed(data []byte, db *stations.StationDB) (map[string][]Arrival, error) {
	feed := &gtfs.FeedMessage{}
	if err := proto.Unmarshal(data, feed); err != nil {
		return nil, err
	}

	arrivals := make(map[string][]Arrival)
	now := time.Now().Unix()

	for _, entity := range feed.Entity {
		if entity.TripUpdate == nil {
			continue
		}

		tu := entity.TripUpdate
		// MTA extensions sometimes in TripUpdate, but mostly we rely on StopTimeUpdate
		// Valid trip?
		// Determine line data if possible from TripDescriptor?

		line := ""
		if tu.Trip != nil && tu.Trip.RouteId != nil {
			line = *tu.Trip.RouteId
		}

		for _, stu := range tu.StopTimeUpdate {
			if stu.StopId == nil {
				continue
			}

			stopIDFull := *stu.StopId // e.g. "L08N"
			if len(stopIDFull) < 3 {
				continue
			}

			// Last char usually direction
			dirCode := stopIDFull[len(stopIDFull)-1:]
			baseStopID := stopIDFull[:len(stopIDFull)-1]

			// Check if last char is N or S
			if dirCode != "N" && dirCode != "S" {
				// Sometimes ID doesn't have direction, or is just base?
				// MTA usually follows convention. safely handle?
				baseStopID = stopIDFull
				dirCode = ""
			}

			// Lookup station
			station, found := db.GetStation(baseStopID)
			if !found {
				continue
			}

			var arrivalTime int64
			if stu.Arrival != nil && stu.Arrival.Time != nil {
				arrivalTime = *stu.Arrival.Time
			} else if stu.Departure != nil && stu.Departure.Time != nil {
				arrivalTime = *stu.Departure.Time
			} else {
				continue
			}

			// Filter past trains?
			if arrivalTime < now {
				continue
			}

			minutes := int(math.Round(float64(arrivalTime-now) / 60))
			if minutes < 0 {
				minutes = 0
			}

			// Determine Label
			directionLabel := ""
			if dirCode == "N" {
				directionLabel = station.NorthLabel
			} else if dirCode == "S" {
				directionLabel = station.SouthLabel
			}

			arr := Arrival{
				StopID:        baseStopID, // Group by the station ID, not the specific platform (L08N)
				Station:       station.Name,
				Line:          line, // From TripDescriptor
				Direction:     directionLabel,
				DirectionCode: dirCode,
				Minutes:       minutes,
			}

			arrivals[baseStopID] = append(arrivals[baseStopID], arr)
		}
	}

	return arrivals, nil
}
