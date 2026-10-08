// ============================================================
// FarmDirect / Agrimarket - Frontend logic
// Talks to the Express backend in /backend via fetch().
// ============================================================

// Change this if your backend runs somewhere other than localhost:4000
const API_BASE_URL = window.API_BASE_URL || "http://localhost:4000/api";

let navigationStack = ["screen-home"];
let cart = []; // { product, quantity } - kept client-side for the session
let currentUploadedImageData = null;
let currentUser = null; // { id, name, email, role, phone, avatar, status }
let authToken = localStorage.getItem("agrimarket_token") || null;
let pendingLoginEmail = null;
let currentSelectedProductForDetail = null;
let checkoutMap = null;
let checkoutMarker = null;
let mediaStream = null;

let activeOrderId = null;
let currentCoords = [16.3067, 80.4365]; // Guntur, AP - used as the default map center

// -----------------------------
// API helper
// -----------------------------
async function apiRequest(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    if (!authToken) throw new Error("You need to be logged in for that.");
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (networkErr) {
    throw new Error(
      "Could not reach the backend server. Is it running at " + API_BASE_URL + "?"
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    // no JSON body
  }

  if (!response.ok) {
    const message = (data && (data.message || data.error)) || `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

function showApiError(message) {
  const banner = document.getElementById("global-api-error");
  banner.textContent = "⚠ " + message;
  banner.style.display = "block";
  window.scrollTo(0, 0);
  clearTimeout(showApiError._t);
  showApiError._t = setTimeout(() => (banner.style.display = "none"), 6000);
}

function setButtonLoading(btnId, loading, loadingLabel, defaultLabel) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="spinner-inline"></span>${loadingLabel}` : defaultLabel;
}

// -----------------------------
// Navigation
// -----------------------------
function showScreen(screenId, isBack = false) {
  if (!isBack && navigationStack[navigationStack.length - 1] !== screenId) {
    navigationStack.push(screenId);
  }
  if (screenId === "screen-cart") renderCart();
  if (screenId === "screen-products") loadMarketplace();
  if (screenId === "screen-my-crops") loadFarmerInventory();
  if (screenId === "screen-admin-dash") loadAdminDashboard();
  if (screenId === "screen-farmer-dash") loadFarmerDashboard();
  if (screenId === "screen-orders") loadBuyerOrders();
  if (screenId === "screen-checkout") setTimeout(initCheckoutMap, 200);

  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
  window.scrollTo(0, 0);
}

function goBack() {
  closeCamera();
  if (navigationStack.length > 1) {
    navigationStack.pop();
    showScreen(navigationStack[navigationStack.length - 1], true);
  } else {
    showScreen("screen-home", true);
  }
}

function logout() {
  currentUser = null;
  authToken = null;
  localStorage.removeItem("agrimarket_token");
  cart = [];
  updateCartCounts();
  pendingLoginEmail = null;
  cancelOTPStep();
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  navigationStack = ["screen-home"];
  showScreen("screen-login");
}

// -----------------------------
// Auth: register / login / OTP
// -----------------------------
async function handleRegistration() {
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim().toLowerCase();
  const phone = document.getElementById("reg-phone").value.trim();
  const role = document.getElementById("register-role-select").value;
  const password = document.getElementById("reg-password").value;

  setButtonLoading("register-submit-btn", true, "Creating account...", "Create Account");
  try {
    const result = await apiRequest("/auth/register", {
      method: "POST",
      body: { name, email, phone, role, password }
    });

    document.getElementById("reg-name").value = "";
    document.getElementById("reg-email").value = "";
    document.getElementById("reg-phone").value = "";
    document.getElementById("reg-password").value = "";

    if (result.pendingApproval) {
      showScreen("screen-pending-approval");
    } else {
      authToken = result.token;
      currentUser = result.user;
      localStorage.setItem("agrimarket_token", authToken);
      alert("Buyer registration successful! Welcome.");
      showScreen("screen-buyer-dash");
    }
  } catch (err) {
    showApiError(err.message);
  } finally {
    setButtonLoading("register-submit-btn", false, "", "Create Account");
  }
}

async function initiateLogin() {
  const selectedRole = document.getElementById("login-role-select").value;
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;

  setButtonLoading("login-submit-btn", true, "Sending code...", "Send Verification Code →");
  try {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: { email, password, role: selectedRole }
    });

    pendingLoginEmail = email;
    document.getElementById("login-form-step1").style.display = "none";
    document.getElementById("login-form-step2").style.display = "block";
    document.getElementById("otp-sent-email").textContent = result.otpDeliveredTo;
    // devOtp is only present because the backend has no real email/SMS provider wired up yet.
    document.getElementById("mock-inbox-preview").textContent = result.devOtp
      ? `Verification Code: ${result.devOtp}`
      : "";
    document.getElementById("login-otp-input").value = "";

    if (result.devOtp) {
      alert(`Verification Code Sent!\nCode: ${result.devOtp}\n(Sent to: ${result.otpDeliveredTo})`);
    }
  } catch (err) {
    if (err.data && err.data.error === "pending_approval") {
      showScreen("screen-pending-approval");
    } else {
      showApiError(err.message);
    }
  } finally {
    setButtonLoading("login-submit-btn", false, "", "Send Verification Code →");
  }
}

async function verifyLoginOTP() {
  const enteredCode = document.getElementById("login-otp-input").value.trim();
  try {
    const result = await apiRequest("/auth/verify-otp", {
      method: "POST",
      body: { email: pendingLoginEmail, otp: enteredCode }
    });

    authToken = result.token;
    currentUser = result.user;
    localStorage.setItem("agrimarket_token", authToken);
    pendingLoginEmail = null;
    cancelOTPStep();

    if (currentUser.role === "admin") showScreen("screen-admin-dash");
    else if (currentUser.role === "farmer") showScreen("screen-farmer-dash");
    else if (currentUser.role === "buyer") showScreen("screen-buyer-dash");
  } catch (err) {
    showApiError(err.message);
  }
}

function cancelOTPStep() {
  pendingLoginEmail = null;
  const s1 = document.getElementById("login-form-step1");
  const s2 = document.getElementById("login-form-step2");
  if (s1) s1.style.display = "block";
  if (s2) s2.style.display = "none";
}

// Try to restore a session on page load if a token is already stored.
async function restoreSession() {
  if (!authToken) return;
  try {
    const result = await apiRequest("/auth/me", { auth: true });
    currentUser = result.user;
  } catch (err) {
    authToken = null;
    localStorage.removeItem("agrimarket_token");
  }
}

// -----------------------------
// Camera (unchanged - browser API, no backend involved)
// -----------------------------
async function startLiveCamera() {
  try {
    const video = document.getElementById("camera-feed");
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = mediaStream;
    video.style.display = "block";
    document.getElementById("start-cam-btn").style.display = "none";
    document.getElementById("snap-btn").style.display = "inline-block";
    document.getElementById("stop-cam-btn").style.display = "inline-block";
  } catch (err) {
    alert("Camera access denied or unavailable.");
  }
}

function captureLiveSnapshot() {
  const video = document.getElementById("camera-feed");
  const canvas = document.getElementById("camera-canvas");
  if (!video || !video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  currentUploadedImageData = canvas.toDataURL("image/jpeg", 0.85);
  document.getElementById("image-preview").src = currentUploadedImageData;
  document.getElementById("image-preview-container").style.display = "block";
  closeCamera();
}

function closeCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  document.querySelectorAll(".camera-video").forEach((v) => (v.style.display = "none"));
  const startCam = document.getElementById("start-cam-btn");
  const snapCam = document.getElementById("snap-btn");
  const stopCam = document.getElementById("stop-cam-btn");
  if (startCam) startCam.style.display = "inline-block";
  if (snapCam) snapCam.style.display = "none";
  if (stopCam) stopCam.style.display = "none";
}

// -----------------------------
// Crops / Products (farmer + marketplace)
// -----------------------------
async function handleAddCrop() {
  const name = document.getElementById("crop-name").value.trim();
  const category = document.getElementById("crop-category").value;
  const price = parseFloat(document.getElementById("crop-price").value);
  const qty = parseInt(document.getElementById("crop-qty").value, 10);
  const grade = document.getElementById("crop-grade").value;
  const shelfLife = document.getElementById("crop-shelflife").value;
  const farm = document.getElementById("crop-farm").value.trim();
  const farmerPhone = document.getElementById("crop-farmer-phone").value.trim() || "8328205356";
  const image = currentUploadedImageData || undefined;

  setButtonLoading("add-crop-submit-btn", true, "Publishing...", "Publish Produce to Marketplace");
  try {
    const result = await apiRequest("/products", {
      method: "POST",
      auth: true,
      body: { name, category, price, qty, grade, shelfLife, farm, farmerPhone, image }
    });

    document.getElementById("add-crop-form").reset();
    document.getElementById("crop-farmer-phone").value = "8328205356";
    document.getElementById("image-preview-container").style.display = "none";
    currentUploadedImageData = null;
    closeCamera();

    alert(`"${result.product.name}" has been published to the marketplace!`);
    showScreen("screen-farmer-dash");
  } catch (err) {
    showApiError(err.message);
  } finally {
    setButtonLoading("add-crop-submit-btn", false, "", "Publish Produce to Marketplace");
  }
}

async function loadFarmerDashboard() {
  document.getElementById("active-crops-count").textContent = "…";
  try {
    const [productsResult, ordersResult] = await Promise.all([
      apiRequest("/products/mine", { auth: true }),
      apiRequest("/orders/farmer", { auth: true })
    ]);

    document.getElementById("active-crops-count").textContent = productsResult.products.length;

    let pendingEscrow = 0;
    let settledBank = 0;
    const tbody = document.getElementById("farmer-payouts-table-body");
    tbody.innerHTML = "";

    if (ordersResult.orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No order earnings yet.</td></tr>';
    } else {
      ordersResult.orders.forEach((o) => {
        if (!o.disbursed) pendingEscrow += parseFloat(o.farmerShare);
        else settledBank += parseFloat(o.farmerShare);

        const itemNames = o.items ? o.items.map((i) => i.name).join(", ") : "Produce";

        tbody.innerHTML += `
          <tr>
            <td><strong>#${o.id}</strong></td>
            <td>${itemNames}</td>
            <td>${o.buyerName}</td>
            <td style="color:var(--primary); font-weight:bold;">₹${parseFloat(o.farmerShare).toFixed(2)}</td>
            <td>
              <span class="badge ${o.disbursed ? "badge-success" : "badge-warning"}">
                ${o.disbursed ? "✓ Transferred to Bank" : "🏦 In Admin Escrow"}
              </span>
            </td>
            <td>
              <small style="color:${o.disbursed ? "#2e7d32" : "#f57c00"}; font-weight:600;">
                ${o.disbursed ? "Settled by Admin" : "Pending Admin Release"}
              </small>
            </td>
          </tr>
        `;
      });
    }

    document.getElementById("farmer-escrow-bal").textContent = `₹${pendingEscrow.toFixed(2)}`;
    document.getElementById("farmer-total-rev").textContent = `₹${settledBank.toFixed(2)}`;
  } catch (err) {
    showApiError(err.message);
  }
}

async function loadFarmerInventory() {
  const tbody = document.getElementById("farmer-inventory-body");
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading...</td></tr>';
  try {
    const result = await apiRequest("/products/mine", { auth: true });
    tbody.innerHTML = "";
    if (result.products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No crops listed yet.</td></tr>';
      return;
    }
    result.products.forEach((p) => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${p.name}</strong></td>
          <td>${p.category}</td>
          <td><span class="badge badge-success">${p.grade || "Grade A"}</span></td>
          <td>₹${p.price.toFixed(2)}</td>
          <td>${p.qty} kg</td>
          <td><span class="badge ${p.status === "Approved" ? "badge-success" : "badge-warning"}">${p.status}</span></td>
        </tr>
      `;
    });
  } catch (err) {
    showApiError(err.message);
  }
}

let allMarketplaceProducts = [];

async function loadMarketplace() {
  const grid = document.getElementById("marketplace-grid");
  grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Loading produce...</p>';
  try {
    const result = await apiRequest("/products");
    allMarketplaceProducts = result.products;
    renderMarketplace(allMarketplaceProducts);
  } catch (err) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Could not load the marketplace.</p>';
    showApiError(err.message);
  }
}

function renderMarketplace(list) {
  const grid = document.getElementById("marketplace-grid");
  grid.innerHTML = "";
  if (list.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">No produce items matching your query.</p>';
    return;
  }
  list.forEach((p) => {
    const farmerPhone = p.farmerPhone || "8328205356";
    const cleanPhone = farmerPhone.replace(/\D/g, "");
    grid.innerHTML += `
      <div class="card">
        <img src="${p.image}" alt="${p.name}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>${p.name}</h3>
          <span class="badge badge-success">${p.grade || "Grade A"}</span>
        </div>
        <p><strong>₹${p.price.toFixed(2)}</strong> / kg</p>
        <small>📍 ${p.farm}</small>
        <div style="margin: 8px 0; font-size: 0.85rem;">
          Contact: <strong>${farmerPhone}</strong>
        </div>
        <div style="display: flex; gap: 5px; margin-bottom: 8px;">
          <a href="https://wa.me/91${cleanPhone}?text=Hi,%20inquiring%20about%20${encodeURIComponent(p.name)}" target="_blank" class="btn btn-success" style="flex:1; text-align:center; padding:5px; font-size:0.8rem;">💬 WhatsApp</a>
          <a href="tel:${farmerPhone}" onclick="return handleCallClick('${farmerPhone}')" class="btn btn-outline" style="flex:1; text-align:center; padding:5px; font-size:0.8rem;">📞 Call</a>
        </div>
        <div class="card-actions">
          <button class="btn btn-outline" onclick="openProductDetails(${p.id})">Details</button>
          <button class="btn btn-secondary" onclick="addToCart(${p.id})">Add Cart</button>
        </div>
      </div>
    `;
  });
  updateCartCounts();
}

function filterMarketplace() {
  const q = document.getElementById("market-search").value.toLowerCase();
  const filtered = allMarketplaceProducts.filter(
    (p) => p.name.toLowerCase().includes(q) || p.farm.toLowerCase().includes(q)
  );
  renderMarketplace(filtered);
}

function openProductDetails(id) {
  const p = allMarketplaceProducts.find((prod) => prod.id === id);
  if (!p) return;
  currentSelectedProductForDetail = p;
  document.getElementById("detail-img").src = p.image;
  document.getElementById("detail-title").textContent = p.name;
  document.getElementById("detail-price").textContent = `₹${p.price.toFixed(2)} / kg`;
  document.getElementById("detail-farm").textContent = p.farm;
  document.getElementById("detail-grade").textContent = p.grade || "Grade A";
  document.getElementById("detail-shelflife").textContent = p.shelfLife || "5-7 Days";

  const farmerPhone = p.farmerPhone || "8328205356";
  const cleanPhone = farmerPhone.replace(/\D/g, "");
  document.getElementById("detail-farmer-phone").textContent = farmerPhone;
  document.getElementById("detail-whatsapp-btn").href = `https://wa.me/91${cleanPhone}?text=Hi,%20interested%20in%20${encodeURIComponent(p.name)}`;
  document.getElementById("detail-call-btn").href = `tel:${farmerPhone}`;
  document.getElementById("detail-call-btn").onclick = () => handleCallClick(farmerPhone);

  document.getElementById("detail-add-btn").onclick = () => addToCart(p.id);
  showScreen("screen-product-details");
}

// The `tel:` link on the "Call" button only does anything if the OS/browser has
// a phone-dialing app registered for it — true on virtually every phone, but
// NOT true by default on most desktop browsers (Windows/Mac/Linux Chrome, Edge,
// etc. with no Skype/Teams/dialer app configured). On desktop, clicking a tel:
// link there just does nothing, with no visible error - which looks broken even
// though the code is correct. This gives every click a visible result either way.
function handleCallClick(phone) {
  const isLikelyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (!isLikelyMobile) {
    // Desktop: tel: almost never has a handler, so don't rely on it silently
    // "working" - show the number immediately and offer to copy it.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(phone)
        .then(() => alert(`📞 Farmer's number: ${phone}\n\n(Copied to clipboard - your computer likely has no calling app to open this link with.)`))
        .catch(() => alert(`📞 Farmer's number: ${phone}`));
    } else {
      alert(`📞 Farmer's number: ${phone}`);
    }
    return false; // prevent the tel: navigation attempt on desktop
  }

  // Mobile: let the tel: link proceed normally and open the dialer.
  return true;
}

// -----------------------------
// Cart (client-side; orders are what get persisted server-side)
// -----------------------------
function addToCart(productId) {
  const prod = allMarketplaceProducts.find((p) => p.id === productId);
  if (!prod) return;
  const exist = cart.find((c) => c.product.id === productId);
  if (exist) exist.quantity += 1;
  else cart.push({ product: prod, quantity: 1 });
  updateCartCounts();
  alert(`${prod.name} added to cart.`);
}

function updateCartCounts() {
  const total = cart.reduce((s, i) => s + i.quantity, 0);
  document.querySelectorAll(".cart-count").forEach((el) => (el.textContent = total));
}

function renderCart() {
  const tbody = document.getElementById("cart-table-body");
  tbody.innerHTML = "";
  let subtotal = 0;

  if (cart.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Your cart is empty.</td></tr>';
  } else {
    cart.forEach((item, idx) => {
      const itemSub = item.product.price * item.quantity;
      subtotal += itemSub;
      tbody.innerHTML += `
        <tr>
          <td><strong>${item.product.name}</strong></td>
          <td>₹${item.product.price.toFixed(2)}</td>
          <td>
            <button class="qty-btn" onclick="updateQty(${idx}, -1)">-</button>
            ${item.quantity}
            <button class="qty-btn" onclick="updateQty(${idx}, 1)">+</button>
          </td>
          <td>₹${itemSub.toFixed(2)}</td>
          <td><button class="btn btn-danger" style="padding:2px 6px;" onclick="removeCart(${idx})">x</button></td>
        </tr>
      `;
    });
  }

  const DELIVERY_CHARGE = 40.0;
  const delivery = cart.length > 0 ? DELIVERY_CHARGE : 0;
  const gst = subtotal * 0.05;
  const grandTotal = subtotal + delivery + gst;

  document.getElementById("cart-subtotal").textContent = subtotal.toFixed(2);
  document.getElementById("cart-delivery").textContent = delivery.toFixed(2);
  document.getElementById("cart-cgst").textContent = (gst / 2).toFixed(2);
  document.getElementById("cart-sgst").textContent = (gst / 2).toFixed(2);
  document.getElementById("cart-grand-total").textContent = grandTotal.toFixed(2);

  document.getElementById("checkout-subtotal").textContent = subtotal.toFixed(2);
  document.getElementById("checkout-delivery").textContent = delivery.toFixed(2);
  document.getElementById("checkout-gst").textContent = gst.toFixed(2);
  document.getElementById("checkout-grand-total").textContent = grandTotal.toFixed(2);
  document.getElementById("checkout-button-total").textContent = grandTotal.toFixed(2);
}

function updateQty(idx, delta) {
  cart[idx].quantity += delta;
  if (cart[idx].quantity <= 0) cart.splice(idx, 1);
  renderCart();
  updateCartCounts();
}

function removeCart(idx) {
  cart.splice(idx, 1);
  renderCart();
  updateCartCounts();
}

function proceedToCheckout() {
  if (cart.length === 0) return alert("Your cart is empty.");
  if (currentUser) {
    document.getElementById("chk-name").value = currentUser.name || "Jane Buyer";
    document.getElementById("chk-phone").value = currentUser.phone || "8328205356";
  }
  showScreen("screen-checkout");
}

// -----------------------------
// Checkout / Orders
// -----------------------------
async function completeOrder() {
  const selectedPayment = document.querySelector('input[name="payment-method"]:checked').value;

  const address = {
    name: document.getElementById("chk-name").value,
    phone: document.getElementById("chk-phone").value,
    street: document.getElementById("chk-street").value,
    place: document.getElementById("chk-place").value,
    mandal: document.getElementById("chk-mandal").value,
    state: document.getElementById("chk-state").value,
    pincode: document.getElementById("chk-pincode").value
  };

  const items = cart.map((item) => ({ productId: item.product.id, qty: item.quantity }));

  setButtonLoading("checkout-submit-btn", true, "Processing payment...", "Pay to Admin Escrow & Place Order");
  try {
    const result = await apiRequest("/orders", {
      method: "POST",
      auth: true,
      body: { items, address, paymentMethod: selectedPayment }
    });

    alert(`Payment deposited successfully to Admin Escrow! Your order is placed.`);
    cart = [];
    updateCartCounts();
    showTracking(result.order.id, result.order.date, result.order.amount);
  } catch (err) {
    showApiError(err.message);
  } finally {
    setButtonLoading(
      "checkout-submit-btn",
      false,
      "",
      `Pay to Admin Escrow & Place Order (₹<span id="checkout-button-total">${document.getElementById("checkout-grand-total").textContent}</span>)`
    );
  }
}

async function loadBuyerOrders() {
  const tbody = document.getElementById("orders-table-body");
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading...</td></tr>';
  try {
    const result = await apiRequest("/orders/mine", { auth: true });
    renderBuyerOrdersTable(result.orders);
    document.getElementById("buyer-orders-status").textContent = `${result.orders.length} Order${result.orders.length === 1 ? "" : "s"}`;
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Could not load orders.</td></tr>';
    showApiError(err.message);
  }
}

function renderBuyerOrdersTable(orders) {
  const tbody = document.getElementById("orders-table-body");
  tbody.innerHTML = "";
  if (!orders || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No orders placed yet.</td></tr>';
    return;
  }
  orders.forEach((o) => {
    tbody.innerHTML += `
      <tr>
        <td><strong>#${o.id}</strong></td>
        <td>${new Date(o.date).toLocaleDateString()}</td>
        <td>₹${o.amount}</td>
        <td>
          <span class="badge ${o.disbursed ? "badge-success" : "badge-warning"}">
            ${o.disbursed ? "Delivered & Farmer Paid" : "In Transit (Admin Protected)"}
          </span>
        </td>
        <td>
          <button class="btn btn-outline" style="padding: 2px 8px; font-size: 0.8rem;" onclick="downloadOrderReceipt('${o.id}')">🧾 Receipt</button>
        </td>
        <td><button class="btn btn-secondary" style="padding: 2px 8px; font-size: 0.8rem;" onclick="showTracking('${o.id}', '${o.date}', '${o.amount}')">Track Order</button></td>
      </tr>
    `;
  });
}

function showTracking(id, date, grandTotal) {
  activeOrderId = id;
  document.getElementById("track-order-id").textContent = `Order #${id}`;
  document.getElementById("track-order-date").textContent = new Date(date).toLocaleString();
  showScreen("screen-tracking");
}

async function downloadOrderReceipt(orderId) {
  let o;
  try {
    const result = await apiRequest(`/orders/${orderId}`, { auth: true });
    o = result.order;
  } catch (err) {
    return showApiError(err.message);
  }

  let itemsRows = "";
  if (o.items && o.items.length > 0) {
    o.items.forEach((it) => {
      itemsRows += `
        <tr>
          <td style="padding:8px; border-bottom:1px solid #ddd;">${it.name}</td>
          <td style="padding:8px; border-bottom:1px solid #ddd; text-align:center;">${it.qty} kg</td>
          <td style="padding:8px; border-bottom:1px solid #ddd; text-align:right;">₹${it.price.toFixed(2)}</td>
          <td style="padding:8px; border-bottom:1px solid #ddd; text-align:right;">₹${it.subtotal.toFixed(2)}</td>
        </tr>
      `;
    });
  } else {
    itemsRows = `
      <tr>
        <td style="padding:8px; border-bottom:1px solid #ddd;">Agricultural Farm Produce Order</td>
        <td style="padding:8px; border-bottom:1px solid #ddd; text-align:center;">1 Unit</td>
        <td style="padding:8px; border-bottom:1px solid #ddd; text-align:right;">₹${o.subtotal || o.amount}</td>
        <td style="padding:8px; border-bottom:1px solid #ddd; text-align:right;">₹${o.subtotal || o.amount}</td>
      </tr>
    `;
  }

  const invoiceWindow = window.open("", "_blank", "width=800,height=900");
  invoiceWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tax Invoice - ${o.id}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 40px; color: #222; }
        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #2e7d32; padding-bottom: 15px; margin-bottom: 20px; }
        .brand h2 { margin: 0; color: #2e7d32; }
        .meta { text-align: right; font-size: 0.9rem; }
        .section { margin-bottom: 20px; font-size: 0.95rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th { background: #f4f6f8; text-align: left; padding: 8px; border-bottom: 2px solid #ccc; font-size: 0.9rem; }
        .totals { margin-top: 20px; width: 300px; margin-left: auto; font-size: 0.95rem; }
        .totals-row { display: flex; justify-content: space-between; padding: 4px 0; }
        .grand-total { border-top: 2px solid #2e7d32; padding-top: 6px; font-weight: bold; font-size: 1.15rem; color: #2e7d32; }
        .footer { margin-top: 40px; border-top: 1px dashed #ccc; padding-top: 15px; text-align: center; font-size: 0.85rem; color: #666; }
        .badge { display: inline-block; padding: 3px 8px; background: #e8f5e9; color: #2e7d32; border-radius: 4px; font-weight: bold; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 20px; text-align: right;">
        <button onclick="window.print()" style="background:#2e7d32; color:#fff; border:none; padding:10px 18px; border-radius:4px; font-weight:bold; cursor:pointer;">🖨️ Print / Save as PDF</button>
      </div>

      <div class="header">
        <div class="brand">
          <h2>FarmDirect Marketplace</h2>
          <small>Empowering Direct Agriculture Commerce</small>
        </div>
        <div class="meta">
          <strong>TAX INVOICE</strong><br>
          <strong>Invoice #:</strong> ${o.id}<br>
          <strong>Date:</strong> ${new Date(o.date).toLocaleString()}
        </div>
      </div>

      <div class="section">
        <strong>Billed & Delivered To:</strong><br>
        ${o.buyerName} | Phone: ${o.buyerPhone}<br>
        ${o.place}<br>
        <strong>Payment Mode:</strong> ${o.paymentMethod || "UPI"} | <span class="badge">Admin Escrow Protected</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item Description</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Unit Price</th>
            <th style="text-align:right;">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="totals">
        <div class="totals-row">
          <span>Subtotal:</span>
          <span>₹${o.subtotal || "0.00"}</span>
        </div>
        <div class="totals-row">
          <span>Delivery Charge:</span>
          <span>₹${o.deliveryCharge || "40.00"}</span>
        </div>
        <div class="totals-row">
          <span>GST @ 5%:</span>
          <span>₹${o.gst || "0.00"}</span>
        </div>
        <div class="totals-row grand-total">
          <span>Total Paid:</span>
          <span>₹${o.amount}</span>
        </div>
      </div>

      <div class="footer">
        <p>🛡️ This transaction is protected under the FarmDirect Central Admin Escrow System.</p>
        <p>Thank you for directly supporting local farmers!</p>
      </div>
    </body>
    </html>
  `);
  invoiceWindow.document.close();
  invoiceWindow.focus();
  setTimeout(() => invoiceWindow.print(), 400);
}

// -----------------------------
// Admin
// -----------------------------
function switchAdminTab(evt, sectionId) {
  document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".admin-nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById(sectionId).classList.add("active");
  if (evt && evt.target) evt.target.classList.add("active");
}

async function loadAdminDashboard() {
  try {
    const [ordersResult, usersResult, pendingResult] = await Promise.all([
      apiRequest("/orders", { auth: true }),
      apiRequest("/users", { auth: true }),
      apiRequest("/users/pending-farmers", { auth: true })
    ]);

    renderAdminEscrowTable(ordersResult.orders);
    renderAdminAccountApprovals(pendingResult.users);
    renderAdminUserTable(usersResult.users);
    await loadAdminProduceTable();

    document.getElementById("admin-pending-users-badge").textContent =
      `${pendingResult.users.length} Farmer${pendingResult.users.length === 1 ? "" : "s"}`;

    let totalEscrowHolding = 0;
    let totalSettled = 0;
    ordersResult.orders.forEach((o) => {
      if (!o.disbursed) totalEscrowHolding += parseFloat(o.amount);
      else totalSettled += parseFloat(o.farmerShare);
    });

    document.getElementById("admin-escrow-badge").textContent = `₹${totalEscrowHolding.toFixed(2)}`;
    document.getElementById("admin-settled-total").textContent = `₹${totalSettled.toFixed(2)}`;
  } catch (err) {
    showApiError(err.message);
  }
}

function renderAdminEscrowTable(orders) {
  const tbody = document.getElementById("admin-escrow-table-body");
  tbody.innerHTML = "";

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No escrow payments currently.</td></tr>';
    return;
  }

  orders.forEach((o) => {
    tbody.innerHTML += `
      <tr>
        <td><strong>#${o.id}</strong></td>
        <td>${o.buyerName}</td>
        <td>${o.farmerName || "Farmer"} (${o.farmerPhone || "-"})</td>
        <td><strong>₹${o.amount}</strong></td>
        <td style="color:var(--primary); font-weight:bold;">₹${o.farmerShare}</td>
        <td>
          <span class="badge ${o.disbursed ? "badge-success" : "badge-warning"}">
            ${o.disbursed ? "Disbursed to Farmer" : "Locked in Escrow"}
          </span>
        </td>
        <td>
          ${
            o.disbursed
              ? "✓ Transferred"
              : `<button class="btn btn-secondary" style="padding:4px 8px; font-size:0.8rem;" onclick="adminDisbursePayment('${o.id}')">💸 Disburse to Farmer</button>`
          }
        </td>
      </tr>
    `;
  });
}

async function adminDisbursePayment(orderId) {
  try {
    await apiRequest(`/orders/${orderId}/disburse`, { method: "PATCH", auth: true });
    alert(`Payment has been successfully transferred from Admin Escrow to the farmer!`);
    loadAdminDashboard();
  } catch (err) {
    showApiError(err.message);
  }
}

function renderAdminAccountApprovals(pendingFarmers) {
  const tbodyAppr = document.getElementById("admin-approvals-tbody");
  tbodyAppr.innerHTML = "";

  if (pendingFarmers.length === 0) {
    tbodyAppr.innerHTML = '<tr><td colspan="6" style="text-align:center;">No pending requests.</td></tr>';
  } else {
    pendingFarmers.forEach((u) => {
      tbodyAppr.innerHTML += `
        <tr>
          <td><strong>${u.name}</strong></td>
          <td>${u.email}</td>
          <td>${u.phone}</td>
          <td>${new Date(u.regDate).toLocaleDateString()}</td>
          <td><span class="badge badge-warning">Pending Review</span></td>
          <td>
            <button class="btn" style="padding:4px 8px; font-size:0.8rem;" onclick="processFarmerAdmin(${u.id})">✓ Approve</button>
          </td>
        </tr>
      `;
    });
  }
}

async function processFarmerAdmin(userId) {
  try {
    const result = await apiRequest(`/users/${userId}/approve`, { method: "PATCH", auth: true });
    alert(`Farmer "${result.user.name}" has been approved.`);
    loadAdminDashboard();
  } catch (err) {
    showApiError(err.message);
  }
}

async function loadAdminProduceTable() {
  try {
    // Admins see everything, approved or not, so hit the public list plus farmer-listed items.
    // The simplest correct source here is the public marketplace endpoint for approved items;
    // for a full moderation queue including delisted/pending items you would add a dedicated
    // admin products endpoint - left as a note for the next iteration.
    const result = await apiRequest("/products");
    renderAdminProduceTable(result.products);
  } catch (err) {
    showApiError(err.message);
  }
}

function renderAdminProduceTable(products) {
  const tbody = document.getElementById("admin-produce-table");
  tbody.innerHTML = "";
  products.forEach((p) => {
    tbody.innerHTML += `
      <tr>
        <td><img src="${p.image}" style="width:40px; height:40px; object-fit:cover; border-radius:4px; margin-bottom:0;"></td>
        <td><strong>${p.name}</strong></td>
        <td>${p.category}</td>
        <td>₹${p.price.toFixed(2)}</td>
        <td>${p.qty} kg</td>
        <td>${p.farm}</td>
        <td><span class="badge badge-success">${p.status}</span></td>
        <td>
          <button class="btn btn-outline" style="padding:3px 8px; font-size:0.8rem;" onclick="toggleProduce(${p.id})">Delist / Relist</button>
        </td>
      </tr>
    `;
  });
}

async function toggleProduce(id) {
  try {
    await apiRequest(`/products/${id}/status`, { method: "PATCH", auth: true });
    loadAdminProduceTable();
  } catch (err) {
    showApiError(err.message);
  }
}

function renderAdminUserTable(users) {
  const tbody = document.getElementById("admin-user-table");
  tbody.innerHTML = "";
  users.forEach((u) => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td>${u.phone}</td>
        <td><span class="badge badge-info">${u.role.toUpperCase()}</span></td>
        <td><span class="badge ${u.status === "Approved" ? "badge-success" : "badge-warning"}">${u.status}</span></td>
        <td>
          <button class="btn ${u.status === "Approved" ? "btn-danger" : "btn-outline"}" style="padding:4px 8px; font-size:0.8rem;" onclick="toggleUser(${u.id})">
            ${u.status === "Approved" ? "Block" : "Unblock"}
          </button>
        </td>
      </tr>
    `;
  });
}

async function toggleUser(id) {
  try {
    await apiRequest(`/users/${id}/toggle-block`, { method: "PATCH", auth: true });
    loadAdminDashboard();
  } catch (err) {
    showApiError(err.message);
  }
}

// -----------------------------
// Profile
// -----------------------------
function openProfile() {
  if (!currentUser) return;
  document.getElementById("prof-name").value = currentUser.name || "";
  document.getElementById("prof-email").value = currentUser.email || "";
  document.getElementById("prof-role").value = (currentUser.role || "").toUpperCase();
  document.getElementById("prof-phone").value = currentUser.phone || "";
  document.getElementById("user-profile-img").src =
    currentUser.avatar ||
    "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80";
  showScreen("screen-profile");
}

async function saveProfile() {
  const name = document.getElementById("prof-name").value;
  const phone = document.getElementById("prof-phone").value;
  try {
    const result = await apiRequest("/auth/profile", {
      method: "PUT",
      auth: true,
      body: { name, phone }
    });
    currentUser = result.user;
    alert("Profile changes saved.");
  } catch (err) {
    showApiError(err.message);
  }
}

function handleProfilePicUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    document.getElementById("user-profile-img").src = e.target.result;
    try {
      const result = await apiRequest("/auth/profile", {
        method: "PUT",
        auth: true,
        body: { avatar: e.target.result }
      });
      currentUser = result.user;
    } catch (err) {
      showApiError(err.message);
    }
  };
  reader.readAsDataURL(file);
}

// -----------------------------
// Checkout payment UI + card formatting (no backend involved)
// -----------------------------
function handlePaymentChange(method) {
  document.getElementById("payment-upi-box").style.display = method === "upi" ? "block" : "none";
  document.getElementById("payment-card-box").style.display = method === "card" ? "block" : "none";
  document.getElementById("payment-cod-box").style.display = method === "cod" ? "block" : "none";
}

function formatCardNumber(input) {
  let v = input.value.replace(/\D/g, "");
  input.value = v.match(/.{1,4}/g)?.join(" ") || v;
}

function detectLiveLocation() {
  if (!navigator.geolocation) return alert("Geolocation not supported.");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      currentCoords = [lat, lon];
      if (checkoutMap) {
        checkoutMap.setView([lat, lon], 15);
        if (checkoutMarker) checkoutMarker.setLatLng([lat, lon]);
      }
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.address) {
            const a = data.address;
            document.getElementById("chk-place").value = a.city || a.town || a.village || "";
            document.getElementById("chk-mandal").value = a.county || a.state_district || "";
            document.getElementById("chk-state").value = a.state || "Andhra Pradesh";
            document.getElementById("chk-pincode").value = a.postcode || "";
          }
        })
        .catch(() => {});
    },
    () => alert("Location permission denied.")
  );
}

function initCheckoutMap() {
  if (typeof L === "undefined") return;
  if (!checkoutMap) {
    checkoutMap = L.map("checkout-map").setView(currentCoords, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(checkoutMap);
    checkoutMarker = L.marker(currentCoords, { draggable: true }).addTo(checkoutMap);
    checkoutMarker.on("dragend", (e) => {
      currentCoords = [e.target.getLatLng().lat, e.target.getLatLng().lng];
    });
  } else {
    checkoutMap.setView(currentCoords, 13);
    checkoutMap.invalidateSize();
  }
}

// -----------------------------
// Startup
// -----------------------------
(async function init() {
  await restoreSession();
  if (currentUser) {
    if (currentUser.role === "admin") showScreen("screen-admin-dash", true);
    else if (currentUser.role === "farmer") showScreen("screen-farmer-dash", true);
    else if (currentUser.role === "buyer") showScreen("screen-buyer-dash", true);
  }
})();
