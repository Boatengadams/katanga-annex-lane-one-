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
const signupRoom = document.getElementById("signupRoom");
const program = document.getElementById("program");

let mode = "login";
const emailRegex = /^[A-Za-z0-9._%+-]+@st\.knust\.edu\.gh$/;

const clearAuthForm = () => {
  if (fullName) fullName.value = "";
  if (studentId) studentId.value = "";
  if (signupRoom) signupRoom.value = "";
  if (program) program.value = "";
  if (email) email.value = "";
  if (password) password.value = "";
};

const RATE_LIMIT_KEY = "authRateLimit";
const isRateLimited = () => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 3;
  const raw = sessionStorage.getItem(RATE_LIMIT_KEY);
  const attempts = raw ? JSON.parse(raw) : [];
  const recent = attempts.filter(ts => now - ts < windowMs);
  recent.push(now);
  sessionStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(recent));
  return recent.length > limit;
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
  authMessage.textContent = "";
};

if (loginTab && signupTab) {
  loginTab.addEventListener("click", () => setMode("login"));
  signupTab.addEventListener("click", () => setMode("signup"));
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
        if (!emailRegex.test(normalizedEmail)) {
          authMessage.textContent = "Use your KNUST email: name@st.knust.edu.gh";
          return;
        }
        if (!fullName.value.trim() || !studentId.value.trim()) {
          authMessage.textContent = "Please enter your name and student ID.";
          return;
        }
        if (!signupRoom.value) {
          authMessage.textContent = "Please select your room.";
          return;
        }
        if (!program.value.trim()) {
          authMessage.textContent = "Please enter your program of study.";
          return;
        }

        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password.value);
        await updateProfile(cred.user, { displayName: fullName.value.trim() });

        await setDoc(doc(db, "users", cred.user.uid), {
          name: fullName.value.trim(),
          studentId: studentId.value.trim(),
          room: signupRoom.value,
          program: program.value.trim(),
          login: normalizedEmail,
          email: normalizedEmail,
          role: "student",
          approved: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });

        authMessage.textContent = "Account created. Your account will be reviewed and confirmed shortly.";
        authMessage.style.color = "#9ee6b8";
        clearAuthForm();
        return;
      } else {
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
        window.location.href = "Lane1annexkatanga.html";
      }
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

setMode("login");
