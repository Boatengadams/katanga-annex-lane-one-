import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const loginForm = document.getElementById("loginForm");
const authCard = document.querySelector(".glass");
const loginTab = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");
const signupFields = document.getElementById("signupFields");
const authSubmit = document.getElementById("authSubmit");
const authMessage = document.getElementById("authMessage");
const email = document.getElementById("email");
const password = document.getElementById("password");
const passwordToggle = document.getElementById("passwordToggle");
const fullName = document.getElementById("fullName");
const studentId = document.getElementById("studentId");
const studentIdLabel = document.getElementById("studentIdLabel");
const signupRoom = document.getElementById("signupRoom");
const program = document.getElementById("program");
const registerRole = document.getElementById("registerRole");
const maintenanceType = document.getElementById("maintenanceType");
const staffRank = document.getElementById("staffRank");
const signupArea = document.getElementById("signupArea");
const signupSubdivision = document.getElementById("signupSubdivision");
const maintenanceTypeWrap = document.getElementById("maintenanceTypeWrap");
const staffRankWrap = document.getElementById("staffRankWrap");
const locationAreaWrap = document.getElementById("locationAreaWrap");
const locationSubdivisionWrap = document.getElementById("locationSubdivisionWrap");
const programWrap = document.getElementById("programWrap");

let mode = "login";
const studentEmailRegex = /^[A-Za-z0-9._%+-]+@st\.knust\.edu\.gh$/;
const studentEmailPattern = "^[A-Za-z0-9._%+-]+@st\\.knust\\.edu\\.gh$";

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
    label: "East Wing",
    subdivisions: {
      "lane-1": "Lane 1",
      "lane-2": "Lane 2",
      "lane-3": "Lane 3"
    }
  },
  "west-wing": {
    label: "West Wing",
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

const TECHNICIAN_FAULTS = {
  electrician: ["Faulty Bulb", "Faulty Fan", "Fan Regulator", "Socket"],
  carpenter: ["Broken Shelves", "Door Lock Fault", "Broken Louvers", "Broken Bed"],
  plumber: ["Drainages"]
};

const clearAuthForm = () => {
  if (fullName) fullName.value = "";
  if (studentId) studentId.value = "";
  if (signupRoom) signupRoom.value = "";
  if (program) program.value = "";
  if (email) email.value = "";
  if (password) password.value = "";
  if (registerRole) registerRole.value = "student";
  if (maintenanceType) maintenanceType.value = "";
  if (staffRank) staffRank.value = "";
  if (signupArea) signupArea.value = "";
  if (signupSubdivision) signupSubdivision.value = "";
  updateRoleFields();
};

const RATE_LIMIT_KEY = "authRateLimit";
const isRateLimited = () => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 3;
  const raw = sessionStorage.getItem(RATE_LIMIT_KEY);
  const attempts = raw ? JSON.parse(raw) : [];
  const recent = attempts.filter((ts) => now - ts < windowMs);
  recent.push(now);
  sessionStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(recent));
  return recent.length > limit;
};

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

const populateAreaOptions = () => {
  if (!signupArea) return;
  const options = Object.entries(LOCATION_STRUCTURE)
    .map(([value, item]) => `<option value="${value}">${item.label}</option>`)
    .join("");
  signupArea.innerHTML = `<option value="">-- Select Area --</option>${options}`;
};

const populateSubdivisionOptions = () => {
  if (!signupSubdivision || !signupArea) return;
  const areaConfig = LOCATION_STRUCTURE[signupArea.value];
  if (!areaConfig) {
    signupSubdivision.innerHTML = '<option value="">-- Select Subdivision --</option>';
    return;
  }

  const options = Object.entries(areaConfig.subdivisions)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  signupSubdivision.innerHTML = `<option value="">-- Select Subdivision --</option>${options}`;
};

const populateRoomOptions = () => {
  if (!signupRoom || !signupArea || !signupSubdivision) return;
  const rooms = getRoomsForLocation(signupArea.value, signupSubdivision.value);
  if (!rooms.length) {
    signupRoom.innerHTML = '<option value="">-- Select Room --</option>';
    return;
  }

  signupRoom.innerHTML = `<option value="">-- Select Room --</option>${rooms
    .map((value) => `<option>${value}</option>`)
    .join("")}`;
};

const updateRoleFields = () => {
  if (!registerRole) return;

  const role = registerRole.value;
  const isStudent = role === "student";
  const isTechnician = role === "maintenance_technician";
  const isStaff = role === "staff";

  if (maintenanceTypeWrap) maintenanceTypeWrap.classList.toggle("hidden", !isTechnician);
  if (staffRankWrap) staffRankWrap.classList.toggle("hidden", !isStaff);
  if (locationAreaWrap) locationAreaWrap.classList.toggle("hidden", !isStudent);
  if (locationSubdivisionWrap) locationSubdivisionWrap.classList.toggle("hidden", !isStudent);
  if (signupRoom?.closest(".form-field")) signupRoom.closest(".form-field").classList.toggle("hidden", !isStudent);
  if (programWrap) programWrap.classList.toggle("hidden", !isStudent);

  if (studentIdLabel) {
    studentIdLabel.textContent = isStudent ? "Student ID" : "ID Number";
  }
  if (studentId) {
    studentId.placeholder = isStudent ? "2500000001" : "Enter ID number";
  }

  if (email) {
    if (mode === "signup" && isStudent) {
      email.setAttribute("pattern", studentEmailPattern);
      email.setAttribute("title", "Use your KNUST student email in the format name@st.knust.edu.gh");
      email.setAttribute("placeholder", "name@st.knust.edu.gh");
    } else if (mode === "signup") {
      email.removeAttribute("pattern");
      email.setAttribute("title", "Enter your registration email.");
      email.setAttribute("placeholder", "name@example.com");
    }
  }
};

const setMode = (next) => {
  mode = next;
  const isSignup = mode === "signup";
  signupFields.classList.toggle("hidden", !isSignup);
  loginForm.classList.toggle("is-signup", isSignup);
  if (authCard) authCard.classList.toggle("is-signup-mode", isSignup);
  loginTab.classList.toggle("is-active", !isSignup);
  signupTab.classList.toggle("is-active", isSignup);
  authSubmit.value = isSignup ? "Create Account" : "Login";

  if (email) {
    if (!isSignup) {
      email.removeAttribute("pattern");
      email.setAttribute("title", "Enter your login email.");
      email.setAttribute("placeholder", "Enter email");
    }
  }

  updateRoleFields();
  authMessage.textContent = "";
};

if (loginTab && signupTab) {
  loginTab.addEventListener("click", () => setMode("login"));
  signupTab.addEventListener("click", () => setMode("signup"));
}

if (registerRole) {
  registerRole.addEventListener("change", updateRoleFields);
}

if (signupArea) {
  signupArea.addEventListener("change", () => {
    populateSubdivisionOptions();
    populateRoomOptions();
  });
}

if (signupSubdivision) {
  signupSubdivision.addEventListener("change", populateRoomOptions);
}

if (password && passwordToggle) {
  passwordToggle.addEventListener("click", () => {
    const showing = password.type === "text";
    password.type = showing ? "password" : "text";
    passwordToggle.textContent = showing ? "Show" : "Hide";
    passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    passwordToggle.setAttribute("aria-pressed", showing ? "false" : "true");
  });
}

const resolveRoleRedirect = (profile) => {
  const role = String(profile?.role || "").trim().toLowerCase();
  if (role === "maintenance_technician") return "maintenance.html";
  if (role === "staff") return "staff.html";
  return "Lane1annexkatanga.html";
};

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authMessage.textContent = "";
    authMessage.style.color = "";
    if (isRateLimited()) {
      authMessage.textContent = "Too many attempts. Please wait a minute.";
      return;
    }

    try {
      const normalizedEmail = email.value.trim().toLowerCase();
      if (mode === "signup") {
        const role = registerRole?.value || "student";
        if (!fullName.value.trim() || !studentId.value.trim()) {
          authMessage.textContent = "Please enter your name and ID number.";
          return;
        }

        if (role === "student") {
          if (!studentEmailRegex.test(normalizedEmail)) {
            authMessage.textContent = "Use your KNUST email: name@st.knust.edu.gh";
            return;
          }
          if (!signupArea.value || !signupSubdivision.value || !signupRoom.value) {
            authMessage.textContent = "Please select area, subdivision, and room.";
            return;
          }
          if (!program.value.trim()) {
            authMessage.textContent = "Please enter your program of study.";
            return;
          }
        }

        if (role === "maintenance_technician" && !maintenanceType.value) {
          authMessage.textContent = "Please select maintenance type.";
          return;
        }

        if (role === "staff" && !staffRank.value) {
          authMessage.textContent = "Please select staff rank.";
          return;
        }

        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password.value);
        await updateProfile(cred.user, { displayName: fullName.value.trim() });

        const profile = {
          name: fullName.value.trim(),
          idNumber: studentId.value.trim(),
          login: normalizedEmail,
          email: normalizedEmail,
          role,
          approved: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        if (role === "student") {
          profile.studentId = studentId.value.trim();
          profile.program = program.value.trim();
          profile.area = signupArea.value;
          profile.areaLabel = LOCATION_STRUCTURE[signupArea.value]?.label || "";
          profile.subdivision = signupSubdivision.value;
          profile.subdivisionLabel = LOCATION_STRUCTURE[signupArea.value]?.subdivisions?.[signupSubdivision.value] || "";
          profile.room = signupRoom.value;
          profile.locationText = `${profile.areaLabel} ${profile.subdivisionLabel} ${profile.room}`.trim();
        }

        if (role === "maintenance_technician") {
          const type = maintenanceType.value;
          profile.maintenanceType = type;
          profile.maintenanceLabel = type.charAt(0).toUpperCase() + type.slice(1);
          profile.allowedFaultTypes = TECHNICIAN_FAULTS[type] || [];
        }

        if (role === "staff") {
          profile.staffRank = staffRank.value;
        }

        await setDoc(doc(db, "users", cred.user.uid), profile, { merge: true });

        authMessage.textContent = "Account created. Your account will be reviewed and confirmed shortly.";
        authMessage.style.color = "#9ee6b8";
        clearAuthForm();
        return;
      }

      const loginEmail = normalizedEmail;
      const loginPassword = password.value;
      const cred = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      const tokenPromise = cred.user.getIdTokenResult(true);
      const profilePromise = getDoc(doc(db, "users", cred.user.uid));
      const token = await tokenPromise;
      const isAdmin = token.claims.admin === true;
      const isSuperAdmin = token.claims.superAdmin === true;

      if (isAdmin || isSuperAdmin) {
        clearAuthForm();
        window.location.href = "admin.html";
        return;
      }

      const snap = await profilePromise;
      if (!snap.exists()) {
        authMessage.textContent = "Account not found. Please sign up.";
        return;
      }
      const profile = snap.data();
      const role = String(profile.role || "").trim().toLowerCase();
      const isRoleAdmin =
        role === "admin" ||
        role === "administrator" ||
        role === "super admin" ||
        role === "super_admin" ||
        role === "superadmin";
      if (isRoleAdmin) {
        clearAuthForm();
        window.location.href = "admin.html";
        return;
      }
      if (!profile.approved) {
        authMessage.textContent = "Your account is pending approval. Please check back shortly.";
        return;
      }

      clearAuthForm();
      window.location.href = resolveRoleRedirect(profile);
    } catch (err) {
      const code = err?.code || "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        authMessage.textContent = "Incorrect email or password.";
      } else {
        authMessage.textContent = err?.message || "Authentication failed.";
      }
      authMessage.style.color = "";
    }
  });
}

populateAreaOptions();
populateSubdivisionOptions();
populateRoomOptions();
setMode("login");
