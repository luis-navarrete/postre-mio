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

const STORE_ID = "postremio_main";

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

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

let _audioCtx;
function playClick() {
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

  try {
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }

    const authDoc = await configRef("auth").get();

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
      await initApp();
      document.getElementById("loadingScreen").style.display = "none";
      document.getElementById("appShell").style.display = "block";
    } else {
      const hash = await hashPin(pin);
      if (hash === authDoc.data().pinHash) {
        await initApp();
        document.getElementById("loadingScreen").style.display = "none";
        document.getElementById("appShell").style.display = "block";
      } else {
        document.getElementById("loadingScreen").style.display = "none";
        document.getElementById("authGate").style.display = "flex";
        errEl.textContent = "PIN incorrecto";
        clearPin();
      }
    }
  } catch (e) {
    document.getElementById("loadingScreen").style.display = "none";
    document.getElementById("authGate").style.display = "flex";
    document.getElementById("authSubtitle").textContent = "Ingresa el PIN para continuar";
    _isSettingUp = false;
    errEl.textContent = "Error de conexión. Intenta de nuevo.";
    clearPin();
  } finally {
    _submitting = false;
  }
}


function logout() {
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
    const snap = await storeRef("inventory").get();
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

  // ── Folio Counter (atomic) ──
  async getNextFolio(dateStr) {
    const ref = storeRef("counters").doc(dateStr);
    await ref.set({ value: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    const doc = await ref.get();
    return dateStr + String(doc.data().value).padStart(2, "0");
  },

  // ── Promotions ──
  async getPromotions() {
    const snap = await storeRef("promotions").get();
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

  async clearMermas() {
    const snap = await storeRef("mermas").get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  // ── Restock Log ──
  async getRestockLog() {
    const snap = await storeRef("restockLog").orderBy("date", "desc").get();
    return snap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
  },

  async addRestock(entry) {
    await storeRef("restockLog").add(entry);
  },

  async clearRestockLog() {
    const snap = await storeRef("restockLog").get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  // ── Config (costs, prices, hidden) ──
  async getCosts() {
    const doc = await configRef("costs").get();
    return doc.exists ? doc.data() : {};
  },

  async saveCosts(costs) {
    await configRef("costs").set(costs);
  },

  async getCustomPrices() {
    const doc = await configRef("prices").get();
    return doc.exists ? doc.data() : {};
  },

  async saveCustomPrice(name, price) {
    await configRef("prices").set({ [name]: price }, { merge: true });
  },

  async getExtrasPrices() {
    const doc = await configRef("extrasPrices").get();
    return doc.exists ? doc.data() : {};
  },

  async saveExtrasPrice(productName, extraName, price) {
    const key = productName + '__' + extraName;
    await configRef("extrasPrices").set({ [key]: price }, { merge: true });
  },

  async getHiddenItems() {
    const doc = await configRef("hidden").get();
    return doc.exists ? (doc.data().items || []) : [];
  },

  async saveHiddenItems(items) {
    await configRef("hidden").set({ items });
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

  // Restock log — re-render if visible
  _unsubscribers.push(
    storeRef("restockLog").onSnapshot(() => {
      if (document.getElementById("inventoryPage").style.display !== "none") {
        renderRestockLogFromFirestore();
      }
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

const defaultInventory = {
  "M&Ms": 0,
  "Lotus": 0,
  "Kinder Bueno": 0,
  "Red Velvet": 0,
  "Oreo": 0,
  "Lucky Charms": 0,
  "Conejito Turín": 0,
  "Pistache": 0,
  "Canela": 0,
  "Fresa": 0,
  "Crookie": 0,
  "Rol de canela": 0,
  "Brownie": 0,
  "Cookie bites": 0,
  "Besos de nuez": 0,
  "Mini pastel zanahoria": 0,
  "Mini pastel red velvet": 0,
  "Mini pastel Nutella": 0,
  "Mini pastel dulce de leche": 0,
  "Carlota de limón": 0,
  "Pastel red velvet": 0
};

const savedInventory = JSON.parse(localStorage.getItem("inventory")) || {};
let inventory = { ...defaultInventory, ...savedInventory };

let originalInventory = JSON.parse(JSON.stringify(inventory));
let updatedItems = new Set();

function saveInventory() {
  localStorage.setItem("inventory", JSON.stringify(inventory));
}

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
      { name: "Canela", price: 49.00, img: "canela.jpg" },
      { name: "Fresa", price: 49.00, img: "fresa.jpg" }
    ]
  },
  {
    category: "✨ Especiales",
    items: [
      { name: "Crookie", price: 65.00, img: "crookie.jpg" },
      { name: "Rol de canela", price: 60.00, img: "rol.jpg" },
      { name: "Brownie", price: 40.00, img: "brownie.jpg" },
      { name: "Cookie bites", price: 100.00, img: "bites.jpg" },
      { name: "Besos de nuez", price: 90.00, img: "besosnuez.jpg" }
    ]
  },
  {
    category: "🍰 Postres",
    items: [
      { name: "Mini pastel zanahoria", price: 220.00, img: "cake_carrot.jpg" },
      { name: "Mini pastel red velvet", price: 220.00, img: "cake_velvet.jpg" },
      { name: "Mini pastel Nutella", price: 220.00, img: "cake_gvan.jpg" },
      { name: "Mini pastel dulce de leche", price: 220.00, img: "cake_fvan.jpg" },
      { name: "Carlota de limón", price: 30.00, img: "carlota.jpg" },
      { name: "Pastel red velvet", price: 80.00, img: "pastel_rv.jpg" }
    ]
  }
];

let cart = JSON.parse(localStorage.getItem("cart")) || [];

// Render productos
function renderProducts() {
  const container = document.getElementById("products");
  container.innerHTML = "";
  const hiddenItems = getHiddenItems();

  menu.forEach(cat => {
    const section = document.createElement("div");
    section.className = "category";

    section.innerHTML = `<h2>${cat.category}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid";

    cat.items.forEach(item => {
      if (hiddenItems.includes(item.name)) return;

      const stock = inventory[item.name] ?? 0;
      const isOut = stock === 0;
      const isLow = stock > 0 && stock <= 3;

      const safeId = item.name.replace(/[^a-zA-Z0-9]/g, '-');
      const div = document.createElement("div");
      div.className = "product" + (isLow ? " low-stock-product" : "") + (isOut ? " out-of-stock" : "");
      div.innerHTML = `
        <img src="${item.img}">
        <h3>${esc(item.name)}</h3>
        <p>$${parseFloat(item.price).toFixed(2)}</p>
        <p id="stock-${safeId}" style="margin:0;font-size:12px;color:var(--text-muted);">Stock: ${stock}${isLow ? ' <span class="low-stock-badge">⚠ Poco</span>' : ""}${isOut ? ' <span class="low-stock-badge" style="background:#e53935;">Sin stock</span>' : ""}</p>
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
  ]
};

// Carrito
function addToCart(item) {
  const inCart = cart.filter(i => i.name === item.name).length;
  if (inCart >= (inventory[item.name] ?? 0)) {
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
  const buttonsHTML = extras.map(e => `
    <button
      class="extra-btn ${e.price === 0 ? 'natural' : 'paid'}"
      onclick="confirmExtra(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${JSON.stringify(e).replace(/"/g, '&quot;')})"
    >
      ${esc(e.name)}
      <span class="extra-price">${e.price === 0 ? 'Incluido' : '+$' + e.price.toFixed(2)}</span>
    </button>
  `).join("");

  openModal(`
    <h3 style="margin-top:0;">🥐 ${esc(item.name)}</h3>
    <p style="color:#666;font-size:14px;margin:4px 0 8px;">Elige el betún:</p>
    <div class="extras-grid">${buttonsHTML}</div>
    <button onclick="closeModal()" style="background:#f5f5f5;margin-top:14px;">Cancelar</button>
  `);
}

function confirmExtra(item, extra) {
  closeModal();
  pushCartItem(item, extra.price > 0 ? extra : null);
}

// Assigns a unique cartId so each rol is independent in the cart
let _cartIdCounter = 0;

function pushCartItem(item, extra) {
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
    if (totalInCart >= (inventory[name] ?? 0)) {
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

function openModal(html) {
  const modal = document.getElementById("modal");
  const content = document.getElementById("modalContent");

  content.innerHTML = html;
  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

function openPaymentOptions() {
  const { finalTotal } = computeCartTotals();
  openModal(`
    <h3>Cobrar: $${finalTotal.toFixed(2)}</h3>
    <button class="btn-primary" onclick="handleCash(${finalTotal})">Efectivo</button>
    <button class="btn-brand" onclick="handleTransfer(${finalTotal})">Transferencia</button>
    <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
  `);
}

function handleCash(total) {
  const denominations = [50, 100, 200, 500];

  openModal(`
    <h3 style="margin-top:0;">💵 Pago en efectivo</h3>
    <p style="color:var(--text-muted);font-size:13px;margin:4px 0 8px;">Total: <strong>$${total.toFixed(2)}</strong></p>

    <div class="denom-grid">
      ${denominations.map(d => `
        <button class="denom-btn" onclick="selectDenom(${d}, ${total})">$${d}</button>
      `).join('')}
    </div>

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

function selectDenom(value, total) {
  document.querySelectorAll('.denom-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.denom-btn').forEach(b => {
    if (b.textContent.trim() === `$${value}`) b.classList.add('selected');
  });

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
  showFinalStep(total, "transfer", 0);
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

  // Fetch folio in background while user sees the confirmation
  const now = new Date();
  const dateStr = now.getFullYear().toString().slice(2)
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0');
  DataStore.getNextFolio(dateStr).then(folio => {
    if (currentSale) currentSale.folio = folio;
  });

  openModal(`
    <h3>Total: $${total}</h3>

    ${method === "cash" ? `<p>Cambio: $${change}</p>` : ""}

    <button onclick="finalizeSale()">
      Finalizar
    </button>
    <button onclick="openPaymentOptions(${total})">Regresar</button>
  `);
}

async function finalizeSale() {
  if (!currentSale) {
    showToast("Error en la venta");
    return;
  }

  const itemCounts = {};
  currentSale.items.forEach(item => {
    itemCounts[item.name] = (itemCounts[item.name] || 0) + 1;
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

  confirmModal("¿Enviar ticket al cliente?", () => {
    generateTicket(sale);
  });

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
          <td>${sale.method === "cash" ? "Efectivo" : "Transferencia"}</td>
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
        <strong style="font-size:13px;">🎟 RIFA 🎟</strong><br>
        <span style="font-size:11px;">¡Ganaste <strong>${totalRaffleEntries}</strong> ${totalRaffleEntries === 1 ? 'entrada' : 'entradas'}!</span><br>
        ${rafflePromos.map(p => `<span style="font-size:10px;opacity:0.7;">${esc(p.name)} (×${p.raffleEntries})</span>`).join('<br>')}
      </div>
      ` : ''}

      <br><br>
      <div style="text-align:center;font-size:10px;">
        ¡Gracias por su compra! ❤️<br><br>
        Tel. 229 157 4962<br>
        @postremio.mx
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

    html2canvas(ticketElement, {
      scale: 2,
      useCORS: true
    }).then(canvas => {

      canvas.toBlob(blob => {
        const file = new File([blob], "ticket_postremio.png", { type: "image/png" });

        // Best path: Web Share API with file (works on Android Chrome and iOS Safari)
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            title: "Ticket Postre Mío",
            text: "Gracias por tu compra en Postre Mío ❤️",
            files: [file]
          }).catch(() => {}); // user cancelled — do nothing
        } else {
          // Fallback: download image, then open WhatsApp with a message
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `ticket_postremio_${Date.now()}.png`;
          link.click();
          URL.revokeObjectURL(url);

          const message = encodeURIComponent("Gracias por tu compra en Postre Mío ❤️\n(Adjunta la imagen del ticket que se acaba de descargar)");
          setTimeout(() => window.open(`https://wa.me/?text=${message}`, "_blank"), 800);
        }
      }, "image/png");

    });

  }, 100);
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

document.addEventListener("click", function(e) {
  const menu = document.getElementById("sideMenu");
  const btn = document.querySelector(".menu-btn");

  if (!menu || !btn) return;

  if (!menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove("open");
  }
});

function showPage(page) {
  const inventoryVisible = document.getElementById('inventoryPage').style.display !== 'none';
  if (page !== 'inventory' && inventoryVisible && updatedItems.size > 0) {
    document.getElementById('sideMenu').classList.remove('open');
    openModal(`
      <h3 style="margin-top:0;">Cambios sin guardar</h3>
      <p style="color:var(--text-muted);font-size:14px;">Tienes cambios de inventario sin guardar.</p>
      <button class="btn-brand" id="_navSave">💾 Guardar y salir</button>
      <button class="btn-danger" id="_navDiscard">Descartar cambios</button>
      <button class="btn-secondary" id="_navCancel">Cancelar</button>
    `);
    document.getElementById('_navSave').onclick = async () => {
      await saveInventoryChanges();
      closeModal();
      showPage(page);
    };
    document.getElementById('_navDiscard').onclick = () => {
      Object.keys(originalInventory).forEach(k => { inventory[k] = originalInventory[k]; });
      updatedItems.clear();
      _pendingRestockByName = {};
      saveInventory();
      closeModal();
      showPage(page);
    };
    document.getElementById('_navCancel').onclick = () => closeModal();
    return;
  }

  ["posPage","inventoryPage","historyPage","promoPage","pendingPage","mermaPage"]
    .forEach(id => document.getElementById(id).style.display = "none");
  ["promoFab","mermaFab"]
    .forEach(id => document.getElementById(id).style.display = "none");

  if (page === "pos") {
    document.getElementById("posPage").style.display = "block";
  }
  if (page === "inventory") {
    document.getElementById("inventoryPage").style.display = "block";
    originalInventory = JSON.parse(JSON.stringify(inventory));
    updatedItems.clear();
    _pendingRestockByName = {};
    updateSaveBtn();
    renderProducts();
    renderInventory();
    renderRestockLogFromFirestore();
  }
  if (page === "history") {
    document.getElementById("historyPage").style.display = "block";
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
  if (page === "mermas") {
    document.getElementById("mermaPage").style.display = "block";
    document.getElementById("mermaFab").style.display = "flex";
    renderMermaLog();
  }

  if (page !== "inventory") {
    hideModeActive = false;
    updatedItems.clear();
  }
  if (page !== "history") {
    editModeActive = false;
  }
  document.getElementById("sideMenu").classList.remove("open");
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

  validNames.forEach(name => {
    if (!(name in inventory)) inventory[name] = defaultInventory[name];

    const isHidden = hiddenItems.includes(name);

    // In normal mode, skip hidden items
    if (!hideModeActive && isHidden) return;

    const qty = inventory[name];
    const isLow = qty > 0 && qty <= 3;
    const isOut = qty === 0;
    const menuItem = menu.flatMap(c => c.items).find(i => i.name === name);

    let cardClass = "inventory-card";
    if (hideModeActive) cardClass += " hide-mode-target";
    if (isHidden) cardClass += " hidden-item";
    else if (updatedItems.has(name)) cardClass += " updated";
    else if (isOut || isLow) cardClass += " low-stock";

    const div = document.createElement("div");
    div.className = cardClass;

    if (hideModeActive) {
      div.onclick = () => toggleItemHidden(name);
      div.innerHTML = `
        <div class="inv-name">${esc(name)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;display:flex;align-items:center;gap:4px;">${isHidden ? `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Oculto — toca para mostrar` : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Visible — toca para ocultar`}</div>
      `;
    } else {
      div.innerHTML = `
        <div class="inv-name">${esc(name)}</div>
        <div class="inv-qty">Stock: ${qty}${isLow && !isOut ? ' <span class="low-stock-badge">⚠ Poco</span>' : ""}${isOut ? ' <span class="low-stock-badge" style="background:#e53935;">Sin stock</span>' : ""}</div>
        <div class="inv-controls">
          <button
            style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
            onpointerdown="startHold('${name.replace(/'/g, "\\'")}', -1)"
            onpointerup="stopHold()"
            onpointerleave="stopHold()"
            oncontextmenu="return false"
            ontouchstart="this.ontouchend=stopHold;return true;"
          >−</button>
          <button
            style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
            onpointerdown="startHold('${name.replace(/'/g, "\\'")}', 1)"
            onpointerup="stopHold()"
            onpointerleave="stopHold()"
            oncontextmenu="return false"
            ontouchstart="this.ontouchend=stopHold;return true;"
          >+</button>
        </div>
      `;
    }

    container.appendChild(div);
  });
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

function openPricesModal() {
  const productRows = menu.map(cat => {
    const rows = cat.items.map(item => `
      <div class="costs-row">
        <span>${esc(item.name)}</span>
        <span style="color:var(--text-muted);font-size:12px;">$</span>
        <input type="number" inputmode="decimal" min="0" step="1"
          value="${item.price}"
          onfocus="this.select()"
          onchange="updatePrice('${item.name.replace(/'/g, "\\'")}', this.value)">
      </div>
    `).join('');
    return `<div style="font-size:12px;font-weight:700;margin:12px 0 6px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">${esc(cat.category)}</div>${rows}`;
  }).join('');

  const extrasRows = Object.entries(ITEM_EXTRAS).map(([productName, extras]) => {
    const rows = extras.map(e => `
      <div class="costs-row">
        <span>${esc(e.name)}</span>
        <span style="color:var(--text-muted);font-size:12px;">$</span>
        <input type="number" inputmode="decimal" min="0" step="1"
          value="${e.price}"
          onfocus="this.select()"
          onchange="updateExtrasPrice('${productName.replace(/'/g, "\\'")}', '${e.name.replace(/'/g, "\\'")}', this.value)">
      </div>
    `).join('');
    return `<div style="font-size:12px;font-weight:700;margin:12px 0 6px;color:var(--text-muted);">+ Extras: ${esc(productName)}</div>${rows}`;
  }).join('');

  openModal(`
    <h3 style="margin-top:0;">💲 Precios</h3>
    <div class="costs-section" style="margin-top:8px;max-height:55vh;overflow-y:auto;">
      ${productRows}
      ${extrasRows ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">${extrasRows}</div>` : ''}
    </div>
    <button class="btn-secondary" style="width:100%;margin-top:12px;" onclick="closeModal()">Cerrar</button>
  `);
}

function updateExtrasPrice(productName, extraName, value) {
  const price = Math.max(0, parseFloat(value));
  if (isNaN(price)) return;
  if (ITEM_EXTRAS[productName]) {
    const extra = ITEM_EXTRAS[productName].find(e => e.name === extraName);
    if (extra) extra.price = price;
  }
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
  updateSaveBtn();
}

function updateSaveBtn() {
  const show = updatedItems.size > 0;
  const btn = document.getElementById('saveInventoryBtn');
  const cancelBtn = document.getElementById('cancelInventoryBtn');
  if (btn) btn.style.display = show ? 'flex' : 'none';
  if (cancelBtn) cancelBtn.style.display = show ? 'flex' : 'none';
}

function cancelInventoryChanges() {
  Object.keys(originalInventory).forEach(k => { inventory[k] = originalInventory[k]; });
  updatedItems.clear();
  _pendingRestockByName = {};
  saveInventory();
  updateSaveBtn();
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
    updateSaveBtn();
    renderInventory();
    renderProducts();
    showToast('Inventario reseteado a 0');
  });
}

async function saveInventoryChanges() {
  const btn = document.getElementById('saveInventoryBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    await Promise.all([...updatedItems].map(name => DataStore.setStock(name, inventory[name])));

    const restockDate = new Date().toLocaleString();
    await Promise.all(
      Object.entries(_pendingRestockByName)
        .filter(([, qty]) => qty > 0)
        .map(([name, qty]) => DataStore.addRestock({ date: restockDate, name, qty }))
    );

    originalInventory = JSON.parse(JSON.stringify(inventory));
    updatedItems.clear();
    _pendingRestockByName = {};

    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar'; }
    saveInventory();
    updateSaveBtn();
    renderInventory();
    await renderRestockLogFromFirestore();
    showToast('Inventario guardado ✅');
  } catch (e) {
    showToast('Error al guardar. Intenta de nuevo.');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar'; }
  }
}

// ── HIDING MODE ──────────────────────────────
let hideModeActive = false;

function getHiddenItems() {
  return JSON.parse(localStorage.getItem("hiddenItems")) || [];
}

function saveHiddenItems(list) {
  localStorage.setItem("hiddenItems", JSON.stringify(list));
  DataStore.saveHiddenItems(list);
}

const _SVG_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _SVG_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function toggleHideMode() {
  hideModeActive = !hideModeActive;
  const btn = document.getElementById("hideModeBtn");
  if (btn) {
    btn.innerHTML = hideModeActive ? _SVG_EYE_OFF : _SVG_EYE;
    btn.classList.toggle("active", hideModeActive);
  }
  renderInventory();
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
  }
  saveHiddenItems(hidden);
  renderInventory();
  renderProducts();
}

// ── EDIT MODE ────────────────────────────────
let editModeActive = false;

function toggleEditMode() {
  editModeActive = !editModeActive;
  const btn = document.getElementById("editModeBtn");
  if (btn) btn.classList.toggle("active", editModeActive);
  renderHistory();
}

function openEditSale(saleId) {
  const sale = (_historyData || []).find(s => s._id === saleId);
  if (!sale) return;

  openModal(`
    <h3 style="margin-top:0;">✏️ Editar venta</h3>
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;">Folio: ${esc(sale.folio || '—')} · ${esc(sale.date)}</p>
    <div class="promo-form">
      <label>Total ($)</label>
      <input id="edit-total" type="number" inputmode="decimal" value="${parseFloat(sale.total).toFixed(2)}" onfocus="this.select()">

      <label>Método de pago</label>
      <select id="edit-method">
        <option value="cash"     ${sale.method === 'cash'     ? 'selected' : ''}>Efectivo</option>
        <option value="transfer" ${sale.method === 'transfer' ? 'selected' : ''}>Transferencia</option>
      </select>

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

  await DataStore.updateSale(saleId, updates);
  closeModal();
  showToast("Venta actualizada ✅");
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
        <div style="font-size:36px;margin-bottom:10px;">🧾</div>
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
            <span>🎟 ${esc(p.name)} (×${p.raffleEntries})</span>
            <span></span>
            <span style="text-align:right;">¡Rifa!</span>
          </div>
        `;
      } else {
        let label = `🏷 ${esc(p.name)}`;
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
        ${sale.folio ? `<div style="font-size:11px;color:var(--text-muted);">Folio: ${esc(sale.folio)}</div>` : ''}
      </div>

      <div class="history-items">
        ${itemsHTML}
      </div>

      <div class="history-footer">
        <div class="history-total">Total: $${parseFloat(finalTotal).toFixed(2)}</div>
        <div style="display:flex;gap:6px;">
          ${editModeActive ? `<button class="edit-mode-btn active" onclick="openEditSale('${saleId}')">✏️</button>` : ''}
          <button onclick="generateTicket((_historyData.find(s=>s._id==='${saleId}')))">🧾</button>
          <button class="delete-btn" onclick="deleteSale('${saleId}')">🗑️</button>
        </div>
      </div>
    `;

    container.appendChild(div);
  });

  updateCutBtnWithData(data);
}

function updateCutBtnWithData(data) {
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
      if (!(item.name in defaultInventory)) return;
      if (!inventory[item.name]) inventory[item.name] = 0;
      inventory[item.name]++;
      DataStore.incrementStock(item.name, 1);
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

  await exportToExcel(history);
  clearSales(count, total);
}

function clearSales(count, total) {
  confirmModal("¿Cerrar caja y borrar ventas?", async () => {
    await DataStore.clearDayData();

    await renderHistoryFromFirestore();

    openModal(`
      <h3 style="margin-top:0;">Corte del día</h3>
      <p>Ventas: <strong>${count}</strong></p>
      <p>Total: <strong>$${parseFloat(total).toFixed(2)}</strong></p>
      <button class="btn-primary" onclick="closeModal()">Cerrar</button>
    `);
  });
}

async function exportToExcel(historyOverride) {
  const history = historyOverride || await DataStore.getSales();
  const mermas  = await DataStore.getMermas();

  // All products from menu for consistent columns across sales and mermas
  const products = menu.flatMap(c => c.items).map(i => i.name);

  // ── HEADER ──
  let csv = `Folio,Fecha,Método de pago,Total,`;
  products.forEach(p => { csv += `"${p}",`; });
  csv += "\n";

  // ── SALE ROWS ──
  history.forEach(sale => {
    const folio  = sale.folio || "";
    const date   = sale.date ? sale.date.split(",")[0].trim() : "";
    const method = sale.method === "cash" ? "Efectivo" : "Transferencia";
    let row = `${folio},${date},${method},${sale.total},`;
    products.forEach(p => {
      let qty = 0;
      sale.items.forEach(item => { if (item.name === p) qty++; });
      row += qty + ",";
    });
    csv += row + "\n";
  });

  // ── SUMMARY ROWS ──
  csv += "\n";

  // Sold totals — sales only, mermas not counted
  let soldRow = `,,,Vendidos,`;
  products.forEach(p => {
    let total = 0;
    history.forEach(sale => {
      sale.items.forEach(item => { if (item.name === p) total++; });
    });
    soldRow += total + ",";
  });
  csv += soldRow + "\n";

  // Merma totals per product
  const mermaTotals = {};
  mermas.forEach(m => { mermaTotals[m.name] = (mermaTotals[m.name] || 0) + m.qty; });

  let mermaRow = `,,,Mermas,`;
  products.forEach(p => { mermaRow += (mermaTotals[p] || 0) + ","; });
  csv += mermaRow + "\n";

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `postre_mio_corte_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── COSTS ENGINE ──────────────────────────────

let _costsCache = {};

async function openCostsModal() {
  showSpinner();
  _costsCache = await DataStore.getCosts().finally(hideSpinner);
  const allItems = menu.flatMap(c => c.items);
  const rows = allItems.map(item => `
    <div class="costs-row">
      <span>${esc(item.name)}</span>
      <span style="color:var(--text-muted);font-size:12px;">$</span>
      <input
        type="number"
        inputmode="decimal"
        min="0"
        step="0.01"
        value="${_costsCache[item.name] !== undefined ? _costsCache[item.name] : ''}"
        placeholder="0.00"
        onfocus="this.select()"
        onchange="updateCost('${item.name.replace(/'/g, "\\'")}', this.value)"
      >
    </div>
  `).join('');
  openModal(`
    <h3 style="margin-top:0;">💰 Costo por producto</h3>
    <div class="costs-section" style="margin-top:8px;max-height:55vh;overflow-y:auto;">${rows}</div>
    <button class="btn-secondary" style="width:100%;margin-top:12px;" onclick="closeModal()">Cerrar</button>
  `);
}

function updateCost(name, value) {
  const cost = Math.max(0, parseFloat(value));
  if (isNaN(cost)) {
    delete _costsCache[name];
  } else {
    _costsCache[name] = cost;
  }
  DataStore.saveCosts(_costsCache);
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

function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  setTimeout(() => {
    toast.remove();
  }, 2500);
}

function confirmModal(message, onConfirm) {
  openModal(`
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
  return menu.flatMap(c => c.items);
}

function allCategories() {
  return menu.map(c => c.category);
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
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="cart-item-name">${esc(item.name)}</div>
      <div class="cart-item-price">$${basePrice.toFixed(2)}${item.extra ? ` + $${item.extra.price.toFixed(2)}` : ''} × ${item.qty}</div>
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
      line.innerHTML = `<span>🎟 ${esc(a.promo.name)} (×${a.raffleEntries})</span><span style="color:var(--green);">¡Rifa!</span>`;
    } else {
      let label = `🏷 ${esc(a.promo.name)}`;
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
    const remaining = (inventory[item.name] ?? 0) - inCart;
    const isLow = remaining > 0 && remaining <= 3;
    const isOut = remaining <= 0;
    el.innerHTML = `Stock: ${Math.max(0, remaining)}${isLow ? ' <span class="low-stock-badge">⚠ Poco</span>' : ''}${isOut ? ' <span class="low-stock-badge" style="background:#e53935;">Sin stock</span>' : ''}`;
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
  return { free_item: "🎁 Gratis", fixed_price: "💰 Precio fijo", pct_discount: "% Descuento", raffle: "🎟 Rifa" }[type] || type;
}

function promoTypeClass(type) {
  return { free_item: "type-free", fixed_price: "type-price", pct_discount: "type-pct", raffle: "type-raffle" }[type] || "";
}

function promoDescription(p) {
  const scopeStr = p.scope === "any" ? "cualquier producto"
    : p.scope === "category" ? `categoría "${p.scopeValue}"`
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
        <div class="promo-empty-icon">🏷️</div>
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
          ${p.active ? "✅ Activa" : "⏸ Inactiva"}
        </button>
        <button class="delete-btn" onclick="deletePromo(${idx})">🗑️</button>
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
    .map(i => `<option value="${i.name}">${i.name}</option>`).join("");
  const categoryOptions = allCategories()
    .map(c => `<option value="${c}">${c}</option>`).join("");

  openModal(`
    <h3 style="margin-top:0;">Nueva promoción</h3>
    <div class="promo-form">

      <label>Nombre de la promoción</label>
      <input id="pf-name" type="text" placeholder="Ej: 6 galletas por $200">

      <label>Tipo de descuento</label>
      <select id="pf-type" onchange="onPromoTypeChange()">
        <option value="free_item">🎁 Producto gratis</option>
        <option value="fixed_price">💰 Precio fijo por grupo</option>
        <option value="pct_discount">% Descuento</option>
        <option value="raffle">🎟 Entrada de rifa</option>
      </select>

      <label>Aplica a</label>
      <select id="pf-scope" onchange="onPromoScopeChange()">
        <option value="any">Cualquier producto</option>
        <option value="category">Categoría específica</option>
        <option value="product">Producto específico</option>
      </select>

      <div id="pf-scope-value-wrap" style="display:none;">
        <label id="pf-scope-value-label">Producto</label>
        <select id="pf-scope-product">${productOptions}</select>
        <select id="pf-scope-category" style="display:none;">${categoryOptions}</select>
      </div>

      <div id="pf-trigger-mode-wrap" style="display:none;">
        <label>Condición de la rifa</label>
        <select id="pf-trigger-mode" onchange="onTriggerModeChange()">
          <option value="qty">Por cantidad de productos</option>
          <option value="amount">Por monto gastado ($)</option>
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
  showToast(`Promoción "${name}" creada ✅`);
  renderPromos();
  renderCart();
}

// ─────────────────────────────────────────────
//  RESTOCK LOG ENGINE
// ─────────────────────────────────────────────

async function renderRestockLogFromFirestore() {
  showSpinner();
  const log = await DataStore.getRestockLog().finally(hideSpinner);
  renderRestockLogWithData(log);
}

function renderRestockLogWithData(log) {
  const section = document.getElementById("restockSection");
  const container = document.getElementById("restockList");
  if (!section || !container) return;

  if (!log.length) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";

  const rows = log.map(entry => `
    <div class="restock-entry">
      <div>
        <div style="font-weight:600;">${esc(entry.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${esc(entry.date)}</div>
      </div>
      <span class="restock-qty">+${entry.qty}</span>
    </div>
  `).join('');

  container.innerHTML = rows;
}

function clearRestockLog() {
  confirmModal("¿Borrar el registro de reabastecimientos?", async () => {
    await DataStore.clearRestockLog();
    renderRestockLogWithData([]);
  });
}

// ── Init (called after auth) ─────────────────
async function initApp() {
  // Load initial data from Firestore
  const [firestoreInv, firestorePrices, firestorePromos, firestoreHidden, firestoreExtrasPrices] = await Promise.all([
    DataStore.getInventory(),
    DataStore.getCustomPrices(),
    DataStore.getPromotions(),
    DataStore.getHiddenItems(),
    DataStore.getExtrasPrices(),
  ]);

  // Seed inventory if Firestore is empty (first run)
  if (Object.keys(firestoreInv).length === 0) {
    const batch = db.batch();
    Object.entries(defaultInventory).forEach(([name, qty]) => {
      batch.set(storeRef("inventory").doc(name), { qty });
    });
    await batch.commit();
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
    if (ITEM_EXTRAS[productName]) {
      const extra = ITEM_EXTRAS[productName].find(e => e.name === extraName);
      if (extra) extra.price = price;
    }
  });

  // Load promotions
  promotions = firestorePromos;

  // Store hidden items locally for quick access
  localStorage.setItem("hiddenItems", JSON.stringify(firestoreHidden));

  saveInventory();
  renderProducts();
  renderCart();

  startListeners();
}

// ─────────────────────────────────────────────
//  MERMA ENGINE
// ─────────────────────────────────────────────

const MERMA_REASONS = {
  merma:   { label: "Merma",            emoji: "🗑️" },
  muestra: { label: "Muestra/Degusto",  emoji: "🍽️" },
  regalo:  { label: "Regalo",           emoji: "🎁" },
  consumo: { label: "Consumo propio",   emoji: "👩‍🍳" },
};



function openMermaModal() {
  // Build category options
  const catOptions = menu.map(c =>
    `<option value="${c.category}">${c.category}</option>`
  ).join('');

  // Build item options for first category
  const firstCatItems = menu[0]?.items || [];
  const itemOptions = firstCatItems.map(i =>
    `<option value="${i.name}">${i.name} (stock: ${inventory[i.name] ?? 0})</option>`
  ).join('');

  const reasonOptions = Object.entries(MERMA_REASONS).map(([k, v]) =>
    `<option value="${k}">${v.emoji} ${v.label}</option>`
  ).join('');

  openModal(`
    <h3 style="margin-top:0;">📉 Registrar merma</h3>
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

function onMermaCatChange() {
  const cat = document.getElementById('merma-cat')?.value;
  const catData = menu.find(c => c.category === cat);
  const itemSel = document.getElementById('merma-item');
  if (!catData || !itemSel) return;
  itemSel.innerHTML = catData.items.map(i =>
    `<option value="${i.name}">${i.name} (stock: ${inventory[i.name] ?? 0})</option>`
  ).join('');
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
        <div style="font-size:36px;margin-bottom:10px;">📋</div>
        <p>No hay mermas registradas.</p>
      </div>
    `;
    return;
  }

  const rows = mermas.map(m => {
    const r = MERMA_REASONS[m.reason] || { label: m.reason, emoji: "📦" };
    return `
      <div class="merma-entry">
        <div>
          <div style="font-weight:600;">${esc(m.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${esc(m.date)}</div>
        </div>
        <span class="merma-reason ${m.reason}">${r.emoji} ${r.label}</span>
        <span class="merma-qty">−${m.qty}</span>
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

// ─────────────────────────────────────────────
//  PENDING ORDERS ENGINE
// ─────────────────────────────────────────────



function saveAsPending() {
  if (cart.length === 0) {
    showToast("El carrito está vacío");
    return;
  }

  openModal(`
    <h3 style="margin-top:0;">📋 Guardar pedido</h3>
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
      if (inventory[item.name] > 0) {
        inventory[item.name]--;
        DataStore.setStock(item.name, inventory[item.name]);
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
      inventory[item.name] = (inventory[item.name] ?? 0) + 1;
      DataStore.setStock(item.name, inventory[item.name]);
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
        inventory[item.name] = (inventory[item.name] ?? 0) + 1;
        DataStore.setStock(item.name, inventory[item.name]);
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

  if (!list.length) {
    container.innerHTML = `
      <div class="pending-empty">
        <div style="font-size:36px;margin-bottom:10px;">📋</div>
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
      ${order.note ? `<div class="pending-note">📝 ${esc(order.note)}</div>` : ''}
      <div class="pending-items">${esc(summary)}</div>
      <div class="pending-footer">
        <div class="pending-total">$${parseFloat(order.total).toFixed(2)}</div>
        <div class="pending-actions">
          <button class="btn-brand" onclick="loadPending('${order._id}')">🛒 Cobrar</button>
          <button class="delete-btn" onclick="deletePending('${order._id}')">🗑️</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}
