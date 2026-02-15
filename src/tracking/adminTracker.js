import { addDoc, serverTimestamp } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { activityRef } from "../firebase/firestore.js";
import { app } from "../firebase/firebase.js";

const auth = getAuth(app);

export function trackAdmin(action, meta = {}) {
  const user = auth.currentUser;
  if (!user) return Promise.resolve();
  return addDoc(activityRef, {
    adminId: user.uid,
    action,
    meta,
    timestamp: serverTimestamp()
  });
}
