'use strict';

/**
 * Secretary: Default Firebase Configuration
 * Project: secretary-98cdd (Realtime Database & Authentication)
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB-0n-yWt0UdQ8vHnBb6rJZe7HzxGbQ34g",
  authDomain: "secretary-98cdd.firebaseapp.com",
  databaseURL: "https://secretary-98cdd-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "secretary-98cdd",
  storageBucket: "secretary-98cdd.firebasestorage.app",
  messagingSenderId: "759729165674",
  appId: "1:759729165674:web:8c7d7f1cdb97f7d726c113",
  measurementId: "G-00T108ZZG1"
};

if (typeof window !== 'undefined') {
  window.DEFAULT_FIREBASE_CONFIG = DEFAULT_FIREBASE_CONFIG;
}
if (typeof globalThis !== 'undefined') {
  globalThis.DEFAULT_FIREBASE_CONFIG = DEFAULT_FIREBASE_CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_FIREBASE_CONFIG };
}
