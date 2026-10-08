// Lightweight file-based JSON "database".
// Good enough for a demo/prototype backend - no native build tools required.
// Swap this out for a real database (Postgres/Mongo) later without touching the routes much,
// since everything goes through the functions exported below.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data.json");

const bcrypt = require("bcryptjs");

function seedData() {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: 1,
        name: "System Administrator",
        email: "admin@platform.com",
        passwordHash: bcrypt.hashSync("admin123", 8),
        role: "admin",
        phone: "8328205356",
        status: "Approved",
        regDate: now,
        avatar:
          "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80"
      },
      {
        id: 2,
        name: "John Farmer",
        email: "john@farmer.com",
        passwordHash: bcrypt.hashSync("password123", 8),
        role: "farmer",
        phone: "8328205356",
        status: "Approved",
        regDate: now,
        avatar:
          "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80"
      },
      {
        id: 3,
        name: "Jane Buyer",
        email: "jane@buyer.com",
        passwordHash: bcrypt.hashSync("password123", 8),
        role: "buyer",
        phone: "8328205356",
        status: "Approved",
        regDate: now,
        avatar:
          "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80"
      },
      {
        id: 4,
        name: "Ramesh AgriGrower",
        email: "ramesh@agri.com",
        passwordHash: bcrypt.hashSync("password123", 8),
        role: "farmer",
        phone: "8328205356",
        status: "Pending",
        regDate: now,
        avatar:
          "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=200&q=80"
      }
    ],
    products: [
      {
        id: 1,
        farmerId: 2,
        name: "Fresh Country Tomatoes",
        category: "Vegetables",
        price: 24,
        qty: 500,
        grade: "Grade A",
        shelfLife: "5-7 Days",
        farm: "Green Valley Organics, Guntur",
        farmerPhone: "8328205356",
        image:
          "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=400&q=80",
        status: "Approved"
      },
      {
        id: 2,
        farmerId: 2,
        name: "Green Farm Chillies",
        category: "Vegetables",
        price: 40,
        qty: 150,
        grade: "Grade A",
        shelfLife: "7-10 Days",
        farm: "Sunny Ridge Farm, Guntur",
        farmerPhone: "8328205356",
        image:
          "https://images.unsplash.com/photo-1588252303782-cb80119abd6d?auto=format&fit=crop&w=400&q=80",
        status: "Approved"
      },
      {
        id: 3,
        farmerId: 2,
        name: "Organic Fresh Onions",
        category: "Vegetables",
        price: 20,
        qty: 600,
        grade: "Organic Certified",
        shelfLife: "15-20 Days",
        farm: "Highland Co-op, Tenali",
        farmerPhone: "8328205356",
        image:
          "https://images.unsplash.com/photo-1508747703725-719777637510?auto=format&fit=crop&w=400&q=80",
        status: "Approved"
      }
    ],
    orders: [
      {
        id: "ORD-88392",
        date: now,
        buyerId: 3,
        buyerName: "Jane Buyer",
        buyerPhone: "8328205356",
        farmerId: 2,
        farmerName: "John Farmer",
        farmerPhone: "8328205356",
        place: "Guntur Urban",
        subtotal: "450.00",
        deliveryCharge: "40.00",
        gst: "22.50",
        amount: "512.50",
        farmerShare: "450.00",
        paymentMethod: "UPI",
        escrowStatus: "Held by Admin",
        disbursed: false,
        items: [
          { name: "Fresh Country Tomatoes", price: 24, qty: 15, subtotal: 360 },
          { name: "Organic Fresh Onions", price: 20, qty: 4.5, subtotal: 90 }
        ]
      }
    ],
    settledTotal: 18450.0,
    nextUserId: 5,
    nextProductId: 4
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(seedData());
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Every exported function re-reads/writes the file so this stays correct
// even if you later run the server with multiple processes pointed at
// the same file. For a real production app, replace this file with a
// proper database client but keep the same function names/signatures.

module.exports = {
  getAll() {
    return load();
  },
  saveAll(data) {
    save(data);
  },
  resetToSeed() {
    save(seedData());
    return load();
  }
};
