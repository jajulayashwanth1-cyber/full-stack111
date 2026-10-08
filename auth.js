const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../lib/db");
const { signToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

// In-memory OTP store: email -> { otp, userId, expiresAt }
// Fine for a demo. For production, use a real store (Redis) and a real SMS/email sender.
const otpStore = new Map();

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

// POST /api/auth/register
router.post("/register", (req, res) => {
  const { name, email, phone, role, password } = req.body || {};
  if (!name || !email || !phone || !role || !password) {
    return res.status(400).json({ error: "name, email, phone, role and password are all required." });
  }
  if (!["farmer", "buyer"].includes(role)) {
    return res.status(400).json({ error: "role must be 'farmer' or 'buyer'." });
  }

  const data = db.getAll();
  const normalizedEmail = email.trim().toLowerCase();

  if (data.users.some((u) => u.email === normalizedEmail)) {
    return res.status(409).json({ error: "An account with this email is already registered." });
  }

  const status = role === "buyer" ? "Approved" : "Pending";
  const newUser = {
    id: data.nextUserId++,
    name: name.trim(),
    email: normalizedEmail,
    phone: phone.trim(),
    passwordHash: bcrypt.hashSync(password, 8),
    role,
    status,
    regDate: new Date().toISOString(),
    avatar:
      "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80"
  };

  data.users.push(newUser);
  db.saveAll(data);

  if (status === "Pending") {
    return res.status(201).json({ pendingApproval: true, user: publicUser(newUser) });
  }

  // Buyers get instant access.
  const token = signToken(newUser);
  return res.status(201).json({ pendingApproval: false, token, user: publicUser(newUser) });
});

// POST /api/auth/login  { email, password, role }
// Step 1 of login: validate credentials, then issue an OTP (simulating an email/SMS code).
router.post("/login", (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) {
    return res.status(400).json({ error: "email, password and role are required." });
  }

  const data = db.getAll();
  const normalizedEmail = email.trim().toLowerCase();
  const user = data.users.find(
    (u) => u.email === normalizedEmail && (role === "admin" ? u.role === "admin" : u.role === role)
  );

  if (!user) {
    return res.status(404).json({ error: `No account found for "${email}" with role "${role}".` });
  }
  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  if (user.status === "Pending") {
    return res.status(403).json({ error: "pending_approval", message: "Your account is pending admin approval." });
  }
  if (user.status === "Blocked") {
    return res.status(403).json({ error: "Your account has been blocked. Contact the platform administrator." });
  }

  const otp = String(Math.floor(1000 + Math.random() * 9000));
  otpStore.set(normalizedEmail, { otp, userId: user.id, expiresAt: Date.now() + 5 * 60 * 1000 });

  // NOTE: In production, send this via email/SMS instead of returning it in the response.
  // It is returned here (and logged) only so the demo works without a mail/SMS provider configured.
  console.log(`[DEV] OTP for ${normalizedEmail}: ${otp}`);

  return res.json({
    message: "Verification code generated.",
    otpDeliveredTo: normalizedEmail,
    devOtp: otp // remove this field once you wire up real email/SMS delivery
  });
});

// POST /api/auth/verify-otp  { email, otp }
router.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ error: "email and otp are required." });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const record = otpStore.get(normalizedEmail);

  if (!record || record.expiresAt < Date.now()) {
    return res.status(400).json({ error: "OTP expired or not found. Please log in again." });
  }
  if (record.otp !== String(otp).trim()) {
    return res.status(400).json({ error: "Invalid verification code." });
  }

  otpStore.delete(normalizedEmail);

  const data = db.getAll();
  const user = data.users.find((u) => u.id === record.userId);
  if (!user) return res.status(404).json({ error: "User no longer exists." });

  const token = signToken(user);
  return res.json({ token, user: publicUser(user) });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
  const data = db.getAll();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

// PUT /api/auth/profile  { name, phone, avatar }
router.put("/profile", requireAuth, (req, res) => {
  const data = db.getAll();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });

  const { name, phone, avatar } = req.body || {};
  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (avatar) user.avatar = avatar;

  db.saveAll(data);
  res.json({ user: publicUser(user) });
});

module.exports = router;
