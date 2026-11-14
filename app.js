// ─────────────────────────────────────────────
//  FIREBASE CONFIG
// ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyB6n8i2IhhquFkswMwfHfL1TscbxOBrAvE",
  authDomain:        "postre-mio.firebaseapp.com",
  projectId:         "postre-mio",
  storageBucket:     "postre-mio.firebasestorage.app",
  messagingSenderId: "15227550841",
  appId:             "1:15227550841:web:a01be146ce95b7b267e8a8"
};

// Bump both when releasing a change (shown in Ajustes > Acerca de)
const APP_VERSION = "1.9.8";
const APP_UPDATED = "2026-11-14T05:25Z";

const STORE_ID = "postremio_main";

{ const v = document.getElementById("authVersion"); if (v) v.textContent = "v" + APP_VERSION; }

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// Reads used during startup must never hang the loading screen: if the server
// doesn't answer in time, fall back to the offline cache. requireData makes the
// fallback fail when the cache is empty, so a missing cache is never mistaken
// for "no data yet" (which would seed defaults or reset the PIN).
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

async function fastGet(ref, requireData = false) {
  try {
    return await withTimeout(ref.get(), 8000);
  } catch (e) {
    let snap;
    try {
      snap = await withTimeout(ref.get({ source: "cache" }), 4000);
    } catch (e2) {
      // The offline cache itself can hang (e.g. blocked/private-mode storage)
      if (requireData) throw e;
      return { exists: false, empty: true, docs: [], data: () => ({}), forEach() {} };
    }
    const empty = snap.exists === undefined ? snap.empty : !snap.exists;
    if (requireData && empty) throw e;
    return snap;
  }
}

function storeRef(path) {
  return db.collection("stores").doc(STORE_ID).collection(path);
}

function configRef(docName) {
  return db.collection("stores").doc(STORE_ID).collection("config").doc(docName);
}

// ─────────────────────────────────────────────
//  PIN AUTH
// ─────────────────────────────────────────────

async function hashPin(pin) {
  const data = new TextEncoder().encode(pin);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

let _isSettingUp = false;

// Numpad-driven PIN
let _pinValue = "";
const pinDots = document.querySelectorAll("#pinDots .pin-dot");

function pinKey(digit) {
  if (_pinValue.length >= 4) return;
  playClick();
  _pinValue += digit;
  pinDots.forEach((dot, i) => dot.classList.toggle("filled", i < _pinValue.length));
  if (_pinValue.length === 4) submitPin();
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

let _audioCtx;
function playClick() {
  vibrate(8);
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = _audioCtx.createOscillator();
  const gain = _audioCtx.createGain();
  osc.connect(gain);
  gain.connect(_audioCtx.destination);
  osc.frequency.value = 1200;
  gain.gain.setValueAtTime(0.08, _audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.06);
  osc.start(_audioCtx.currentTime);
  osc.stop(_audioCtx.currentTime + 0.06);
}

function pinBackspace() {
  if (_pinValue.length === 0) return;
  playClick();
  _pinValue = _pinValue.slice(0, -1);
  pinDots.forEach((dot, i) => dot.classList.toggle("filled", i < _pinValue.length));
}

function getPin() {
  return _pinValue;
}

function clearPin() {
  _pinValue = "";
  pinDots.forEach(dot => dot.classList.remove("filled"));
}

let _submitting = false;
let _savingPending = false;
async function submitPin() {
  const pin = getPin();
  if (pin.length !== 4 || _submitting) return;
  _submitting = true;

  const errEl = document.getElementById("authError");
  errEl.textContent = "";

  document.getElementById("authGate").style.display = "none";
  document.getElementById("loadingScreen").style.display = "flex";

  let step = "inicio de sesión";
  const setStep = (name, label) => {
    step = name;
    const el = document.getElementById("loadingStatus");
    if (el) el.textContent = label;
  };

  try {
    setStep("inicio de sesión", "Iniciando sesión…");
    if (!auth.currentUser) {
      await withTimeout(auth.signInAnonymously(), 15000);
    }

    setStep("verificación del PIN", "Verificando PIN…");
    const authDoc = await fastGet(configRef("auth"), true);

    if (!authDoc.exists || !authDoc.data().pinHash) {
      if (!_isSettingUp) {
        _isSettingUp = true;
        document.getElementById("loadingScreen").style.display = "none";
        document.getElementById("authGate").style.display = "flex";
        document.getElementById("authSubtitle").textContent = "Crea un PIN de 4 dígitos para tu negocio";
        clearPin();
        return;
      }
      const hash = await hashPin(pin);
      await configRef("auth").set({ pinHash: hash });
      _isSettingUp = false;
      setStep("carga de datos", "Cargando datos…");
      await withTimeout(initApp(), 40000);
      document.getElementById("loadingScreen").style.display = "none";
      document.getElementById("appShell").style.display = "block";
    } else {
      const hash = await hashPin(pin);
      if (hash === authDoc.data().pinHash) {
        setStep("carga de datos", "Cargando datos…");
        await withTimeout(initApp(), 40000);
        document.getElementById("loadingScreen").style.display = "none";
        document.getElementById("appShell").style.display = "block";
      } else {
        document.getElementById("loadingScreen").style.display = "none";
        document.getElementById("authGate").style.display = "flex";
        errEl.textContent = "PIN incorrecto";
        vibrate([60, 60, 60]);
        clearPin();
      }
    }
  } catch (e) {
    document.getElementById("loadingScreen").style.display = "none";
    document.getElementById("authGate").style.display = "flex";
    document.getElementById("authSubtitle").textContent = "Ingresa el PIN para continuar";
    _isSettingUp = false;
    errEl.textContent = `Error de conexión (${step}). Intenta de nuevo.`;
    console.error("Login failed at", step, e);
    clearPin();
  } finally {
    _submitting = false;
  }
}


function logout() {
  if (!guardSettingsLeave(logout)) return;
  stopListeners();
  auth.signOut();
  document.getElementById("loadingScreen").style.display = "none";
  document.getElementById("appShell").style.display = "none";
  document.getElementById("authGate").style.display = "flex";
  document.getElementById("authSubtitle").textContent = "Ingresa el PIN para continuar";
  document.getElementById("authError").textContent = "";
  _isSettingUp = false;
  clearPin();
}

// Online/offline indicator
window.addEventListener("online",  () => updateConnBadge(true));
window.addEventListener("offline", () => updateConnBadge(false));

function updateConnBadge(online) {
  const el = document.getElementById("connBadge");
  if (!el) return;
  el.textContent = online ? "En línea" : "Sin conexión";
  el.className   = "conn-badge " + (online ? "online" : "offline");
}

updateConnBadge(navigator.onLine);

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────
//  DATA STORE (Firestore-backed)
// ─────────────────────────────────────────────

const DataStore = {
  // ── Inventory ──
  async getInventory() {
    const snap = await fastGet(storeRef("inventory"), true);
    const inv = {};
    snap.forEach(doc => { inv[doc.id] = doc.data().qty; });
    return inv;
  },

  async setStock(name, qty) {
    await storeRef("inventory").doc(name).set({ qty });
  },

  async decrementStock(name, qty) {
    const ref = storeRef("inventory").doc(name);
    return db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const current = doc.exists ? doc.data().qty : 0;
      if (current < qty) throw new Error("insufficient_stock");
      tx.set(ref, { qty: current - qty });
    });
  },

  async incrementStock(name, qty) {
    const ref = storeRef("inventory").doc(name);
    await ref.set({ qty: firebase.firestore.FieldValue.increment(qty) }, { merge: true });
  },

  // ── Sales History ──
  async getSales() {
    const snap = await storeRef("sales").orderBy("isoDate", "desc").get();
    return snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
  },

  async addSale(sale) {
    const ref = await storeRef("sales").add(sale);
    return ref.id;
  },

  async updateSale(id, fields) {
    await storeRef("sales").doc(id).update(fields);
  },

  async deleteSale(id) {
    await storeRef("sales").doc(id).delete();
  },

  // ── Promotions ──
  async getPromotions() {
    const snap = await fastGet(storeRef("promotions"));
    return snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
  },

  async addPromotion(promo) {
    await storeRef("promotions").add(promo);
  },

  async updatePromotion(id, fields) {
    await storeRef("promotions").doc(id).update(fields);
  },

  async deletePromotion(id) {
    await storeRef("promotions").doc(id).delete();
  },

  // ── Pending Orders ──
  async getPending() {
    const snap = await storeRef("pendingOrders").orderBy("date", "desc").get();
    return snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
  },

  async addPending(order) {
    await storeRef("pendingOrders").add(order);
  },

  async deletePending(id) {
    await storeRef("pendingOrders").doc(id).delete();
  },

  // ── Mermas ──
  async getMermas() {
    const snap = await storeRef("mermas").orderBy("date", "desc").get();
    return snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
  },

  async addMerma(merma) {
    await storeRef("mermas").add(merma);
  },

  async deleteMerma(id) {
    await storeRef("mermas").doc(id).delete();
  },

  async clearMermas() {
    const snap = await storeRef("mermas").get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  // ── Restock Log ──
  async getRestockLog() {
    const snap = await fastGet(storeRef("restockLog").orderBy("date", "desc").limit(RESTOCK_LOG_LIMIT));
    return snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
  },

  async addRestock(entry) {
    await storeRef("restockLog").add(entry);
  },

  async deleteRestocks(ids) {
    const batch = db.batch();
    ids.forEach(id => batch.delete(storeRef("restockLog").doc(id)));
    await batch.commit();
  },

  async clearRestockLog() {
    const snap = await storeRef("restockLog").get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  // ── Config (prices, hidden) ──

  async getCustomPrices() {
    const doc = await fastGet(configRef("prices"));
    return doc.exists ? doc.data() : {};
  },

  async saveCustomPrice(name, price) {
    await configRef("prices").set({ [name]: price }, { merge: true });
  },

  async getExtrasPrices() {
    const doc = await fastGet(configRef("extrasPrices"));
    return doc.exists ? doc.data() : {};
  },

  async saveExtrasPrice(productName, extraName, price) {
    const key = productName + '__' + extraName;
    await configRef("extrasPrices").set({ [key]: price }, { merge: true });
  },

  async getHiddenItems() {
    const doc = await fastGet(configRef("hidden"));
    return doc.exists ? (doc.data().items || []) : [];
  },

  async saveHiddenItems(items) {
    await configRef("hidden").set({ items });
  },

  // ── Settings ──
  async getSettings() {
    const doc = await fastGet(configRef("settings"));
    return doc.exists ? doc.data() : {};
  },

  async saveSettings(fields) {
    await configRef("settings").set(fields, { merge: true });
  },

  // ── Frozen Inventory ──
  async getFrozenInventory() {
    const doc = await fastGet(configRef("frozenInventory"));
    return doc.exists ? doc.data() : {};
  },

  async setFrozenStock(name, qty) {
    await configRef("frozenInventory").set({ [name]: qty }, { merge: true });
  },

  // ── Bulk clear for daily cut ──
  async clearDayData() {
    const collections = ["sales", "mermas", "restockLog"];
    for (const col of collections) {
      const snap = await storeRef(col).get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  }
};

// ─────────────────────────────────────────────
//  REAL-TIME LISTENERS
// ─────────────────────────────────────────────

let _unsubscribers = [];

function startListeners() {
  stopListeners();
  // Inventory
  _unsubscribers.push(
    storeRef("inventory").onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "removed") {
          delete inventory[change.doc.id];
        } else {
          inventory[change.doc.id] = change.doc.data().qty;
        }
      });
      saveInventory();
      renderProducts();
      if (document.getElementById("inventoryPage").style.display !== "none") {
        renderInventory();
      }
    })
  );

  // Sales — just re-render history if visible
  _unsubscribers.push(
    storeRef("sales").onSnapshot(() => {
      if (document.getElementById("historyPage").style.display !== "none") {
        renderHistoryFromFirestore();
      }
    })
  );

  // Promotions
  _unsubscribers.push(
    storeRef("promotions").onSnapshot(async () => {
      promotions = await DataStore.getPromotions();
      renderCart();
      if (document.getElementById("promoPage").style.display !== "none") {
        renderPromos();
      }
    })
  );

  // Config (prices, hidden)
  _unsubscribers.push(
    configRef("prices").onSnapshot(doc => {
      if (!doc.exists) return;
      const prices = doc.data();
      menu.forEach(cat => {
        cat.items.forEach(item => {
          if (prices[item.name] !== undefined) item.price = prices[item.name];
        });
      });
      renderProducts();
      renderCart();
    })
  );

  // Mermas — re-render if visible
  _unsubscribers.push(
    storeRef("mermas").onSnapshot(() => {
      if (document.getElementById("mermaPage").style.display !== "none") {
        renderMermaLog();
      }
    })
  );

  // Pending orders — re-render if visible
  _unsubscribers.push(
    storeRef("pendingOrders").onSnapshot(() => {
      if (document.getElementById("pendingPage").style.display !== "none") {
        renderPending();
      }
    })
  );

  // Restock log — only the latest entries, rendered straight from the snapshot
  _unsubscribers.push(
    storeRef("restockLog").orderBy("date", "desc").limit(RESTOCK_LOG_LIMIT).onSnapshot(snap => {
      renderRestockLogWithData(snap.docs.map(doc => ({ _id: doc.id, ...doc.data() })));
    })
  );
}

function stopListeners() {
  _unsubscribers.forEach(unsub => unsub());
  _unsubscribers = [];
}

// Helper to render history from Firestore
async function renderHistoryFromFirestore() {
  showSpinner();
  const data = await DataStore.getSales().finally(hideSpinner);
  _historyData = data;
  renderHistoryWithData(data);
}

// ─────────────────────────────────────────────

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ── SVG ICONS ─────────────────────────────────
const _ICON_PATHS = {
  cookie:   '<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  cake:     '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3"/><path d="M7 4h.01M12 4h.01M17 4h.01"/>',
  cupcake:  '<path d="M5 11a7 7 0 0 1 14 0"/><path d="M4 11h16l-2 9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M12 4V3"/><path d="M9 14v4M12 14v4M15 14v4"/>',
  croissant:'<path d="M3 16c-1-4 1-8 5-9l2 3 2-4 2 4 2-3c4 1 6 5 5 9-2 1-4-1-5-3l-3 1-3-1c-1 2-3 4-5 3z"/>',
  bread:    '<path d="M5 11a4 4 0 0 1 0-8h14a4 4 0 0 1 0 8v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  coins:    '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4"/><path d="m16.7 13.9.7.7-2.8 2.8"/>',
  tag:      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  gift:     '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  ticket:   '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
  check:    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  pause:    '<circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>',
  pencil:   '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  flame:    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  snowflake:'<line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  save:     '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  package:  '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  dollar:   '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  alert:    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  clipboard:'<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  note:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  card:     '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  transfer: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  percent:  '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  refresh:  '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  eye:      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:   '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  chevronsDown: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  tick:     '<polyline points="20 6 9 17 4 12"/>',
  plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  trendDown:'<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  chef:     '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.46.32-.84.73-1.04a4 4 0 0 0-2.14-7.59 5 5 0 0 0-9.18 0 4 4 0 0 0-2.14 7.59c.41.2.73.58.73 1.04V20a1 1 0 0 0 1 1z"/><path d="M6 17h12"/>',
  receipt:  '<path d="M4 2.6q1 -1.1 2 0q1 -1.1 2 0q1 -1.1 2 0q1 -1.1 2 0q1 -1.1 2 0q1 -1.1 2 0q1 -1.1 2 0q1 -1.1 2 0L20 21.4q-1 1.1 -2 0q-1 1.1 -2 0q-1 1.1 -2 0q-1 1.1 -2 0q-1 1.1 -2 0q-1 1.1 -2 0q-1 1.1 -2 0q-1 1.1 -2 0Z" fill="#f6f7f9" stroke="#b9bec7" stroke-width=".7" stroke-linejoin="round"/><rect x="6" y="4.6" width="12" height="2" rx=".3" fill="#2b2f36"/><rect x="6" y="7.4" width="12" height=".55" fill="#2b2f36"/><rect x="6" y="8.4" width="12" height=".55" fill="#2b2f36"/><rect x="9.6" y="10" width="4.8" height=".95" rx=".3" fill="#2b2f36"/><rect x="6" y="12.3" width="5" height="0.95" rx=".3" fill="#2b2f36"/><line x1="11.7" y1="12.8" x2="15.2" y2="12.8" stroke="#7b818c" stroke-width=".7" stroke-dasharray=".6 .7"/><rect x="15.5" y="12.3" width="2.6" height="0.95" rx=".3" fill="#2b2f36"/><rect x="6" y="14.5" width="5" height="0.95" rx=".3" fill="#2b2f36"/><line x1="11.7" y1="15.0" x2="15.2" y2="15.0" stroke="#7b818c" stroke-width=".7" stroke-dasharray=".6 .7"/><rect x="15.5" y="14.5" width="2.6" height="0.95" rx=".3" fill="#2b2f36"/><rect x="6" y="16.7" width="5" height="0.95" rx=".3" fill="#2b2f36"/><line x1="11.7" y1="17.2" x2="15.2" y2="17.2" stroke="#7b818c" stroke-width=".7" stroke-dasharray=".6 .7"/><rect x="15.5" y="16.7" width="2.6" height="0.95" rx=".3" fill="#2b2f36"/><rect x="15.5" y="19.1" width="2.6" height=".95" rx=".3" fill="#2b2f36"/>',
  cart:     '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
};

// Full-color icons (drawn with their own fills) instead of single-color outlines
const _COLOR_ICONS = new Set(["receipt"]);

function icon(name) {
  if (_COLOR_ICONS.has(name)) {
    return `<svg class="icon icon-${name}" viewBox="0 0 24 24" aria-hidden="true">${_ICON_PATHS[name]}</svg>`;
  }
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_ICON_PATHS[name] || ''}</svg>`;
}

// Category identity strings (stored in promos) start with an emoji; show a name + SVG instead.
const CATEGORY_ICONS = { "🍪 Galletas": "cookie", "✨ Especiales": "sparkles", "🎂 Pasteles": "cake", "🍰 Postres": "cupcake" };
function catName(category) { return category.replace(/^\S+\s/, ""); }
function catHTML(category) { return `${icon(CATEGORY_ICONS[category])} ${esc(catName(category))}`; }

// Products whose variants (the first extras choice) each have their own stock.
const VARIANT_PRODUCTS = {
  "Pan de muerto": ["Nutella y kínder", "Lotus biscoff", "Betún de queso crema y fresas"],
};
const variantKey = (product, variant) => `${product} · ${variant}`;
// Inventory key for a cart/sale item (its variant's own key, or just its name)
function stockKey(item) {
  return VARIANT_PRODUCTS[item.name] && item.extra && item.extra.variant
    ? variantKey(item.name, item.extra.variant)
    : item.name;
}
function stockNamesFor(productName) {
  return VARIANT_PRODUCTS[productName]
    ? VARIANT_PRODUCTS[productName].map(v => variantKey(productName, v))
    : [productName];
}
function productStock(productName) {
  return stockNamesFor(productName).reduce((sum, k) => sum + (inventory[k] ?? 0), 0);
}
function parentProduct(key) { return key.split(" · ")[0]; }

// Stock at or below this (but above 0) is flagged as "Poco"; editable in Ajustes.
let lowStockThreshold = 3;

// Editable in Ajustes; stored in config/settings (missing fields use these defaults)
const RESTOCK_LOG_LIMIT = 50;

const DEFAULT_SETTINGS = {
  ticketThanks: "¡Gracias por su compra! ❤️",
  ticketFooter: "Tel. 229 157 4962\n@postremio.mx",
  shareMessage: "Gracias por tu compra en Postre Mío ❤️",
  askSendTicket: true,
  cashDenominations: [50, 100, 200, 500],
};
let appSettings = { ...DEFAULT_SETTINGS };

const defaultInventory = {
  "M&Ms": 0,
  "Lotus": 0,
  "Kinder Bueno": 0,
  "Red Velvet": 0,
  "Oreo": 0,
  "Lucky Charms": 0,
  "Conejito Turín": 0,
  "Pistache": 0,
  "Cinnamon Roll": 0,
  "Fresa Pink Sugar": 0,
  "Crookie": 0,
  "Rol de canela": 0,
  "Brownie": 0,
  "Cookie bites": 0,
  "Besos de nuez": 0,
  "Mini pastel maceta": 0,
  "Carlota de limón": 0,
  "Rebanada Red Velvet": 0,
  ...Object.fromEntries(stockNamesFor("Pan de muerto").map(k => [k, 0])),
  "Pan de zanahoria": 0,
  "Pay de elote": 0,
  "Rebanada de tres leches": 0,
  "Cheesecake mermelada de fresa": 0,
  "Cheesecake Nutella": 0
};

// Old product names mapped to their current names, for migrating existing Firestore data
const PRODUCT_RENAMES = {
  "Canela": "Cinnamon Roll",
  "Rol": "Cinnamon Roll",
  "Fresa": "Fresa Pink Sugar",
  "Pastel red velvet": "Rebanada Red Velvet",
  "Pastel Red Velvet": "Rebanada Red Velvet",
  "Pastel de tres leches": "Rebanada de tres leches",
  "Cheesecake · Mermelada de fresa": "Cheesecake mermelada de fresa",
  "Cheesecake · Nutella": "Cheesecake Nutella",
  "Mini pastel zanahoria": "Mini pastel maceta",
  "Mini pastel red velvet": "Mini pastel maceta",
  "Mini pastel Nutella": "Mini pastel maceta",
  "Mini pastel dulce de leche": "Mini pastel maceta",
};

const savedInventory = JSON.parse(localStorage.getItem("inventory")) || {};
let inventory = { ...defaultInventory, ...savedInventory };

let originalInventory = JSON.parse(JSON.stringify(inventory));
let updatedItems = new Set();

function saveInventory() {
  localStorage.setItem("inventory", JSON.stringify(inventory));
}

// Products that can be frozen (1:1 with menu items)
const FREEZABLE_PRODUCTS = [
  "M&Ms", "Lotus", "Kinder Bueno", "Red Velvet", "Oreo",
  "Lucky Charms", "Conejito Turín", "Pistache", "Cinnamon Roll", "Fresa Pink Sugar",
  "Crookie"
];

let frozenInventory = {};
let originalFrozenInventory = JSON.parse(JSON.stringify(frozenInventory));
let updatedFrozenItems = new Set();
let _frozenHoldInterval = null;
let _editModalOpen = false;

let currentSale = null;

const menu = [
  {
    category: "🍪 Galletas",
    items: [
      { name: "M&Ms", price: 49.00, img: "mms.jpg" },
      { name: "Lotus", price: 49.00, img: "lotus.jpg" },
      { name: "Kinder Bueno", price: 49.00, img: "kinder.jpg" },
      { name: "Red Velvet", price: 49.00, img: "redvelvet.jpg" },
      { name: "Oreo", price: 49.00, img: "oreo.jpg" },
      { name: "Lucky Charms", price: 49.00, img: "lucky.jpg" },
      { name: "Conejito Turín", price: 49.00, img: "turin.jpg" },
      { name: "Pistache", price: 49.00, img: "pistache.jpg" },
      { name: "Cinnamon Roll", price: 49.00, img: "canela.jpg" },
      { name: "Fresa Pink Sugar", price: 49.00, img: "fresa.jpg" }
    ]
  },
  {
    category: "✨ Especiales",
    items: [
      { name: "Crookie", price: 65.00, img: "crookie.jpg" },
      { name: "Rol de canela", price: 60.00, img: "rol.jpg" },
      { name: "Brownie", price: 40.00, img: "brownie.jpg" },
      { name: "Cookie bites", price: 100.00, img: "bites.jpg" },
      { name: "Besos de nuez", price: 90.00, img: "besosnuez.jpg" },
      { name: "Pan de muerto", price: 0, img: "pandemuerto.jpg", noBasePrice: true }
    ]
  },
  {
    category: "🎂 Pasteles",
    items: [
      { name: "Mini pastel maceta", price: 220.00, img: "mini_cake.jpg" },
      { name: "Rebanada Red Velvet", price: 80.00, img: "pastel_rv.jpg" },
      { name: "Rebanada de tres leches", price: 95.00, img: "tres_leches.jpg" },
      { name: "Cheesecake mermelada de fresa", price: 80.00, img: "cheesecake_fresa.jpg" },
      { name: "Cheesecake Nutella", price: 80.00, img: "cheesecake_nutella.jpg" }
    ]
  },
  {
    category: "🍰 Postres",
    items: [
      { name: "Carlota de limón", price: 30.00, img: "carlota.jpg" },
      { name: "Pan de zanahoria", price: 50.00, img: "pan_zanahoria.jpg" },
      { name: "Pay de elote", price: 40.00, img: "pay_elote.jpg" }
    ]
  }
];

// Drop cart items saved under product names that no longer exist (renamed/merged)
let cart = (JSON.parse(localStorage.getItem("cart")) || []).filter(i => stockKey(i) in defaultInventory);

// Render productos
function renderProducts() {
  const container = document.getElementById("products");
  container.innerHTML = "";
  const hiddenItems = getHiddenItems();

  menu.forEach(cat => {
    if (cat.items.every(i => hiddenItems.includes(i.name))) return;
    const section = document.createElement("div");
    section.className = "category";

    section.innerHTML = `<h2>${catHTML(cat.category)}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid";

    cat.items.forEach(item => {
      if (hiddenItems.includes(item.name)) return;

      const stock = productStock(item.name);
      const isOut = stock === 0;
      const isLow = stock > 0 && stock <= lowStockThreshold;

      const safeId = item.name.replace(/[^a-zA-Z0-9]/g, '-');
      const div = document.createElement("div");
      div.className = "product" + (isLow ? " low-stock-product" : "") + (isOut ? " out-of-stock" : "");
      div.innerHTML = `
        <img src="${item.img}">
        <h3>${esc(item.name)}</h3>
        ${item.noBasePrice ? '' : `<p>$${parseFloat(item.price).toFixed(2)}</p>`}
        <p id="stock-${safeId}" style="margin:0;font-size:12px;color:var(--text-muted);">Stock: ${stock}${isLow ? ` <span class="low-stock-badge">${icon('alert')} Poco</span>` : ""}${isOut ? ' <span class="low-stock-badge" style="background:#e53935;">Sin stock</span>' : ""}</p>
      `;
      if (!isOut) div.onclick = () => addToCart(item);
      grid.appendChild(div);
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

// ── EXTRAS CONFIG ─────────────────────────────
// Items that require an extra selection when added to cart.
// extrasPrice: 0 means free (Natural), > 0 means charged extra.
let ITEM_EXTRAS = {
  "Rol de canela": [
    { name: "Natural",              price: 0   },
    { name: "Glaseado queso crema", price: 5  },
    { name: "Nutella",              price: 10  },
    { name: "Lotus",                price: 25  },
  ],
  // Pan de muerto has no base price — each flavor carries its own full price.
  "Pan de muerto": [
    { name: "Nutella y kínder",                 price: 90 },
    { name: "Lotus biscoff",                    price: 95 },
    { name: "Betún de queso crema y fresas",    price: 95 },
  ],
  // Mini pastel maceta: flavor choice only, no price difference between them.
  "Mini pastel maceta": [
    { name: "Zanahoria",      price: 0 },
    { name: "Red velvet",     price: 0 },
    { name: "Nutella",        price: 0 },
    { name: "Dulce de leche", price: 0 },
  ],
};

// Items with a second extras step after the first one (e.g. flavor, then a
// separate filling choice). Combined into a single cart "extra" on confirm.
const ITEM_EXTRAS_STEP2 = {
  "Pan de muerto": [
    { name: "Natural",                price: 0  },
    { name: "Extra de tres leches",   price: 25 },
  ],
};

// Items whose extra choice must always be recorded even when its price is 0
// (the choice itself is meaningful, e.g. a cake flavor) — unlike Rol de
// canela's "Natural", which is the default/no-extra state and can be omitted.
const ITEM_EXTRAS_ALWAYS_KEEP = new Set(["Mini pastel maceta"]);

const ITEM_EXTRAS_LABEL = {
  "Rol de canela": "Elige el betún:",
  "Pan de muerto": "Elige el relleno:",
  "Mini pastel maceta": "Elige el sabor:",
};

const ITEM_EXTRAS_STEP2_LABEL = {
  "Pan de muerto": "Extras:",
};

const ITEM_EXTRAS_ICON = {
  "Rol de canela": "croissant",
  "Pan de muerto": "bread",
  "Mini pastel maceta": "cupcake",
};

// Carrito
function addToCart(item) {
  const inCart = cart.filter(i => i.name === item.name).length;
  if (inCart >= productStock(item.name)) {
    showToast("Sin stock disponible");
    return;
  }

  const extras = ITEM_EXTRAS[item.name];
  if (extras) {
    openExtrasModal(item, extras);
  } else {
    pushCartItem(item, null);
  }
}

function openExtrasModal(item, extras) {
  const buttonsHTML = extras.map(e => {
    const variantStock = VARIANT_PRODUCTS[item.name]
      ? (inventory[variantKey(item.name, e.name)] ?? 0) - cart.filter(i => stockKey(i) === variantKey(item.name, e.name)).length
      : null;
    return `
    <button
      class="extra-btn ${e.price === 0 ? 'natural' : 'paid'}"
      ${variantStock !== null && variantStock <= 0 ? 'disabled' : ''}
      onclick="confirmExtra(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${JSON.stringify(e).replace(/"/g, '&quot;')})"
    >
      ${esc(e.name)}${variantStock !== null ? ` <span class="extra-price">Stock: ${Math.max(0, variantStock)}</span>` : ''}
      <span class="extra-price">${item.noBasePrice ? '$' + e.price.toFixed(2) : (e.price === 0 ? 'Incluido' : '+$' + e.price.toFixed(2))}</span>
    </button>
  `;
  }).join("");

  openPopupModal(`
    <h3 style="margin-top:0;">${icon(ITEM_EXTRAS_ICON[item.name] || 'croissant')} ${esc(item.name)}</h3>
    <p style="color:#666;font-size:14px;margin:4px 0 8px;">${esc(ITEM_EXTRAS_LABEL[item.name] || 'Elige una opción:')}</p>
    <div class="extras-grid">${buttonsHTML}</div>
    <button onclick="closeModal()" style="background:#f5f5f5;margin-top:14px;">Cancelar</button>
  `);
}

function confirmExtra(item, extra) {
  closeModal();
  if (VARIANT_PRODUCTS[item.name]) extra = { ...extra, variant: extra.name };
  const step2 = ITEM_EXTRAS_STEP2[item.name];
  if (step2) {
    openExtrasStep2Modal(item, extra, step2);
  } else {
    const keep = extra.price > 0 || ITEM_EXTRAS_ALWAYS_KEEP.has(item.name);
    pushCartItem(item, keep ? extra : null);
  }
}

function openExtrasStep2Modal(item, firstExtra, options) {
  const buttonsHTML = options.map(o => `
    <button
      class="extra-btn ${o.price === 0 ? 'natural' : 'paid'}"
      onclick="confirmExtrasStep2(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${JSON.stringify(firstExtra).replace(/"/g, '&quot;')}, ${JSON.stringify(o).replace(/"/g, '&quot;')})"
    >
      ${esc(o.name)}
      <span class="extra-price">${o.price === 0 ? 'Incluido' : '+$' + o.price.toFixed(2)}</span>
    </button>
  `).join("");

  openPopupModal(`
    <h3 style="margin-top:0;">${icon(ITEM_EXTRAS_ICON[item.name] || 'croissant')} ${esc(item.name)}</h3>
    <p style="color:#666;font-size:14px;margin:4px 0 8px;">${esc(ITEM_EXTRAS_STEP2_LABEL[item.name] || 'Elige una opción:')}</p>
    <div class="extras-grid">${buttonsHTML}</div>
    <button onclick="closeModal()" style="background:#f5f5f5;margin-top:14px;">Cancelar</button>
  `);
}

function confirmExtrasStep2(item, firstExtra, addon) {
  closeModal();
  const combined = {
    name: addon.price > 0 ? `${firstExtra.name} + ${addon.name}` : firstExtra.name,
    price: firstExtra.price + addon.price,
    variant: firstExtra.variant,
  };
  pushCartItem(item, combined);
}

// Assigns a unique cartId so each rol is independent in the cart
let _cartIdCounter = 0;

function pushCartItem(item, extra) {
  if (VARIANT_PRODUCTS[item.name]) {
    const key = stockKey({ ...item, extra });
    const inCart = cart.filter(i => stockKey(i) === key).length;
    if (inCart >= (inventory[key] ?? 0)) {
      showToast("Sin stock de esa opción");
      return;
    }
  }
  vibrate(10);
  const cartItem = {
    ...item,
    cartId: ++_cartIdCounter,
    extra: extra || null
  };
  if (extra) {
    cartItem.price = item.price + extra.price; // total price includes extra
  }
  cart.push(cartItem);
  renderCart();
}

function removeCartItem(cartId) {
  const idx = cart.findIndex(i => String(i.cartId) === String(cartId));
  if (idx > -1) cart.splice(idx, 1);
  renderCart();
}

// Unified +/− for grouped cart rows (works for both plain and extra-variant items)
function changeQtyGrouped(name, extraName, delta) {
  if (delta > 0) {
    // Check total in cart for this item name (all variants combined) vs stock
    const totalInCart = cart.filter(i => i.name === name).length;
    if (totalInCart >= productStock(name)) {
      showToast("No hay más stock disponible");
      return;
    }

    const menuItem = menu.flatMap(c => c.items).find(i => i.name === name);
    if (ITEM_EXTRAS[name]) {
      openExtrasModal(menuItem, ITEM_EXTRAS[name]);
    } else {
      cart.push(menuItem);
      renderCart();
    }
  } else {
    // Remove the last matching instance
    const idx = [...cart].map((i, idx) => ({ i, idx }))
      .reverse()
      .find(({ i }) => {
        const iExtra = i.extra ? i.extra.name : null;
        return i.name === name && iExtra === extraName;
      })?.idx;
    if (idx !== undefined) { cart.splice(idx, 1); renderCart(); }
  }
}

function removeItem(i) {
  cart.splice(i, 1);
  renderCart();
}

function clearCart() {
  if (cart.length === 0) return;
  confirmModal("¿Limpiar la orden?", () => {
    cart = [];
    renderCart();
  });
}

// ── Custom dropdowns ─────────────────────────
// Replaces native <select> (iOS wheel picker) with a styled list. The original
// <select> stays in the DOM, hidden, so existing code that reads .value or
// listens to onchange keeps working.
let _cselectBackdrop = null;
let _cselectBtn = null;

function closeCustomSelect() {
  if (_cselectBackdrop) { _cselectBackdrop.remove(); _cselectBackdrop = null; }
  if (_cselectBtn) { _cselectBtn.classList.remove("open"); _cselectBtn = null; }
}

// Options may carry data-icon (an icon name) and data-meta (small text on the right).
function optionParts(opt) {
  const parts = [];
  if (opt.dataset.icon) {
    const i = document.createElement("span");
    i.className = "cselect-icon";
    i.innerHTML = icon(opt.dataset.icon);
    parts.push(i);
  }
  const t = document.createElement("span");
  t.className = "cselect-text";
  t.textContent = opt.textContent;
  parts.push(t);
  if (opt.dataset.meta) {
    const m = document.createElement("span");
    m.className = "cselect-meta";
    m.textContent = opt.dataset.meta;
    parts.push(m);
  }
  return parts;
}

function enhanceSelects(root) {
  root.querySelectorAll("select").forEach(enhanceSelect);
}

function enhanceSelect(sel) {
  if (sel._cselect) return;
  sel._cselect = true;

  const wrap = document.createElement("div");
  wrap.className = "cselect";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cselect-btn";
  btn.innerHTML = `<span class="cselect-label"></span>${icon("chevronDown")}`;
  const label = btn.firstChild;

  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(btn);
  wrap.appendChild(sel);
  sel.classList.add("cselect-native");
  sel.tabIndex = -1;

  const refresh = () => {
    const opt = sel.options[sel.selectedIndex];
    label.replaceChildren(...(opt ? optionParts(opt) : []));
    btn.disabled = sel.disabled;
    wrap.style.display = sel.style.display === "none" ? "none" : "";
  };

  // Programmatic `select.value = x` doesn't fire events, so keep the label in sync.
  const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  Object.defineProperty(sel, "value", {
    configurable: true,
    get() { return valueProp.get.call(this); },
    set(v) { valueProp.set.call(this, v); refresh(); },
  });

  // Options replaced (innerHTML) or the select shown/hidden by other code.
  new MutationObserver(refresh).observe(sel, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["style", "disabled"],
  });

  btn.addEventListener("click", () => openCustomSelect(sel, btn, refresh));
  refresh();
}

function openCustomSelect(sel, btn, refresh) {
  const wasThis = _cselectBtn === btn;
  closeCustomSelect();
  if (wasThis || !sel.options.length) return;

  const backdrop = document.createElement("div");
  backdrop.className = "cselect-backdrop";
  const list = document.createElement("div");
  list.className = "cselect-list";

  [...sel.options].forEach((opt, i) => {
    const item = document.createElement("div");
    item.className = "cselect-item" + (i === sel.selectedIndex ? " selected" : "");
    item.append(...optionParts(opt));
    if (i === sel.selectedIndex) item.insertAdjacentHTML("beforeend", icon("tick"));
    item.addEventListener("click", () => {
      const changed = sel.selectedIndex !== i;
      sel.selectedIndex = i;
      refresh();
      closeCustomSelect();
      vibrate(8);
      if (changed) sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    list.appendChild(item);
  });

  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeCustomSelect(); });
  backdrop.appendChild(list);
  document.body.appendChild(backdrop);

  // Place under the button, or above it when there is more room there.
  const r = btn.getBoundingClientRect();
  const vh = window.innerHeight;
  const below = vh - r.bottom - 12;
  const above = r.top - 12;
  const wanted = Math.min(280, list.scrollHeight + 8);
  const openUp = below < wanted && above > below;
  list.style.left = r.left + "px";
  list.style.width = r.width + "px";
  list.style.maxHeight = Math.max(120, Math.min(280, openUp ? above : below)) + "px";
  if (openUp) { list.style.bottom = (vh - r.top + 4) + "px"; list.style.transformOrigin = "bottom"; }
  else { list.style.top = (r.bottom + 4) + "px"; list.style.transformOrigin = "top"; }

  const selected = list.querySelector(".selected");
  if (selected) selected.scrollIntoView({ block: "nearest" });

  btn.classList.add("open");
  _cselectBackdrop = backdrop;
  _cselectBtn = btn;
}

function openModal(html) {
  const modal = document.getElementById("modal");
  const content = document.getElementById("modalContent");
  content.className = "modal-content";
  closeCustomSelect();
  content.innerHTML = html;
  enhanceSelects(content);
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function openPopupModal(html) {
  openModal(html);
  document.getElementById("modalContent").classList.add("modal-popup");
}

function openCompactModal(html) {
  openModal(html);
  document.getElementById("modalContent").classList.add("modal-compact");
}

function closeModal() {
  closeCustomSelect();
  document.getElementById("modal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function openPaymentOptions() {
  const { finalTotal } = computeCartTotals();
  openPopupModal(`
    <h3>Cobrar: $${finalTotal.toFixed(2)}</h3>
    <button class="btn-primary" onclick="handleCash(${finalTotal})">Efectivo</button>
    <button class="btn-brand" onclick="handleTransfer(${finalTotal})">Transferencia</button>
    <button class="btn-brand" onclick="handleCard(${finalTotal})">Tarjeta</button>
    <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
  `);
}

function handleCash(total) {
  vibrate(10);
  const denominations = appSettings.cashDenominations;

  openCompactModal(`
    <h3 style="margin-top:0;">${icon('banknote')} Pago en efectivo</h3>
    <p style="color:var(--text-muted);font-size:13px;margin:4px 0 8px;">Total: <strong>$${total.toFixed(2)}</strong></p>

    <div class="denom-grid">
      ${denominations.map(d => `
        <button class="denom-btn" onclick="selectDenom(${d}, ${total}, this)">$${d}</button>
      `).join('')}
    </div>

    <button class="denom-btn" style="width:100%;margin:0 0 8px;" onclick="selectDenom(${total}, ${total}, this)">${icon('coins')} Exacto ($${total.toFixed(2)})</button>

    <div style="margin-bottom:8px;">
      <input
        id="cashInput"
        type="number"
        inputmode="numeric"
        placeholder="Cantidad recibida..."
        style="width:100%;box-sizing:border-box;padding:10px;font-size:16px;border:1.5px solid var(--border);border-radius:var(--radius-sm);"
        oninput="updateChange(${total})"
      >
    </div>

    <div class="change-display" id="changeDisplay" style="display:none;"></div>
    <div class="change-label" id="changeLabel" style="display:none;">Cambio</div>

    <button class="btn-primary" id="continueBtn" onclick="confirmCash(${total})" disabled style="margin-top:8px;">Continuar</button>
    <button class="btn-secondary" onclick="openPaymentOptions()">Regresar</button>
  `);
}

function selectDenom(value, total, btnEl) {
  document.querySelectorAll('.denom-btn').forEach(b => b.classList.remove('selected'));
  if (btnEl) btnEl.classList.add('selected');

  // Fill the input with the selected denomination
  const input = document.getElementById('cashInput');
  if (input) { input.value = value; }

  const change = value - total;
  const changeDisplay = document.getElementById('changeDisplay');
  const changeLabel = document.getElementById('changeLabel');

  if (change >= 0) {
    changeDisplay.textContent = `$${change.toFixed(2)}`;
    changeDisplay.style.color = change === 0 ? 'var(--text-muted)' : 'var(--green)';
    changeDisplay.style.display = 'block';
    changeLabel.style.display = 'block';
    document.getElementById('continueBtn').disabled = false;
    document.getElementById('continueBtn').onclick = () => showFinalStep(total, "cash", change, value);
  } else {
    changeDisplay.textContent = `Insuficiente`;
    changeDisplay.style.color = 'var(--red)';
    changeDisplay.style.display = 'block';
    changeLabel.style.display = 'none';
    document.getElementById('continueBtn').disabled = true;
  }
}

function updateChange(total) {
  const input = document.getElementById('cashInput');
  const value = parseFloat(input?.value);
  const changeDisplay = document.getElementById('changeDisplay');
  const changeLabel = document.getElementById('changeLabel');
  const btn = document.getElementById('continueBtn');

  if (isNaN(value) || value < total) {
    changeDisplay.style.display = 'none';
    changeLabel.style.display = 'none';
    btn.disabled = true;
    return;
  }

  const change = value - total;
  changeDisplay.textContent = `$${change.toFixed(2)}`;
  changeDisplay.style.color = change === 0 ? 'var(--text-muted)' : 'var(--green)';
  changeDisplay.style.display = 'block';
  changeLabel.style.display = 'block';
  btn.disabled = false;
  btn.onclick = () => showFinalStep(total, "cash", change, value);
}

function confirmCash(total) {
  const input = document.getElementById('cashInput');
  const value = parseFloat(input?.value);
  if (isNaN(value) || value < total) return;
  const change = value - total;
  showFinalStep(total, "cash", change, value);
}

function handleTransfer(total) {
  vibrate(10);
  showFinalStep(total, "transfer", 0);
}

function handleCard(total) {
  vibrate(10);
  showFinalStep(total, "card", 0);
}

function showFinalStep(total, method, change, amount) {
  const paidAmount = amount !== undefined ? amount
    : method === "cash"
      ? parseFloat(document.getElementById("cashInput")?.value || total)
      : total;

  const { appliedPromos } = computeCartTotals();

  currentSale = {
    folio: null,
    date: new Date().toLocaleString(),
    isoDate: new Date().toISOString(),
    items: [...cart],
    total: total,
    method: method,
    amount: paidAmount,
    change: change,
    promos: appliedPromos.filter(a => a.discount > 0 || a.raffleEntries).map(a => ({
      name: a.promo.name,
      discount: a.discount,
      freeCount: a.freeCount || 0,
      freeItemName: a.freeItemName || "",
      raffleEntries: a.raffleEntries || 0
    }))
  };

  openPopupModal(`
    <h3>Total: $${total}</h3>

    ${method === "cash" ? `<p>Cambio: $${change}</p>` : ""}

    <button onclick="finalizeSale()">
      Finalizar
    </button>
    <button onclick="openPaymentOptions(${total})">Regresar</button>
  `);
}

// Folio = the sale's date and time, e.g. 261114-203045 (YYMMDD-HHMMSS). It's made on the
// device itself, so it works offline, never waits on the network and never changes.
function formatFolio(date) {
  const pad = n => String(n).padStart(2, "0");
  return date.getFullYear().toString().slice(2) + pad(date.getMonth() + 1) + pad(date.getDate()) +
    "-" + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

let _lastFolioTime = 0;
function makeFolio() {
  // Never reuse a second on this device: if sales land in the same second, the later
  // ones move to the following seconds.
  _lastFolioTime = Math.max(Date.now(), _lastFolioTime + 1000);
  return formatFolio(new Date(_lastFolioTime));
}

let _lastFinalizedAt = 0;

async function finalizeSale() {
  if (!currentSale) {
    // a quick second tap on "Finalizar" arrives after the sale was already saved
    if (Date.now() - _lastFinalizedAt > 2000) showToast("Error en la venta");
    return;
  }
  _lastFinalizedAt = Date.now();
  vibrate(20);
  currentSale.folio = makeFolio();

  const itemCounts = {};
  currentSale.items.forEach(item => {
    const k = stockKey(item);
    itemCounts[k] = (itemCounts[k] || 0) + 1;
  });

  // Update local inventory immediately for instant UI feedback
  for (const [name, qty] of Object.entries(itemCounts)) {
    inventory[name] = Math.max(0, (inventory[name] || 0) - qty);
  }
  saveInventory();
  closeModal();
  renderProducts();

  const sale = currentSale;
  cart = [];
  localStorage.removeItem("cart");
  renderCart();
  currentSale = null;

  showToast("Venta registrada");

  if (appSettings.askSendTicket) {
    confirmModal("¿Enviar ticket al cliente?", () => {
      generateTicket(sale);
    });
  }

  // Write to Firestore in parallel (non-blocking)
  try {
    const stockUpdates = Object.entries(itemCounts).map(([name, qty]) =>
      DataStore.decrementStock(name, qty)
    );
    const [, saleRef] = await Promise.all([
      Promise.all(stockUpdates),
      DataStore.addSale(sale)
    ]);
    sale._id = saleRef;
  } catch (e) {
    showToast("Error al sincronizar: " + (e.message === "insufficient_stock" ? "Stock insuficiente" : "Reintenta"));
  }
}

function generateTicket(sale) {
  if (!sale) {
    showToast("No hay venta disponible");
    return;
  }

  const container = document.getElementById("ticket-container");

  if (!container) {
    showToast("Error al generar ticket");
    return;
  }

  let rows = "";

  // Group ALL items by name + extra variant (regardless of cartId)
  const grouped = {};
  sale.items.forEach(item => {
    const key = item.name + (item.extra ? '::' + item.extra.name : '');
    if (!grouped[key]) grouped[key] = { name: item.name, price: item.price, extra: item.extra || null, qty: 0 };
    grouped[key].qty++;
  });

  Object.values(grouped).forEach(info => {
    const basePrice = info.extra ? info.price - info.extra.price : info.price;
    const totalItem = info.price * info.qty;
    const extraTotal = info.extra ? info.extra.price * info.qty : 0;

    rows += `
      <tr>
        <td style="text-align:center;width:20px;">${info.qty}</td>
        <td>${esc(info.name)}</td>
        <td style="width:8px;text-align:right;padding-right:0;">$</td>
        <td style="text-align:right;padding-left:2px;">${basePrice.toFixed(2)}</td>
        <td style="width:8px;text-align:right;padding-right:0;">$</td>
        <td style="text-align:right;padding-left:2px;">${totalItem.toFixed(2)}</td>
      </tr>
      ${info.extra ? `
      <tr style="font-size:10px;opacity:0.8;">
        <td></td>
        <td style="padding-left:8px;">+ ${esc(info.extra.name)}</td>
        <td style="width:8px;text-align:right;padding-right:0;">$</td>
        <td style="text-align:right;padding-left:2px;">${info.extra.price.toFixed(2)}</td>
        <td colspan="2" style="text-align:right;padding-left:2px;font-style:italic;">(incl.)</td>
      </tr>` : ''}
    `;
  });

  const salePromos = sale.promos || [];
  const totalDiscount = salePromos.reduce((sum, p) => sum + p.discount, 0);
  const rafflePromos = salePromos.filter(p => p.raffleEntries > 0);
  const totalRaffleEntries = rafflePromos.reduce((sum, p) => sum + p.raffleEntries, 0);

  const ticketHTML = `
    <div id="ticket" style="
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.5;
      padding: 14px;
      width: 268px;
      background: white;
      color: black;
    ">
      <div style="text-align:center;">
        <img src="ticket_logo.jpg" style="max-width:100px;"><br>
        <strong style="font-size:13px;">POSTRE MÍO</strong><br>
        ${sale.date}<br>
        Folio: ${sale.folio || '—'}<br>
      </div>

      <hr style="border:none;border-top:1px dashed black;margin:8px 0;"/>

      <table style="width:100%;border-collapse:collapse;">
        <tr style="font-weight:bold;border-bottom:1px solid black;">
          <td style="width:16px;text-align:center;">Q</td>
          <td>DESCRIPCIÓN</td>
          <td style="width:8px;"></td>
          <td style="text-align:right;white-space:nowrap;">PRECIO</td>
          <td style="width:8px;"></td>
          <td style="text-align:right;white-space:nowrap;">TOTAL</td>
        </tr>
        ${rows}
      </table>

      <hr style="border:none;border-top:1px dashed black;margin:8px 0;"/>

      <table style="width:100%;border-collapse:collapse;">
        ${totalDiscount > 0 ? `
        <tr>
          <td>Subtotal</td>
          <td style="width:16px;text-align:right;padding-right:0;">$</td>
          <td style="text-align:right;padding-left:2px;white-space:nowrap;">${(parseFloat(sale.total) + totalDiscount).toFixed(2)}</td>
        </tr>
        <tr>
          <td>Descuentos</td>
          <td style="width:16px;text-align:right;padding-right:0;">−$</td>
          <td style="text-align:right;padding-left:2px;white-space:nowrap;">${totalDiscount.toFixed(2)}</td>
        </tr>
        ` : ''}
        <tr style="font-weight:bold;">
          <td>TOTAL</td>
          <td style="width:16px;text-align:right;padding-right:0;">$</td>
          <td style="text-align:right;padding-left:2px;white-space:nowrap;">${parseFloat(sale.total).toFixed(2)}</td>
        </tr>
      </table>

      <hr style="border:none;border-top:1px dashed black;margin:8px 0;width:30%;margin-left:auto;"/>

      <table style="width:100%;border-collapse:collapse;">
        <tr><td colspan="3" style="font-size:10px;opacity:0.6;">FORMA DE PAGO</td></tr>
        <tr>
          <td>${sale.method === "cash" ? "Efectivo" : sale.method === "card" ? "Tarjeta" : "Transferencia"}</td>
          <td style="width:16px;text-align:right;padding-right:0;">$</td>
          <td style="text-align:right;padding-left:2px;white-space:nowrap;">${parseFloat(sale.amount).toFixed(2)}</td>
        </tr>
        <tr>
          <td>Cambio</td>
          <td style="width:16px;text-align:right;padding-right:0;">$</td>
          <td style="text-align:right;padding-left:2px;white-space:nowrap;">${parseFloat(sale.change).toFixed(2)}</td>
        </tr>
      </table>

      ${totalRaffleEntries > 0 ? `
      <hr style="border:none;border-top:1px dashed black;margin:8px 0;"/>
      <div style="text-align:center;">
        <strong style="font-size:13px;">${icon('ticket')} RIFA ${icon('ticket')}</strong><br>
        <span style="font-size:11px;">¡Ganaste <strong>${totalRaffleEntries}</strong> ${totalRaffleEntries === 1 ? 'entrada' : 'entradas'}!</span><br>
        ${rafflePromos.map(p => `<span style="font-size:10px;opacity:0.7;">${esc(p.name)} (×${p.raffleEntries})</span>`).join('<br>')}
      </div>
      ` : ''}

      <br><br>
      <div style="text-align:center;font-size:10px;">
        ${esc(appSettings.ticketThanks)}<br><br>
        ${esc(appSettings.ticketFooter).replace(/\n/g, "<br>")}
      </div>
    </div>
  `;

  // ✅ Insertar correctamente
  container.innerHTML = ticketHTML;

  // ⏳ Esperar a que el DOM lo procese
  setTimeout(() => {
    const ticketElement = document.getElementById("ticket");

    if (!ticketElement) {
      showToast("No se generó el ticket");
      return;
    }

    if (typeof html2canvas === "undefined") {
      showToast("El generador de tickets aún no carga, intenta de nuevo");
      return;
    }

    html2canvas(ticketElement, {
      scale: 2,
      useCORS: true
    }).then(canvas => {
      canvas.toBlob(blob => {
        if (!blob) { showToast("No se pudo generar el ticket"); return; }
        showTicketModal(blob);
      }, "image/png");
    }).catch(() => showToast("No se pudo generar el ticket"));

  }, 100);
}

// Sharing must start from a tap: the image is rendered asynchronously, so by the
// time it's ready the original tap no longer counts (iOS/iPadOS Safari then
// rejects navigator.share). Show a preview with buttons that start a fresh tap.
let _ticketBlob = null;
let _ticketUrl = null;

function showTicketModal(blob) {
  if (_ticketUrl) URL.revokeObjectURL(_ticketUrl);
  _ticketBlob = blob;
  _ticketUrl = URL.createObjectURL(blob);
  const file = new File([blob], "ticket_postremio.png", { type: "image/png" });
  const canShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));

  openCompactModal(`
    <h3 style="margin-top:0;">${icon('note')} Ticket</h3>
    <img src="${_ticketUrl}" style="width:100%;max-height:45vh;object-fit:contain;border:1px solid var(--border);border-radius:var(--radius-sm);">
    ${canShare ? `<button class="btn-brand" style="margin-top:12px;" onclick="shareTicket()">Compartir</button>` : ''}
    <button class="btn-secondary" onclick="downloadTicket()">Descargar</button>
    <button class="btn-secondary" onclick="closeModal()">Cerrar</button>
  `);
}

function shareTicket() {
  if (!_ticketBlob) return;
  const file = new File([_ticketBlob], "ticket_postremio.png", { type: "image/png" });
  navigator.share({
    title: "Ticket Postre Mío",
    text: appSettings.shareMessage,
    files: [file]
  }).catch(() => {}); // user cancelled
}

function downloadTicket() {
  if (!_ticketUrl) return;
  const link = document.createElement("a");
  link.href = _ticketUrl;
  link.download = `ticket_postremio_${Date.now()}.png`;
  link.click();
}

let _rafSync = 0;
function syncMenuTop() {
  const h = document.querySelector(".header")?.offsetHeight || 100;
  document.documentElement.style.setProperty("--header-h", h + "px");
}
window.addEventListener("resize", () => {
  cancelAnimationFrame(_rafSync);
  _rafSync = requestAnimationFrame(syncMenuTop);
});

function toggleMenu() {
  syncMenuTop();
  document.getElementById("sideMenu").classList.toggle("open");
}

// Swipe from the far left edge to the right opens the menu; swiping left closes it.
const SWIPE_EDGE = 30;      // px from the left edge where an opening swipe must start
const SWIPE_DISTANCE = 70;  // px of horizontal travel needed
let _swipe = null;

function menuSwipeAllowed() {
  return document.getElementById("appShell").style.display !== "none"
    && !document.body.classList.contains("modal-open");
}

document.addEventListener("touchstart", e => {
  _swipe = null;
  if (e.touches.length !== 1 || !menuSwipeAllowed()) return;
  const t = e.touches[0];
  const open = document.getElementById("sideMenu").classList.contains("open");
  if (!open && t.clientX <= SWIPE_EDGE) _swipe = { x: t.clientX, y: t.clientY, mode: "open" };
  else if (open) _swipe = { x: t.clientX, y: t.clientY, mode: "close" };
}, { passive: true });

document.addEventListener("touchmove", e => {
  if (!_swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - _swipe.x;
  const dy = t.clientY - _swipe.y;
  if (Math.abs(dy) > Math.abs(dx) * 0.7 && Math.abs(dy) > 20) { _swipe = null; return; } // vertical scroll
  const menu = document.getElementById("sideMenu");
  if (_swipe.mode === "open" && dx >= SWIPE_DISTANCE) {
    syncMenuTop();
    menu.classList.add("open");
    vibrate(8);
    _swipe = null;
  } else if (_swipe.mode === "close" && dx <= -SWIPE_DISTANCE) {
    menu.classList.remove("open");
    _swipe = null;
  }
}, { passive: true });

document.addEventListener("touchend", () => { _swipe = null; }, { passive: true });
document.addEventListener("touchcancel", () => { _swipe = null; }, { passive: true });

function showPage(page) {
  if (page !== 'settings' && !guardSettingsLeave(() => showPage(page))) return;
  const inventoryVisible = document.getElementById('inventoryPage').style.display !== 'none';
  if (page !== 'inventory' && inventoryVisible && (updatedItems.size > 0 || updatedFrozenItems.size > 0)) {
    document.getElementById('sideMenu').classList.remove('open');
    openPopupModal(`
      <h3 style="margin-top:0;">Cambios sin guardar</h3>
      <p style="color:var(--text-muted);font-size:14px;">Tienes cambios de inventario sin guardar.</p>
      <button class="btn-brand" id="_navSave">${icon('save')} Guardar y salir</button>
      <button class="btn-danger" id="_navDiscard">Descartar cambios</button>
      <button class="btn-secondary" id="_navCancel">Cancelar</button>
    `);
    document.getElementById('_navSave').onclick = async () => {
      await saveInventoryChanges();
      _editModalOpen = false;
      closeModal();
      showPage(page);
    };
    document.getElementById('_navDiscard').onclick = () => {
      cancelInventoryChanges();
      _editModalOpen = false;
      closeModal();
      showPage(page);
    };
    document.getElementById('_navCancel').onclick = () => closeModal();
    return;
  }

  ["posPage","inventoryPage","historyPage","promoPage","pendingPage","mermaPage","settingsPage"]
    .forEach(id => document.getElementById(id).style.display = "none");
  ["promoFab","mermaFab","editFab","priceFab","hideFab"]
    .forEach(id => document.getElementById(id).style.display = "none");

  if (page === "pos") {
    document.getElementById("posPage").style.display = "block";
  }
  if (page === "inventory") {
    document.getElementById("inventoryPage").style.display = "block";
    document.getElementById("priceFab").style.display = "flex";
    document.getElementById("hideFab").style.display = "flex";
    originalInventory = JSON.parse(JSON.stringify(inventory));
    updatedItems.clear();
    _pendingRestockByName = {};
    originalFrozenInventory = JSON.parse(JSON.stringify(frozenInventory));
    updatedFrozenItems.clear();
    renderProducts();
    renderInventory();
  }
  if (page === "history") {
    document.getElementById("historyPage").style.display = "block";
    document.getElementById("editFab").style.display = "flex";
    renderHistory();
  }
  if (page === "promos") {
    document.getElementById("promoPage").style.display = "block";
    document.getElementById("promoFab").style.display = "flex";
    renderPromos();
  }
  if (page === "pending") {
    document.getElementById("pendingPage").style.display = "block";
    renderPending();
  }
  if (page === "settings") {
    document.getElementById("settingsPage").style.display = "block";
    renderSettings();
  }
  if (page === "mermas") {
    document.getElementById("mermaPage").style.display = "block";
    document.getElementById("mermaFab").style.display = "flex";
    renderMermaLog();
  }

  if (page !== "inventory") {
    hideModeActive = false;
    updatedItems.clear();
    updatedFrozenItems.clear();
    _editModalOpen = false;
  }
  if (page !== "history") {
    editModeActive = false;
  }
  document.getElementById("sideMenu").classList.remove("open");
  updateSettingsDirty();
  updateStatsJump();
  syncModeFabs();

  document.body.classList.toggle("no-page-scroll", page === "pos");
  window.scrollTo(0, 0);

  const pageEl = document.getElementById(
    { pos: "posPage", inventory: "inventoryPage", history: "historyPage", promos: "promoPage", pending: "pendingPage", mermas: "mermaPage", settings: "settingsPage" }[page]
  );
  if (pageEl) {
    pageEl.classList.remove("page-enter");
    void pageEl.offsetWidth; // restart the animation
    pageEl.classList.add("page-enter");
  }
}

// ── SETTINGS ─────────────────────────────────
function renderSettings() {
  document.getElementById("settingsContent").innerHTML = `
    <div class="settings-card">
      <div class="settings-card-head">
        <h3>${icon('note')} Acerca de</h3>
        <button class="settings-mini-btn" onclick="if (guardSettingsLeave(refreshApp)) refreshApp()" title="Borra la copia guardada y vuelve a cargar la app">${icon('refresh')} Actualizar</button>
      </div>
      <div class="costs-row" style="border:none;"><span>Versión</span><strong>${esc(APP_VERSION)}</strong></div>
      <div class="costs-row" style="border:none;"><span>Actualizada</span><strong>${esc(new Date(APP_UPDATED).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }))}</strong></div>
    </div>

    <div class="settings-card">
      <h3>${icon('alert')} Stock bajo</h3>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 8px;">Se muestra "Poco" cuando el stock es esta cantidad o menos.</p>
      <div class="costs-row" style="border:none;">
        <span>Avisar con stock de</span>
        <input id="lowStockInput" type="number" inputmode="numeric" min="0" max="99" value="${lowStockThreshold}" onfocus="this.select()">
      </div>
    </div>

    <div class="settings-card">
      <h3>${icon('note')} Tickets y mensajes</h3>
      <label class="switch-row">
        <span>Enviar ticket después de venta</span>
        <span class="toggle">
          <input type="checkbox" id="askTicketInput" ${appSettings.askSendTicket ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </span>
      </label>
      <div class="promo-form">
        <label>Agradecimiento en el ticket</label>
        <input id="ticketThanksInput" type="text" value="${esc(appSettings.ticketThanks)}">
        <label>Pie del ticket (una línea por renglón)</label>
        <textarea id="ticketFooterInput" rows="3">${esc(appSettings.ticketFooter)}</textarea>
        <label>Mensaje al compartir el ticket</label>
        <input id="shareMessageInput" type="text" value="${esc(appSettings.shareMessage)}">
      </div>
    </div>

    <div class="settings-card">
      <h3>${icon('banknote')} Efectivo</h3>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 8px;">Botones rápidos del pago en efectivo (hasta ${MAX_CASH_BUTTONS}).</p>
      <div id="denomList" class="denom-list">
        ${appSettings.cashDenominations.map(denomRowHTML).join('')}
      </div>
      <div id="denomDupMsg" class="field-error" style="display:none;">Hay cantidades repetidas. Cada botón debe tener un monto distinto.</div>
      <button id="denomAddBtn" class="btn-secondary" style="width:100%;" onclick="addDenomRow()">${icon('plus')} Agregar cantidad</button>
    </div>

    <div class="settings-card">
      <h3>${icon('save')} Seguridad</h3>
      <button class="btn-secondary" style="width:100%;" onclick="openChangePinModal()">Cambiar PIN</button>
      <button class="btn-danger" style="width:100%;" onclick="logout()">Cerrar sesión</button>
    </div>
  `;
  updateSettingsDirty();
}

async function refreshApp() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {
    console.error("refreshApp failed:", e);
  }
  location.reload();
}

// ── Settings: unsaved-changes tracking and floating save button ──
// Each tracked field compares the control's current value with the saved one.
const _byId = id => document.getElementById(id);
// Positive whole amounts typed in the cash rows, sorted (repeats are kept so they can be flagged).
const _normDenoms = () => [...document.querySelectorAll("#denomList .denom-input")]
  .map(i => Number(i.value)).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
const _hasRepeats = arr => new Set(arr).size !== arr.length;

const SETTINGS_FIELDS = {
  lowStockThreshold: {
    read: () => { const v = _byId("lowStockInput").value.trim(); return v === "" ? NaN : Number(v); },
    saved: () => lowStockThreshold,
    same: (a, b) => a === b,
    valid: v => Number.isInteger(v) && v >= 0 && v <= 99,
    error: "Stock bajo: escribe un número de 0 a 99",
    marks: () => [_byId("lowStockInput")],
  },
  askSendTicket: {
    read: () => _byId("askTicketInput").checked,
    saved: () => !!appSettings.askSendTicket,
    same: (a, b) => a === b,
    valid: () => true,
    marks: () => [_byId("askTicketInput").closest(".switch-row")],
  },
  ticketThanks: {
    read: () => _byId("ticketThanksInput").value.trim(),
    saved: () => String(appSettings.ticketThanks ?? "").trim(),
    same: (a, b) => a === b,
    valid: () => true,
    marks: () => [_byId("ticketThanksInput")],
  },
  ticketFooter: {
    read: () => _byId("ticketFooterInput").value.trim(),
    saved: () => String(appSettings.ticketFooter ?? "").trim(),
    same: (a, b) => a === b,
    valid: () => true,
    marks: () => [_byId("ticketFooterInput")],
  },
  shareMessage: {
    read: () => _byId("shareMessageInput").value.trim(),
    saved: () => String(appSettings.shareMessage ?? "").trim(),
    same: (a, b) => a === b,
    valid: () => true,
    marks: () => [_byId("shareMessageInput")],
  },
  cashDenominations: {
    read: _normDenoms,
    saved: () => appSettings.cashDenominations,
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    valid: v => v.length > 0 && !_hasRepeats(v),
    error: "Efectivo: agrega al menos una cantidad y sin repetir",
    marks: () => [_byId("denomList")],
  },
};

function settingsPageVisible() {
  const el = _byId("settingsPage");
  return !!el && el.style.display !== "none";
}

// Recomputes which fields differ from what's saved, highlights them (and removes the
// highlight when reverted), and shows or hides the floating save button.
function updateSettingsDirty() {
  const bar = _byId("settingsSaveBar");
  if (!settingsPageVisible() || !_byId("lowStockInput")) {
    if (bar) bar.classList.remove("show");
    document.body.classList.remove("has-savebar");
    return 0;
  }

  let count = 0;
  for (const f of Object.values(SETTINGS_FIELDS)) {
    const changed = !f.same(f.read(), f.saved());
    f.marks().forEach(el => el && el.classList.toggle("changed", changed));
    if (changed) count++;
  }

  // New cash amounts get their own highlight; repeated amounts are flagged and block saving
  const savedDenoms = new Set(appSettings.cashDenominations);
  const denomInputs = [...document.querySelectorAll("#denomList .denom-input")];
  const counts = {};
  denomInputs.forEach(i => { const n = Number(i.value); if (i.value !== "" && n > 0) counts[n] = (counts[n] || 0) + 1; });
  let hasRepeats = false;
  denomInputs.forEach(i => {
    const n = Number(i.value);
    const dup = i.value !== "" && counts[n] > 1;
    if (dup) hasRepeats = true;
    i.classList.toggle("dup", dup);
    i.classList.toggle("changed", !dup && i.value !== "" && !savedDenoms.has(n));
  });
  const dupMsg = _byId("denomDupMsg");
  if (dupMsg) dupMsg.style.display = hasRepeats ? "block" : "none";
  _byId("settingsSaveBtn").disabled = hasRepeats;

  _byId("settingsSaveLabel").textContent = count > 1 ? `Guardar cambios (${count})` : "Guardar cambios";
  bar.classList.toggle("show", count > 0);
  document.body.classList.toggle("has-savebar", count > 0);
  return count;
}

async function saveSettingsChanges() {
  const fields = {};
  for (const [key, f] of Object.entries(SETTINGS_FIELDS)) {
    const v = f.read();
    if (f.same(v, f.saved())) continue;
    if (!f.valid(v)) { showToast(f.error); return false; }
    fields[key] = v;
  }
  if (!Object.keys(fields).length) return true;

  const btn = _byId("settingsSaveBtn");
  btn.disabled = true;

  // Apply locally first (the app keeps working offline); roll back if the save fails.
  const prevLow = lowStockThreshold;
  const prevSettings = { ...appSettings };
  const { lowStockThreshold: newLow, ...rest } = fields;
  if (newLow !== undefined) lowStockThreshold = newLow;
  Object.assign(appSettings, rest);

  const write = DataStore.saveSettings(fields);
  let ok = true;
  if (!navigator.onLine) {
    write.catch(() => {});
    showToast("Guardado. Se sincronizará al conectar", "check");
  } else {
    try {
      await withTimeout(write, 10000);
      showToast("Guardado", "check");
    } catch (e) {
      ok = false;
      lowStockThreshold = prevLow;
      Object.keys(appSettings).forEach(k => delete appSettings[k]);
      Object.assign(appSettings, prevSettings);
      showToast("Error al guardar. Intenta de nuevo.");
    }
  }

  btn.disabled = false;
  if (ok) {
    if (newLow !== undefined) { renderProducts(); renderCart(); renderInventory(); }
    renderSettings();
  }
  return ok;
}

// Returns true when it's fine to leave the settings page right now. Otherwise shows the
// unsaved-changes dialog and calls `proceed` later if the user saves or discards.
function guardSettingsLeave(proceed) {
  if (!settingsPageVisible() || updateSettingsDirty() === 0) return true;
  _byId("sideMenu").classList.remove("open");
  openPopupModal(`
    <h3 style="margin-top:0;">Cambios sin guardar</h3>
    <p style="color:var(--text-muted);font-size:14px;">Tienes cambios en Ajustes sin guardar.</p>
    <button class="btn-brand" id="_navSave">${icon('save')} Guardar y salir</button>
    <button class="btn-danger" id="_navDiscard">Descartar cambios</button>
    <button class="btn-secondary" id="_navCancel">Seguir editando</button>
  `);
  _byId("_navSave").onclick = async () => {
    if (await saveSettingsChanges()) { closeModal(); proceed(); }
  };
  _byId("_navDiscard").onclick = () => { renderSettings(); closeModal(); proceed(); };
  _byId("_navCancel").onclick = () => closeModal();
  return false;
}

const MAX_CASH_BUTTONS = 8;

function denomRowHTML(value) {
  return `<div class="denom-row">
    <span class="denom-prefix">$</span>
    <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" class="denom-input" value="${esc(String(value ?? ''))}" placeholder="0" oninput="this.value=this.value.replace(/\\D/g,'')">
    <button class="history-action-btn danger" onclick="removeDenomRow(this)" title="Quitar">${icon('trash')}</button>
  </div>`;
}

function updateDenomAddBtn() {
  const n = document.querySelectorAll("#denomList .denom-row").length;
  const btn = document.getElementById("denomAddBtn");
  if (btn) btn.disabled = n >= MAX_CASH_BUTTONS;
}

function addDenomRow() {
  const list = document.getElementById("denomList");
  if (list.children.length >= MAX_CASH_BUTTONS) return;
  list.insertAdjacentHTML("beforeend", denomRowHTML(""));
  list.lastElementChild.querySelector("input").focus();
  updateDenomAddBtn();
  updateSettingsDirty();
}

function removeDenomRow(btn) {
  btn.closest(".denom-row").remove();
  updateDenomAddBtn();
  updateSettingsDirty();
}

function openChangePinModal() {
  openCompactModal(`
    <h3 style="margin-top:0;">${icon('save')} Cambiar PIN</h3>
    <div class="promo-form">
      <label>PIN actual</label>
      <input id="pin-current" type="password" inputmode="numeric" maxlength="4" autocomplete="off">
      <label>PIN nuevo (4 dígitos)</label>
      <input id="pin-new" type="password" inputmode="numeric" maxlength="4" autocomplete="off">
      <label>Repite el PIN nuevo</label>
      <input id="pin-confirm" type="password" inputmode="numeric" maxlength="4" autocomplete="off">
    </div>
    <button class="btn-brand" id="changePinBtn" style="margin-top:14px;" onclick="confirmChangePin()">Guardar</button>
    <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
  `);
}

async function confirmChangePin() {
  const current = document.getElementById("pin-current").value;
  const next    = document.getElementById("pin-new").value;
  const confirm = document.getElementById("pin-confirm").value;

  if (!/^\d{4}$/.test(next)) { showToast("El PIN nuevo debe tener 4 dígitos"); return; }
  if (next !== confirm)       { showToast("Los PIN nuevos no coinciden"); return; }

  const btn = document.getElementById("changePinBtn");
  btn.disabled = true;
  try {
    const authDoc = await fastGet(configRef("auth"), true);
    if (await hashPin(current) !== authDoc.data().pinHash) {
      showToast("PIN actual incorrecto");
      btn.disabled = false;
      return;
    }
    await withTimeout(configRef("auth").set({ pinHash: await hashPin(next) }, { merge: true }), 10000);
    closeModal();
    showToast("PIN actualizado", "check");
  } catch (e) {
    showToast("No se pudo cambiar el PIN. Intenta de nuevo.");
    btn.disabled = false;
  }
}

function logoClick(el) {
  el.classList.remove("logo-pop");
  void el.offsetWidth;
  el.classList.add("logo-pop");
  showPage('pos');
}

// Hold-to-repeat state
let holdTimer = null;
let holdInterval = null;
let _holdRestockName = null;
let _holdRestockAccum = 0;

// Pending inventory changes (saved to Firestore on "Guardar")
let _pendingRestockByName = {};

function startHold(name, delta) {
  _holdRestockName = name;
  _holdRestockAccum = 0;
  updateStock(name, delta);
  if (delta > 0) _holdRestockAccum += delta;
  holdTimer = setTimeout(() => {
    holdInterval = setInterval(() => {
      updateStock(name, delta);
      if (delta > 0) _holdRestockAccum += delta;
    }, 80);
  }, 500);
}

function stopHold() {
  clearTimeout(holdTimer);
  clearInterval(holdInterval);
  holdTimer = null;
  holdInterval = null;
  clearInterval(_frozenHoldInterval);
  _frozenHoldInterval = null;
  clearInterval(_bakeHoldInterval);
  _bakeHoldInterval = null;
  if (_holdRestockAccum > 0 && _holdRestockName) {
    _pendingRestockByName[_holdRestockName] = (_pendingRestockByName[_holdRestockName] || 0) + _holdRestockAccum;
  }
  _holdRestockName = null;
  _holdRestockAccum = 0;
}

function renderInventory() {
  const container = document.getElementById("inventoryList");
  container.innerHTML = "";

  const validNames = Object.keys(defaultInventory);
  const hiddenItems = getHiddenItems();

  // Clean up stale keys
  Object.keys(inventory).forEach(name => {
    if (!validNames.includes(name)) delete inventory[name];
  });
  saveInventory();

  menu.forEach(cat => {
    let headerAdded = false;
    cat.items.flatMap(i => stockNamesFor(i.name).map(k => [k, i.name])).forEach(([name, parent]) => {
    if (!(name in inventory)) inventory[name] = defaultInventory[name];

    const isHidden = hiddenItems.includes(parent);

    // In normal mode, skip hidden items
    if (!hideModeActive && isHidden) return;

    if (!headerAdded) {
      const header = document.createElement("div");
      header.className = "inv-list-cat";
      header.innerHTML = catHTML(cat.category);
      container.appendChild(header);
      headerAdded = true;
    }

    const qty = inventory[name];
    const isLow = qty > 0 && qty <= lowStockThreshold;
    const isOut = qty === 0;
    const isFreezable = FREEZABLE_PRODUCTS.includes(name);
    const frozenQty = frozenInventory[name] ?? 0;

    let rowClass = "inv-list-row";
    if (hideModeActive) rowClass += " hide-mode-target";
    if (isHidden) rowClass += " hidden-item";
    else if (isOut || isLow) rowClass += " low-stock";

    const row = document.createElement("div");
    row.className = rowClass;

    if (hideModeActive) {
      row.onclick = () => toggleItemHidden(parent);
      row.innerHTML = `
        <div class="inv-list-main">
          <span class="inv-list-name">${esc(name)}</span>
          <span class="vis-icon ${isHidden ? 'is-hidden' : 'is-visible'}" title="${isHidden ? 'Oculto' : 'Visible'}">${icon(isHidden ? 'eyeOff' : 'eye')}</span>
        </div>
      `;
    } else {
      row.innerHTML = `
        <div class="inv-list-main">
          <span class="inv-list-name">${esc(name)}</span>
          <span class="inv-list-qty">${qty}${isLow && !isOut ? ` <span class="low-stock-badge">${icon('alert')} Poco</span>` : ""}${isOut ? ' <span class="low-stock-badge" style="background:#e53935;">Sin stock</span>' : ""}</span>
        </div>
        ${isFreezable ? `<div class="inv-list-sub">${icon('snowflake')} Congelados: ${frozenQty}</div>` : ''}
      `;
    }

    container.appendChild(row);
    });
  });

  const bakeBtn = document.getElementById('bakeBtn');
  if (bakeBtn) bakeBtn.disabled = !FREEZABLE_PRODUCTS.some(name => (frozenInventory[name] ?? 0) > 0);
}

function openEditInventoryModal() {
  _editModalOpen = true;
  renderEditInventoryModalBody();
}

function closeEditInventoryModal() {
  _editModalOpen = false;
  closeModal();
}

function renderEditInventoryModalBody() {
  const hiddenItems = getHiddenItems();

  const rowHTML = name => {
    const qty = inventory[name] ?? 0;
    const isFreezable = FREEZABLE_PRODUCTS.includes(name);
    const frozenQty = frozenInventory[name] ?? 0;
    const safeName = name.replace(/'/g, "\\'");
    const safeId = name.replace(/[^a-zA-Z0-9]/g, '-');

    return `
      <div class="edit-inv-row">
        <div class="edit-inv-name">${esc(name)}</div>
        <div class="edit-inv-line">
          <span class="edit-inv-label">Disponible</span>
          <div class="edit-inv-controls">
            <button
              style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
              onpointerdown="startHold('${safeName}', -1)" onpointerup="stopHold()" onpointerleave="stopHold()"
              oncontextmenu="return false" ontouchstart="this.ontouchend=stopHold;return true;"
            >−</button>
            <span class="edit-inv-qty" id="ei-avail-${safeId}">${qty}</span>
            <button
              style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
              onpointerdown="startHold('${safeName}', 1)" onpointerup="stopHold()" onpointerleave="stopHold()"
              oncontextmenu="return false" ontouchstart="this.ontouchend=stopHold;return true;"
            >+</button>
          </div>
        </div>
        ${isFreezable ? `
          <div class="edit-inv-line">
            <span class="edit-inv-label">${icon('snowflake')} Congelados</span>
            <div class="edit-inv-controls">
              <button
                style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
                onpointerdown="startFrozenEditHold('${safeName}', -1)" onpointerup="stopHold()" onpointerleave="stopHold()"
                oncontextmenu="return false" ontouchstart="this.ontouchend=stopHold;return true;"
              >−</button>
              <span class="edit-inv-qty" id="ei-frozen-${safeId}">${frozenQty}</span>
              <button
                style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
                onpointerdown="startFrozenEditHold('${safeName}', 1)" onpointerup="stopHold()" onpointerleave="stopHold()"
                oncontextmenu="return false" ontouchstart="this.ontouchend=stopHold;return true;"
              >+</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  };

  const rows = menu.map(cat => {
    const names = cat.items.filter(i => !hiddenItems.includes(i.name)).flatMap(i => stockNamesFor(i.name));
    if (!names.length) return '';
    return `<div class="edit-inv-cat">${catHTML(cat.category)}</div>` + names.map(rowHTML).join('');
  }).join('');

  openCompactModal(`
    <h3 style="margin-top:0;">${icon('pencil')} Editar inventario</h3>
    <div class="costs-section" style="margin-top:8px;max-height:55vh;overflow-y:auto;">
      ${rows}
    </div>
    <button class="btn-brand" id="editInvSaveBtn" style="margin-top:12px;" onclick="saveInventoryFromModal()">${icon('save')} Guardar</button>
    <button class="btn-secondary" onclick="cancelInventoryChanges(); closeEditInventoryModal();">Cancelar</button>
  `);
}

function startFrozenEditHold(name, delta) {
  updateFrozenStockDeferred(name, delta);
  holdTimer = setTimeout(() => {
    _frozenHoldInterval = setInterval(() => updateFrozenStockDeferred(name, delta), 80);
  }, 500);
}

function updateFrozenStockDeferred(name, delta) {
  const current = frozenInventory[name] ?? 0;
  frozenInventory[name] = Math.max(0, current + delta);
  if (frozenInventory[name] !== (originalFrozenInventory[name] ?? 0)) {
    updatedFrozenItems.add(name);
  } else {
    updatedFrozenItems.delete(name);
  }
  renderInventory();
  refreshEditModalQty(name);
}

// Update the edit-inventory modal's displayed quantities in place, without
// rebuilding its HTML (which would reset the modal's scroll position).
function refreshEditModalQty(name) {
  if (!_editModalOpen) return;
  const safeId = name.replace(/[^a-zA-Z0-9]/g, '-');
  const availEl = document.getElementById('ei-avail-' + safeId);
  if (availEl) availEl.textContent = inventory[name] ?? 0;
  const frozenEl = document.getElementById('ei-frozen-' + safeId);
  if (frozenEl) frozenEl.textContent = frozenInventory[name] ?? 0;
}

async function saveInventoryFromModal() {
  const btn = document.getElementById('editInvSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  const ok = await saveInventoryChanges();

  if (ok) {
    closeEditInventoryModal();
    showToast('Inventario guardado', 'check');
  } else {
    if (btn) { btn.disabled = false; btn.innerHTML = `${icon('save')} Guardar`; }
    showToast('Error al guardar. Intenta de nuevo.');
  }
}

let _bakeSelections = {};

function openBakeModal() {
  const hiddenItems = getHiddenItems();
  const available = FREEZABLE_PRODUCTS.filter(name => !hiddenItems.includes(name) && (frozenInventory[name] ?? 0) > 0);
  if (available.length === 0) return;

  _bakeSelections = {};
  available.forEach(name => { _bakeSelections[name] = 0; });

  renderBakeModalBody();
}

function renderBakeModalBody() {
  const rows = Object.keys(_bakeSelections).map(name => {
    const frozen = frozenInventory[name] ?? 0;
    const qty = _bakeSelections[name] ?? 0;
    const safeName = name.replace(/'/g, "\\'");
    const safeId = name.replace(/[^a-zA-Z0-9]/g, '-');
    return `
      <div class="edit-inv-row">
        <div class="edit-inv-line">
          <span class="edit-inv-label">${esc(name)} <span style="color:var(--text-muted);font-size:12px;">(${frozen} disp.)</span></span>
          <div class="edit-inv-controls">
            <button
              style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
              onpointerdown="startBakeHold('${safeName}', -1)" onpointerup="stopHold()" onpointerleave="stopHold()"
              oncontextmenu="return false" ontouchstart="this.ontouchend=stopHold;return true;"
            >−</button>
            <span class="edit-inv-qty" id="bk-qty-${safeId}">${qty}</span>
            <button
              style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
              onpointerdown="startBakeHold('${safeName}', 1)" onpointerup="stopHold()" onpointerleave="stopHold()"
              oncontextmenu="return false" ontouchstart="this.ontouchend=stopHold;return true;"
            >+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  openCompactModal(`
    <h3 style="margin-top:0;">${icon('flame')} Hornear</h3>
    <p style="margin:0 0 12px;font-size:14px;color:var(--text-muted);">Cantidad a pasar al inventario</p>
    <div class="costs-section" style="margin-top:8px;max-height:55vh;overflow-y:auto;">
      ${rows}
    </div>
    <button class="btn-brand" style="margin-top:12px;" onclick="confirmBakeAll()">${icon('flame')} Hornear</button>
    <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
  `);
}

let _bakeHoldInterval = null;

function startBakeHold(name, delta) {
  adjustBakeQty(name, delta);
  holdTimer = setTimeout(() => {
    _bakeHoldInterval = setInterval(() => adjustBakeQty(name, delta), 80);
  }, 500);
}

function adjustBakeQty(name, delta) {
  const max = frozenInventory[name] ?? 0;
  const current = _bakeSelections[name] ?? 0;
  _bakeSelections[name] = Math.max(0, Math.min(max, current + delta));
  refreshBakeModalQty(name);
}

// Update the bake modal's displayed quantity in place, without rebuilding
// its HTML (which would reset the modal's scroll position).
function refreshBakeModalQty(name) {
  const safeId = name.replace(/[^a-zA-Z0-9]/g, '-');
  const el = document.getElementById('bk-qty-' + safeId);
  if (el) el.textContent = _bakeSelections[name] ?? 0;
}

async function confirmBakeAll() {
  const changes = Object.entries(_bakeSelections).filter(([, qty]) => qty > 0);
  closeModal();
  if (changes.length === 0) return;

  const bakeDate = new Date().toLocaleString();

  for (const [name, qty] of changes) {
    frozenInventory[name] = (frozenInventory[name] ?? 0) - qty;
    originalFrozenInventory[name] = frozenInventory[name];
    updatedFrozenItems.delete(name);
    await DataStore.setFrozenStock(name, frozenInventory[name]);
    inventory[name] = (inventory[name] ?? 0) + qty;
    originalInventory[name] = inventory[name];
    updatedItems.delete(name);
    await DataStore.setStock(name, inventory[name]);
    await DataStore.addRestock({ date: bakeDate, name, qty, source: 'bake' });
  }

  renderInventory();
  renderProducts();
  const summary = changes.map(([name, qty]) => `${qty} ${name}`).join(', ');
  showToast(`${summary} pasados al inventario`);
}

function updatePrice(name, value) {
  const price = Math.max(0, parseFloat(value));
  if (isNaN(price)) return;

  menu.forEach(cat => {
    cat.items.forEach(item => {
      if (item.name === name) item.price = price;
    });
  });

  DataStore.saveCustomPrice(name, price);

  cart.forEach(item => {
    if (item.name === name) item.price = price;
  });

  renderProducts();
  renderCart();
  showToast(`Precio de ${name} actualizado a $${price}`);
}

function findExtra(productName, extraName) {
  return [...(ITEM_EXTRAS[productName] || []), ...(ITEM_EXTRAS_STEP2[productName] || [])]
    .find(e => e.name === extraName);
}

function openPricesModal() {
  const sectionTitle = (text, upper, html) =>
    `<div style="font-size:12px;font-weight:700;margin:12px 0 6px;color:var(--text-muted);${upper ? 'text-transform:uppercase;letter-spacing:0.5px;' : ''}">${html || esc(text)}</div>`;

  const priceRow = (label, price, onchange) => `
    <div class="costs-row">
      <span>${esc(label)}</span>
      <span style="color:var(--text-muted);font-size:12px;">$</span>
      <input type="number" inputmode="decimal" min="0" step="1"
        value="${price}"
        onfocus="this.select()"
        onchange="${onchange}">
    </div>`;

  const hiddenNow = getHiddenItems();
  const categoryRows = cat => !cat ? '' : sectionTitle(cat.category, true, catHTML(cat.category)) +
    cat.items.filter(item => !item.noBasePrice && !hiddenNow.includes(item.name)).map(item =>
      priceRow(item.name, item.price, `updatePrice('${item.name.replace(/'/g, "\\'")}', this.value)`)
    ).join('');

  // Flavor/filling prices for one product, plus its second-step extras (minus the free "Natural")
  const extrasSection = (productName, title) => {
    if (hiddenNow.includes(productName)) return '';
    const entries = [
      ...(ITEM_EXTRAS[productName] || []),
      ...(ITEM_EXTRAS_STEP2[productName] || []).filter(e => e.name !== "Natural"),
    ];
    return sectionTitle(title, false) + entries.map(e =>
      priceRow(e.name, e.price, `updateExtrasPrice('${productName.replace(/'/g, "\\'")}', '${e.name.replace(/'/g, "\\'")}', this.value)`)
    ).join('');
  };

  const cats = Object.fromEntries(visibleMenu().map(c => [c.category, c]));
  const body =
    categoryRows(cats["🍪 Galletas"]) +
    categoryRows(cats["✨ Especiales"]) +
    extrasSection("Rol de canela", "+ Extras: Rol de canela") +
    extrasSection("Pan de muerto", "Pan de muerto") +
    categoryRows(cats["🎂 Pasteles"]) +
    extrasSection("Mini pastel maceta", "Mini pastel maceta") +
    categoryRows(cats["🍰 Postres"]);

  openPopupModal(`
    <h3 style="margin-top:0;">${icon('dollar')} Precios</h3>
    <div class="costs-section" style="margin-top:8px;max-height:55vh;overflow-y:auto;">
      ${body}
    </div>
    <button class="btn-secondary" style="width:100%;margin-top:12px;" onclick="closeModal()">Cerrar</button>
  `);
}

function updateExtrasPrice(productName, extraName, value) {
  const price = Math.max(0, parseFloat(value));
  if (isNaN(price)) return;
  const extra = findExtra(productName, extraName);
  if (extra) extra.price = price;
  DataStore.saveExtrasPrice(productName, extraName, price);
}

function updateStock(name, delta) {
  inventory[name] += delta;
  if (inventory[name] < 0) inventory[name] = 0;

  if (inventory[name] !== originalInventory[name]) {
    updatedItems.add(name);
  } else {
    updatedItems.delete(name);
  }

  saveInventory();
  renderInventory();
  renderProducts();
  refreshEditModalQty(name);
}

function cancelInventoryChanges() {
  Object.keys(originalInventory).forEach(k => { inventory[k] = originalInventory[k]; });
  updatedItems.clear();
  _pendingRestockByName = {};
  Object.keys(originalFrozenInventory).forEach(k => { frozenInventory[k] = originalFrozenInventory[k]; });
  updatedFrozenItems.clear();
  saveInventory();
  renderInventory();
  renderProducts();
}

function resetInventory() {
  confirmModal('¿Resetear todo el inventario a 0?', async () => {
    Object.keys(inventory).forEach(k => { inventory[k] = 0; });
    const batch = db.batch();
    Object.keys(inventory).forEach(name => {
      batch.set(storeRef("inventory").doc(name), { qty: 0 });
    });
    await batch.commit();
    originalInventory = JSON.parse(JSON.stringify(inventory));
    updatedItems.clear();
    _pendingRestockByName = {};
    saveInventory();
    renderInventory();
    renderProducts();
    showToast('Inventario reseteado a 0');
  });
}

async function saveInventoryChanges() {
  try {
    await Promise.all([...updatedItems].map(name => DataStore.setStock(name, inventory[name])));

    const restockDate = new Date().toLocaleString();
    await Promise.all(
      Object.entries(_pendingRestockByName)
        .filter(([, qty]) => qty > 0)
        .map(([name, qty]) => DataStore.addRestock({ date: restockDate, name, qty }))
    );

    await Promise.all([...updatedFrozenItems].map(name => DataStore.setFrozenStock(name, frozenInventory[name])));

    originalInventory = JSON.parse(JSON.stringify(inventory));
    updatedItems.clear();
    _pendingRestockByName = {};
    originalFrozenInventory = JSON.parse(JSON.stringify(frozenInventory));
    updatedFrozenItems.clear();

    saveInventory();
    renderInventory();
    return true;
  } catch (e) {
    console.error("saveInventoryChanges failed:", e);
    return false;
  }
}

// ── HIDING MODE ──────────────────────────────
let hideModeActive = false;

function getHiddenItems() {
  return JSON.parse(localStorage.getItem("hiddenItems")) || [];
}

// Menu without hidden products (and without categories left empty by hiding)
function visibleMenu() {
  const hidden = getHiddenItems();
  return menu
    .map(cat => ({ ...cat, items: cat.items.filter(i => !hidden.includes(i.name)) }))
    .filter(cat => cat.items.length);
}

function saveHiddenItems(list) {
  localStorage.setItem("hiddenItems", JSON.stringify(list));
  DataStore.saveHiddenItems(list);
}

function toggleHideMode() {
  hideModeActive = !hideModeActive;
  syncModeFabs();
  renderInventory();
}

// Keeps the floating mode buttons (eye / pencil) in line with their mode state
function syncModeFabs() {
  const hide = document.getElementById("hideFab");
  if (hide) {
    hide.innerHTML = icon(hideModeActive ? "eyeOff" : "eye");
    hide.classList.toggle("active", hideModeActive);
  }
  const edit = document.getElementById("editFab");
  if (edit) edit.classList.toggle("active", editModeActive);
}

function toggleItemHidden(name) {
  const hidden = getHiddenItems();
  const idx = hidden.indexOf(name);
  if (idx > -1) {
    hidden.splice(idx, 1);
    showToast(`${name} visible de nuevo`);
  } else {
    hidden.push(name);
    showToast(`${name} ocultado`);
    if (cart.some(i => i.name === name)) {
      cart = cart.filter(i => i.name !== name);
      renderCart();
    }
  }
  saveHiddenItems(hidden);
  renderInventory();
  renderProducts();
}

// ── EDIT MODE ────────────────────────────────
let editModeActive = false;

function toggleEditMode() {
  editModeActive = !editModeActive;
  syncModeFabs();
  renderHistory();
}

function openEditSale(saleId) {
  const sale = (_historyData || []).find(s => s._id === saleId);
  if (!sale) return;

  const saleTime = sale.isoDate ? (() => {
    const d = new Date(sale.isoDate);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  })() : "";

  openCompactModal(`
    <h3 style="margin-top:0;">${icon('pencil')} Editar venta</h3>
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;">Folio: ${esc(sale.folio || '—')} · ${esc(sale.date)}</p>
    <div class="promo-form">
      <label>Total ($)</label>
      <input id="edit-total" type="number" inputmode="decimal" value="${parseFloat(sale.total).toFixed(2)}" onfocus="this.select()">

      <label>Método de pago</label>
      <select id="edit-method">
        <option value="cash"     data-icon="banknote" ${sale.method === 'cash'     ? 'selected' : ''}>Efectivo</option>
        <option value="transfer" data-icon="transfer" ${sale.method === 'transfer' ? 'selected' : ''}>Transferencia</option>
        <option value="card"     data-icon="card"     ${sale.method === 'card'     ? 'selected' : ''}>Tarjeta</option>
      </select>

      ${saleTime ? `
      <label>Hora</label>
      <input id="edit-time" type="time" value="${saleTime}" data-original="${saleTime}">
      ` : ''}

      <label>Nota (opcional)</label>
      <input id="edit-note" type="text" value="${esc(sale.note || '')}" placeholder="Ej: cobro parcial, error de precio...">
    </div>
    <button class="btn-brand" onclick="confirmEditSale('${saleId}')" style="margin-top:14px;">Guardar</button>
    <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
  `);
}

async function confirmEditSale(saleId) {
  const total  = parseFloat(document.getElementById("edit-total").value);
  const method = document.getElementById("edit-method").value;
  const note   = document.getElementById("edit-note").value.trim();

  if (isNaN(total) || total < 0) { showToast("Total inválido"); return; }

  const updates = { total, method };
  if (note) updates.note = note;

  // Change only the time of day; the sale keeps its date and seconds.
  const timeInput = document.getElementById("edit-time");
  const sale = (_historyData || []).find(s => s._id === saleId);
  if (timeInput && sale && sale.isoDate) {
    if (!timeInput.value) { showToast("Hora inválida"); return; }
    if (timeInput.value !== timeInput.dataset.original) {
      const [h, m] = timeInput.value.split(":").map(Number);
      const d = new Date(sale.isoDate);
      d.setHours(h, m);
      updates.isoDate = d.toISOString();
      updates.date = d.toLocaleString();
    }
  }

  await DataStore.updateSale(saleId, updates);
  closeModal();
  showToast("Venta actualizada", "check");
  await renderHistoryFromFirestore();
}

let _historyData = [];

async function renderHistory() {
  await renderHistoryFromFirestore();
}

function renderHistoryWithData(data) {
  const container = document.getElementById("historyList");
  if (!container) return;

  container.innerHTML = "";
  _historyData = data;

  if (data.length === 0) {
    container.innerHTML = `
      <div class="pending-empty">
        <div style="font-size:36px;margin-bottom:10px;">${icon('receipt')}</div>
        <p>No hay ventas aún.</p>
      </div>
    `;
    updateCutBtnWithData(data);
    return;
  }

  data.forEach(sale => {
    const div = document.createElement("div");
    div.className = "inventory-card";

    let itemsHTML = "";
    let rawTotal = 0;

    const grouped = {};
    sale.items.forEach(item => {
      const key = item.name + (item.extra ? '::' + item.extra.name : '');
      if (!grouped[key]) grouped[key] = { name: item.name, price: item.extra ? item.price - item.extra.price : item.price, extra: item.extra || null, qty: 0 };
      grouped[key].qty++;
    });

    itemsHTML += `
      <div style="display:grid;grid-template-columns:20px 1fr 58px 58px;gap:4px;font-size:11px;font-weight:700;opacity:0.5;padding:2px 0;border-bottom:1px solid var(--border);">
        <span style="text-align:center;">Q</span>
        <span>DESCRIPCIÓN</span>
        <span style="text-align:right;">IMP.</span>
        <span style="text-align:right;">TOTAL</span>
      </div>
    `;

    Object.values(grouped).forEach(info => {
      const subtotal = (info.price + (info.extra ? info.extra.price : 0)) * info.qty;
      rawTotal += subtotal;
      itemsHTML += `
        <div style="display:grid;grid-template-columns:20px 1fr 58px 58px;gap:4px;font-size:13px;padding:3px 0;">
          <span style="text-align:center;">${info.qty}</span>
          <span>${esc(info.name)}${info.extra ? `<br><span style="font-size:11px;color:var(--purple);">+ ${esc(info.extra.name)}</span>` : ''}</span>
          <span style="text-align:right;">$${info.price.toFixed(2)}</span>
          <span style="text-align:right;">$${subtotal.toFixed(2)}</span>
        </div>
      `;
    });

    const salePromos = sale.promos || [];
    let totalDiscount = 0;
    salePromos.forEach(p => {
      totalDiscount += p.discount;
      if (p.raffleEntries) {
        itemsHTML += `
          <div style="display:grid;grid-template-columns:20px 1fr 58px 58px;gap:4px;font-size:12px;color:#e91e63;padding:2px 0;">
            <span></span>
            <span>${icon('ticket')} ${esc(p.name)} (×${p.raffleEntries})</span>
            <span></span>
            <span style="text-align:right;">¡Rifa!</span>
          </div>
        `;
      } else {
        let label = `${icon('tag')} ${esc(p.name)}`;
        if (p.freeCount) label += ` (+${p.freeCount} gratis)`;
        itemsHTML += `
          <div style="display:grid;grid-template-columns:20px 1fr 58px 58px;gap:4px;font-size:12px;color:var(--green);padding:2px 0;">
            <span></span>
            <span>${label}</span>
            <span></span>
            <span style="text-align:right;">−$${p.discount.toFixed(2)}</span>
          </div>
        `;
      }
    });

    const finalTotal = sale.total;
    const saleId = sale._id;

    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div class="inv-name">${esc(sale.date || "")}</div>
        ${sale.folio ? `<div style="font-size:11px;color:var(--text-muted);">${esc(sale.folio)}</div>` : ''}
      </div>

      <div class="history-items">
        ${itemsHTML}
      </div>

      <div class="history-footer">
        <div class="history-total">Total: $${parseFloat(finalTotal).toFixed(2)}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${editModeActive
            ? `<button class="history-action-btn active" onclick="openEditSale('${saleId}')">${icon('pencil')}</button>
               <button class="history-action-btn danger" onclick="deleteSale('${saleId}')">${icon('trash')}</button>`
            : `<button class="history-action-btn" onclick="generateTicket((_historyData.find(s=>s._id==='${saleId}')))">${icon('receipt')}</button>`}
        </div>
      </div>
    `;

    container.appendChild(div);
  });

  updateCutBtnWithData(data);
}

function renderHistoryStats(data) {
  const el = document.getElementById("historyStats");
  if (!el) return;
  if (!data.length) { el.style.display = "none"; el.innerHTML = ""; return; }

  const counts = {};
  data.forEach(sale => (sale.items || []).forEach(item => {
    counts[item.name] = (counts[item.name] || 0) + 1;
  }));

  const known = new Set();
  const groups = menu.map(cat => {
    const items = cat.items.filter(i => counts[i.name]).map(i => { known.add(i.name); return [i.name, counts[i.name]]; });
    return { label: catHTML(cat.category), items };
  });
  const others = Object.entries(counts).filter(([name]) => !known.has(name));
  if (others.length) groups.push({ label: "Otros", items: others });

  const rows = groups.filter(g => g.items.length).map(g => `
    <div class="stats-cat">
      <div class="stats-cat-head"><span>${g.label}</span><strong>${g.items.reduce((sum, [, n]) => sum + n, 0)}</strong></div>
      <div class="stats-items">${g.items.map(([name, n]) => `<span class="stats-chip"><b>${n}×</b><span>${esc(name)}</span></span>`).join("")}</div>
    </div>`).join("");

  el.innerHTML = `<div class="stats-title"><span>Ventas</span><strong>${data.length}</strong></div>${rows}`;
  el.style.display = "block";
  updateStatsJump();
}

// Small floating button on History that jumps to the stats when they're below the fold.
function updateStatsJump() {
  const btn = document.getElementById("statsJumpBtn");
  const stats = document.getElementById("historyStats");
  if (!btn || !stats) return;
  let show = false;
  if (document.getElementById("historyPage").style.display !== "none" && stats.style.display !== "none") {
    show = stats.getBoundingClientRect().top > window.innerHeight - 8;
  }
  btn.classList.toggle("show", show);
}

function scrollToStats() {
  const stats = document.getElementById("historyStats");
  const header = document.querySelector(".header");
  const top = stats.getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 0) - 10;
  window.scrollTo({ top, behavior: "smooth" });
}

function updateCutBtnWithData(data) {
  renderHistoryStats(data);
  const container = document.getElementById("cutBtn");
  if (data.length > 0) {
    container.style.display = "block";
  } else {
    container.style.display = "none";
  }
}

function deleteSale(saleId) {
  const sale = (_historyData || []).find(s => s._id === saleId);
  if (!sale) return;
  confirmModal("¿Borrar esta transacción?", async () => {
    (sale.items || []).forEach(item => {
      const k = stockKey(item);
      if (!(k in defaultInventory)) return;
      if (!inventory[k]) inventory[k] = 0;
      inventory[k]++;
      DataStore.incrementStock(k, 1);
    });

    saveInventory();
    await DataStore.deleteSale(saleId);

    renderProducts();
    renderInventory();
    await renderHistoryFromFirestore();
  });
}

async function generateCut() {
  const todayISO = new Date().toISOString().slice(0, 10);

  const history = _historyData || await DataStore.getSales();

  const todaySales = history.filter(s =>
    s.isoDate ? s.isoDate.startsWith(todayISO) : true
  );

  const total = todaySales.reduce((sum, s) => sum + s.total, 0);
  const count = todaySales.length;

  // Build CSV data now (Firestore reads), before any download or clearing.
  // If this fails, bail out entirely — never offer to delete without a ready export.
  let csvString = null;
  try {
    csvString = await buildCsvString(history);
  } catch (e) {
    showToast("Error al preparar el archivo. Cierre de caja cancelado.");
    return;
  }

  confirmModal("¿Cerrar caja y borrar ventas?", async () => {
    // Export must actually happen before anything gets deleted.
    try {
      triggerCsvDownload(csvString);
    } catch (e) {
      showToast("Error al descargar el archivo. Cierre de caja cancelado.");
      return;
    }

    try {
      await DataStore.clearDayData();
      _historyData = [];
      renderHistoryWithData([]);

      openPopupModal(`
        <h3 style="margin-top:0;">Corte del día</h3>
        <p>Ventas: <strong>${count}</strong></p>
        <p>Total: <strong>$${parseFloat(total).toFixed(2)}</strong></p>
        <button class="btn-primary" onclick="closeModal()">Cerrar</button>
      `);
    } catch (e) {
      showToast("El archivo ya se descargó, pero hubo un error al borrar las ventas: " + (e.message || "reintenta"));
    }
  });
}

async function buildCsvString(history) {
  const mermas   = await DataStore.getMermas();
  const hiddenItems = getHiddenItems();
  const products = menu.flatMap(c => c.items).map(i => i.name).filter(name => !hiddenItems.includes(name));

  let csv = `Folio,Fecha,Hora,Método de pago,Total,`;
  products.forEach(p => { csv += `"${p}",`; });
  csv += "\n";

  history.forEach(sale => {
    const folio  = sale.folio || "";
    const parts  = sale.date ? sale.date.split(",") : [];
    const date   = parts[0]?.trim() || "";
    const time   = parts[1]?.trim() || "";
    const method = sale.method === "cash" ? "Efectivo" : sale.method === "card" ? "Tarjeta" : "Transferencia";
    let row = `${folio},${date},${time},${method},${sale.total},`;
    products.forEach(p => {
      let qty = 0;
      sale.items.forEach(item => { if (item.name === p) qty++; });
      row += qty + ",";
    });
    csv += row + "\n";
  });

  csv += "\n";

  let soldRow = `,,,,Vendidos,`;
  products.forEach(p => {
    let total = 0;
    history.forEach(sale => {
      sale.items.forEach(item => { if (item.name === p) total++; });
    });
    soldRow += total + ",";
  });
  csv += soldRow + "\n";

  const mermaTotals = {};
  mermas.forEach(m => { const p = parentProduct(m.name); mermaTotals[p] = (mermaTotals[p] || 0) + m.qty; });
  let mermaRow = `,,,,Mermas,`;
  products.forEach(p => { mermaRow += (mermaTotals[p] || 0) + ","; });
  csv += mermaRow + "\n";

  return csv;
}

function triggerCsvDownload(csv) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `postre_mio_corte_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}


let _spinnerCount = 0;
function showSpinner() {
  _spinnerCount++;
  const el = document.getElementById('pageSpinner');
  if (el) el.style.display = 'flex';
}
function hideSpinner() {
  if (--_spinnerCount <= 0) {
    _spinnerCount = 0;
    const el = document.getElementById('pageSpinner');
    if (el) el.style.display = 'none';
  }
}

function showToast(msg, iconName) {
  const toast = document.createElement("div");
  toast.className = "toast";
  if (iconName) toast.insertAdjacentHTML("beforeend", icon(iconName) + " ");
  toast.appendChild(document.createTextNode(msg));

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  setTimeout(() => {
    toast.remove();
  }, 2500);
}

function confirmModal(message, onConfirm) {
  openPopupModal(`
    <h3 style="margin-top:0;">${esc(message)}</h3>
    <button class="btn-primary" id="_confirmYes">Sí</button>
    <button class="btn-secondary" id="_confirmNo">Cancelar</button>
  `);
  document.getElementById("_confirmYes").onclick = () => { closeModal(); onConfirm(); };
  document.getElementById("_confirmNo").onclick = () => { closeModal(); };
}


// ─────────────────────────────────────────────
//  PROMOTIONS ENGINE
// ─────────────────────────────────────────────
//
//  Promotion schema:
//  {
//    id: number (timestamp),
//    name: string,          — display label
//    active: bool,
//    scope: "any" | "category" | "product",
//    scopeValue: string,    — category name or product name (empty when scope=any)
//    triggerQty: number,    — how many items must be in cart to trigger
//    type: "free_item" | "fixed_price" | "pct_discount",
//    value: number,
//      — free_item:    number of free items added (usually 1)
//      — fixed_price:  new total price for the matched group (e.g. 6 cookies for $200)
//      — pct_discount: discount % applied to matched items (e.g. 10 for 10%)
//  }

let promotions = [];

// ── helpers ──────────────────────────────────

function allMenuItems() {
  return visibleMenu().flatMap(c => c.items);
}

function allCategories() {
  return visibleMenu().map(c => c.category);
}

function itemMatchesScope(item, promo) {
  if (promo.scope === "any") return true;
  if (promo.scope === "product") return item.name === promo.scopeValue;
  if (promo.scope === "category") {
    const cat = menu.find(c => c.items.some(i => i.name === item.name));
    return cat && cat.category === promo.scopeValue;
  }
  return false;
}

// Returns array of { promo, discount, freeItems[] }
function applyPromotions(cartItems) {
  const applied = [];

  if (!cartItems.length) return applied;

  for (const promo of promotions) {
    if (!promo.active) continue;

    const matched = cartItems.filter(i => itemMatchesScope(i, promo));
    const matchedCount = matched.length;

    if (promo.type === "raffle" && promo.triggerMode === "amount") {
      const matchedTotal = matched.reduce((s, i) => s + i.price, 0);
      if (matchedTotal >= promo.triggerQty) {
        const amountSets = Math.floor(matchedTotal / promo.triggerQty);
        applied.push({ promo, discount: 0, raffleEntries: amountSets * (promo.value || 1) });
      }
      continue;
    }

    if (matchedCount < promo.triggerQty) continue;

    const sets = Math.floor(matchedCount / promo.triggerQty);

    if (promo.type === "free_item") {
      const freeCount = sets * promo.value;
      const cheapest = matched.slice().sort((a, b) => a.price - b.price)[0];
      const discount = cheapest.price * freeCount;
      applied.push({ promo, discount, freeCount, freeItemName: cheapest.name });

    } else if (promo.type === "fixed_price") {
      const normalCost = matched.slice(0, promo.triggerQty * sets)
        .reduce((s, i) => s + i.price, 0);
      const discount = normalCost - (promo.value * sets);
      applied.push({ promo, discount: Math.max(0, discount) });

    } else if (promo.type === "pct_discount") {
      const applicableItems = matched.slice(0, promo.triggerQty * sets);
      const base = applicableItems.reduce((s, i) => s + i.price, 0);
      const discount = base * (promo.value / 100);
      applied.push({ promo, discount });

    } else if (promo.type === "raffle") {
      const entries = sets * (promo.value || 1);
      applied.push({ promo, discount: 0, raffleEntries: entries });
    }
  }

  return applied;
}

// Computes cart total after promos and returns { rawTotal, discount, finalTotal, appliedPromos }
function computeCartTotals() {
  const rawTotal = cart.reduce((s, i) => s + i.price, 0);
  const appliedPromos = applyPromotions(cart);
  const discount = appliedPromos.reduce((s, a) => s + a.discount, 0);
  const finalTotal = Math.max(0, rawTotal - discount);
  return { rawTotal, discount, finalTotal, appliedPromos };
}

// ── renderCart — groups items, shows promos ──
function renderCart() {
  const payBtn = document.getElementById("payBtn");
  payBtn.disabled = cart.length === 0;

  const container = document.getElementById("cart");
  const frag = document.createDocumentFragment();

  const { finalTotal, appliedPromos } = computeCartTotals();

  // Group ALL items by name + extra variant
  const grouped = {};
  cart.forEach(item => {
    const key = item.name + (item.extra ? '::' + item.extra.name : '');
    if (!grouped[key]) grouped[key] = { ...item, qty: 0 };
    grouped[key].qty++;
  });

  Object.values(grouped).forEach(item => {
    const basePrice = item.extra ? item.price - item.extra.price : item.price;
    const extraName = item.extra ? item.extra.name : null;
    const priceLine = (item.extra && basePrice === 0)
      ? `$${item.extra.price.toFixed(2)} × ${item.qty}`
      : `$${basePrice.toFixed(2)}${item.extra ? ` + $${item.extra.price.toFixed(2)}` : ''} × ${item.qty}`;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="cart-item-name">${esc(item.name)}</div>
      <div class="cart-item-price">${priceLine}</div>
      ${item.extra ? `<div class="cart-extra-line"><span>↳ ${esc(item.extra.name)}</span></div>` : ''}
      <div class="cart-item-controls">
        <button onclick="changeQtyGrouped('${item.name.replace(/'/g,"\\'")}', ${extraName ? `'${extraName.replace(/'/g,"\\'")}'` : 'null'}, -1)">−</button>
        <button onclick="changeQtyGrouped('${item.name.replace(/'/g,"\\'")}', ${extraName ? `'${extraName.replace(/'/g,"\\'")}'` : 'null'}, 1)">+</button>
      </div>
    `;
    frag.appendChild(div);
  });

  // Discount & raffle lines
  appliedPromos.forEach(a => {
    if (a.discount <= 0 && !a.raffleEntries) return;
    const line = document.createElement("div");
    line.className = "cart-discount-line";
    if (a.raffleEntries) {
      line.innerHTML = `<span>${icon('ticket')} ${esc(a.promo.name)} (×${a.raffleEntries})</span><span style="color:var(--green);">¡Rifa!</span>`;
    } else {
      let label = `${icon('tag')} ${esc(a.promo.name)}`;
      if (a.freeCount) label += ` (+${a.freeCount} gratis)`;
      line.innerHTML = `<span>${label}</span><span>−$${a.discount.toFixed(2)}</span>`;
    }
    frag.appendChild(line);
  });

  container.innerHTML = "";
  container.appendChild(frag);

  document.getElementById("total").innerText = finalTotal.toFixed(2);
  localStorage.setItem("cart", JSON.stringify(cart));

  // Build a set of product names in the cart for targeted stock updates
  const cartNames = new Set(cart.map(i => i.name));
  const allItems = menu.flatMap(c => c.items);
  const itemsToUpdate = allItems.filter(i => cartNames.has(i.name) || i._prevInCart);

  // Count items in cart once
  const cartCounts = {};
  cart.forEach(i => { cartCounts[i.name] = (cartCounts[i.name] || 0) + 1; });

  allItems.forEach(item => {
    const inCart = cartCounts[item.name] || 0;
    const wasInCart = item._prevInCart || 0;
    item._prevInCart = inCart;
    if (inCart === 0 && wasInCart === 0) return;

    const safeId = item.name.replace(/[^a-zA-Z0-9]/g, '-');
    const el = document.getElementById('stock-' + safeId);
    if (!el) return;
    const remaining = productStock(item.name) - inCart;
    const isLow = remaining > 0 && remaining <= lowStockThreshold;
    const isOut = remaining <= 0;
    el.innerHTML = `Stock: ${Math.max(0, remaining)}${isLow ? ` <span class="low-stock-badge">${icon('alert')} Poco</span>` : ''}${isOut ? ' <span class="low-stock-badge" style="background:#e53935;">Sin stock</span>' : ''}`;
    el.style.color = isOut ? 'var(--red)' : isLow ? 'var(--orange)' : 'var(--text-muted)';

    const card = el.closest('.product');
    if (card) {
      card.className = 'product' + (isLow ? ' low-stock-product' : '') + (isOut ? ' out-of-stock' : '');
      card.onclick = isOut ? null : () => addToCart(item);
    }
  });
}

// ── render promo list ─────────────────────────

function promoTypeLabel(type) {
  return { free_item: `${icon('gift')} Gratis`, fixed_price: `${icon('coins')} Precio fijo`, pct_discount: `${icon('percent')} Descuento`, raffle: `${icon('ticket')} Rifa` }[type] || type;
}

function promoTypeClass(type) {
  return { free_item: "type-free", fixed_price: "type-price", pct_discount: "type-pct", raffle: "type-raffle" }[type] || "";
}

function promoDescription(p) {
  const scopeStr = p.scope === "any" ? "cualquier producto"
    : p.scope === "category" ? `categoría "${catName(p.scopeValue)}"`
    : `"${p.scopeValue}"`;

  if (p.type === "free_item") {
    return `Lleva ${p.triggerQty} de ${scopeStr} y obtén ${p.value} gratis.`;
  } else if (p.type === "fixed_price") {
    return `${p.triggerQty} de ${scopeStr} por $${p.value}.`;
  } else if (p.type === "pct_discount") {
    return `${p.value}% de descuento al llevar ${p.triggerQty} de ${scopeStr}.`;
  } else if (p.type === "raffle") {
    const n = p.value || 1;
    const entryWord = n === 1 ? 'entrada' : 'entradas';
    if (p.triggerMode === "amount") {
      return `${n} ${entryWord} de rifa por cada $${p.triggerQty} gastados en ${scopeStr}.`;
    }
    return `${n} ${entryWord} de rifa al llevar ${p.triggerQty} de ${scopeStr}.`;
  }
  return "";
}

function renderPromos() {
  const container = document.getElementById("promoList");
  if (!container) return;
  container.innerHTML = "";

  if (!promotions.length) {
    container.innerHTML = `
      <div class="promo-empty">
        <div class="promo-empty-icon">${icon('tag')}</div>
        <p>No hay promociones activas.</p>
        <p style="font-size:12px;">Toca el botón + para agregar una.</p>
      </div>
    `;
    return;
  }

  promotions.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "promo-card" + (p.active ? "" : " promo-inactive");
    card.innerHTML = `
      <div class="promo-card-header">
        <div class="promo-name">${esc(p.name)}</div>
        <span class="promo-badge ${promoTypeClass(p.type)}">${promoTypeLabel(p.type)}</span>
      </div>
      <div class="promo-desc">${esc(promoDescription(p))}</div>
      <div class="promo-card-footer">
        <button class="promo-toggle ${p.active ? 'active' : 'inactive'}"
          onclick="togglePromo(${idx})">
          ${p.active ? `${icon('check')} Activa` : `${icon('pause')} Inactiva`}
        </button>
        <button class="history-action-btn danger" onclick="deletePromo(${idx})">${icon('trash')}</button>
      </div>
    `;
    container.appendChild(card);
  });
}

async function togglePromo(idx) {
  const promo = promotions[idx];
  promo.active = !promo.active;
  if (promo._id) await DataStore.updatePromotion(promo._id, { active: promo.active });
  renderPromos();
  renderCart();
}

function deletePromo(idx) {
  confirmModal(`¿Eliminar la promoción "${promotions[idx].name}"?`, async () => {
    const promo = promotions[idx];
    if (promo._id) await DataStore.deletePromotion(promo._id);
    promotions.splice(idx, 1);
    renderPromos();
    renderCart();
  });
}

// ── promo creation modal ──────────────────────

function openPromoModal() {
  const productOptions = allMenuItems()
    .map(i => `<option value="${esc(i.name)}">${esc(i.name)}</option>`).join("");
  const categoryOptions = allCategories()
    .map(c => `<option value="${esc(c)}" data-icon="${CATEGORY_ICONS[c] || ''}">${esc(catName(c))}</option>`).join("");

  openCompactModal(`
    <h3 style="margin-top:0;">Nueva promoción</h3>
    <div class="promo-form">

      <label>Nombre de la promoción</label>
      <input id="pf-name" type="text" placeholder="Ej: 6 galletas por $200">

      <label>Tipo de descuento</label>
      <select id="pf-type" onchange="onPromoTypeChange()">
        <option value="free_item" data-icon="gift">Producto gratis</option>
        <option value="fixed_price" data-icon="tag">Precio fijo por grupo</option>
        <option value="pct_discount" data-icon="percent">Descuento</option>
        <option value="raffle" data-icon="ticket">Entrada de rifa</option>
      </select>

      <label>Aplica a</label>
      <select id="pf-scope" onchange="onPromoScopeChange()">
        <option value="any" data-icon="sparkles">Cualquier producto</option>
        <option value="category" data-icon="package">Categoría específica</option>
        <option value="product" data-icon="cookie">Producto específico</option>
      </select>

      <div id="pf-scope-value-wrap" style="display:none;">
        <label id="pf-scope-value-label">Producto</label>
        <select id="pf-scope-product">${productOptions}</select>
        <select id="pf-scope-category" style="display:none;">${categoryOptions}</select>
      </div>

      <div id="pf-trigger-mode-wrap" style="display:none;">
        <label>Condición de la rifa</label>
        <select id="pf-trigger-mode" onchange="onTriggerModeChange()">
          <option value="qty" data-icon="package">Por cantidad de productos</option>
          <option value="amount" data-icon="dollar">Por monto gastado ($)</option>
        </select>
      </div>

      <div class="row2">
        <div>
          <label id="pf-trigger-label">Cantidad mínima</label>
          <input id="pf-trigger" type="number" min="1" value="6" inputmode="numeric">
        </div>
        <div>
          <label id="pf-value-label">Valor</label>
          <input id="pf-value" type="number" min="0" value="1" inputmode="decimal">
        </div>
      </div>
      <div id="pf-value-hint" style="font-size:12px;color:#888;margin-top:4px;">
        Número de productos gratis por activación
      </div>

    </div>
    <button onclick="savePromo()" class="btn-brand" style="margin-top:14px;">Guardar</button>
    <button onclick="closeModal()" class="btn-secondary">Cancelar</button>
  `);
}

function onPromoTypeChange() {
  const type = document.getElementById("pf-type").value;
  const valueLabel = document.getElementById("pf-value-label");
  const hint = document.getElementById("pf-value-hint");
  const valueInput = document.getElementById("pf-value");
  const triggerModeWrap = document.getElementById("pf-trigger-mode-wrap");

  triggerModeWrap.style.display = type === "raffle" ? "block" : "none";

  if (type === "free_item") {
    valueLabel.textContent = "Productos gratis";
    hint.textContent = "Número de productos gratis por activación.";
    valueInput.value = 1;
  } else if (type === "fixed_price") {
    valueLabel.textContent = "Precio total ($)";
    hint.textContent = "Precio total del grupo de productos (ej: 6 galletas por $200).";
    valueInput.value = 200;
  } else if (type === "pct_discount") {
    valueLabel.textContent = "Descuento (%)";
    hint.textContent = "Porcentaje de descuento sobre los productos del grupo.";
    valueInput.value = 10;
  } else if (type === "raffle") {
    valueLabel.textContent = "Entradas de rifa";
    hint.textContent = "Número de entradas de rifa que se otorgan al cumplir la condición.";
    valueInput.value = 1;
    document.getElementById("pf-trigger-mode").value = "qty";
    onTriggerModeChange();
  }

  if (type !== "raffle") {
    document.getElementById("pf-trigger-label").textContent = "Cantidad mínima";
  }
}

function onTriggerModeChange() {
  const mode = document.getElementById("pf-trigger-mode").value;
  const triggerLabel = document.getElementById("pf-trigger-label");
  const triggerInput = document.getElementById("pf-trigger");
  if (mode === "amount") {
    triggerLabel.textContent = "Monto mínimo ($)";
    triggerInput.value = 200;
    triggerInput.setAttribute("inputmode", "decimal");
  } else {
    triggerLabel.textContent = "Cantidad mínima";
    triggerInput.value = 6;
    triggerInput.setAttribute("inputmode", "numeric");
  }
}

function onPromoScopeChange() {
  const scope = document.getElementById("pf-scope").value;
  const wrap = document.getElementById("pf-scope-value-wrap");
  const prodSel = document.getElementById("pf-scope-product");
  const catSel = document.getElementById("pf-scope-category");
  const lbl = document.getElementById("pf-scope-value-label");

  if (scope === "any") {
    wrap.style.display = "none";
  } else if (scope === "product") {
    wrap.style.display = "block";
    prodSel.style.display = "block";
    catSel.style.display = "none";
    lbl.textContent = "Producto";
  } else if (scope === "category") {
    wrap.style.display = "block";
    prodSel.style.display = "none";
    catSel.style.display = "block";
    lbl.textContent = "Categoría";
  }
}

function savePromo() {
  const name = document.getElementById("pf-name").value.trim();
  const type = document.getElementById("pf-type").value;
  const scope = document.getElementById("pf-scope").value;
  const triggerMode = type === "raffle" ? document.getElementById("pf-trigger-mode").value : "qty";
  const triggerRaw = parseFloat(document.getElementById("pf-trigger").value);
  const triggerQty = triggerMode === "amount" ? triggerRaw : parseInt(triggerRaw, 10);
  const value = parseFloat(document.getElementById("pf-value").value);

  if (!name) { showToast("Ponle un nombre a la promoción"); return; }
  if (isNaN(triggerQty) || triggerQty < 1) { showToast(triggerMode === "amount" ? "El monto mínimo debe ser al menos 1" : "La cantidad mínima debe ser al menos 1"); return; }
  if (isNaN(value) || value < 0) { showToast("El valor no es válido"); return; }

  let scopeValue = "";
  if (scope === "product") scopeValue = document.getElementById("pf-scope-product").value;
  if (scope === "category") scopeValue = document.getElementById("pf-scope-category").value;

  const promo = { name, active: true, scope, scopeValue, triggerQty, triggerMode, type, value };
  DataStore.addPromotion(promo);
  promotions.push(promo);

  closeModal();
  showToast(`Promoción "${name}" creada`, "check");
  renderPromos();
  renderCart();
}

// ─────────────────────────────────────────────
//  RESTOCK LOG ENGINE
// ─────────────────────────────────────────────

let _restockLog = [];
let _restockEditing = false;
let _restockMarked = new Set();

function renderRestockLogWithData(log) {
  if (log) _restockLog = log;
  const section = document.getElementById("restockSection");
  const container = document.getElementById("restockList");
  if (!section || !container) return;

  if (!_restockLog.length) {
    _restockEditing = false;
    _restockMarked.clear();
    section.style.display = "none";
    return;
  }

  section.style.display = "block";

  container.innerHTML = _restockLog.map(entry => {
    const marked = _restockMarked.has(entry._id);
    return `
    <div class="restock-entry${marked ? ' marked' : ''}${_restockEditing ? ' editing' : ''}">
      <div>
        <div style="font-weight:600;">${entry.source === 'bake' ? icon('flame') + ' ' : ''}${esc(entry.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${esc(entry.date)}</div>
      </div>
      <span class="restock-qty">+${entry.qty}</span>
      ${_restockEditing ? `<button class="history-action-btn danger" onclick="toggleRestockMark('${entry._id}')" title="${marked ? 'Deshacer' : 'Eliminar'}">${icon('trash')}</button>` : ''}
    </div>`;
  }).join('');

  const actions = document.getElementById("restockActions");
  actions.innerHTML = _restockEditing ? `
    <div class="restock-confirm-row">
      <button class="btn-secondary" onclick="cancelRestockEdit()">Cancelar</button>
      <button class="btn-primary" onclick="confirmRestockEdit()">Confirmar${_restockMarked.size ? ` (${_restockMarked.size})` : ''}</button>
    </div>
    <button class="btn-danger" style="width:100%;margin-top:8px;font-size:13px;" onclick="clearRestockLog()">Borrar registro</button>
  ` : `
    <button class="btn-secondary" style="width:100%;margin-top:10px;font-size:13px;" onclick="startRestockEdit()">${icon('pencil')} Editar registro</button>
  `;
}

function startRestockEdit() {
  _restockEditing = true;
  _restockMarked.clear();
  renderRestockLogWithData();
}

function cancelRestockEdit() {
  _restockEditing = false;
  _restockMarked.clear();
  renderRestockLogWithData();
}

function toggleRestockMark(id) {
  if (_restockMarked.has(id)) _restockMarked.delete(id); else _restockMarked.add(id);
  renderRestockLogWithData();
}

function confirmRestockEdit() {
  const ids = [..._restockMarked];
  _restockEditing = false;
  _restockMarked.clear();
  renderRestockLogWithData();
  if (!ids.length) return;
  // Don't await: offline, the write is queued and the list already updates locally.
  DataStore.deleteRestocks(ids).catch(() => showToast("Error al eliminar. Intenta de nuevo."));
}

function clearRestockLog() {
  confirmModal("¿Borrar el registro de reabastecimientos?", async () => {
    _restockEditing = false;
    _restockMarked.clear();
    await DataStore.clearRestockLog();
    renderRestockLogWithData([]);
  });
}

// Renamed products: migrate any existing Firestore data (stock, frozen stock, custom
// prices, hidden flag, promo scope) from the old name to the new one, once.
async function migrateRenamedProducts(firestoreInv, firestoreFrozen, firestorePrices, firestoreHidden, firestorePromos) {
  const invBatch = db.batch();
  let invChanged = false;
  const tasks = [];

  for (const [oldName, newName] of Object.entries(PRODUCT_RENAMES)) {
    // Inventory and frozen stock are quantities, so when several old names
    // collapse into the same new name (e.g. the four "Mini pastel X"
    // products merging into one), sum them instead of keeping only one.
    if (oldName in firestoreInv) {
      firestoreInv[newName] = (firestoreInv[newName] || 0) + firestoreInv[oldName];
      delete firestoreInv[oldName];
      invBatch.delete(storeRef("inventory").doc(oldName));
      invBatch.set(storeRef("inventory").doc(newName), { qty: firestoreInv[newName] });
      invChanged = true;
    }

    if (oldName in firestoreFrozen) {
      firestoreFrozen[newName] = (firestoreFrozen[newName] || 0) + firestoreFrozen[oldName];
      delete firestoreFrozen[oldName];
      tasks.push(configRef("frozenInventory").set(
        { [oldName]: firebase.firestore.FieldValue.delete(), [newName]: firestoreFrozen[newName] },
        { merge: true }
      ));
    }

    // Prices aren't additive — keep whichever one is found first.
    if (oldName in firestorePrices) {
      if (!(newName in firestorePrices)) firestorePrices[newName] = firestorePrices[oldName];
      delete firestorePrices[oldName];
      tasks.push(configRef("prices").set(
        { [oldName]: firebase.firestore.FieldValue.delete(), [newName]: firestorePrices[newName] },
        { merge: true }
      ));
    }

    const hiddenIdx = firestoreHidden.indexOf(oldName);
    if (hiddenIdx > -1) {
      if (firestoreHidden.includes(newName)) {
        firestoreHidden.splice(hiddenIdx, 1);
      } else {
        firestoreHidden[hiddenIdx] = newName;
      }
      tasks.push(DataStore.saveHiddenItems(firestoreHidden));
    }

    firestorePromos.forEach(promo => {
      if (promo.scope === "product" && promo.scopeValue === oldName) {
        promo.scopeValue = newName;
        if (promo._id) tasks.push(DataStore.updatePromotion(promo._id, { scopeValue: newName }));
      }
    });
  }

  if (invChanged) tasks.push(invBatch.commit());
  // Don't block startup on write acknowledgements (they stall while offline).
  Promise.all(tasks).catch(e => console.error("migration failed:", e));
}

// ── Init (called after auth) ─────────────────
async function initApp() {
  // Load initial data from Firestore
  const [firestoreInv, firestorePrices, firestorePromos, firestoreHidden, firestoreExtrasPrices, firestoreFrozen, firestoreSettings] = await Promise.all([
    DataStore.getInventory(),
    DataStore.getCustomPrices(),
    DataStore.getPromotions(),
    DataStore.getHiddenItems(),
    DataStore.getExtrasPrices(),
    DataStore.getFrozenInventory(),
    DataStore.getSettings(),
  ]);

  if (Number.isInteger(firestoreSettings.lowStockThreshold)) {
    lowStockThreshold = firestoreSettings.lowStockThreshold;
  }
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    if (firestoreSettings[k] !== undefined) appSettings[k] = firestoreSettings[k];
  });

  await migrateRenamedProducts(firestoreInv, firestoreFrozen, firestorePrices, firestoreHidden, firestorePromos);

  // Seed inventory if Firestore is empty (first run)
  if (Object.keys(firestoreInv).length === 0) {
    const batch = db.batch();
    Object.entries(defaultInventory).forEach(([name, qty]) => {
      batch.set(storeRef("inventory").doc(name), { qty });
    });
    batch.commit().catch(e => console.error("seed failed:", e));
    Object.assign(inventory, defaultInventory);
  } else {
    Object.keys(inventory).forEach(k => delete inventory[k]);
    Object.assign(inventory, firestoreInv);
  }

  // Apply custom prices
  menu.forEach(cat => {
    cat.items.forEach(item => {
      if (firestorePrices[item.name] !== undefined) item.price = firestorePrices[item.name];
    });
  });

  // Apply saved extras prices
  Object.entries(firestoreExtrasPrices).forEach(([key, price]) => {
    const sep = key.indexOf('__');
    if (sep === -1) return;
    const productName = key.slice(0, sep);
    const extraName   = key.slice(sep + 2);
    const extra = findExtra(productName, extraName);
    if (extra) extra.price = price;
  });

  // Load promotions
  promotions = firestorePromos;

  // Store hidden items locally for quick access
  localStorage.setItem("hiddenItems", JSON.stringify(firestoreHidden));

  // Load frozen inventory
  Object.assign(frozenInventory, firestoreFrozen);
  originalFrozenInventory = JSON.parse(JSON.stringify(frozenInventory));

  saveInventory();
  renderProducts();
  renderCart();

  startListeners();
}

// ─────────────────────────────────────────────
//  MERMA ENGINE
// ─────────────────────────────────────────────

const MERMA_REASONS = {
  merma:   { label: "Merma",            icon: "trash" },
  muestra: { label: "Muestra/Degusto",  icon: "utensils" },
  regalo:  { label: "Regalo",           icon: "gift" },
  consumo: { label: "Consumo propio",   icon: "chef" },
};



function openMermaModal() {
  // Build category options
  const vMenu = visibleMenu();
  const catOptions = vMenu.map(c =>
    `<option value="${esc(c.category)}" data-icon="${CATEGORY_ICONS[c.category] || ''}">${esc(catName(c.category))}</option>`
  ).join('');

  // Build item options for first category
  const itemOptions = mermaItemOptions(vMenu[0]?.items || []);

  const reasonOptions = Object.entries(MERMA_REASONS).map(([k, v]) =>
    `<option value="${k}" data-icon="${v.icon}">${v.label}</option>`
  ).join('');

  openCompactModal(`
    <h3 style="margin-top:0;">${icon('trendDown')} Registrar merma</h3>
    <div class="promo-form">

      <label>Categoría</label>
      <select id="merma-cat" onchange="onMermaCatChange()">
        ${catOptions}
      </select>

      <label>Producto</label>
      <select id="merma-item">
        ${itemOptions}
      </select>

      <label>Motivo</label>
      <select id="merma-reason">
        ${reasonOptions}
      </select>

      <label>Cantidad</label>
      <input id="merma-qty" type="number" inputmode="numeric" min="1" value="1">
    </div>
    <button class="btn-danger" onclick="confirmMerma()" style="margin-top:14px;">Registrar</button>
    <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
  `);
}

function mermaItemOptions(items) {
  return items.flatMap(i => stockNamesFor(i.name)).map(k =>
    `<option value="${esc(k)}" data-meta="STOCK: ${inventory[k] ?? 0}">${esc(k)}</option>`
  ).join('');
}

function onMermaCatChange() {
  const cat = document.getElementById('merma-cat')?.value;
  const catData = visibleMenu().find(c => c.category === cat);
  const itemSel = document.getElementById('merma-item');
  if (!catData || !itemSel) return;
  itemSel.innerHTML = mermaItemOptions(catData.items);
}

async function confirmMerma() {
  const name   = document.getElementById("merma-item")?.value;
  const reason = document.getElementById("merma-reason")?.value;
  const qty    = parseInt(document.getElementById("merma-qty")?.value, 10);
  const stock  = inventory[name] ?? 0;

  if (!name)              { showToast("Selecciona un producto");  return; }
  if (isNaN(qty) || qty < 1) { showToast("Cantidad inválida");   return; }
  if (qty > stock)        { showToast(`Solo hay ${stock} en stock`); return; }

  inventory[name] = stock - qty;
  DataStore.setStock(name, inventory[name]);

  await DataStore.addMerma({ date: new Date().toLocaleString(), name, qty, reason });

  closeModal();
  showToast(`Merma de ${qty} × ${name} registrada`);
  renderProducts();
  renderMermaLog();
}

async function renderMermaLog() {
  const container = document.getElementById("mermaList");
  if (!container) return;

  showSpinner();
  const mermas = await DataStore.getMermas().finally(hideSpinner);

  if (!mermas.length) {
    container.innerHTML = `
      <div class="pending-empty">
        <div style="font-size:36px;margin-bottom:10px;">${icon('clipboard')}</div>
        <p>No hay mermas registradas.</p>
      </div>
    `;
    return;
  }

  const rows = mermas.map(m => {
    const r = MERMA_REASONS[m.reason] || { label: m.reason, icon: "package" };
    return `
      <div class="merma-entry">
        <div>
          <div style="font-weight:600;">${esc(m.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${esc(m.date)}</div>
        </div>
        <span class="merma-reason ${m.reason}">${icon(r.icon)} ${r.label}</span>
        <span class="merma-qty">−${m.qty}</span>
        <button class="history-action-btn danger" onclick="deleteMermaEntry('${m._id}')" title="Eliminar">${icon('trash')}</button>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="background:var(--card-bg);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);">
      ${rows}
    </div>
    <button class="btn-secondary" style="width:100%;margin-top:12px;font-size:13px;" onclick="clearMermaLog()">Borrar historial</button>
  `;
}

function clearMermaLog() {
  confirmModal("¿Borrar todo el registro de mermas?", async () => {
    await DataStore.clearMermas();
    renderMermaLog();
  });
}

async function deleteMermaEntry(id) {
  await DataStore.deleteMerma(id);
  renderMermaLog();
}

// ─────────────────────────────────────────────
//  PENDING ORDERS ENGINE
// ─────────────────────────────────────────────



function saveAsPending() {
  if (cart.length === 0) {
    showToast("El carrito está vacío");
    return;
  }

  openCompactModal(`
    <h3 style="margin-top:0;">${icon('clipboard')} Guardar pedido</h3>
    <div class="promo-form">
      <label>Nombre del cliente</label>
      <input id="pending-name" type="text" placeholder="Ej: Ana García" autocomplete="off">
      <label>Nota (opcional)</label>
      <input id="pending-note" type="text" placeholder="Ej: Pasa a las 5pm">
    </div>
    <button class="btn-primary" onclick="confirmSaveAsPending()" style="margin-top:14px;">Guardar</button>
    <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
  `);

  setTimeout(() => document.getElementById('pending-name')?.focus(), 80);
}


async function confirmSaveAsPending() {
  if (_savingPending) return;
  _savingPending = true;
  showSpinner();
  try {
    const name = document.getElementById('pending-name').value.trim() || "Sin nombre";
    const note = document.getElementById('pending-note').value.trim();
    const { finalTotal, appliedPromos } = computeCartTotals();

    const order = {
      date: new Date().toLocaleString(),
      isoDate: new Date().toISOString(),
      name,
      note,
      items: [...cart],
      total: finalTotal,
      promos: appliedPromos
        .filter(a => a.discount > 0 || a.raffleEntries)
        .map(a => ({ name: a.promo.name, discount: a.discount, freeCount: a.freeCount || 0, freeItemName: a.freeItemName || "", raffleEntries: a.raffleEntries || 0 }))
    };

    for (const item of order.items) {
      const k = stockKey(item);
      if (inventory[k] > 0) {
        inventory[k]--;
        DataStore.setStock(k, inventory[k]);
      }
    }

    await DataStore.addPending(order);

    cart = [];
    localStorage.removeItem("cart");
    renderCart();
    renderProducts();

    closeModal();
    showToast(`Pedido de ${name} guardado`);
  } finally {
    hideSpinner();
    _savingPending = false;
  }
}

async function loadPending(id) {
  const list = await DataStore.getPending();
  const order = list.find(o => o._id === id);
  if (!order) return;

  const doLoad = async () => {
    for (const item of order.items) {
      const k = stockKey(item);
      inventory[k] = (inventory[k] ?? 0) + 1;
      DataStore.setStock(k, inventory[k]);
    }
    await DataStore.deletePending(id);
    cart = order.items.map(item => ({ ...item }));
    renderCart();
    renderProducts();
    showPage('pos');
    showToast(`Pedido de ${order.name} cargado`);
  };

  if (cart.length > 0) {
    confirmModal("El carrito actual se reemplazará. ¿Continuar?", doLoad);
  } else {
    await doLoad();
  }
}

async function deletePending(id) {
  const list = await DataStore.getPending();
  const order = list.find(o => o._id === id);
  confirmModal(`¿Eliminar el pedido de ${order?.name || 'este cliente'}?`, async () => {
    if (order) {
      for (const item of order.items) {
        const k = stockKey(item);
        inventory[k] = (inventory[k] ?? 0) + 1;
        DataStore.setStock(k, inventory[k]);
      }
      renderProducts();
    }
    await DataStore.deletePending(id);
    renderPending();
  });
}


async function renderPending() {
  const container = document.getElementById("pendingList");
  if (!container) return;

  showSpinner();
  const list = await DataStore.getPending().finally(hideSpinner);
  _pendingCache = list;

  if (!list.length) {
    container.innerHTML = `
      <div class="pending-empty">
        <div style="font-size:36px;margin-bottom:10px;">${icon('clipboard')}</div>
        <p>No hay pedidos pendientes.</p>
        <p style="font-size:12px;">Usa "Guardar como pendiente" desde el carrito.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  list.forEach(order => {
    const grouped = {};
    order.items.forEach(item => {
      const key = item.name + (item.extra ? ' + ' + item.extra.name : '');
      grouped[key] = (grouped[key] || 0) + 1;
    });
    const summary = Object.entries(grouped)
      .map(([k, qty]) => `${qty} × ${k}`)
      .join(', ');

    const card = document.createElement("div");
    card.className = "pending-card";
    card.innerHTML = `
      <div class="pending-card-header">
        <div class="pending-name">${esc(order.name)}</div>
        <div class="pending-date">${esc(order.date)}</div>
      </div>
      ${order.note ? `<div class="pending-note">${icon('note')} ${esc(order.note)}</div>` : ''}
      <div class="pending-items">${esc(summary)}</div>
      <div class="pending-footer">
        <div class="pending-total">$${parseFloat(order.total).toFixed(2)}</div>
        <div class="pending-actions">
          <button class="btn-brand" onclick="loadPending('${order._id}')">${icon('cart')} Cobrar</button>
          <button class="btn-secondary" onclick="sharePending('${order._id}')" style="font-size:13px;padding:8px 12px;">Compartir</button>
          <button class="history-action-btn danger" onclick="deletePending('${order._id}')">${icon('trash')}</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Width (in characters) of the shared order text; fits most phones in WhatsApp's monospaced block
const SHARE_WIDTH = 28;

// Word-wrap text to `width`, indenting continuation lines by `indent` spaces
function wrapText(text, width, indent = 0) {
  const lines = [];
  let line = "";
  const limit = () => lines.length ? width - indent : width;
  for (let word of String(text).split(" ")) {
    if (!word) continue;
    if (line && (line + " " + word).length > limit()) { lines.push(line); line = ""; }
    while (word.length > limit()) {
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, limit()));
      word = word.slice(limit());
    }
    line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => i ? " ".repeat(indent) + l : l);
}

// Kept from the last render so sharing starts synchronously from the tap
// (iOS rejects navigator.share after an await).
let _pendingCache = [];

function sharePending(id) {
  const order = _pendingCache.find(o => o._id === id);
  if (!order) return;

  const grouped = {};
  order.items.forEach(item => {
    const key = item.name + (item.extra ? ' + ' + item.extra.name : '');
    grouped[key] = { qty: (grouped[key]?.qty || 0) + 1, price: item.price };
  });

  const entries = Object.entries(grouped).map(([k, { qty, price }]) =>
    ({ left: `${qty}× ${k}`, right: `$${(qty * price).toFixed(2)}` })
  );
  if (order.promos?.length) {
    order.promos.forEach(p => {
      if (p.discount > 0) entries.push({ left: `Promo: ${p.name}`, right: `-$${p.discount.toFixed(2)}` });
    });
  }
  const totalEntry = { left: 'Total', right: `$${parseFloat(order.total).toFixed(2)}` };

  const maxRight  = Math.max(...[...entries, totalEntry].map(e => e.right.length));
  const leftWidth = Math.max(12, SHARE_WIDTH - 2 - maxRight);
  const sep = '─'.repeat(leftWidth + 2 + maxRight);

  const fmt = ({ left, right }) => {
    const [first, ...rest] = wrapText(left, leftWidth, 3);
    return [first.padEnd(leftWidth) + '  ' + right.padStart(maxRight), ...rest].join('\n');
  };

  const body = [
    'POSTRE MÍO 🩵',
    ...wrapText(`Pedido de ${order.name}`, SHARE_WIDTH),
    ...(order.note ? wrapText(`📝 ${order.note}`, SHARE_WIDTH, 3) : []),
    sep,
    ...entries.map(fmt),
    sep,
    fmt(totalEntry),
  ].join('\n');

  const text = `\`\`\`\n${body}\n\`\`\``;

  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showToast("Copiado al portapapeles"));
  }
}

// History: show/hide the "go to stats" button as the page scrolls or changes size
window.addEventListener("scroll", updateStatsJump, { passive: true });
window.addEventListener("resize", updateStatsJump);
if (window.ResizeObserver) new ResizeObserver(updateStatsJump).observe(document.getElementById("historyList"));

// Settings: re-check for unsaved changes whenever a control is edited
["input", "change"].forEach(ev => document.getElementById("settingsContent").addEventListener(ev, updateSettingsDirty));
window.addEventListener("beforeunload", e => {
  if (settingsPageVisible() && updateSettingsDirty() > 0) { e.preventDefault(); e.returnValue = ""; }
});

// Fill static icon placeholders in index.html
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

// Offline support (see sw.js)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(e => console.error("Service worker failed:", e));
  });
}
