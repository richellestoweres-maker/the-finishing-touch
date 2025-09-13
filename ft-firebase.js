// /js/ft-firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCfMOyKa2uT6BuMiST95Ry96Z7FUH_vYgQ",
  authDomain: "the-finishing-touch-8ac71.firebaseapp.com",
  projectId: "the-finishing-touch-8ac71",
  storageBucket: "the-finishing-touch-8ac71.firebasestorage.app",
  messagingSenderId: "591177706994",
  appId: "1:591177706994:web:254424c220c5d15fa24f6b",
  measurementId: "G-2SR4MB8JHW"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
