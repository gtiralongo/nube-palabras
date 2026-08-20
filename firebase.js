import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import {
  getDatabase,
  ref,
  set,
  get
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyBYQqMirx5f176cwZXxDrJm78BBv77A4zY",
  authDomain: "nubedepalabras-1c7ca.firebaseapp.com",
  databaseURL: "https://nubedepalabras-1c7ca-default-rtdb.europe-west1.firebasedatabase.app/",
  projectId: "nubedepalabras-1c7ca",
  storageBucket: "nubedepalabras-1c7ca.firebasestorage.app",
  messagingSenderId: "224898448924",
  appId: "1:224898448924:web:014e7318fced0f4cc169d9"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

window.firebaseSave = async function(words) {
  const data = words.map((w) => ({
    word: w.word,
    level: w.level,
    desc: w.desc
  }));
  await set(ref(db, 'words'), data);
};

window.firebaseLoad = async function() {
  try {
    const snapshot = await get(ref(db, 'words'));
    if (snapshot.exists()) {
      const data = snapshot.val();
      return Array.isArray(data) ? data : Object.values(data);
    }
  } catch (e) {
    console.error('firebase load error:', e);
  }
  return null;
};
