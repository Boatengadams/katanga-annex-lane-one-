import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD63dYY8e9tIjU4JT5jsNqWcr7P8KKuO6Q",
  authDomain: "edutec-1.firebaseapp.com",
  projectId: "edutec-1",
  storageBucket: "edutec-1.firebasestorage.app",
  messagingSenderId: "180726692565",
  appId: "1:180726692565:web:0ccdf87e3f3a620b5f405c",
  measurementId: "G-948DJGHQDG"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
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

export { app, auth, db };
