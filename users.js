const express = require("express");
const db = require("../lib/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

// GET /api/users  (admin only) - all non-admin users, for the User Management tab
router.get("/", requireAuth, requireRole("admin"), (req, res) => {
  const data = db.getAll();
  const list = data.users.filter((u) => u.role !== "admin").map(publicUser);
  res.json({ users: list });
});

// GET /api/users/pending-farmers  (admin only)
router.get("/pending-farmers", requireAuth, requireRole("admin"), (req, res) => {
  const data = db.getAll();
  const list = data.users.filter((u) => u.role === "farmer" && u.status === "Pending").map(publicUser);
  res.json({ users: list });
});

// PATCH /api/users/:id/approve  (admin only)
router.patch("/:id/approve", requireAuth, requireRole("admin"), (req, res) => {
  const data = db.getAll();
  const user = data.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found." });

  user.status = "Approved";
  db.saveAll(data);
  res.json({ user: publicUser(user) });
});

// PATCH /api/users/:id/toggle-block  (admin only)
router.patch("/:id/toggle-block", requireAuth, requireRole("admin"), (req, res) => {
  const data = db.getAll();
  const user = data.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found." });

  user.status = user.status === "Approved" ? "Blocked" : "Approved";
  db.saveAll(data);
  res.json({ user: publicUser(user) });
});

module.exports = router;
