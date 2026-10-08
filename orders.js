const express = require("express");
const db = require("../lib/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const DELIVERY_CHARGE = 40.0;
const GST_RATE = 0.05;

// POST /api/orders  (buyer only) - place an order from cart items
// body: { items: [{ productId, qty }], address: {...}, paymentMethod }
router.post("/", requireAuth, requireRole("buyer"), (req, res) => {
  const { items, address, paymentMethod } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array of { productId, qty }." });
  }
  if (!address || !address.name || !address.phone || !address.street) {
    return res.status(400).json({ error: "A delivery address (name, phone, street, place, mandal, state, pincode) is required." });
  }

  const data = db.getAll();
  const buyer = data.users.find((u) => u.id === req.user.id);

  let subtotal = 0;
  const orderItems = [];
  let primaryFarmerId = null;

  for (const item of items) {
    const product = data.products.find((p) => p.id === Number(item.productId));
    if (!product) return res.status(404).json({ error: `Product ${item.productId} not found.` });
    const qty = Number(item.qty);
    if (!qty || qty <= 0) return res.status(400).json({ error: "Each item needs a positive qty." });

    const lineSubtotal = product.price * qty;
    subtotal += lineSubtotal;
    orderItems.push({ name: product.name, price: product.price, qty, subtotal: lineSubtotal, farmerId: product.farmerId });
    if (primaryFarmerId === null) primaryFarmerId = product.farmerId;
  }

  const delivery = DELIVERY_CHARGE;
  const gst = subtotal * GST_RATE;
  const grandTotal = subtotal + delivery + gst;

  const farmer = data.users.find((u) => u.id === primaryFarmerId) || {};

  const newOrder = {
    id: "ORD-" + Math.floor(10000 + Math.random() * 90000),
    date: new Date().toISOString(),
    buyerId: buyer.id,
    buyerName: address.name,
    buyerPhone: address.phone,
    farmerId: farmer.id || null,
    farmerName: farmer.name || "Farmer",
    farmerPhone: farmer.phone || "",
    place: `${address.street}, ${address.place || ""}, ${address.mandal || ""}, ${address.state || ""} - ${address.pincode || ""}`,
    subtotal: subtotal.toFixed(2),
    deliveryCharge: delivery.toFixed(2),
    gst: gst.toFixed(2),
    amount: grandTotal.toFixed(2),
    farmerShare: subtotal.toFixed(2), // platform keeps delivery + gst in this demo model
    paymentMethod: (paymentMethod || "UPI").toUpperCase(),
    escrowStatus: "Held by Admin",
    disbursed: false,
    items: orderItems
  };

  data.orders.unshift(newOrder);
  db.saveAll(data);

  res.status(201).json({ order: newOrder });
});

// GET /api/orders/mine  (buyer) - buyer's own orders
router.get("/mine", requireAuth, requireRole("buyer"), (req, res) => {
  const data = db.getAll();
  const list = data.orders.filter((o) => o.buyerId === req.user.id);
  res.json({ orders: list });
});

// GET /api/orders/farmer  (farmer) - orders containing this farmer's produce
router.get("/farmer", requireAuth, requireRole("farmer"), (req, res) => {
  const data = db.getAll();
  const list = data.orders.filter((o) => o.farmerId === req.user.id);
  res.json({ orders: list });
});

// GET /api/orders  (admin) - every order, for the escrow/settlement table
router.get("/", requireAuth, requireRole("admin"), (req, res) => {
  const data = db.getAll();
  res.json({ orders: data.orders });
});

// GET /api/orders/:id  (any authenticated user who owns/relates to the order, or admin)
router.get("/:id", requireAuth, (req, res) => {
  const data = db.getAll();
  const order = data.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  const isOwner =
    req.user.role === "admin" ||
    (req.user.role === "buyer" && order.buyerId === req.user.id) ||
    (req.user.role === "farmer" && order.farmerId === req.user.id);
  if (!isOwner) return res.status(403).json({ error: "You do not have access to this order." });

  res.json({ order });
});

// PATCH /api/orders/:id/disburse  (admin only) - release escrow to the farmer
router.patch("/:id/disburse", requireAuth, requireRole("admin"), (req, res) => {
  const data = db.getAll();
  const order = data.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  order.disbursed = true;
  order.escrowStatus = "Disbursed to Farmer";
  data.settledTotal = (data.settledTotal || 0) + parseFloat(order.farmerShare);

  db.saveAll(data);
  res.json({ order });
});

module.exports = router;
