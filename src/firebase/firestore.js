import { getFirestore, collection } from "firebase/firestore";
import { app } from "./firebase.js";

export const db = getFirestore(app);

export const faultsRef = collection(db, "faults");
export const reportsRef = collection(db, "reports");
export const usersRef = collection(db, "users");
export const auditRef = collection(db, "auditLogs");
export const activityRef = collection(db, "adminActivity");
