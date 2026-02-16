import {
  collection,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { app } from "./firebase.js";

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (err) {
  console.warn("Firestore persistent cache unavailable, using default mode.", err);
  db = getFirestore(app);
}

export { db };

export const faultsRef = collection(db, "faults");
export const reportsRef = collection(db, "reports");
export const usersRef = collection(db, "users");
export const auditRef = collection(db, "auditLogs");
export const activityRef = collection(db, "adminActivity");
