import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import {
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";
import { app } from "./src/firebase/firebase.js";
import { db, usersRef } from "./src/firebase/firestore.js";

const auth = getAuth(app);
const LOGIN_PAGE = "index.html";
const goToLogin = () => window.location.replace(LOGIN_PAGE);

window.addEventListener("pageshow", (event) => {
  if (event.persisted && !auth.currentUser) {
    goToLogin();
  }
});

const params = new URLSearchParams(window.location.search);
const selectedFaultId = params.get("fault") || "";
const selectedFaultLabel = params.get("label") || "Fault";

const faultSubportalTitle = document.getElementById("faultSubportalTitle");
const faultHeading = document.getElementById("faultHeading");
const faultSubportalAlert = document.getElementById("faultSubportalAlert");
const roomFaultList = document.getElementById("roomFaultList");
const backToAdminBtn = document.getElementById("backToAdminBtn");
const subportalLogoutBtn = document.getElementById("subportalLogoutBtn");

let reportsCache = [];
let groupedReportsCache = [];
let legacyReportsCache = [];
let currentAdmin = null;
const REPORT_STREAM_LIMIT = 220;

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

const escapeAttr = (value) => String(value || "").replace(/"/g, "&quot;");

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

const reportMatchesFault = (report, faultId, faultLabel) => {
  if (!report || !faultId) return false;
  if (report.faultId) return report.faultId === faultId;
  if (Array.isArray(report.faultTypes)) {
    return report.faultTypes.includes(faultLabel);
  }
  if (Array.isArray(report.faults)) {
    return report.faults.some((f) => f === faultLabel || f.startsWith(faultLabel));
  }
  return false;
};

const getReportsForFault = () => {
  return reportsCache.filter((r) => reportMatchesFault(r, selectedFaultId, selectedFaultLabel))
    .map((r) => ({ ...r, status: normalizeStatus(r.status) }));
};

const getRoomsForFault = () => {
  const rows = getReportsForFault();
  const roomMap = new Map();
  rows.forEach((r) => {
    if (!r.room) return;
    const entry = roomMap.get(r.room) || {
      room: r.room,
      reports: 0,
      open: 0,
      resolved: 0,
      lastDate: null,
      reportsData: []
    };
    entry.reports += 1;
    if (normalizeStatus(r.status) === "resolved") entry.resolved += 1;
    if (normalizeStatus(r.status) === "open") entry.open += 1;
    entry.reportsData.push(r);
    const date = getReportDate(r);
    if (date && (!entry.lastDate || date > entry.lastDate)) entry.lastDate = date;
    roomMap.set(r.room, entry);
  });
  return Array.from(roomMap.values()).sort((a, b) => a.room.localeCompare(b.room));
};

const renderHeader = () => {
  if (faultSubportalTitle) faultSubportalTitle.textContent = selectedFaultLabel;
  if (faultHeading) faultHeading.textContent = selectedFaultLabel.toUpperCase();
};

const renderRooms = () => {
  if (!roomFaultList) return;
  const rooms = getRoomsForFault();
  if (faultSubportalAlert) {
    const openTotal = rooms.reduce((sum, room) => sum + room.open, 0);
    faultSubportalAlert.textContent = `${rooms.length} room(s), ${openTotal} open complaint(s) for ${selectedFaultLabel}.`;
  }
  if (!rooms.length) {
    roomFaultList.innerHTML = "<p>No rooms currently reported for this fault.</p>";
    return;
  }

  roomFaultList.innerHTML = rooms.map((room) => {
    const done = room.open === 0;
    const submissions = [...room.reportsData].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return `
      <div class="report-card room-card room-tick-card" data-room="${room.room}">
        <label class="room-done-toggle">
          <input type="checkbox" class="room-done-check" data-room="${room.room}" ${done ? "checked" : ""}>
          <span>Done</span>
        </label>
        <div class="report-head">
          <strong>${room.room}</strong>
          <span class="status ${done ? "resolved" : "pending"}">${done ? "resolved" : "open"}</span>
        </div>
        <div class="report-meta">
          <div><strong>Total Reports:</strong> ${room.reports}</div>
          <div><strong>Open:</strong> ${room.open}</div>
          <div><strong>Resolved:</strong> ${room.resolved}</div>
          <div><strong>Last Report:</strong> ${room.lastDate ? room.lastDate.toLocaleString() : "-"}</div>
        </div>
        <div class="report-meta">
          <strong>Student Submissions</strong>
        </div>
        ${submissions.map((r) => {
          const dateValue = getReportDate(r);
          const complaint = Array.isArray(r.faults) && r.faults.length ? r.faults.join(", ") : selectedFaultLabel;
          const reportImages = getReportImages(r);
          const resolved = normalizeStatus(r.status) === "resolved";
          return `
            <div class="report-meta">
              <div><strong>Name:</strong> ${r.student?.name || "-"}</div>
              <div><strong>ID:</strong> ${r.student?.id || "-"}</div>
              <div><strong>Login:</strong> ${r.student?.login || "-"}</div>
              <div><strong>Date:</strong> ${dateValue ? dateValue.toLocaleString() : "-"}</div>
              <div><strong>Status:</strong> <span class="status ${statusClass(r.status)}">${statusLabel(r.status)}</span></div>
              <div><strong>Complaint:</strong> ${complaint}</div>
            </div>
            <button class="done-btn submission-toggle-btn" data-path="${r.docPath || ""}" data-action="${resolved ? "undo" : "resolve"}">
              ${resolved ? "Undo Resolve" : "Mark Resolved"}
            </button>
            ${reportImages.length ? `
              <div class="report-images">
                ${reportImages.map((url) => renderReportImage(url)).join("")}
              </div>
            ` : ""}
            <hr class="report-sep">
          `;
        }).join("")}
      </div>
    `;
  }).join("");
};

const markRoomDone = async (roomId) => {
  if (!roomId || !selectedFaultId) return;
  const targets = getReportsForFault().filter((r) => r.room === roomId && normalizeStatus(r.status) === "open");
  if (!targets.length) return;
  const writes = await Promise.allSettled(
    targets.map((r) => updateDoc(doc(db, r.docPath), {
      status: "resolved",
      resolvedAt: serverTimestamp(),
      resolvedBy: currentAdmin?.uid || ""
    }))
  );
  const failedCount = writes.filter((w) => w.status === "rejected").length;
  if (failedCount > 0) {
    throw new Error(`Failed to update ${failedCount} report(s).`);
  }
};

const markRoomUndone = async (roomId) => {
  if (!roomId || !selectedFaultId) return;
  const targets = getReportsForFault().filter((r) => r.room === roomId && normalizeStatus(r.status) === "resolved");
  if (!targets.length) return;
  const writes = await Promise.allSettled(
    targets.map((r) => updateDoc(doc(db, r.docPath), {
      status: "pending",
      resolvedAt: null,
      reopenedAt: serverTimestamp(),
      reopenedBy: currentAdmin?.uid || ""
    }))
  );
  const failedCount = writes.filter((w) => w.status === "rejected").length;
  if (failedCount > 0) {
    throw new Error(`Failed to update ${failedCount} report(s).`);
  }
};

const toggleReportStatus = async (reportPath, nextStatus) => {
  if (!reportPath || !nextStatus) return;
  await updateDoc(doc(db, reportPath), {
    status: nextStatus,
    resolvedAt: nextStatus === "resolved" ? serverTimestamp() : null
  });
};

const initInteractions = () => {
  if (backToAdminBtn) {
    backToAdminBtn.addEventListener("click", () => {
      window.location.href = "admin.html";
    });
  }

  if (subportalLogoutBtn) {
    subportalLogoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      goToLogin();
    });
  }

  if (roomFaultList) {
    roomFaultList.addEventListener("change", async (e) => {
      const check = e.target.closest(".room-done-check");
      if (!check) return;
      check.disabled = true;
      const roomId = check.dataset.room;
      try {
        if (check.checked) {
          await markRoomDone(roomId);
        } else {
          await markRoomUndone(roomId);
        }
      } catch (err) {
        alert(err?.message || "Failed to update room status.");
        check.disabled = false;
        check.checked = !check.checked;
      } finally {
        check.disabled = false;
      }
    });

    roomFaultList.addEventListener("click", async (e) => {
      const btn = e.target.closest(".submission-toggle-btn");
      if (!btn) return;
      const nextStatus = btn.dataset.action === "undo" ? "pending" : "resolved";
      btn.disabled = true;
      try {
        await toggleReportStatus(btn.dataset.path, nextStatus);
      } catch (err) {
        alert(err?.message || "Failed to update report.");
      } finally {
        btn.disabled = false;
      }
    });
  }
};

const initReports = () => {
  const groupedReportsQuery = query(collectionGroup(db, "reports"), orderBy("createdAt", "desc"), limit(REPORT_STREAM_LIMIT));
  onSnapshot(groupedReportsQuery, (snapshot) => {
    groupedReportsCache = snapshot.docs.map(mapReportDoc);
    legacyReportsCache = [];
    refreshReportsCache();
    renderRooms();
  });
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

  if (!(claimsAdmin || roleAdmin)) {
    await signOut(auth);
    goToLogin();
    return;
  }

  currentAdmin = { uid: user.uid, ...data };
  if (!selectedFaultId) {
    if (faultSubportalAlert) faultSubportalAlert.textContent = "No fault selected. Return to admin portal.";
    if (roomFaultList) roomFaultList.innerHTML = "";
    return;
  }

  renderHeader();
  initInteractions();
  initReports();
});
