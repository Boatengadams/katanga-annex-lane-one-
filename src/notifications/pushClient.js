import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app } from "../firebase/firebase.js";

export const messaging = getMessaging(app);

export async function registerPush(uid) {
  const token = await getToken(messaging, {
    vapidKey: "YOUR_VAPID_KEY"
  });
  return token;
}

onMessage(messaging, payload => {
  const liveAlert = document.getElementById("liveAlert");
  if (liveAlert && payload?.notification?.title) {
    liveAlert.textContent = payload.notification.title;
  }
});
