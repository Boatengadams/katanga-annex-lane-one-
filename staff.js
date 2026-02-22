import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const staffLogoutBtn = document.getElementById("staffLogoutBtn");
const staffRankHeading = document.getElementById("staffRankHeading");
const staffSummaryText = document.getElementById("staffSummaryText");
const staffName = document.getElementById("staffName");
const staffEmail = document.getElementById("staffEmail");
const staffRank = document.getElementById("staffRank");
const staffApprovalStatus = document.getElementById("staffApprovalStatus");
const staffTaskText = document.getElementById("staffTaskText");
const staffActions = document.getElementById("staffActions");
const staffAuthMessage = document.getElementById("staffAuthMessage");

const LOGIN_PAGE = "index.html";

const goToLogin = () => window.location.replace(LOGIN_PAGE);

const roleRedirect = (profile) => {
  const role = String(profile?.role || "").trim().toLowerCase();
  if (role === "student") return "Lane1annexkatanga.html";
  if (role === "maintenance_technician") return "maintenance.html";
  if (role === "admin" || role === "administrator" || role === "super admin" || role === "superadmin" || role === "super_admin") return "admin.html";
  return LOGIN_PAGE;
};

const renderActionsByRank = (rankValue) => {
  const rank = String(rankValue || "").trim().toUpperCase();

  if (rank === "SCR") {
    staffTaskText.textContent = "SCR rank can supervise hall operations and handle high-level user management tasks.";
    staffActions.innerHTML = `
      <button type="button" class="maintenance-room-chip" id="openAdminDashboardBtn">Open Admin Dashboard</button>
      <p>Use the admin dashboard for approvals and user management when admin permissions are granted.</p>
    `;
    const openAdminDashboardBtn = document.getElementById("openAdminDashboardBtn");
    if (openAdminDashboardBtn) {
      openAdminDashboardBtn.addEventListener("click", () => {
        window.location.href = "admin.html";
      });
    }
    return;
  }

  if (rank === "JCR") {
    staffTaskText.textContent = "JCR rank supports operational coordination and resident assistance.";
    staffActions.innerHTML = "<p>Coordinate student issues, monitor report progress, and escalate hall-wide concerns to SCR/Admin.</p>";
    return;
  }

  staffTaskText.textContent = "Porter rank focuses on assigned day-to-day hall support tasks.";
  staffActions.innerHTML = "<p>Handle assigned logistics and routine support requests according to management instructions.</p>";
};

if (staffLogoutBtn) {
  staffLogoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      goToLogin();
    } catch (err) {
      staffAuthMessage.textContent = err?.message || "Failed to logout.";
    }
  });
}

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

    const profile = snap.data();
    const role = String(profile?.role || "").trim().toLowerCase();
    if (role !== "staff") {
      window.location.replace(roleRedirect(profile));
      return;
    }

    staffName.textContent = profile?.name || "-";
    staffEmail.textContent = profile?.email || user.email || "-";
    staffRank.textContent = profile?.staffRank || "-";
    staffApprovalStatus.textContent = profile?.approved ? "Approved" : "Pending approval";

    const rankUpper = String(profile?.staffRank || "").trim().toUpperCase() || "STAFF";
    staffRankHeading.textContent = `${rankUpper} PORTAL`;
    staffSummaryText.textContent = `Welcome ${profile?.name || "Staff"}. Access and actions are controlled by your rank.`;

    renderActionsByRank(profile?.staffRank);

    if (!profile?.approved) {
      staffAuthMessage.textContent = "Your account is pending admin approval.";
    }
  } catch (err) {
    staffAuthMessage.textContent = err?.message || "Failed to load staff profile.";
  }
});
