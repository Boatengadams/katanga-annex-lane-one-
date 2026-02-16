import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const room = document.getElementById("room");
const section = document.getElementById("faultSection");
const images = document.getElementById("faultImages");
const preview = document.getElementById("preview");
const socketType = document.getElementById("socketType");
const bedType = document.getElementById("bedType");
const tiltCard = document.querySelector(".card");
const studentName = document.getElementById("studentName");
const studentId = document.getElementById("studentId");
const studentLogin = document.getElementById("studentLogin");
const studentReports = document.getElementById("studentReports");
const toggleReportsBtn = document.getElementById("toggleReportsBtn");
const studentLogoutBtn = document.getElementById("studentLogoutBtn");
const openRulesBtn = document.getElementById("openRulesBtn");

let currentUser = null;
let currentProfile = null;
let reportsUnsub = null;
const LOGIN_PAGE = "index.html";
const goToLogin = () => window.location.replace(LOGIN_PAGE);

window.addEventListener("pageshow", (event) => {
  if (event.persisted && !auth.currentUser) {
    goToLogin();
  }
});

const normalizeFaultType = (fault) => {
  if (!fault) return "";
  const parts = fault.split(" - ");
  return parts[0].trim();
};

const toCompressedDataUrl = (file, maxSide = 800, quality = 0.5) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to process image."));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Invalid image file."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
};

if (room && section) {
  room.addEventListener("change", () => {
    section.classList.toggle("hidden", room.value === "");
  });
}

if (images && preview) {
  images.addEventListener("change", () => {
    preview.innerHTML = "";
    [...images.files].forEach(file => {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      preview.appendChild(img);
    });
  });
}

if (tiltCard) {
  const maxTilt = 6;

  const handleMove = (event) => {
    const rect = tiltCard.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const midX = rect.width / 2;
    const midY = rect.height / 2;
    const tiltX = ((y - midY) / midY) * -maxTilt;
    const tiltY = ((x - midX) / midX) * maxTilt;

    tiltCard.style.transform = `translateY(-4px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
  };

  const resetTilt = () => {
    tiltCard.style.transform = "";
  };

  tiltCard.addEventListener("mousemove", handleMove);
  tiltCard.addEventListener("mouseleave", resetTilt);
}

const faultCards = document.querySelectorAll(".fault-card");
if (faultCards.length) {
  faultCards.forEach(card => {
    const checkbox = card.querySelector("input[type='checkbox']");
    const select = card.querySelector("select");
    if (!checkbox || !select) return;

    const syncSelect = () => {
      const isChecked = checkbox.checked;
      select.style.display = isChecked ? "block" : "none";
      select.disabled = !isChecked;
      if (!isChecked) {
        select.selectedIndex = 0;
      }
    };

    checkbox.addEventListener("change", syncSelect);
    syncSelect();
  });
}

async function submitReport() {
  if (!currentUser) {
    alert("Please log in to submit a report.");
    return;
  }

  if (!currentProfile?.approved || currentProfile?.role !== "student") {
    alert("Your account is not approved for reporting yet.");
    return;
  }

  const faults = [...document.querySelectorAll(".fault-card input:checked")]
    .map(f => f.value);

  if (socketType && socketType.selectedIndex > 0) {
    faults.push(`Faulty Socket - ${socketType.value}`);
  }

  if (bedType && bedType.selectedIndex > 0) {
    faults.push(`Broken Bed - ${bedType.value}`);
  }

  if (!room.value) {
    alert("Please select a room.");
    return;
  }

  const loginValue = currentUser?.email || studentLogin?.value || "";
  const lockedName = (currentProfile?.name || studentName?.value || "").trim();
  const lockedStudentId = (currentProfile?.studentId || studentId?.value || "").trim();
  const lockedRoom = (currentProfile?.room || room?.value || "").trim();
  const lockedLogin = (currentProfile?.login || loginValue || "").trim();

  if (!lockedName || !lockedStudentId || !lockedLogin) {
    alert("Profile details are missing. Please contact admin.");
    return;
  }

  if (!faults.length) {
    alert("Please select at least one fault.");
    return;
  }

  let imageUrls = [];
  if (images?.files?.length) {
    const selectedFiles = [...images.files].slice(0, 2);
    if (images.files.length > 2) {
      alert("Only the first 2 images will be attached to the report.");
    }
    try {
      imageUrls = await Promise.all(selectedFiles.map((file) => toCompressedDataUrl(file)));
    } catch (err) {
      alert(err?.message || "Failed to process one or more images.");
      return;
    }
  }

  const faultTypes = [...new Set(faults.map(normalizeFaultType).filter(Boolean))];

  const report = {
    room: lockedRoom,
    faults,
    faultTypes,
    socketType: socketType ? socketType.value : "",
    bedType: bedType ? bedType.value : "",
    imageUrls,
    student: {
      uid: currentUser?.uid || "",
      name: lockedName,
      id: lockedStudentId,
      login: lockedLogin
    },
    createdBy: currentUser?.uid || "",
    status: "pending",
    createdAt: serverTimestamp()
  };

  try {
    const studentReportCollection = collection(
      db,
      "rooms",
      lockedRoom,
      "students",
      currentUser.uid,
      "reports"
    );
    await addDoc(studentReportCollection, report);
    alert("Fault report submitted successfully");
    document.querySelectorAll(".fault-card input:checked").forEach(input => {
      input.checked = false;
    });
    if (socketType) socketType.selectedIndex = 0;
    if (bedType) bedType.selectedIndex = 0;
    if (images) images.value = "";
    if (preview) preview.innerHTML = "";
  } catch (err) {
    alert(err?.message || "Failed to submit report.");
  }
}

const bgVideo = document.getElementById("bgVideo");
if (bgVideo) {
  bgVideo.playbackRate = 1;
  bgVideo.muted = true;
  bgVideo.autoplay = true;
  bgVideo.loop = true;
  bgVideo.playsInline = true;

  let playbackLocked = false;

  const hideVideoIfBlocked = () => {
    playbackLocked = true;
    bgVideo.classList.add("is-hidden");
  };

  const tryPlayBgVideo = async () => {
    if (playbackLocked) return;
    try {
      await bgVideo.play();
      bgVideo.classList.remove("is-hidden");
    } catch (err) {
      hideVideoIfBlocked();
    }
  };

  bgVideo.addEventListener("loadedmetadata", tryPlayBgVideo, { once: true });
  bgVideo.addEventListener("canplay", tryPlayBgVideo, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      tryPlayBgVideo();
    }
  });
  document.addEventListener("touchstart", tryPlayBgVideo, { passive: true, once: true });
  document.addEventListener("click", tryPlayBgVideo, { once: true });
  tryPlayBgVideo();
}

function renderStudentReports() {
  if (!studentReports) return;
  studentReports.innerHTML = "<p>Loading reports...</p>";
}

const renderStudentReportsFromData = (data) => {
  if (!studentReports) return;
  if (!data.length) {
    studentReports.innerHTML = "<p>No reports yet.</p>";
    return;
  }

  studentReports.innerHTML = data.map(r => {
    const dateValue = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : (r.date || "");
    const statusValue = r.status || "pending";
    return `
    <div class="report-card">
      <div class="report-head">
        <strong>${r.room}</strong>
        <span class="status ${statusValue}">${statusValue}</span>
      </div>
      <div class="report-meta">
        <div><strong>Name:</strong> ${r.student?.name || "-"}</div>
        <div><strong>ID:</strong> ${r.student?.id || "-"}</div>
        <div><strong>Login:</strong> ${r.student?.login || "-"}</div>
        <div><strong>Date:</strong> ${dateValue}</div>
      </div>
      <div class="report-faults">${(r.faults || []).map(f => `<span>${f}</span>`).join("")}</div>
    </div>
  `;
  }).join("");
}

renderStudentReports();

if (studentLogin) {
  studentLogin.addEventListener("input", renderStudentReports);
}

if (studentId) {
  studentId.addEventListener("input", renderStudentReports);
}

if (toggleReportsBtn && studentReports) {
  toggleReportsBtn.addEventListener("click", () => {
    const isOpen = studentReports.classList.toggle("is-open");
    toggleReportsBtn.textContent = isOpen ? "Hide Reports" : "View Reports";
  });
}

if (openRulesBtn) {
  openRulesBtn.addEventListener("click", () => {
    window.location.href = "rules.html";
  });
}

if (studentLogoutBtn) {
  studentLogoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      goToLogin();
    } catch (err) {
      alert(err?.message || "Failed to logout.");
    }
  });
}

window.submitReport = submitReport;

if (auth && (studentName || studentReports || room)) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    if (!user) {
      if (room || studentReports) {
        goToLogin();
      }
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        currentProfile = snap.data();
        if (studentName) {
          studentName.value = currentProfile.name || "";
          studentName.readOnly = true;
        }
        if (studentId) {
          studentId.value = currentProfile.studentId || "";
          studentId.readOnly = true;
        }
        if (studentLogin) {
          studentLogin.value = currentProfile.login || user.email || "";
          studentLogin.readOnly = true;
        }
        if (room) {
          room.value = currentProfile.room || "";
          room.disabled = true;
          if (section) section.classList.toggle("hidden", room.value === "");
        }
      } else {
        currentProfile = null;
        if (studentName) studentName.readOnly = false;
        if (studentId) studentId.readOnly = false;
        if (studentLogin) {
          studentLogin.value = user.email || "";
          studentLogin.readOnly = true;
        }
        if (room) room.disabled = false;
      }
    } catch (err) {
      console.error(err);
    }

    if (studentReports) {
      if (reportsUnsub) reportsUnsub();
      const studentRoom = (currentProfile?.room || "").trim();
      if (!studentRoom) {
        renderStudentReportsFromData([]);
        return;
      }
      const studentReportCollection = collection(
        db,
        "rooms",
        studentRoom,
        "students",
        user.uid,
        "reports"
      );
      reportsUnsub = onSnapshot(studentReportCollection, (snapshot) => {
        const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderStudentReportsFromData(rows);
      });
    }
  });
}
