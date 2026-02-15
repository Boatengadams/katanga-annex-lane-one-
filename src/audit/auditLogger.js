import { addDoc, serverTimestamp } from "firebase/firestore";
import { auditRef } from "../firebase/firestore.js";

export function logAudit(action, target, admin) {
  return addDoc(auditRef, {
    action,
    target,
    actorId: admin.uid,
    role: admin.role,
    timestamp: serverTimestamp()
  });
}
