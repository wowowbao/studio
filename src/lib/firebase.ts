
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, EmailAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// IMPORTANT: Replace this with your actual Firebase project configuration!
// You can find this in your Firebase project settings.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY", // REPLACE THIS
  authDomain: "YOUR_AUTH_DOMAIN", // REPLACE THIS
  projectId: "YOUR_PROJECT_ID", // REPLACE THIS
  storageBucket: "YOUR_STORAGE_BUCKET", // REPLACE THIS
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID", // REPLACE THIS
  appId: "YOUR_APP_ID", // REPLACE THIS
  measurementId: "YOUR_MEASUREMENT_ID" // Optional, REPLACE THIS if you use it
};

let app: FirebaseApp;

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const emailProvider = new EmailAuthProvider();

export { app, auth, db, googleProvider, emailProvider };
