import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

const API_URL = "/arrivals";
const STATIONS_SEARCH_URL = "/stations/search";
const REFRESH_INTERVAL = 15000;
const DEPARTED_DISPLAY_MS = 10000;

const VIEW_MODE_KEY = "mta-view-mode";
const LINE_ORDER_KEY = "mta-line-order";
const STATION_ORDER_KEY = "mta-station-order";
const GLANCE_PINNED_KEY = "mta-glance-pinned";
const USER_STATIONS_KEY = "mta-user-stations";

// Generate a key for tracking a train (without minutes, to track across updates)
function trainKey(arr) {
  return `${arr.station}-${arr.line}-${arr.direction_code}`;
}

// Hash-based routing
function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}

// User stations: [{stop_id, name, lines}]
function useUserStations() {
  const [stations, setStations] = useState(() => {
    const stored = localStorage.getItem(USER_STATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const addStation = (station) => {
    setStations((prev) => {
      if (prev.some((s) => s.stop_id === station.stop_id)) return prev;
      const next = [...prev, station];
      localStorage.setItem(USER_STATIONS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const removeStation = (stopId) => {
    setStations((prev) => {
      const next = prev.filter((s) => s.stop_id !== stopId);
      localStorage.setItem(USER_STATIONS_KEY, JSON.stringify(next));
      return next;
    });
  };

  return { stations, addStation, removeStation };
}

function App() {
  const route = useHashRoute();
  const isDashboard = route === "#/glance";
  const isSearch = route === "#/search";

  const { stations: userStations, addStation, removeStation } =
    useUserStations();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [departedTrains, setDepartedTrains] = useState({});
  const prevArrivalsRef = useRef({});

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem(VIEW_MODE_KEY) || "station";
  });

  const [lineOrder, setLineOrder] = useState(() => {
    const stored = localStorage.getItem(LINE_ORDER_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const [stationOrder, setStationOrder] = useState(() => {
    const stored = localStorage.getItem(STATION_ORDER_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const [draggedItem, setDraggedItem] = useState(null);

  const toggleViewMode = () => {
    const newMode = viewMode === "line" ? "station" : "line";
    setViewMode(newMode);
    localStorage.setItem(VIEW_MODE_KEY, newMode);
  };

  // Build the stops query param from user stations
  const stopsParam = userStations.map((s) => s.stop_id).join(",");

  const fetchArrivals = useCallback(async () => {
    try {
      const url = stopsParam
        ? `${API_URL}?stops=${encodeURIComponent(stopsParam)}`
        : API_URL;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (json.arrivals) {
        const now = Date.now();
        const currentArrivingByKey = {};

        json.arrivals.forEach((arr) => {
          if (arr.minutes === 0) {
            const key = trainKey(arr);
            currentArrivingByKey[key] = arr;
          }
        });

        const newDeparted = { ...departedTrains };
        Object.entries(prevArrivalsRef.current).forEach(([key, prevArr]) => {
          if (!currentArrivingByKey[key]) {
            newDeparted[key] = {
              timestamp: now,
              station: prevArr.station,
              direction: prevArr.direction,
              direction_code: prevArr.direction_code,
              line: prevArr.line,
            };
          }
        });

        Object.keys(newDeparted).forEach((key) => {
          if (now - newDeparted[key].timestamp > DEPARTED_DISPLAY_MS) {
            delete newDeparted[key];
          }
        });

        setDepartedTrains(newDeparted);
        prevArrivalsRef.current = currentArrivingByKey;
      }

      setData(json);
      setError(null);
      setLastFetch(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [stopsParam]);

  useEffect(() => {
    fetchArrivals();
    const interval = setInterval(fetchArrivals, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchArrivals]);

  // Group arrivals by line
  const groupedByLine =
    data?.arrivals?.reduce((acc, arr) => {
      if (!acc[arr.line]) acc[arr.line] = [];
      acc[arr.line].push(arr);
      return acc;
    }, {}) || {};

  // Group arrivals by station
  const groupedByStation =
    data?.arrivals?.reduce((acc, arr) => {
      if (!acc[arr.station]) acc[arr.station] = [];
      acc[arr.station].push(arr);
      return acc;
    }, {}) || {};

  // Sort items based on stored order, with new items at the end
  const sortWithOrder = (items, order) => {
    const orderMap = new Map(order.map((id, idx) => [id, idx]));
    return [...items].sort(([a], [b]) => {
      const aIdx = orderMap.has(a) ? orderMap.get(a) : Infinity;
      const bIdx = orderMap.has(b) ? orderMap.get(b) : Infinity;
      if (aIdx === Infinity && bIdx === Infinity) return a.localeCompare(b);
      return aIdx - bIdx;
    });
  };

  const sortedLines = sortWithOrder(Object.entries(groupedByLine), lineOrder);
  const sortedStations = sortWithOrder(
    Object.entries(groupedByStation),
    stationOrder,
  );

  // Drag and drop handlers
  const handleDragStart = (e, id) => {
    setDraggedItem(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    const items = viewMode === "line" ? sortedLines : sortedStations;
    const order = items.map(([id]) => id);

    const dragIdx = order.indexOf(draggedItem);
    const targetIdx = order.indexOf(targetId);

    order.splice(dragIdx, 1);
    order.splice(targetIdx, 0, draggedItem);

    if (viewMode === "line") {
      setLineOrder(order);
      localStorage.setItem(LINE_ORDER_KEY, JSON.stringify(order));
    } else {
      setStationOrder(order);
      localStorage.setItem(STATION_ORDER_KEY, JSON.stringify(order));
    }

    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  const isStale = data?.stale || !!error;

  // Render Search view
  if (isSearch) {
    return <SearchView userStations={userStations} addStation={addStation} />;
  }

  // Render Dashboard view
  if (isDashboard) {
    return (
      <Dashboard
        data={data}
        loading={loading}
        error={error}
        isStale={isStale}
        departedTrains={departedTrains}
        userStations={userStations}
      />
    );
  }

  // Render detailed view
  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">{"\u25FC"}</span>
            <span className="logo-text">MTA</span>
          </div>
          <div className="header-divider" />
          <span className="header-subtitle">REAL-TIME ARRIVALS</span>
        </div>
        <div className="header-right">
          <a href="#/search" className="dashboard-link" title="Search stations">
            SEARCH
          </a>
          <a href="#/glance" className="dashboard-link" title="Glance view">
            GLANCE
          </a>
          <button
            className="view-toggle"
            onClick={toggleViewMode}
            title="Toggle view mode"
          >
            <span
              className={`view-option ${viewMode === "line" ? "active" : ""}`}
            >
              LINE
            </span>
            <span className="view-separator">/</span>
            <span
              className={`view-option ${viewMode === "station" ? "active" : ""}`}
            >
              STATION
            </span>
          </button>
          <StatusIndicator stale={isStale} error={error} loading={loading} />
          {lastFetch && (
            <span className="last-update">
              {lastFetch.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })}
            </span>
          )}
        </div>
      </header>

      <main className="main">
        {loading && !data ? (
          <div className="loading">
            <div className="loading-bar" />
            <span>CONNECTING...</span>
          </div>
        ) : error && !data ? (
          <div className="error-state">
            <span className="error-icon">!</span>
            <span>CONNECTION ERROR</span>
            <span className="error-detail">{error}</span>
          </div>
        ) : userStations.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">{"\u25FC"}</span>
            <span className="empty-state-title">NO STATIONS ADDED</span>
            <span className="empty-state-subtitle">
              Use{" "}
              <a href="#/search" className="empty-state-link">
                SEARCH
              </a>{" "}
              to find and add stations
            </span>
          </div>
        ) : viewMode === "line" ? (
          <div className="lines-grid">
            {sortedLines.map(([line, arrivals]) => (
              <LineCard
                key={line}
                line={line}
                arrivals={arrivals}
                departedTrains={departedTrains}
                stale={data?.stale}
                offline={!!error}
                isDragging={draggedItem === line}
                onDragStart={(e) => handleDragStart(e, line)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, line)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        ) : (
          <div className="stations-grid">
            {sortedStations.map(([station, arrivals]) => (
              <StationCard
                key={station}
                station={station}
                arrivals={arrivals}
                departedTrains={departedTrains}
                stale={data?.stale}
                offline={!!error}
                isDragging={draggedItem === station}
                onDragStart={(e) => handleDragStart(e, station)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, station)}
                onDragEnd={handleDragEnd}
                userStations={userStations}
                onRemoveStation={removeStation}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="footer">
        <span className="footer-text">WILLIAMSBURG TRANSIT DISPLAY</span>
        <span className="footer-divider">{"\u2022"}</span>
        <span className="footer-text">v2.0</span>
      </footer>
    </div>
  );
}

function StatusIndicator({ stale, error, loading }) {
  const status = error ? "error" : stale ? "stale" : "live";
  const labels = {
    live: "LIVE",
    stale: "STALE",
    error: "OFFLINE",
  };

  return (
    <div className={`status-indicator status-${status}`}>
      <span className="status-dot" />
      <span className="status-label">{labels[status]}</span>
    </div>
  );
}

/* ========================================
   SEARCH VIEW
   ======================================== */

function SearchView({ userStations, addStation }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedStation, setSelectedStation] = useState(null);
  const [arrivals, setArrivals] = useState(null);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);
  const debounceRef = useRef(null);

  // Search stations
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `${STATIONS_SEARCH_URL}?q=${encodeURIComponent(query.trim())}`,
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data || []);
        }
      } catch (e) {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Fetch arrivals for selected station (live updates)
  useEffect(() => {
    if (!selectedStation) {
      setArrivals(null);
      return;
    }

    const fetchStationArrivals = async () => {
      setArrivalsLoading(true);
      try {
        const res = await fetch(
          `${API_URL}?stops=${encodeURIComponent(selectedStation.stop_id)}`,
        );
        if (res.ok) {
          const data = await res.json();
          setArrivals(data);
        }
      } catch (e) {
        // ignore
      } finally {
        setArrivalsLoading(false);
      }
    };

    fetchStationArrivals();
    const interval = setInterval(fetchStationArrivals, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [selectedStation]);

  const isAdded = selectedStation
    ? userStations.some((s) => s.stop_id === selectedStation.stop_id)
    : false;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <a href="#/" className="back-link" title="Back">
            {"\u2190"}
          </a>
          <div className="header-divider" />
          <span className="header-subtitle">SEARCH STATIONS</span>
        </div>
        <div className="header-right">
          <a href="#/" className="dashboard-link">
            ARRIVALS
          </a>
          <a href="#/glance" className="dashboard-link">
            GLANCE
          </a>
        </div>
      </header>

      <main className="main search-main">
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="STATION NAME OR LINE..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedStation(null);
            }}
            autoFocus
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => {
                setQuery("");
                setSelectedStation(null);
                setResults([]);
              }}
            >
              {"\u2715"}
            </button>
          )}
        </div>

        {selectedStation ? (
          <div className="search-detail">
            <div className="search-detail-header">
              <button
                className="search-detail-back"
                onClick={() => setSelectedStation(null)}
              >
                {"\u2190"} RESULTS
              </button>
              <div className="search-detail-station">
                <span className="search-detail-name">
                  {selectedStation.name.toUpperCase()}
                </span>
                <div className="search-detail-lines">
                  {selectedStation.lines.map((l) => (
                    <span key={l} className={`line-badge line-badge-small line-${l}`}>
                      {l}
                    </span>
                  ))}
                </div>
              </div>
              <button
                className={`search-add-btn ${isAdded ? "added" : ""}`}
                onClick={() => {
                  if (!isAdded) {
                    addStation({
                      stop_id: selectedStation.stop_id,
                      name: selectedStation.name,
                      lines: selectedStation.lines,
                    });
                  }
                }}
                disabled={isAdded}
              >
                {isAdded ? "ADDED" : "+ ADD STATION"}
              </button>
            </div>

            {arrivalsLoading && !arrivals ? (
              <div className="loading">
                <div className="loading-bar" />
                <span>LOADING...</span>
              </div>
            ) : arrivals?.arrivals?.length > 0 ? (
              <div className="search-arrivals">
                <SearchArrivalsDisplay arrivals={arrivals.arrivals} />
              </div>
            ) : (
              <div className="search-no-arrivals">
                <span>NO UPCOMING ARRIVALS</span>
              </div>
            )}
          </div>
        ) : (
          <div className="search-results">
            {searching && (
              <div className="search-loading">
                <div className="loading-bar" />
              </div>
            )}
            {!searching && query && results.length === 0 && (
              <div className="search-empty">NO STATIONS FOUND</div>
            )}
            {results.map((station) => {
              const alreadyAdded = userStations.some(
                (s) => s.stop_id === station.stop_id,
              );
              return (
                <button
                  key={station.stop_id}
                  className="search-result-item"
                  onClick={() => setSelectedStation(station)}
                >
                  <div className="search-result-info">
                    <span className="search-result-name">
                      {station.name.toUpperCase()}
                    </span>
                    <div className="search-result-lines">
                      {station.lines.map((l) => (
                        <span
                          key={l}
                          className={`line-badge line-badge-small line-${l}`}
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                  {alreadyAdded && (
                    <span className="search-result-added">{"\u2713"}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function SearchArrivalsDisplay({ arrivals }) {
  // Group by line, then direction
  const grouped = arrivals.reduce((acc, arr) => {
    const key = `${arr.line}-${arr.direction}`;
    if (!acc[key]) {
      acc[key] = {
        line: arr.line,
        direction: arr.direction,
        direction_code: arr.direction_code,
        arrivals: [],
      };
    }
    acc[key].arrivals.push(arr);
    return acc;
  }, {});

  const rows = Object.values(grouped).sort((a, b) => {
    const lineCompare = a.line.localeCompare(b.line);
    if (lineCompare !== 0) return lineCompare;
    return (a.direction_code || "").localeCompare(b.direction_code || "");
  });

  return (
    <div className="search-arrivals-list">
      {rows.map((row) => (
        <div key={`${row.line}-${row.direction}`} className="search-arrival-row">
          <div className="search-arrival-info">
            <span className={`line-badge line-badge-small line-${row.line}`}>
              {row.line}
            </span>
            <span className="search-arrival-direction">
              {row.direction.toUpperCase()}
            </span>
          </div>
          <div className="search-arrival-times">
            {row.arrivals.slice(0, 3).map((arr, i) => (
              <span
                key={i}
                className={`search-arrival-time ${arr.minutes === 0 ? "arriving" : ""} ${arr.minutes <= 3 ? "soon" : ""}`}
              >
                {arr.minutes === 0 ? "ARR" : `${arr.minutes}`}
                {arr.minutes !== 0 && (
                  <span className="search-arrival-unit">m</span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ========================================
   DASHBOARD (GLANCE VIEW)
   ======================================== */

function Dashboard({ data, loading, error, isStale, departedTrains, userStations }) {
  const [pinnedStations, setPinnedStations] = useState(() => {
    const stored = localStorage.getItem(GLANCE_PINNED_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const togglePin = (station) => {
    setPinnedStations((prev) => {
      let next;
      if (prev.includes(station)) {
        next = prev.filter((s) => s !== station);
      } else {
        next = [station, ...prev];
      }
      localStorage.setItem(GLANCE_PINNED_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Group arrivals by station, then by line+direction combo
  const groupedByStation =
    data?.arrivals?.reduce((acc, arr) => {
      if (!acc[arr.station]) acc[arr.station] = [];

      let row = acc[arr.station].find(
        (r) => r.line === arr.line && r.direction === arr.direction,
      );
      if (!row) {
        row = {
          line: arr.line,
          direction: arr.direction,
          directionCode: arr.direction_code,
          arrivals: [],
        };
        acc[arr.station].push(row);
      }
      row.arrivals.push(arr);
      return acc;
    }, {}) || {};

  // Sort arrivals within each row
  Object.values(groupedByStation).forEach((rows) => {
    rows.forEach((row) => row.arrivals.sort((a, b) => a.minutes - b.minutes));
    rows.sort((a, b) => {
      const lineCompare = a.line.localeCompare(b.line);
      if (lineCompare !== 0) return lineCompare;
      const dirOrder = { N: 0, S: 1 };
      return (
        (dirOrder[a.directionCode] ?? 2) - (dirOrder[b.directionCode] ?? 2)
      );
    });
  });

  // Sort: pinned first, then alphabetically
  const stations = Object.entries(groupedByStation).sort(([a], [b]) => {
    const aPin = pinnedStations.indexOf(a);
    const bPin = pinnedStations.indexOf(b);
    const aIsPinned = aPin !== -1;
    const bIsPinned = bPin !== -1;

    if (aIsPinned && bIsPinned) return aPin - bPin;
    if (aIsPinned) return -1;
    if (bIsPinned) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="dashboard">
      {loading && !data ? (
        <div className="dashboard-loading">
          <div className="dashboard-loading-dot" />
        </div>
      ) : error && !data ? (
        <div className="dashboard-error">
          <span className="dashboard-error-icon">!</span>
        </div>
      ) : stations.length === 0 ? (
        <div className="dashboard-empty">
          <span className="empty-state-title">NO STATIONS</span>
          <a href="#/search" className="empty-state-link">
            SEARCH TO ADD
          </a>
        </div>
      ) : (
        <>
          <div className="dashboard-grid">
            {stations.map(([station, rows]) => (
              <DashboardStation
                key={station}
                station={station}
                rows={rows}
                isOffline={!!error}
                departedTrains={departedTrains}
                isPinned={pinnedStations.includes(station)}
                onTogglePin={() => togglePin(station)}
              />
            ))}
          </div>
          <div className="dashboard-footer">
            <span
              className={`dashboard-status-dot ${isStale ? "stale" : error ? "error" : "live"}`}
            />
            <a href="#/" className="dashboard-back-link">
              {"\u22EE"}
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardStation({
  station,
  rows,
  isOffline,
  departedTrains,
  isPinned,
  onTogglePin,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <div className={`dashboard-station ${isPinned ? "pinned" : ""}`}>
      <div className="dashboard-station-name">
        {isPinned && <span className="dashboard-pin-indicator">{"\u2022"}</span>}
        <span className="dashboard-station-icon">{"\u25FC"}</span>
        {station.toUpperCase()}
        <div className="dashboard-station-menu-wrapper" ref={menuRef}>
          <button
            className="dashboard-station-menu-btn"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {"\u22EE"}
          </button>
          {menuOpen && (
            <div className="dashboard-station-menu">
              <button
                className="dashboard-station-menu-item"
                onClick={() => {
                  onTogglePin();
                  setMenuOpen(false);
                }}
              >
                {isPinned ? "Unpin" : "Pin to top"}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="dashboard-rows">
        {rows.map((row, i) => {
          const departedKey = `${station}-${row.line}-${row.directionCode}`;
          const departed = departedTrains[departedKey];
          const prevLine = i > 0 ? rows[i - 1].line : null;
          const isNewLine = prevLine && prevLine !== row.line;
          return (
            <DashboardRow
              key={`${row.line}-${row.direction}`}
              line={row.line}
              direction={row.direction}
              arrivals={row.arrivals}
              isOffline={isOffline}
              departed={departed}
              isNewLine={isNewLine}
            />
          );
        })}
      </div>
    </div>
  );
}

function DashboardRow({
  line,
  direction,
  arrivals,
  isOffline,
  departed,
  isNewLine,
}) {
  const displayArrivals = departed
    ? arrivals.slice(0, 1)
    : arrivals.slice(0, 2);
  const time1 = departed ? null : displayArrivals[0];
  const time2 = departed ? displayArrivals[0] : displayArrivals[1];

  const renderTime = (arr) => {
    if (!arr) return <span className="dashboard-time none">--</span>;
    const isArrivalStale = arr.stale || isOffline;
    const isArriving = arr.minutes === 0;
    return (
      <span
        className={`dashboard-time ${isArriving ? "arriving" : ""} ${arr.minutes <= 3 ? "soon" : ""} ${isArrivalStale ? "stale" : ""}`}
      >
        {arr.minutes}
        {isArrivalStale && <span className="dashboard-stale-icon">{"\u26A0"}</span>}
      </span>
    );
  };

  return (
    <>
      {isNewLine && <div className="dashboard-row-divider" />}
      <div className="dashboard-row">
        <span className={`dashboard-line-badge line-${line}`}>{line}</span>
        <span className="dashboard-direction-name">
          {direction.toUpperCase()}
        </span>
        {departed ? (
          <span className="dashboard-time departed">{"\u00AB"}</span>
        ) : (
          renderTime(time1)
        )}
        {renderTime(time2)}
      </div>
    </>
  );
}

/* ========================================
   LINE MODE COMPONENTS
   ======================================== */

function LineCard({
  line,
  arrivals,
  departedTrains,
  stale,
  offline,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const byStation = arrivals.reduce((acc, arr) => {
    if (!acc[arr.station]) acc[arr.station] = [];
    acc[arr.station].push(arr);
    return acc;
  }, {});

  const sortedStations = Object.entries(byStation).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const statusClass = offline ? "offline" : stale ? "stale" : "";
  const badgeText = offline ? "OFFLINE" : stale ? "STALE" : null;

  return (
    <div
      className={`line-card ${statusClass} ${isDragging ? "dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="line-header">
        <div className="drag-handle">{"\u22EE\u22EE"}</div>
        <div className={`line-badge line-${line}`}>{line}</div>
        <h2 className="line-name">{line} TRAIN</h2>
        {badgeText && (
          <span className={`status-badge ${statusClass}`}>{badgeText}</span>
        )}
      </div>

      <div className="stations-list">
        {sortedStations.map(([station, stationArrivals]) => (
          <LineModeStationSection
            key={station}
            station={station}
            arrivals={stationArrivals}
            departedTrains={departedTrains}
            line={line}
            stale={stale}
            offline={offline}
          />
        ))}
      </div>
    </div>
  );
}

function LineModeStationSection({
  station,
  arrivals,
  departedTrains,
  line,
  stale,
  offline,
}) {
  const byDirection = arrivals.reduce((acc, arr) => {
    if (!acc[arr.direction]) {
      acc[arr.direction] = { arrivals: [], directionCode: arr.direction_code };
    }
    acc[arr.direction].arrivals.push(arr);
    return acc;
  }, {});

  const sortedDirections = Object.entries(byDirection).sort(([, a], [, b]) =>
    (a.directionCode || "").localeCompare(b.directionCode || ""),
  );

  const stationDeparted = Object.entries(departedTrains)
    .filter(([, dep]) => dep.station === station && dep.line === line)
    .reduce((acc, [, dep]) => {
      acc[dep.direction] = dep;
      return acc;
    }, {});

  return (
    <div className="station-section">
      <div className="station-section-header">
        <span className="station-section-name">{station.toUpperCase()}</span>
      </div>
      <div className="directions">
        {sortedDirections.map(([direction, { arrivals: dirArrivals }]) => (
          <DirectionRow
            key={direction}
            direction={direction}
            arrivals={dirArrivals}
            departed={stationDeparted[direction]}
            showLineBadge={false}
            stale={stale}
            offline={offline}
          />
        ))}
      </div>
    </div>
  );
}

/* ========================================
   STATION MODE COMPONENTS
   ======================================== */

function StationCard({
  station,
  arrivals,
  departedTrains,
  stale,
  offline,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  userStations,
  onRemoveStation,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Find the user station entry for this station name
  const matchingUserStation = userStations?.find(
    (s) => s.name === station || s.name.toUpperCase() === station.toUpperCase(),
  );

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Group by line first
  const byLine = arrivals.reduce((acc, arr) => {
    if (!acc[arr.line]) acc[arr.line] = [];
    acc[arr.line].push(arr);
    return acc;
  }, {});

  const sortedLines = Object.entries(byLine).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const statusClass = offline ? "offline" : stale ? "stale" : "";
  const badgeText = offline ? "OFFLINE" : stale ? "STALE" : null;

  return (
    <div
      className={`station-card ${statusClass} ${isDragging ? "dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="station-header">
        <div className="drag-handle">{"\u22EE\u22EE"}</div>
        <h2 className="station-name">{station.toUpperCase()}</h2>
        {badgeText && (
          <span className={`status-badge ${statusClass}`}>{badgeText}</span>
        )}
        {matchingUserStation && (
          <div className="station-menu-wrapper" ref={menuRef}>
            <button
              className="station-menu-btn"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {"\u22EE"}
            </button>
            {menuOpen && (
              <div className="station-menu">
                <button
                  className="station-menu-item remove"
                  onClick={() => {
                    onRemoveStation(matchingUserStation.stop_id);
                    setMenuOpen(false);
                  }}
                >
                  REMOVE
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="line-sections">
        {sortedLines.map(([line, lineArrivals]) => (
          <StationLineSection
            key={line}
            line={line}
            arrivals={lineArrivals}
            departedTrains={departedTrains}
            station={station}
            stale={stale}
            offline={offline}
          />
        ))}
      </div>
    </div>
  );
}

function StationLineSection({
  line,
  arrivals,
  departedTrains,
  station,
  stale,
  offline,
}) {
  const byDirection = arrivals.reduce((acc, arr) => {
    if (!acc[arr.direction]) {
      acc[arr.direction] = { arrivals: [], directionCode: arr.direction_code };
    }
    acc[arr.direction].arrivals.push(arr);
    return acc;
  }, {});

  const sortedDirections = Object.entries(byDirection).sort(([, a], [, b]) =>
    (a.directionCode || "").localeCompare(b.directionCode || ""),
  );

  const lineDeparted = Object.entries(departedTrains)
    .filter(([, dep]) => dep.station === station && dep.line === line)
    .reduce((acc, [, dep]) => {
      acc[dep.direction] = dep;
      return acc;
    }, {});

  return (
    <div className="line-section">
      <div className="line-section-header">
        <div className={`line-badge line-badge-small line-${line}`}>{line}</div>
      </div>
      <div className="directions">
        {sortedDirections.map(([direction, { arrivals: dirArrivals }]) => (
          <DirectionRow
            key={direction}
            direction={direction}
            arrivals={dirArrivals}
            departed={lineDeparted[direction]}
            showLineBadge={false}
            stale={stale}
            offline={offline}
          />
        ))}
      </div>
    </div>
  );
}

/* ========================================
   SHARED COMPONENTS
   ======================================== */

function DirectionRow({
  direction,
  arrivals,
  departed,
  showLineBadge,
  stale,
  offline,
}) {
  const sortedArrivals = [...arrivals].sort((a, b) => {
    if (a.minutes !== b.minutes) return a.minutes - b.minutes;
    return a.line.localeCompare(b.line);
  });

  let departedInfo = null;
  if (showLineBadge) {
    const departedKey = Object.keys(departed || {}).find((key) =>
      key.startsWith(direction),
    );
    if (departedKey) {
      departedInfo = departed[departedKey];
    }
  } else if (departed) {
    departedInfo = departed;
  }

  const displayArrivals = departedInfo
    ? sortedArrivals.slice(0, 2)
    : sortedArrivals.slice(0, 3);

  return (
    <div className="direction-row">
      <div className="direction-label">
        <span className="direction-arrow">{"\u2192"}</span>
        <span className="direction-name">{direction.toUpperCase()}</span>
        <span className="direction-tooltip">{direction.toUpperCase()}</span>
      </div>
      <div className="arrivals-list">
        {departedInfo && (
          <DepartedBadge
            line={departedInfo.line}
            showLineBadge={showLineBadge}
          />
        )}
        {displayArrivals.map((arr, i) => (
          <ArrivalTime
            key={`${arr.line}-${i}`}
            minutes={arr.minutes}
            line={arr.line}
            showLineBadge={showLineBadge}
            stale={stale}
            offline={offline}
            arrivalStale={arr.stale}
          />
        ))}
      </div>
    </div>
  );
}

function DepartedBadge({ line, showLineBadge }) {
  return (
    <div
      className={`arrival-time departed ${showLineBadge ? "with-badge" : ""}`}
    >
      {showLineBadge && line && (
        <span className={`arrival-line-badge line-${line}`}>{line}</span>
      )}
      <span className="arrival-minutes">DEP</span>
    </div>
  );
}

function ArrivalTime({
  minutes,
  line,
  showLineBadge,
  stale,
  offline,
  arrivalStale,
}) {
  const isArriving = minutes === 0;
  const isSoon = minutes <= 3;
  const isStale = arrivalStale || stale || offline;
  const statusClass = offline ? "offline" : isStale ? "stale" : "";

  return (
    <div
      className={`arrival-time ${isArriving ? "arriving" : ""} ${isSoon ? "soon" : ""} ${statusClass} ${showLineBadge ? "with-badge" : ""}`}
    >
      {showLineBadge && (
        <span className={`arrival-line-badge line-${line}`}>{line}</span>
      )}
      <span className="arrival-minutes">{isArriving ? "ARR" : minutes}</span>
      {!isArriving && <span className="arrival-unit">MIN</span>}
      {isStale && (
        <span className={`arrival-indicator ${statusClass}`}>
          {offline ? "!" : "\u26A0"}
        </span>
      )}
    </div>
  );
}

export default App;
