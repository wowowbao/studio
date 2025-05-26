
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, EmailAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// User-provided Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyCKFWuXosSE7gdrYqDcQiKhjOTOWIPbqks",
  authDomain: "budgetflow-kbfhn.firebaseapp.com",
  projectId: "budgetflow-kbfhn",
  storageBucket: "budgetflow-kbfhn.appspot.com", // Corrected common typo: firebasestorage.app -> appspot.com
  messagingSenderId: "36215483696",
  appId: "1:36215483696:web:9989ffc1495f8f1a1d2cf5"
  // measurementId is optional, can be added if needed
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
