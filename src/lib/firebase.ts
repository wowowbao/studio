
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, EmailAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// !!! IMPORTANT: REPLACE WITH YOUR FIREBASE PROJECT CONFIGURATION !!!
// You can find this in your Firebase project settings:
// Project settings > General > Your apps > Web app > SDK setup and configuration
const firebaseConfig = {
  apiKey: "YOUR_API_KEY", // Replace
  authDomain: "YOUR_AUTH_DOMAIN", // Replace
  projectId: "YOUR_PROJECT_ID", // Replace
  storageBucket: "YOUR_STORAGE_BUCKET", // Replace
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID", // Replace
  appId: "YOUR_APP_ID", // Replace
  measurementId: "YOUR_MEASUREMENT_ID" // Optional, replace if you use Analytics
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
const emailProvider = new EmailAuthProvider(); // Though not directly used if using sendSignInLinkToEmail or password auth

export { app, auth, db, googleProvider, emailProvider };
