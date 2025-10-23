const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();
const app = express();
const port = 3000;

// --- KONFIGURASI DATABASE NEON/POSTGRESQL ---
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("PERINGATAN KRITIS: Variabel lingkungan DATABASE_URL tidak ditemukan. API akan GAGAL terhubung ke Neon.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("Koneksi database GAGAL:", err);
  } else {
    console.log("Koneksi database Neon BERHASIL pada:", res.rows[0].now);
  }
});

// Middleware
app.use(
  cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  })
);
app.use(express.json());

// --- FUNGSI UTAMA (MEMBUAT TABEL JIKA BELUM ADA) ---
async function createTables() {
  try {
    await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                id_produk VARCHAR(50) UNIQUE NOT NULL,
                nama_produk VARCHAR(100) NOT NULL,
                kategori_produk VARCHAR(100)
            );
        `);
    // TABEL INI GAGAL DIBUAT SEBELUMNYA, KAMI PASTIKAN LAGI DI SINI
    await pool.query(`
            CREATE TABLE IF NOT EXISTS stock (
                id SERIAL PRIMARY KEY,
                id_produk VARCHAR(50) UNIQUE REFERENCES products(id_produk) ON DELETE CASCADE,
                nama_produk VARCHAR(100) NOT NULL,
                jumlah_stok INTEGER DEFAULT 0
            );
        `);
    // TABEL INI GAGAL DIBUAT SEBELUMNYA, KAMI PASTIKAN LAGI DI SINI
    await pool.query(`
            CREATE TABLE IF NOT EXISTS employees (
                id SERIAL PRIMARY KEY,
                nama VARCHAR(100) NOT NULL,
                posisi VARCHAR(100),
                email VARCHAR(100)
            );
        `);
    console.log("Semua tabel sudah dipastikan ada.");
  } catch (err) {
    console.error("Gagal membuat tabel:", err);
  }
}
createTables(); // Pastikan ini dipanggil

// --- PRODUCTS ROUTES (CRUD) ---
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET products:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/api/products", async (req, res) => {
  const { id_produk, nama_produk, kategori_produk } = req.body;
  if (!id_produk || !nama_produk) return res.status(400).send("ID Produk dan Nama Produk wajib diisi.");
  try {
    const result = await pool.query("INSERT INTO products (id_produk, nama_produk, kategori_produk) VALUES ($1, $2, $3) RETURNING *", [id_produk, nama_produk, kategori_produk]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST product:", err);
    res.status(500).send("Gagal menambah produk. Mungkin ID Produk sudah ada.");
  }
});

app.put("/api/products/:id", async (req, res) => {
  const id = req.params.id;
  const { nama_produk, kategori_produk } = req.body;
  try {
    const result = await pool.query("UPDATE products SET nama_produk = $1, kategori_produk = $2 WHERE id = $3 RETURNING *", [nama_produk, kategori_produk, id]);
    if (result.rowCount === 0) return res.status(404).send("Produk tidak ditemukan.");

    // PENTING: Update nama_produk di tabel stock juga
    await pool.query("UPDATE stock SET nama_produk = $1 WHERE id_produk = (SELECT id_produk FROM products WHERE id = $2)", [nama_produk, id]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT product:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.delete("/api/products/:id", async (req, res) => {
  const id = req.params.id;
  try {
    // Karena ada ON DELETE CASCADE pada tabel stock,
    // penghapusan di tabel products akan otomatis menghapus stok terkait.
    const result = await pool.query("DELETE FROM products WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).send("Produk tidak ditemukan.");
    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE product:", err);
    res.status(500).send("Internal Server Error");
  }
});

// --- STOCK ROUTES (CRUD) ---
app.get("/api/stock", async (req, res) => {
  try {
    // PERBAIKAN: Menggunakan LEFT JOIN agar tetap menampilkan data stok yang valid
    const query = `
            SELECT 
                s.id, 
                s.id_produk, 
                p.nama_produk, 
                s.jumlah_stok 
            FROM stock s
            LEFT JOIN products p ON s.id_produk = p.id_produk
            ORDER BY s.id DESC;
        `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET stock:", err);
    res.status(500).send("Internal Server Error: Gagal mengambil data stok. Pastikan tabel stock sudah dibuat.");
  }
});

app.post("/api/stock", async (req, res) => {
  const { id_produk, jumlah_stok } = req.body;
  if (!id_produk || typeof jumlah_stok !== "number") return res.status(400).send("ID Produk dan Jumlah Stok wajib diisi.");

  try {
    // Cek apakah produk ada
    const productResult = await pool.query("SELECT nama_produk FROM products WHERE id_produk = $1", [id_produk]);
    if (productResult.rowCount === 0) return res.status(404).send("Produk terkait tidak ditemukan.");
    const nama_produk = productResult.rows[0].nama_produk;

    // Cek apakah stok sudah ada
    const existingStock = await pool.query("SELECT id, jumlah_stok FROM stock WHERE id_produk = $1", [id_produk]);

    let result;
    if (existingStock.rowCount > 0) {
      // Jika sudah ada, update (misalnya penambahan stok)
      const newStock = existingStock.rows[0].jumlah_stok + jumlah_stok;
      result = await pool.query("UPDATE stock SET jumlah_stok = $1 WHERE id_produk = $2 RETURNING *", [newStock, id_produk]);
    } else {
      // Jika belum ada, masukkan baru
      result = await pool.query("INSERT INTO stock (id_produk, nama_produk, jumlah_stok) VALUES ($1, $2, $3) RETURNING *", [id_produk, nama_produk, jumlah_stok]);
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST stock:", err);
    res.status(500).send("Gagal menambah/memperbarui stok.");
  }
});

app.put("/api/stock/:id", async (req, res) => {
  const id = req.params.id;
  const { jumlah_stok } = req.body;
  try {
    const result = await pool.query("UPDATE stock SET jumlah_stok = $1 WHERE id = $2 RETURNING *", [jumlah_stok, id]);
    if (result.rowCount === 0) return res.status(404).send("Stok tidak ditemukan.");
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT stock:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.delete("/api/stock/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query("DELETE FROM stock WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).send("Stok tidak ditemukan.");
    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE stock:", err);
    res.status(500).send("Internal Server Error");
  }
});

// --- EMPLOYEE ROUTES (CRUD) ---
app.get("/api/employees", async (req, res) => {
  try {
    // Kueri sederhana SELECT * FROM employees
    const result = await pool.query("SELECT * FROM employees ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    // Kemungkinan error: Tabel 'employees' tidak ditemukan
    console.error("Error GET employees:", err);
    res.status(500).send("Internal Server Error: Gagal mengambil data karyawan. Pastikan tabel employees sudah dibuat.");
  }
});

app.post("/api/employees", async (req, res) => {
  const { nama, posisi, email } = req.body;
  if (!nama || !posisi) return res.status(400).send("Nama dan Posisi wajib diisi.");
  try {
    const result = await pool.query("INSERT INTO employees (nama, posisi, email) VALUES ($1, $2, $3) RETURNING *", [nama, posisi, email]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST employee:", err);
    res.status(500).send("Gagal menambah karyawan.");
  }
});

app.put("/api/employees/:id", async (req, res) => {
  const id = req.params.id;
  const { nama, posisi, email } = req.body;
  try {
    const result = await pool.query("UPDATE employees SET nama = $1, posisi = $2, email = $3 WHERE id = $4 RETURNING *", [nama, posisi, email, id]);
    if (result.rowCount === 0) return res.status(404).send("Karyawan tidak ditemukan.");
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT employee:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.delete("/api/employees/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query("DELETE FROM employees WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).send("Karyawan tidak ditemukan.");
    res.status(204).send();
  } catch (err) {
    console.error("Error DELETE employee:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Server API berjalan di http://localhost:${port}`);
});
