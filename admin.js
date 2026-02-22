import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  setDoc,
  serverTimestamp
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { app } from "./src/firebase/firebase.js";
import { db, faultsRef, usersRef } from "./src/firebase/firestore.js";
import { computeAnalytics } from "./src/analytics/analyticsEngine.js";
import { renderLineChart } from "./src/analytics/charts.js";
import { logAudit } from "./src/audit/auditLogger.js";
import { trackAdmin } from "./src/tracking/adminTracker.js";
import { registerPush } from "./src/notifications/pushClient.js";

const auth = getAuth(app);
const storage = getStorage(app);
const LOGIN_PAGE = "index.html";
const goToLogin = () => window.location.replace(LOGIN_PAGE);

window.addEventListener("pageshow", (event) => {
  if (event.persisted && !auth.currentUser) {
    goToLogin();
  }
});

let currentAdmin = null;
let faults = [];
let reportsCache = [];
let groupedReportsCache = [];
let legacyReportsCache = [];
let faultReports = [];
let selectedFaultId = null;
let selectedRoomId = null;
let showingRoomDetail = false;
let chartInstance = null;
let hallRoomChartInstance = null;
let hallFaultChartInstance = null;
let refreshUiScheduled = false;
const REPORT_STREAM_LIMIT = 220;
const READ_NOTIFICATIONS_KEY = "adminReadNotifications";

const reportsDiv = document.getElementById("reports");
const faultItemsDiv = document.getElementById("faultItems");
const pendingUsersDiv = document.getElementById("pendingUsers");
const menuBtn = document.getElementById("menuBtn");
const adminDrawer = document.getElementById("adminDrawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const toggleCreateRoomTool = document.getElementById("toggleCreateRoomTool");
const createRoomTool = document.getElementById("createRoomTool");
const newRoomNameInput = document.getElementById("newRoomName");
const createRoomBtn = document.getElementById("createRoomBtn");
const createRoomStatus = document.getElementById("createRoomStatus");
const toggleCreateFaultTool = document.getElementById("toggleCreateFaultTool");
const createFaultTool = document.getElementById("createFaultTool");
const newFaultLabelInput = document.getElementById("newFaultLabel");
const newFaultIconFile = document.getElementById("newFaultIconFile");
const newFaultIconPreview = document.getElementById("newFaultIconPreview");
const createFaultBtn = document.getElementById("createFaultBtn");
const createFaultStatus = document.getElementById("createFaultStatus");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");
const faultPreview = document.getElementById("faultPreview");
const faultRoomsDiv = document.getElementById("faultRooms");
const faultHubSection = document.getElementById("faultHubSection");
const roomDetailView = document.getElementById("roomDetailView");
const roomDetailTitle = document.getElementById("roomDetailTitle");
const roomDetailSubtitle = document.getElementById("roomDetailSubtitle");
const roomDetailReports = document.getElementById("roomDetailReports");
const roomDetailBackBtn = document.getElementById("roomDetailBackBtn");
const roomDetailDoneBtn = document.getElementById("roomDetailDoneBtn");
const analyticsSummary = document.getElementById("analyticsSummary");
const reportChart = document.getElementById("reportChart");
const hallRoomRankingTable = document.getElementById("hallRoomRankingTable");
const hallFaultRankingTable = document.getElementById("hallFaultRankingTable");
const hallRoomRankingChart = document.getElementById("hallRoomRankingChart");
const hallFaultRankingChart = document.getElementById("hallFaultRankingChart");
const hallTotalReports = document.getElementById("hallTotalReports");
const hallTopRoom = document.getElementById("hallTopRoom");
const hallTopFault = document.getElementById("hallTopFault");
const liveNotificationsDiv = document.getElementById("liveNotifications");
const markNotificationsReadBtn = document.getElementById("markNotificationsReadBtn");
const resetNotificationsBtn = document.getElementById("resetNotificationsBtn");
const pendingCountBadge = document.getElementById("pendingCountBadge");
const liveAlert = document.getElementById("liveAlert");

const defaultFaults = [
  { label: "Faulty Bulb", icon: "bulb" },
  { label: "Faulty Fan", icon: "fan" },
  { label: "Faulty Fan Regulator", icon: "regulator" },
  { label: "Faulty Socket", icon: "socket" },
  { label: "Broken Bed", icon: "bed" },
  { label: "Broken Door Handle", icon: "door-handle" },
  { label: "Broken Louvers", icon: "louvers" },
  { label: "Broken Shelves", icon: "shelves" },
  { label: "Choke Drainage", icon: "drainage" },
  { label: "Door Lock Fault", icon: "door-lock" }
];

const slugify = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

const normalizeRoomName = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutPrefix = raw.replace(/^room[\s:-]*/i, "").trim();
  if (!withoutPrefix) return "";
  return `Room ${withoutPrefix.toUpperCase()}`;
};

const buildFaultCatalog = (items = []) => {
  const merged = new Map();
  defaultFaults.forEach((fault) => {
    const id = slugify(fault.label);
    merged.set(id, { id, ...fault });
  });
  items.forEach((item) => {
    const label = item?.label || item?.name || item?.title || item?.id || "Unknown";
    const id = item?.id || slugify(label);
    const existing = merged.get(id) || { id };
    merged.set(id, {
      ...existing,
      ...item,
      id,
      label,
      icon: item?.icon || existing.icon || "wrench"
    });
  });
  return Array.from(merged.values());
};

const getFaultLabel = (fault) => fault?.label || fault?.name || fault?.title || fault?.id || "Unknown";
const isImageIcon = (icon) => typeof icon === "string"
  && (/^Images\//i.test(icon.trim())
    || /^https?:\/\//i.test(icon.trim())
    || /^data:/i.test(icon.trim()));
const escapeAttr = (value) => String(value || "").replace(/"/g, "&quot;");
const renderFaultIcon = (icon, openCount = null) => {
  const badge = openCount === null
    ? ""
    : `<span class="fault-count-badge${openCount === 0 ? " hidden" : ""}">${openCount}</span>`;
  if (isImageIcon(icon)) {
    return `<div class="icon custom-icon" style="--fault-icon:url('${escapeAttr(icon)}')">${badge}</div>`;
  }
  return `<div class="icon ${icon || "wrench"}">${badge}</div>`;
};

const normalizeStatus = (status) => {
  if (!status) return "open";
  return status === "resolved" || status === "done" ? "resolved" : "open";
};

const statusClass = (status) => normalizeStatus(status) === "resolved" ? "resolved" : "pending";
const statusLabel = (status) => normalizeStatus(status);

const getReportDate = (report) => {
  if (!report) return null;
  if (report.createdAt?.toDate) return report.createdAt.toDate();
  if (report.date) {
    const d = new Date(report.date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};

const mapReportDoc = (docSnap) => ({
  id: docSnap.id,
  docPath: docSnap.ref.path,
  ...docSnap.data(),
  status: normalizeStatus(docSnap.data().status)
});

const refreshReportsCache = () => {
  const merged = new Map();
  [...legacyReportsCache, ...groupedReportsCache].forEach((row) => {
    if (!row?.docPath) return;
    merged.set(row.docPath, row);
  });
  reportsCache = Array.from(merged.values())
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
};

const getReportKey = (row) => row?.docPath || row?.id || "";

const readNotificationSet = (() => {
  try {
    const raw = localStorage.getItem(READ_NOTIFICATIONS_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
})();

const saveReadNotificationSet = () => {
  try {
    localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(Array.from(readNotificationSet)));
  } catch (err) {
    console.warn("Failed to persist read notifications", err);
  }
};

const getNotificationRows = (faultId = null, includeRead = false) => {
  let rows = reportsCache.map(r => ({ ...r, status: normalizeStatus(r.status) }));
  if (faultId) {
    const fault = faults.find(f => f.id === faultId);
    if (fault) {
      rows = rows.filter(r => reportMatchesFault(r, faultId, getFaultLabel(fault)));
    }
  }
  if (!includeRead) {
    rows = rows.filter((r) => !readNotificationSet.has(getReportKey(r)));
  }
  rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return rows;
};

const getReportImages = (report) => {
  if (!report) return [];
  if (Array.isArray(report.imageUrls)) {
    return report.imageUrls.filter((url) => typeof url === "string" && url.trim() !== "");
  }
  if (Array.isArray(report.images)) {
    return report.images.filter((url) => typeof url === "string" && url.trim() !== "");
  }
  if (typeof report.imageUrl === "string" && report.imageUrl.trim() !== "") {
    return [report.imageUrl];
  }
  return [];
};

const renderReportImage = (url) => `
  <a class="report-image-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
    <img
      src="${escapeAttr(url)}"
      alt="Fault evidence image"
      loading="lazy"
      decoding="async"
      onerror="this.classList.add('is-broken');const link=this.closest('a');if(link){link.classList.add('is-broken');link.setAttribute('aria-label','Image unavailable');}this.removeAttribute('src');"
    >
  </a>
`;

const reportMatchesFault = (report, faultId, faultLabel) => {
  if (!report || !faultId) return false;
  if (report.faultId) return report.faultId === faultId;
  if (Array.isArray(report.faultTypes)) {
    return report.faultTypes.includes(faultLabel);
  }
  if (Array.isArray(report.faults)) {
    return report.faults.some(f => f === faultLabel || f.startsWith(faultLabel));
  }
  return false;
};

const getReportsForFault = (faultId) => {
  const fault = faults.find(f => f.id === faultId);
  if (!fault) return [];
  const label = getFaultLabel(fault);
  return reportsCache.filter(r => reportMatchesFault(r, faultId, label))
    .map(r => ({ ...r, status: normalizeStatus(r.status) }));
};

const getPrimaryFaultLabel = (report) => {
  if (!report) return "Unspecified fault";
  if (Array.isArray(report.faults) && report.faults.length) {
    return report.faults[0];
  }
  if (Array.isArray(report.faultTypes) && report.faultTypes.length) {
    return report.faultTypes[0];
  }
  if (report.faultId) {
    const fault = faults.find((item) => item.id === report.faultId);
    if (fault) return getFaultLabel(fault);
  }
  return "Unspecified fault";
};

const normalizeFaultItem = (value) => {
  const text = String(value || "").trim();
  if (!text) return "Unspecified fault";
  const parts = text.split(" - ");
  return parts[0].trim() || text;
};

const buildHallStats = () => {
  const roomCounter = new Map();
  const itemCounter = new Map();

  reportsCache.forEach((report) => {
    const room = String(report.room || "").trim() || "Unknown room";
    roomCounter.set(room, (roomCounter.get(room) || 0) + 1);

    const itemSource = Array.isArray(report.faults) && report.faults.length
      ? report.faults.map(normalizeFaultItem)
      : [normalizeFaultItem(getPrimaryFaultLabel(report))];

    itemSource.forEach((item) => {
      itemCounter.set(item, (itemCounter.get(item) || 0) + 1);
    });
  });

  const roomRanking = Array.from(roomCounter.entries()).sort((a, b) => b[1] - a[1]);
  const faultRanking = Array.from(itemCounter.entries()).sort((a, b) => b[1] - a[1]);

  return { roomRanking, faultRanking };
};

const renderHallRankings = () => {
  if (!hallRoomRankingTable || !hallFaultRankingTable) return;
  const { roomRanking, faultRanking } = buildHallStats();

  if (!reportsCache.length) {
    hallRoomRankingTable.innerHTML = `<tr><td colspan="3">No room stats yet.</td></tr>`;
    hallFaultRankingTable.innerHTML = `<tr><td colspan="3">No fault-item stats yet.</td></tr>`;
    if (hallRoomChartInstance) {
      hallRoomChartInstance.destroy();
      hallRoomChartInstance = null;
    }
    if (hallFaultChartInstance) {
      hallFaultChartInstance.destroy();
      hallFaultChartInstance = null;
    }
    if (hallTotalReports) hallTotalReports.textContent = "0";
    if (hallTopRoom) hallTopRoom.textContent = "-";
    if (hallTopFault) hallTopFault.textContent = "-";
    return;
  }

  const topRooms = roomRanking.slice(0, 10);
  const topFaults = faultRanking.slice(0, 10);

  if (hallTotalReports) hallTotalReports.textContent = String(reportsCache.length);
  if (hallTopRoom) hallTopRoom.textContent = topRooms.length ? `${topRooms[0][0]} (${topRooms[0][1]})` : "-";
  if (hallTopFault) hallTopFault.textContent = topFaults.length ? `${topFaults[0][0]} (${topFaults[0][1]})` : "-";

  hallRoomRankingTable.innerHTML = topRooms.map(([room, count], idx) => `
    <tr class="${idx < 3 ? "top-rank" : ""}">
      <td><span class="rank-pill rank-${idx + 1}">${idx + 1}</span></td>
      <td>${room}</td>
      <td>${count}</td>
    </tr>
  `).join("");

  hallFaultRankingTable.innerHTML = topFaults.map(([item, count], idx) => `
    <tr class="${idx < 3 ? "top-rank" : ""}">
      <td><span class="rank-pill rank-${idx + 1}">${idx + 1}</span></td>
      <td>${item}</td>
      <td>${count}</td>
    </tr>
  `).join("");

  if (window.Chart && hallRoomRankingChart && hallFaultRankingChart) {
    if (!hallRoomChartInstance) {
      hallRoomChartInstance = new Chart(hallRoomRankingChart.getContext("2d"), {
        type: "bar",
        data: {
          labels: topRooms.map(([room]) => room),
          datasets: [{
            label: "Reports",
            data: topRooms.map(([, count]) => count),
            backgroundColor: "rgba(241, 194, 50, 0.72)",
            borderColor: "rgba(201, 141, 0, 0.95)",
            borderWidth: 1.5,
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(148,163,184,0.2)" } },
            x: { grid: { display: false } }
          }
        }
      });
    } else {
      hallRoomChartInstance.data.labels = topRooms.map(([room]) => room);
      hallRoomChartInstance.data.datasets[0].data = topRooms.map(([, count]) => count);
      hallRoomChartInstance.update("none");
    }

    if (!hallFaultChartInstance) {
      hallFaultChartInstance = new Chart(hallFaultRankingChart.getContext("2d"), {
        type: "bar",
        data: {
          labels: topFaults.map(([item]) => item),
          datasets: [{
            label: "Reports",
            data: topFaults.map(([, count]) => count),
            backgroundColor: "rgba(11, 26, 52, 0.72)",
            borderColor: "rgba(11, 26, 52, 0.98)",
            borderWidth: 1.5,
            borderRadius: 8
          }]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(148,163,184,0.2)" } },
            y: { grid: { display: false } }
          }
        }
      });
    } else {
      hallFaultChartInstance.data.labels = topFaults.map(([item]) => item);
      hallFaultChartInstance.data.datasets[0].data = topFaults.map(([, count]) => count);
      hallFaultChartInstance.update("none");
    }
  }
};

const countOpenByFault = (faultId) => {
  const rows = getReportsForFault(faultId);
  return rows.filter(r => normalizeStatus(r.status) === "open").length;
};

const countByFault = (faultId) => {
  const rooms = new Set();
  const rows = getReportsForFault(faultId);
  rows.forEach(r => {
    if (r.room) rooms.add(r.room);
  });
  return rooms.size;
};

const renderFaultItems = () => {
  if (!faultItemsDiv) return;
  if (!faults.length) {
    faultItemsDiv.innerHTML = "<p>No fault items yet.</p>";
    return;
  }
  faultItemsDiv.innerHTML = faults.map(item => {
    const icon = item.icon || "wrench";
    const openCount = countOpenByFault(item.id);
    return `
      <div class="fault-card admin-fault" data-fault-id="${item.id}">
        ${renderFaultIcon(icon, openCount)}
        <span>${getFaultLabel(item)}</span>
      </div>
    `;
  }).join("");
};

const renderLiveNotifications = (faultId = null) => {
  if (!liveNotificationsDiv) return;
  const recent = getNotificationRows(faultId).slice(0, 18);

  if (!recent.length) {
    liveNotificationsDiv.innerHTML = "<p>No unread complaint notifications.</p>";
    return;
  }

  liveNotificationsDiv.innerHTML = recent.map((r) => {
    const dateValue = getReportDate(r);
    const complaint = Array.isArray(r.faults) && r.faults.length ? r.faults.join(", ") : "No complaint details";
    return `
      <div class="report-card">
        <div class="report-head">
          <strong>${r.room || "-"}</strong>
          <span class="status ${statusClass(r.status)}">${statusLabel(r.status)}</span>
        </div>
        <div class="report-meta">
          <div><strong>Student:</strong> ${r.student?.name || "-"}</div>
          <div><strong>ID:</strong> ${r.student?.id || "-"}</div>
          <div><strong>Date:</strong> ${dateValue ? dateValue.toLocaleString() : "-"}</div>
          <div><strong>Complaint:</strong> ${complaint}</div>
        </div>
      </div>
    `;
  }).join("");
};

const updateLiveAlert = () => {
  if (!liveAlert) return;
  const openCount = getNotificationRows(selectedFaultId).filter(r => normalizeStatus(r.status) === "open").length;
  liveAlert.textContent = openCount > 0
    ? `${openCount} unread complaint${openCount > 1 ? "s" : ""} require attention.`
    : "No live alerts yet.";
};

const renderFaultPreview = (faultId) => {
  if (!faultPreview) return;
  const fault = faults.find(f => f.id === faultId);
  if (!fault) {
    faultPreview.classList.add("hidden");
    faultPreview.innerHTML = "";
    return;
  }
  faultPreview.classList.remove("hidden");
  const analytics = computeAnalytics(getReportsForFault(faultId));
  faultPreview.innerHTML = `
    <div class="fault-preview-card">
      ${renderFaultIcon(fault.icon || "wrench")}
      <div>
        <h3>${getFaultLabel(fault)}</h3>
        <p>${countByFault(faultId)} room(s) reported this issue.</p>
        <p>${analytics.open} open, ${analytics.resolved} resolved.</p>
      </div>
    </div>
  `;
};

const renderAnalytics = (faultId) => {
  if (!analyticsSummary) return;
  if (!faultId) {
    analyticsSummary.innerHTML = "<p>Select a fault item to see analytics.</p>";
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    return;
  }
  const reports = getReportsForFault(faultId);
  const analytics = computeAnalytics(reports);
  const topRoom = analytics.mostFaultyRoom ? analytics.mostFaultyRoom[0] : "-";
  const topRoomCount = analytics.mostFaultyRoom ? analytics.mostFaultyRoom[1] : 0;
  const resolutionRate = analytics.total ? Math.round((analytics.resolved / analytics.total) * 100) : 0;
  const openRate = analytics.total ? Math.round((analytics.open / analytics.total) * 100) : 0;
  const avgPerDay = Math.max(0, (analytics.total / 7)).toFixed(1);

  analyticsSummary.innerHTML = `
    <div class="insight-kpis">
      <div class="insight-kpi"><p>Total</p><h4>${analytics.total}</h4></div>
      <div class="insight-kpi"><p>Open</p><h4>${analytics.open}</h4></div>
      <div class="insight-kpi"><p>Resolved</p><h4>${analytics.resolved}</h4></div>
      <div class="insight-kpi"><p>Avg / Day</p><h4>${avgPerDay}</h4></div>
    </div>
    <div class="summary-row"><span>Resolution Rate</span><span>${resolutionRate}%</span></div>
    <div class="summary-row"><span>Open Exposure</span><span>${openRate}%</span></div>
    <div class="summary-row"><span>Most Affected Room</span><span>${topRoom} (${topRoomCount})</span></div>
  `;

  if (reportChart && window.Chart) {
    const now = new Date();
    const dayKeys = [];
    const labels = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayKeys.push(key);
      labels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    }
    const counts = dayKeys.map(key => {
      return reports.filter(r => {
        const d = getReportDate(r);
        if (!d) return false;
        return d.toISOString().slice(0, 10) === key;
      }).length;
    });

    if (chartInstance) chartInstance.destroy();
    chartInstance = renderLineChart(reportChart.getContext("2d"), labels, counts);
  }
};

const renderReports = (_faultId = null, roomId = null) => {
  if (!reportsDiv) return;
  const source = reportsCache
    .map(r => ({ ...r, status: normalizeStatus(r.status) }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const filtered = roomId ? source.filter(r => r.room === roomId) : source;

  if (!filtered.length) {
    reportsDiv.innerHTML = "<p>No reports yet.</p>";
    return;
  }

  const grouped = filtered.reduce((acc, report) => {
    const key = getPrimaryFaultLabel(report);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(report);
    return acc;
  }, new Map());

  reportsDiv.innerHTML = Array.from(grouped.entries()).map(([groupKey, groupRows]) => `
    <div class="report-card">
      <div class="report-head">
        <strong>${groupKey}</strong>
        <span class="status pending">${groupRows.length} submissions</span>
      </div>
      ${groupRows.map(r => {
        const dateValue = getReportDate(r);
        const complaint = Array.isArray(r.faults) && r.faults.length ? r.faults.join(", ") : "-";
        const reportImages = getReportImages(r);
        const resolved = normalizeStatus(r.status) === "resolved";
        return `
          <div class="report-meta">
            <div><strong>Room:</strong> ${r.room || "-"}</div>
            <div><strong>Name:</strong> ${r.student?.name || "-"}</div>
            <div><strong>ID:</strong> ${r.student?.id || "-"}</div>
            <div><strong>Login:</strong> ${r.student?.login || "-"}</div>
            <div><strong>Date:</strong> ${dateValue ? dateValue.toLocaleString() : "-"}</div>
            <div><strong>Status:</strong> <span class="status ${statusClass(r.status)}">${statusLabel(r.status)}</span></div>
            <div><strong>Complaint:</strong> ${complaint}</div>
          </div>
          ${reportImages.length ? `
            <div class="report-images">
              ${reportImages.map((url) => renderReportImage(url)).join("")}
            </div>
          ` : ""}
          <div class="report-faults">${(r.faults || []).map(f => `<span>${f}</span>`).join("")}</div>
          <button class="done-btn" data-path="${r.docPath || ""}" data-action="${resolved ? "undo" : "resolve"}">
            ${resolved ? "Undo Resolve" : "Mark Resolved"}
          </button>
          <hr class="report-sep">
        `;
      }).join("")}
    </div>
  `).join("");
};

const getRoomsForFault = (faultId) => {
  if (!faultId) return [];
  const rows = getReportsForFault(faultId);
  const roomMap = new Map();
  rows.forEach(r => {
    if (!r.room) return;
    const entry = roomMap.get(r.room) || {
      room: r.room,
      reports: 0,
      resolved: 0,
      lastDate: null
    };
    entry.reports += 1;
    if (normalizeStatus(r.status) === "resolved") entry.resolved += 1;
    const date = getReportDate(r);
    if (date && (!entry.lastDate || date > entry.lastDate)) {
      entry.lastDate = date;
    }
    roomMap.set(r.room, entry);
  });
  return Array.from(roomMap.values()).sort((a, b) => a.room.localeCompare(b.room));
};

const renderFaultRooms = (faultId = null) => {
  if (!faultRoomsDiv) return;
  if (!faultId) {
    faultRoomsDiv.innerHTML = "<p>Select a fault item to view affected rooms.</p>";
    return;
  }
  const rooms = getRoomsForFault(faultId);
  if (!rooms.length) {
    faultRoomsDiv.innerHTML = "<p>No rooms reported this fault yet.</p>";
    return;
  }
  faultRoomsDiv.innerHTML = rooms.map(room => `
    <div class="report-card room-card${selectedRoomId === room.room ? " is-active" : ""}" data-room="${room.room}">
      <div class="report-head">
        <strong>${room.room}</strong>
        <span class="status ${room.resolved === room.reports ? "resolved" : "pending"}">
          ${room.resolved === room.reports ? "resolved" : "open"}
        </span>
      </div>
      <div class="report-meta">
        <div><strong>Last Report:</strong> ${room.lastDate ? room.lastDate.toLocaleString() : "-"}</div>
        <div><strong>Total Reports:</strong> ${room.reports}</div>
        <div><strong>Resolved:</strong> ${room.resolved}</div>
      </div>
      <button class="done-btn room-done-btn" data-room="${room.room}" data-fault="${selectedFaultId}" data-action="${room.resolved === room.reports ? "undo" : "resolve"}">
        ${room.resolved === room.reports ? "Undo Room Resolve" : "Mark Room Resolved"}
      </button>
    </div>
  `).join("");
};

const renderRoomDetail = (roomId, faultId) => {
  if (!roomDetailView || !roomDetailReports) return;
  if (!roomId || !faultId) {
    roomDetailView.classList.add("hidden");
    return;
  }

  const rows = faultReports.filter(r => r.room === roomId);
  const total = rows.length;
  const doneCount = rows.filter(r => normalizeStatus(r.status) === "resolved").length;

  if (roomDetailTitle) roomDetailTitle.textContent = roomId;
  if (roomDetailSubtitle) roomDetailSubtitle.textContent = `Reports for ${roomId}.`;

  if (!rows.length) {
    roomDetailReports.innerHTML = "<p>No reports for this room.</p>";
  } else {
    roomDetailReports.innerHTML = rows.map(r => {
      const dateValue = getReportDate(r);
      const complaint = Array.isArray(r.faults) && r.faults.length ? r.faults.join(", ") : "-";
      const reportImages = getReportImages(r);
      const resolved = normalizeStatus(r.status) === "resolved";
      return `
        <div class="report-card">
          <div class="report-head">
            <strong>${r.room || "-"}</strong>
            <span class="status ${statusClass(r.status)}">${statusLabel(r.status)}</span>
          </div>
          <div class="report-meta">
            <div><strong>Name:</strong> ${r.student?.name || "-"}</div>
            <div><strong>ID:</strong> ${r.student?.id || "-"}</div>
            <div><strong>Login:</strong> ${r.student?.login || "-"}</div>
            <div><strong>Date:</strong> ${dateValue ? dateValue.toLocaleString() : "-"}</div>
            <div><strong>Complaint:</strong> ${complaint}</div>
          </div>
            ${reportImages.length ? `
              <div class="report-images">
                ${reportImages.map((url) => renderReportImage(url)).join("")}
              </div>
            ` : ""}
          <div class="report-faults">${(r.faults || []).map(f => `<span>${f}</span>`).join("")}</div>
          <button class="done-btn" data-path="${r.docPath || ""}" data-action="${resolved ? "undo" : "resolve"}">
            ${resolved ? "Undo Resolve" : "Mark Resolved"}
          </button>
          <hr class="report-sep">
        </div>
      `;
    }).join("");
  }

  if (roomDetailDoneBtn) {
    const allDone = total > 0 && doneCount === total;
    roomDetailDoneBtn.disabled = total === 0;
    roomDetailDoneBtn.dataset.action = allDone ? "undo" : "resolve";
    roomDetailDoneBtn.textContent = allDone ? "Undo Room Resolve" : "Mark Room Resolved";
  }

  roomDetailView.classList.remove("hidden");
  if (faultHubSection) faultHubSection.classList.add("show-room-detail");
  showingRoomDetail = true;
};

const exitRoomDetail = () => {
  if (!roomDetailView) return;
  roomDetailView.classList.add("hidden");
  if (faultHubSection) faultHubSection.classList.remove("show-room-detail");
  showingRoomDetail = false;
  renderReports(selectedFaultId, selectedRoomId);
  renderFaultRooms(selectedFaultId);
};

const selectFault = (faultId) => {
  selectedFaultId = faultId;
  selectedRoomId = null;
  if (faultId) {
    faultReports = getReportsForFault(faultId);
    renderReports(faultId, selectedRoomId);
    renderFaultRooms(faultId);
    renderAnalytics(faultId);
    renderLiveNotifications(faultId);
    if (showingRoomDetail) {
      renderRoomDetail(selectedRoomId, faultId);
    }
  }
  renderFaultPreview(faultId);
  renderAnalytics(faultId);
  renderLiveNotifications(faultId);
  trackAdmin("fault_selected", { faultId });
};

const resolveReport = async (reportPath, nextStatus = "resolved") => {
  if (!reportPath) return;
  try {
    await updateDoc(doc(db, reportPath), {
      status: nextStatus,
      resolvedAt: nextStatus === "resolved" ? serverTimestamp() : null
    });
    if (currentAdmin) {
      await logAudit(nextStatus === "resolved" ? "report_resolved" : "report_reopened", reportPath, currentAdmin);
    }
    trackAdmin(nextStatus === "resolved" ? "report_resolved" : "report_reopened", { reportPath });
  } catch (err) {
    alert(err?.message || "Failed to update report.");
  }
};

const resolveRoom = async (roomId, faultId, nextStatus = "resolved") => {
  if (!roomId || !faultId) return;
  const targetState = nextStatus === "resolved" ? "open" : "resolved";
  const rows = getReportsForFault(faultId).filter(r => r.room === roomId && normalizeStatus(r.status) === targetState);
  if (!rows.length) return;
  try {
    const writes = await Promise.allSettled(
      rows.map(r => updateDoc(doc(db, r.docPath), {
        status: nextStatus,
        resolvedAt: nextStatus === "resolved" ? serverTimestamp() : null
      }))
    );
    const successCount = writes.filter((w) => w.status === "fulfilled").length;
    const failedCount = writes.length - successCount;
    if (failedCount > 0) {
      alert(`Updated ${successCount} report(s). ${failedCount} failed due to permission/data mismatch.`);
    }
    if (currentAdmin) {
      await logAudit(nextStatus === "resolved" ? "room_resolved" : "room_reopened", roomId, currentAdmin);
    }
    trackAdmin(nextStatus === "resolved" ? "room_resolved" : "room_reopened", { roomId, faultId });
  } catch (err) {
    alert(err?.message || "Failed to update room reports.");
  }
};

const initDrawer = () => {
  if (!menuBtn || !adminDrawer || !drawerBackdrop) return;
  const openDrawer = () => {
    adminDrawer.classList.add("is-open");
    drawerBackdrop.classList.add("is-open");
  };
  const closeDrawer = () => {
    adminDrawer.classList.remove("is-open");
    drawerBackdrop.classList.remove("is-open");
  };

  menuBtn.addEventListener("click", () => {
    if (adminDrawer.classList.contains("is-open")) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  drawerBackdrop.addEventListener("click", closeDrawer);
  document.addEventListener("click", (e) => {
    if (!adminDrawer.classList.contains("is-open")) return;
    const isInside = adminDrawer.contains(e.target) || menuBtn.contains(e.target);
    if (!isInside) closeDrawer();
  });

  const drawerLinks = document.querySelectorAll(".drawer-link");
  drawerLinks.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      if (target === "faultHub") {
        renderReports(selectedFaultId);
      }
      const panels = document.querySelectorAll(".admin-panel");
      panels.forEach(p => p.classList.add("hidden"));
      const panelId = target + "Section";
      const panel = document.getElementById(panelId) || document.getElementById(target);
      if (panel) panel.classList.remove("hidden");
      if (panel) {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      closeDrawer();
    });
  });
};

const initFaultInteractions = () => {
  if (faultItemsDiv) {
    faultItemsDiv.addEventListener("click", (e) => {
      const card = e.target.closest(".admin-fault");
      if (!card) return;
      const faultId = card.dataset.faultId;
      if (!faultId) return;
      const fault = faults.find((f) => f.id === faultId);
      const label = getFaultLabel(fault || { id: faultId });
      window.location.href = `admin-fault.html?fault=${encodeURIComponent(faultId)}&label=${encodeURIComponent(label)}`;
    });
  }

  if (faultRoomsDiv) {
    faultRoomsDiv.addEventListener("click", (e) => {
      const doneBtn = e.target.closest(".room-done-btn");
      if (doneBtn) {
        const roomId = doneBtn.dataset.room;
        const faultId = doneBtn.dataset.fault;
        const action = doneBtn.dataset.action === "undo" ? "pending" : "resolved";
        resolveRoom(roomId, faultId, action);
        return;
      }
      const card = e.target.closest(".room-card");
      if (!card) return;
      const roomId = card.dataset.room;
      if (!roomId) return;
      selectedRoomId = roomId;
      renderFaultRooms(selectedFaultId);
      renderRoomDetail(roomId, selectedFaultId);
    });
  }

  if (roomDetailBackBtn) {
    roomDetailBackBtn.addEventListener("click", () => {
      exitRoomDetail();
    });
  }

  if (roomDetailDoneBtn) {
    roomDetailDoneBtn.addEventListener("click", () => {
      const action = roomDetailDoneBtn.dataset.action === "undo" ? "pending" : "resolved";
      resolveRoom(selectedRoomId, selectedFaultId, action);
    });
  }

  if (roomDetailReports) {
    roomDetailReports.addEventListener("click", (e) => {
      const btn = e.target.closest(".done-btn");
      if (!btn) return;
      const action = btn.dataset.action === "undo" ? "pending" : "resolved";
      resolveReport(btn.dataset.path, action);
    });
  }

  if (reportsDiv) {
    reportsDiv.addEventListener("click", (e) => {
      const btn = e.target.closest(".done-btn");
      if (!btn) return;
      const action = btn.dataset.action === "undo" ? "pending" : "resolved";
      resolveReport(btn.dataset.path, action);
    });
  }
};

const initPendingUsers = () => {
  if (!pendingUsersDiv) return;
  const q = query(usersRef, where("approved", "==", false));
  onSnapshot(
    q,
    (snapshot) => {
      const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (pendingCountBadge) {
        pendingCountBadge.textContent = String(users.length);
        pendingCountBadge.classList.toggle("hidden", users.length === 0);
      }
      if (!users.length) {
        pendingUsersDiv.innerHTML = "<p>No pending accounts.</p>";
        return;
      }
      const canApproveUsers = currentAdmin?.isAdmin === true;
      pendingUsersDiv.innerHTML = users.map(u => `
        <div class="report-card">
          <div class="report-head">
            <strong>${u.name || "User"}</strong>
            <span class="status pending">pending</span>
          </div>
          <div class="report-meta">
            <div><strong>Role:</strong> ${u.role || "-"}</div>
            <div><strong>ID:</strong> ${u.studentId || u.idNumber || "-"}</div>
            <div><strong>Email:</strong> ${u.email || u.login || "-"}</div>
            <div><strong>Location:</strong> ${u.locationText || u.room || "-"}</div>
            <div><strong>Extra:</strong> ${u.program || u.maintenanceLabel || u.staffRank || "-"}</div>
          </div>
          ${canApproveUsers
            ? `<button class="done-btn" data-uid="${u.id}">Approve</button>`
            : `<p class="auth-note">You do not have permission to approve users.</p>`}
        </div>
      `).join("");
    },
    (err) => {
      if (pendingCountBadge) {
        pendingCountBadge.textContent = "0";
        pendingCountBadge.classList.add("hidden");
      }
      pendingUsersDiv.innerHTML = `<p>Failed to load pending users: ${err?.message || "permission denied"}.</p>`;
    }
  );

  pendingUsersDiv.addEventListener("click", async (e) => {
    const btn = e.target.closest(".done-btn");
    if (!btn) return;
    if (currentAdmin?.isAdmin !== true) {
      alert("You do not have permission to approve users.");
      return;
    }
    const uid = btn.dataset.uid;
    if (!uid) return;
    try {
      await updateDoc(doc(usersRef, uid), {
        approved: true,
        approvedAt: serverTimestamp()
      });
      if (currentAdmin) {
        await logAudit("user_approved", uid, currentAdmin);
      }
      trackAdmin("user_approved", { uid });
    } catch (err) {
      alert(err?.message || "Failed to approve user.");
    }
  });
};

const initNotificationActions = () => {
  if (markNotificationsReadBtn) {
    markNotificationsReadBtn.addEventListener("click", () => {
      const visibleRows = getNotificationRows(selectedFaultId, true).slice(0, 18);
      visibleRows.forEach((row) => {
        const key = getReportKey(row);
        if (key) readNotificationSet.add(key);
      });
      saveReadNotificationSet();
      renderLiveNotifications(selectedFaultId);
      updateLiveAlert();
    });
  }

  if (resetNotificationsBtn) {
    resetNotificationsBtn.addEventListener("click", () => {
      readNotificationSet.clear();
      saveReadNotificationSet();
      renderLiveNotifications(selectedFaultId);
      updateLiveAlert();
    });
  }
};

const initAdminTools = () => {
  if (toggleCreateRoomTool && createRoomTool) {
    toggleCreateRoomTool.addEventListener("click", () => {
      createRoomTool.classList.toggle("hidden");
      toggleCreateRoomTool.textContent = createRoomTool.classList.contains("hidden") ? "Create Room" : "Close Create Room";
    });
  }

  if (toggleCreateFaultTool && createFaultTool) {
    toggleCreateFaultTool.addEventListener("click", () => {
      createFaultTool.classList.toggle("hidden");
      toggleCreateFaultTool.textContent = createFaultTool.classList.contains("hidden") ? "Create Fault Item" : "Close Create Fault Item";
    });
  }

  if (newFaultIconFile && newFaultIconPreview) {
    newFaultIconFile.addEventListener("change", () => {
      const file = newFaultIconFile.files?.[0];
      if (!file) {
        newFaultIconPreview.src = "Images/faultybulb.png";
        return;
      }
      newFaultIconPreview.src = URL.createObjectURL(file);
    });
  }

  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", async () => {
      const roomName = normalizeRoomName(newRoomNameInput?.value || "");
      if (!roomName) {
        if (createRoomStatus) createRoomStatus.textContent = "Enter a room name.";
        return;
      }
      try {
        createRoomBtn.disabled = true;
        if (createRoomStatus) {
          createRoomStatus.textContent = "Registering room...";
          createRoomStatus.style.color = "";
        }
        await setDoc(doc(collection(db, "rooms"), roomName), {
          name: roomName,
          createdAt: serverTimestamp()
        }, { merge: true });
        if (createRoomStatus) {
          createRoomStatus.textContent = `Room registered successfully as ${roomName}.`;
          createRoomStatus.style.color = "#9ee6b8";
        }
        if (newRoomNameInput) newRoomNameInput.value = "";
        trackAdmin("room_created", { roomName });
      } catch (err) {
        if (createRoomStatus) {
          createRoomStatus.textContent = err?.message || "Failed to register room.";
          createRoomStatus.style.color = "";
        }
      } finally {
        createRoomBtn.disabled = false;
      }
    });
  }

  if (createFaultBtn) {
    createFaultBtn.addEventListener("click", async () => {
      const label = (newFaultLabelInput?.value || "").trim();
      if (!label) {
        if (createFaultStatus) createFaultStatus.textContent = "Enter a fault item label.";
        return;
      }
      const iconFile = newFaultIconFile?.files?.[0];
      if (!iconFile) {
        if (createFaultStatus) createFaultStatus.textContent = "Select an icon image file.";
        return;
      }
      try {
        createFaultBtn.disabled = true;
        if (createFaultStatus) {
          createFaultStatus.textContent = "Uploading icon and registering fault item...";
          createFaultStatus.style.color = "";
        }
        const id = slugify(label);
        const safeName = String(iconFile.name || "icon.png").replace(/[^a-zA-Z0-9._-]+/g, "-");
        const iconPath = `fault-icons/${id}-${Date.now()}-${safeName}`;
        const iconRef = ref(storage, iconPath);
        await uploadBytes(iconRef, iconFile);
        const icon = await getDownloadURL(iconRef);
        await setDoc(doc(faultsRef, id), {
          label,
          icon,
          iconPath,
          updatedAt: serverTimestamp()
        }, { merge: true });
        if (createFaultStatus) {
          createFaultStatus.textContent = "Fault item registered successfully.";
          createFaultStatus.style.color = "#9ee6b8";
        }
        if (newFaultLabelInput) newFaultLabelInput.value = "";
        if (newFaultIconFile) newFaultIconFile.value = "";
        if (newFaultIconPreview) newFaultIconPreview.src = "Images/faultybulb.png";
        trackAdmin("fault_item_created", { id, label });
      } catch (err) {
        if (createFaultStatus) {
          createFaultStatus.textContent = err?.message || "Failed to register fault item.";
          createFaultStatus.style.color = "";
        }
      } finally {
        createFaultBtn.disabled = false;
      }
    });
  }
};

const initLogout = () => {
  if (!adminLogoutBtn) return;
  adminLogoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      goToLogin();
    } catch (err) {
      alert(err?.message || "Failed to logout.");
    }
  });
};

const initListeners = () => {
  const refreshAdminViews = () => {
    renderFaultItems();
    renderHallRankings();
    updateLiveAlert();
    if (selectedFaultId) {
      faultReports = getReportsForFault(selectedFaultId);
      renderFaultPreview(selectedFaultId);
      renderFaultRooms(selectedFaultId);
      renderAnalytics(selectedFaultId);
      renderLiveNotifications(selectedFaultId);
      renderReports(selectedFaultId, selectedRoomId);
      if (showingRoomDetail) {
        renderRoomDetail(selectedRoomId, selectedFaultId);
      }
    } else {
      renderFaultPreview(null);
      renderFaultRooms(null);
      renderLiveNotifications(null);
      renderReports();
      if (roomDetailView) roomDetailView.classList.add("hidden");
      if (faultHubSection) faultHubSection.classList.remove("show-room-detail");
      showingRoomDetail = false;
    }
  };

  const scheduleAdminRefresh = () => {
    if (refreshUiScheduled) return;
    refreshUiScheduled = true;
    requestAnimationFrame(() => {
      refreshUiScheduled = false;
      refreshAdminViews();
    });
  };

  onSnapshot(faultsRef, (snapshot) => {
    const remoteFaults = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    faults = buildFaultCatalog(remoteFaults);
    scheduleAdminRefresh();
  });

  const groupedReportsQuery = query(collectionGroup(db, "reports"), orderBy("createdAt", "desc"), limit(REPORT_STREAM_LIMIT));
  onSnapshot(groupedReportsQuery, (snapshot) => {
    groupedReportsCache = snapshot.docs.map(mapReportDoc);
    legacyReportsCache = [];
    refreshReportsCache();
    scheduleAdminRefresh();
  });
};

const initPush = async () => {
  if (!currentAdmin) return;
  try {
    const token = await registerPush(currentAdmin.uid);
    if (token) {
      await updateDoc(doc(usersRef, currentAdmin.uid), {
        pushToken: token,
        pushUpdatedAt: serverTimestamp()
      });
    }
  } catch (err) {
    console.warn("Push registration failed", err);
  }
};

const initAdmin = () => {
  faults = buildFaultCatalog();
  renderFaultItems();
  initDrawer();
  initFaultInteractions();
  initNotificationActions();
  initPendingUsers();
  initAdminTools();
  initLogout();
  initListeners();
  initPush();
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    goToLogin();
    return;
  }

  const token = await user.getIdTokenResult(true);
  const claimsSuperAdmin = token.claims.superAdmin === true;
  const claimsAdmin = token.claims.admin === true || claimsSuperAdmin;
  const userSnap = await getDoc(doc(usersRef, user.uid));
  const data = userSnap.exists() ? userSnap.data() : {};
  const roleValue = String(data.role || "").trim().toLowerCase();
  const roleSuperAdmin =
    roleValue === "super admin" ||
    roleValue === "super_admin" ||
    roleValue === "superadmin";
  const roleAdmin =
    roleValue === "admin" ||
    roleValue === "administrator" ||
    roleSuperAdmin;
  const isScrStaff = roleValue === "staff" && String(data.staffRank || "").trim().toLowerCase() === "scr";

  const isSuperAdmin = claimsSuperAdmin || roleSuperAdmin;
  const isAdmin = claimsAdmin || roleAdmin || isScrStaff;
  if (!isAdmin) {
    await signOut(auth);
    goToLogin();
    return;
  }

  currentAdmin = {
    uid: user.uid,
    email: user.email || "",
    ...data,
    role: isSuperAdmin ? "superAdmin" : (isScrStaff ? "scr" : "admin"),
    isAdmin: true,
    isSuperAdmin
  };
  initAdmin();
});
