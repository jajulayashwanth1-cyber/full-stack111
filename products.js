const express = require("express");
const db = require("../lib/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/products  (public marketplace - approved only, optional ?q= search)
router.get("/", (req, res) => {
  const data = db.getAll();
  const q = (req.query.q || "").toLowerCase().trim();
  let list = data.products.filter((p) => p.status === "Approved");
  if (q) {
    list = list.filter(
      (p) => p.name.toLowerCase().includes(q) || p.farm.toLowerCase().includes(q)
    );
  }
  res.json({ products: list });
});

// GET /api/products/mine  (farmer's own listings, any status)
router.get("/mine", requireAuth, requireRole("farmer"), (req, res) => {
  const data = db.getAll();
  const list = data.products.filter((p) => p.farmerId === req.user.id);
  res.json({ products: list });
});

// GET /api/products/:id
router.get("/:id", (req, res) => {
  const data = db.getAll();
  const product = data.products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found." });
  res.json({ product });
});

// POST /api/products  (farmer only) - add a crop listing
router.post("/", requireAuth, requireRole("farmer"), (req, res) => {
  const { name, category, price, qty, grade, shelfLife, farm, farmerPhone, image } = req.body || {};
  if (!name || !category || price == null || qty == null || !farm) {
    return res.status(400).json({ error: "name, category, price, qty and farm are required." });
  }

  const data = db.getAll();
  const newProduct = {
    id: data.nextProductId++,
    farmerId: req.user.id,
    name,
    category,
    price: Number(price),
    qty: Number(qty),
    grade: grade || "Grade A",
    shelfLife: shelfLife || "5-7 Days",
    farm,
    farmerPhone: farmerPhone || "",
    image:
      image ||
      "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80",
    status: "Approved" // set to "Pending" here if you want admin moderation before listings go live
  };

  data.products.unshift(newProduct);
  db.saveAll(data);
  res.status(201).json({ product: newProduct });
});

// PATCH /api/products/:id/status  (admin only) - approve/delist toggle or explicit status
router.patch("/:id/status", requireAuth, requireRole("admin"), (req, res) => {
  const data = db.getAll();
  const product = data.products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found." });

  if (req.body && req.body.status) {
    product.status = req.body.status;
  } else {
    product.status = product.status === "Approved" ? "Delisted" : "Approved";
  }

  db.saveAll(data);
  res.json({ product });
});

module.exports = router;
