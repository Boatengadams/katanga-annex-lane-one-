import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  collectionGroup,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const maintenanceLogoutBtn = document.getElementById("maintenanceLogoutBtn");
const technicianSubtitle = document.getElementById("technicianSubtitle");
const technicianTypeHeading = document.getElementById("technicianTypeHeading");
const faultScopeText = document.getElementById("faultScopeText");
const maintenanceAuthMessage = document.getElementById("maintenanceAuthMessage");
const areaTabs = document.getElementById("areaTabs");
const subdivisionTabs = document.getElementById("subdivisionTabs");
const roomList = document.getElementById("roomList");
const maintenanceReports = document.getElementById("maintenanceReports");
const activeLocationHeading = document.getElementById("activeLocationHeading");

const LOGIN_PAGE = "index.html";
const REPORT_STREAM_LIMIT = 500;

const LOCATION_STRUCTURE = {
  annex: {
    label: "Annex",
    subdivisions: {
      "ground-floor": "Ground Floor",
      "lane-1": "Lane 1",
      "lane-2": "Lane 2",
      "lane-3": "Lane 3",
      "lane-4": "Lane 4",
      "lane-5": "Lane 5",
      "lane-6": "Lane 6",
      "lane-7": "Lane 7",
      "lane-8": "Lane 8"
    }
  },
  "east-wing": {
    label: "East Wings",
    subdivisions: {
      "lane-1": "Lane 1",
      "lane-2": "Lane 2",
      "lane-3": "Lane 3"
    }
  },
  "west-wing": {
    label: "West Wings",
    subdivisions: {
      "lane-1": "Lane 1",
      "lane-2": "Lane 2",
      "lane-3": "Lane 3"
    }
  },
  bridge: {
    label: "Bridge",
    subdivisions: {
      upper: "Upper Bridge",
      lower: "Lower Bridge"
    }
  }
};

const TECHNICIAN_FAULT_TERMS = {
  electrician: [
    "faulty bulb",
    "bulb",
    "faulty fan",
    "fan regulator",
    "regulator",
    "faulty socket",
    "socket"
  ],
  carpenter: ["broken shelves", "shelves", "door lock fault", "broken louvers", "broken bed"],
  plumber: ["drainage", "drainages", "choke drainage"]
};

let currentProfile = null;
let selectedArea = "";
let selectedSubdivision = "";
let selectedRoom = "";
let reportsCache = [];
let reportsUnsub = null;

const goToLogin = () => window.location.replace(LOGIN_PAGE);

const toSlug = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

const parseLaneNumber = (subdivisionKey) => {
  const match = String(subdivisionKey || "").match(/^lane-(\d+)$/);
  return match ? Number(match[1]) : null;
};

const buildRoomRange = (start, end) => {
  const rows = [];
  for (let value = start; value <= end; value += 1) {
    rows.push(`Room ${value}`);
  }
  return rows;
};

const getRoomsForLocation = (areaKey, subdivisionKey) => {
  if (!areaKey || !subdivisionKey) return [];

  if (areaKey === "annex") {
    if (subdivisionKey === "ground-floor") {
      return buildRoomRange(1, 12);
    }
    const lane = parseLaneNumber(subdivisionKey);
    if (lane && lane >= 1 && lane <= 8) {
      const start = ((lane - 1) * 12) + 1;
      return buildRoomRange(start, start + 11);
    }
  }

  if (areaKey === "east-wing" || areaKey === "west-wing") {
    const lane = parseLaneNumber(subdivisionKey);
    if (lane && lane >= 1 && lane <= 3) {
      return buildRoomRange(1, 32);
    }
  }

  if (areaKey === "bridge" && (subdivisionKey === "upper" || subdivisionKey === "lower")) {
    return buildRoomRange(1, 24);
  }

  return [];
};

const normalizeStatus = (status) => {
  if (!status) return "open";
  return status === "resolved" || status === "done" ? "resolved" : "open";
};

const formatTypeLabel = (value) => {
  const lower = String(value || "").trim().toLowerCase();
  if (!lower) return "Technician";
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
};

const inferAreaFromReport = (report) => {
  const explicit = String(report?.area || "").trim().toLowerCase();
  if (LOCATION_STRUCTURE[explicit]) return explicit;

  const text = String(report?.locationText || "").trim().toLowerCase();
  if (text.includes("annex")) return "annex";
  if (text.includes("east wing")) return "east-wing";
  if (text.includes("west wing")) return "west-wing";
  if (text.includes("bridge")) return "bridge";

  return "annex";
};

const inferSubdivisionFromReport = (report, areaKey) => {
  const explicit = String(report?.subdivision || "").trim().toLowerCase();
  if (explicit && LOCATION_STRUCTURE[areaKey]?.subdivisions?.[explicit]) return explicit;

  const text = String(report?.locationText || "").trim().toLowerCase();
  if (areaKey === "bridge") {
    if (text.includes("upper")) return "upper";
    if (text.includes("lower")) return "lower";
  }

  const laneMatch = text.match(/lane\s*(\d+)/);
  if (laneMatch) {
    const laneKey = `lane-${laneMatch[1]}`;
    if (LOCATION_STRUCTURE[areaKey]?.subdivisions?.[laneKey]) return laneKey;
  }

  if (areaKey === "annex" && text.includes("ground")) return "ground-floor";

  const firstKey = Object.keys(LOCATION_STRUCTURE[areaKey]?.subdivisions || {})[0];
  return firstKey || "";
};

const normalizeFaultTokens = (report) => {
  const rows = [];

  if (Array.isArray(report?.faults)) {
    rows.push(...report.faults);
  }
  if (Array.isArray(report?.faultTypes)) {
    rows.push(...report.faultTypes);
  }

  return rows
    .map((item) => String(item || "").toLowerCase())
    .flatMap((item) => item.split(" - "))
    .map((item) => item.trim())
    .filter(Boolean);
};

const reportMatchesTechnician = (report, type) => {
  const terms = TECHNICIAN_FAULT_TERMS[type] || [];
  if (!terms.length) return false;
  const tokens = normalizeFaultTokens(report);
  if (!tokens.length) return false;
  return tokens.some((token) => terms.some((term) => token.includes(term)));
};

const mapReportDoc = (docSnap) => {
  const data = docSnap.data() || {};
  const area = inferAreaFromReport(data);
  const subdivision = inferSubdivisionFromReport(data, area);
  return {
    id: docSnap.id,
    docPath: docSnap.ref.path,
    ...data,
    area,
    subdivision,
    status: normalizeStatus(data.status)
  };
};

const getTechnicianReports = () => {
  const technicianType = String(currentProfile?.maintenanceType || "").trim().toLowerCase();
  return reportsCache.filter((report) => reportMatchesTechnician(report, technicianType));
};

const getOpenReports = () => getTechnicianReports().filter((report) => report.status === "open");

const countReportsForArea = (areaKey) => getOpenReports().filter((report) => report.area === areaKey).length;

const countReportsForSubdivision = (areaKey, subdivisionKey) => getOpenReports()
  .filter((report) => report.area === areaKey && report.subdivision === subdivisionKey)
  .length;

const countReportsForRoom = (areaKey, subdivisionKey, roomName) => getOpenReports()
  .filter((report) => report.area === areaKey && report.subdivision === subdivisionKey && report.room === roomName)
  .length;

const setDefaultLocationSelection = () => {
  selectedArea = "";
  selectedSubdivision = "";
  selectedRoom = "";
};

const renderAreaTabs = () => {
  if (!areaTabs) return;

  areaTabs.innerHTML = Object.entries(LOCATION_STRUCTURE).map(([areaKey, areaConfig]) => {
    const count = countReportsForArea(areaKey);
    return `
      <button
        type="button"
        class="maintenance-tab ${selectedArea === areaKey ? "is-active" : ""}"
        data-area-tab="${areaKey}"
      >
        <span>${areaConfig.label}</span>
        <span class="fault-pill ${count === 0 ? "is-zero" : ""}">${count}</span>
      </button>
    `;
  }).join("");
};

const renderSubdivisionTabs = () => {
  if (!subdivisionTabs) return;
  if (!selectedArea) {
    subdivisionTabs.innerHTML = "<p>Select a block to view its lanes/subdivisions.</p>";
    return;
  }
  const areaConfig = LOCATION_STRUCTURE[selectedArea];
  if (!areaConfig) {
    subdivisionTabs.innerHTML = "";
    return;
  }

  subdivisionTabs.innerHTML = Object.entries(areaConfig.subdivisions).map(([subdivisionKey, label]) => {
    const count = countReportsForSubdivision(selectedArea, subdivisionKey);
    return `
      <button
        type="button"
        class="maintenance-tab maintenance-subtab ${selectedSubdivision === subdivisionKey ? "is-active" : ""}"
        data-subdivision-tab="${subdivisionKey}"
      >
        <span>${label}</span>
        <span class="fault-pill ${count === 0 ? "is-zero" : ""}">${count}</span>
      </button>
    `;
  }).join("");
};

const renderRoomList = () => {
  if (!roomList) return;
  if (!selectedArea) {
    roomList.innerHTML = "";
    return;
  }
  if (!selectedSubdivision) {
    roomList.innerHTML = "<p>Select a lane/subdivision to view rooms.</p>";
    return;
  }
  const rooms = getRoomsForLocation(selectedArea, selectedSubdivision);
  if (!rooms.length) {
    roomList.innerHTML = "<p>No rooms configured for this selection.</p>";
    return;
  }

  roomList.innerHTML = rooms.map((roomName) => {
    const count = countReportsForRoom(selectedArea, selectedSubdivision, roomName);
    return `
      <button
        type="button"
        class="maintenance-room-chip ${selectedRoom === roomName ? "is-active" : ""}"
        data-room="${roomName}"
      >
        <span>${roomName}</span>
        <span class="fault-pill ${count === 0 ? "is-zero" : ""}">${count}</span>
      </button>
    `;
  }).join("");
};

const renderReports = () => {
  if (!maintenanceReports) return;

  if (!selectedArea) {
    activeLocationHeading.textContent = "SELECT A BLOCK";
    maintenanceReports.innerHTML = "<p>Select a block (Annex, East Wings, West Wings, Bridge) to continue.</p>";
    return;
  }
  if (!selectedSubdivision) {
    const areaLabelOnly = LOCATION_STRUCTURE[selectedArea]?.label || "";
    activeLocationHeading.textContent = `${areaLabelOnly.toUpperCase()} SELECT A LANE`;
    maintenanceReports.innerHTML = "<p>Select a lane/subdivision to load rooms and reports.</p>";
    return;
  }

  const areaLabel = LOCATION_STRUCTURE[selectedArea]?.label || "";
  const subdivisionLabel = LOCATION_STRUCTURE[selectedArea]?.subdivisions?.[selectedSubdivision] || "";
  activeLocationHeading.textContent = `${areaLabel.toUpperCase()} ${subdivisionLabel.toUpperCase()}${selectedRoom ? ` ${selectedRoom.toUpperCase()}` : ""}`.trim();

  const reports = getOpenReports()
    .filter((report) => report.area === selectedArea)
    .filter((report) => report.subdivision === selectedSubdivision)
    .filter((report) => (selectedRoom ? report.room === selectedRoom : true))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  if (!reports.length) {
    maintenanceReports.innerHTML = "<p>No open requests in this location for your maintenance type.</p>";
    return;
  }

  maintenanceReports.innerHTML = reports.map((report) => {
    const dateValue = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleString() : "-";
    const faults = Array.isArray(report.faults) ? report.faults : [];
    return `
      <div class="report-card">
        <div class="report-head">
          <strong>${report.room || "Room"}</strong>
          <span class="status pending">open</span>
        </div>
        <div class="report-meta">
          <div><strong>Location:</strong> ${report.locationText || `${areaLabel} ${subdivisionLabel} ${report.room || ""}`.trim()}</div>
          <div><strong>Student:</strong> ${report.student?.name || "-"}</div>
          <div><strong>ID:</strong> ${report.student?.id || "-"}</div>
          <div><strong>Login:</strong> ${report.student?.login || "-"}</div>
          <div><strong>Date:</strong> ${dateValue}</div>
        </div>
        <div class="report-faults">${faults.map((fault) => `<span>${fault}</span>`).join("")}</div>
      </div>
    `;
  }).join("");
};

const renderAll = () => {
  renderAreaTabs();
  renderSubdivisionTabs();
  renderRoomList();
  renderReports();
};

if (areaTabs) {
  areaTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-area-tab]");
    if (!button) return;
    selectedArea = button.dataset.areaTab || selectedArea;
    selectedSubdivision = "";
    selectedRoom = "";
    renderAll();
  });
}

if (subdivisionTabs) {
  subdivisionTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-subdivision-tab]");
    if (!button) return;
    selectedSubdivision = button.dataset.subdivisionTab || selectedSubdivision;
    selectedRoom = "";
    renderRoomList();
    renderReports();
    renderSubdivisionTabs();
  });
}

if (roomList) {
  roomList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-room]");
    if (!button) return;
    selectedRoom = button.dataset.room === selectedRoom ? "" : (button.dataset.room || "");
    renderRoomList();
    renderReports();
  });
}

if (maintenanceLogoutBtn) {
  maintenanceLogoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      goToLogin();
    } catch (err) {
      maintenanceAuthMessage.textContent = err?.message || "Failed to logout.";
    }
  });
}

const roleRedirect = (profile) => {
  const role = String(profile?.role || "").trim().toLowerCase();
  if (role === "student") return "Lane1annexkatanga.html";
  if (role === "staff") return "staff.html";
  if (role === "admin" || role === "administrator" || role === "super admin" || role === "superadmin" || role === "super_admin") return "admin.html";
  return LOGIN_PAGE;
};

const subscribeReports = () => {
  if (reportsUnsub) reportsUnsub();
  const reportQuery = query(collectionGroup(db, "reports"), orderBy("createdAt", "desc"), limit(REPORT_STREAM_LIMIT));
  reportsUnsub = onSnapshot(reportQuery, (snapshot) => {
    reportsCache = snapshot.docs.map(mapReportDoc);
    renderAll();
  }, (err) => {
    maintenanceAuthMessage.textContent = err?.message || "Failed to load maintenance reports.";
  });
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    goToLogin();
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) {
      await signOut(auth);
      goToLogin();
      return;
    }

    currentProfile = snap.data();
    const role = String(currentProfile?.role || "").trim().toLowerCase();
    if (role !== "maintenance_technician") {
      window.location.replace(roleRedirect(currentProfile));
      return;
    }

    if (!currentProfile.approved) {
      maintenanceAuthMessage.textContent = "Your account is pending admin approval.";
      return;
    }

    const technicianType = String(currentProfile?.maintenanceType || "").trim().toLowerCase();
    const technicianLabel = formatTypeLabel(technicianType);
    technicianSubtitle.textContent = `${technicianLabel} Dashboard`;
    technicianTypeHeading.textContent = `${technicianLabel.toUpperCase()} PORTAL`;

    const allowed = Array.isArray(currentProfile.allowedFaultTypes) ? currentProfile.allowedFaultTypes : [];
    faultScopeText.textContent = allowed.length
      ? `Visible faults: ${allowed.join(", ")}`
      : "Visible faults are filtered by your maintenance type.";

    setDefaultLocationSelection();
    subscribeReports();
  } catch (err) {
    maintenanceAuthMessage.textContent = err?.message || "Failed to load account profile.";
  }
});
