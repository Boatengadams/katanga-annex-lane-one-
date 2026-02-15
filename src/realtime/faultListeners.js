import { onSnapshot, query, where, orderBy, limit } from "firebase/firestore";
import { reportsRef } from "../firebase/firestore.js";

export function listenToFaultReports({ faultId, faultLabel }, callback) {
  let q = null;
  if (faultLabel) {
    q = query(
      reportsRef,
      where("faultTypes", "array-contains", faultLabel),
      orderBy("createdAt", "desc"),
      limit(50)
    );
  } else if (faultId) {
    q = query(
      reportsRef,
      where("faultId", "==", faultId),
      orderBy("createdAt", "desc"),
      limit(50)
    );
  }

  if (!q) return () => {};

  return onSnapshot(q, snap => {
    callback(
      snap.docs.map(d => ({ id: d.id, ...d.data() }))
    );
  });
}
