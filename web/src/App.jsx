import { useState, useEffect, useRef } from "react";
import "./App.css";

const API_URL = "/arrivals";
const REFRESH_INTERVAL = 15000;
const DEPARTED_DISPLAY_MS = 10000;

const VIEW_MODE_KEY = "mta-view-mode";
const LINE_ORDER_KEY = "mta-line-order";
const STATION_ORDER_KEY = "mta-station-order";
const GLANCE_PINNED_KEY = "mta-glance-pinned";

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

function App() {
  const route = useHashRoute();
  const isDashboard = route === "#/glance";

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

  const fetchArrivals = async () => {
    try {
      const res = await fetch(API_URL);
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
  };

  useEffect(() => {
    fetchArrivals();
    const interval = setInterval(fetchArrivals, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

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

  // Render Dashboard view
  if (isDashboard) {
    return (
      <Dashboard
        data={data}
        loading={loading}
        error={error}
        isStale={isStale}
        departedTrains={departedTrains}
      />
    );
  }

  // Render detailed view
  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">◼</span>
            <span className="logo-text">MTA</span>
          </div>
          <div className="header-divider" />
          <span className="header-subtitle">REAL-TIME ARRIVALS</span>
        </div>
        <div className="header-right">
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
              />
            ))}
          </div>
        )}
      </main>

      <footer className="footer">
        <span className="footer-text">WILLIAMSBURG TRANSIT DISPLAY</span>
        <span className="footer-divider">•</span>
        <span className="footer-text">v1.0</span>
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
   DASHBOARD (GLANCE VIEW)
   ======================================== */

function Dashboard({ data, loading, error, isStale, departedTrains }) {
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
        next = [station, ...prev]; // Most recent at front
      }
      localStorage.setItem(GLANCE_PINNED_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Group arrivals by station, then by line+direction combo
  const groupedByStation =
    data?.arrivals?.reduce((acc, arr) => {
      if (!acc[arr.station]) acc[arr.station] = [];

      // Find existing row for this line+direction
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

  // Sort arrivals within each row, then sort rows by line then direction code
  Object.values(groupedByStation).forEach((rows) => {
    rows.forEach((row) => row.arrivals.sort((a, b) => a.minutes - b.minutes));
    rows.sort((a, b) => {
      const lineCompare = a.line.localeCompare(b.line);
      if (lineCompare !== 0) return lineCompare;
      // N before S
      const dirOrder = { N: 0, S: 1 };
      return (
        (dirOrder[a.directionCode] ?? 2) - (dirOrder[b.directionCode] ?? 2)
      );
    });
  });

  // Sort: pinned first (in pin order), then alphabetically
  const stations = Object.entries(groupedByStation).sort(([a], [b]) => {
    const aPin = pinnedStations.indexOf(a);
    const bPin = pinnedStations.indexOf(b);
    const aIsPinned = aPin !== -1;
    const bIsPinned = bPin !== -1;

    if (aIsPinned && bIsPinned) return aPin - bPin; // Both pinned: by pin order
    if (aIsPinned) return -1; // a pinned, b not
    if (bIsPinned) return 1; // b pinned, a not
    return a.localeCompare(b); // Neither pinned: alphabetical
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
              ⋮
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

  // Close menu when clicking outside
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
        {isPinned && <span className="dashboard-pin-indicator">•</span>}
        <span className="dashboard-station-icon">◼</span>
        {station.toUpperCase()}
        <div className="dashboard-station-menu-wrapper" ref={menuRef}>
          <button
            className="dashboard-station-menu-btn"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ⋮
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
          // Check if there's a departed train for this line+direction
          const departedKey = `${station}-${row.line}-${row.directionCode}`;
          const departed = departedTrains[departedKey];
          // Check if line changed from previous row
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
  // If departed, show one fewer arrival to keep columns consistent
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
        {isArrivalStale && <span className="dashboard-stale-icon">⚠</span>}
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
          <span className="dashboard-time departed">«</span>
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
        <div className="drag-handle">⋮⋮</div>
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
}) {
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
        <div className="drag-handle">⋮⋮</div>
        <h2 className="station-name">{station.toUpperCase()}</h2>
        {badgeText && (
          <span className={`status-badge ${statusClass}`}>{badgeText}</span>
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
  // Group by direction
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

  // Find departed trains for this station and line
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
  // Sort arrivals by minutes, then by line
  const sortedArrivals = [...arrivals].sort((a, b) => {
    if (a.minutes !== b.minutes) return a.minutes - b.minutes;
    return a.line.localeCompare(b.line);
  });

  // Check for departed trains and get the line info
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

  // If showing DEP, show one fewer arrival to keep count consistent
  const displayArrivals = departedInfo
    ? sortedArrivals.slice(0, Math.max(0, sortedArrivals.length - 1))
    : sortedArrivals;

  return (
    <div className="direction-row">
      <div className="direction-label">
        <span className="direction-arrow">→</span>
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
          {offline ? "!" : "⚠"}
        </span>
      )}
    </div>
  );
}

export default App;
