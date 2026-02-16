import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const LOGIN_PAGE = "index.html";
const PORTAL_PAGE = "Lane1annexkatanga.html";

const declName = document.getElementById("declName");
const declStudentId = document.getElementById("declStudentId");
const declDate = document.getElementById("declDate");
const backToPortalBtn = document.getElementById("backToPortalBtn");
const rulesLogoutBtn = document.getElementById("rulesLogoutBtn");

const goToLogin = () => window.location.replace(LOGIN_PAGE);

window.addEventListener("pageshow", (event) => {
  if (event.persisted && !auth.currentUser) {
    goToLogin();
  }
});

if (backToPortalBtn) {
  backToPortalBtn.addEventListener("click", () => {
    window.location.href = PORTAL_PAGE;
  });
}

if (rulesLogoutBtn) {
  rulesLogoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      goToLogin();
    } catch (err) {
      alert(err?.message || "Failed to logout.");
    }
  });
}

const setDeclarationDate = () => {
  const now = new Date();
  if (declDate) {
    declDate.textContent = now.toLocaleDateString();
  }
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    goToLogin();
    return;
  }

  setDeclarationDate();

  let profile = null;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    profile = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error(err);
  }

  const studentName = (profile?.name || user.displayName || user.email || "Student").trim();
  const studentNumber = (profile?.studentId || "Not set").trim();

  if (declName) declName.textContent = studentName;
  if (declStudentId) declStudentId.textContent = studentNumber;
});
