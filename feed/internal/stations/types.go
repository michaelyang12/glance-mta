package stations

type StationInfo struct {
    StopID      string   `json:"stop_id"`
    Name        string   `json:"name"`
    Lines       []string `json:"lines"`
    NorthLabel  string   `json:"north_label"`
    SouthLabel  string   `json:"south_label"`
    Feeds       []string `json:"-"`
}
