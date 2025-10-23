/**
 * BACKEND API SERVER UNTUK INVENTORY
 *
 * Menggunakan Express dan PostgreSQL (Neon)
 *
 * CATATAN PENTING:
 * - Variabel lingkungan DATABASE_URL harus disetel (via .env atau Vercel Environment Variables).
 * - Fungsi createTables() dihilangkan untuk meningkatkan stabilitas Vercel.
 * - Diasumsikan skema database sudah dibuat secara manual di Neon.
 */

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

// Memuat variabel lingkungan dari file .env (hanya untuk pengembangan lokal)
// Di Vercel, variabel ini diambil secara otomatis dari setting.
require("dotenv").config();

const app = express();
const port = 3000;

// URL database dari environment variable
const DATABASE_URL = process.env.DATABASE_URL;

// Middleware
app.use(cors());
app.use(express.json());

if (!DATABASE_URL) {
  console.error("KRITIS: Variabel lingkungan DATABASE_URL tidak ditemukan. API akan GAGAL terhubung ke Neon.");
}

// Inisialisasi Pool Koneksi Database
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Tes Koneksi Database
pool
  .connect()
  .then((client) => {
    console.log(`Koneksi database Neon BERHASIL pada: ${new Date().toISOString()}`);
    client.release();
  })
  .catch((err) => {
    console.error(`Gagal koneksi database Neon: ${err.message}`);
    // Keluar jika koneksi gagal secara krusial
  });

// =============================================================================
// HELPER: Penanganan Error Kueri
// =============================================================================

const handleQueryError = (res, error, message) => {
  console.error(`SQL Query Error: ${message}`, error.stack);
  res.status(500).json({ error: "Internal Server Error", message: `${message}: ${error.message}` });
};

// =============================================================================
// ROUTE DASHBOARD (Hanya GET Ringkasan)
// =============================================================================

app.get("/api/dashboard", async (req, res) => {
  try {
    const productCountResult = await pool.query("SELECT COUNT(*) FROM products");
    const stockSumResult = await pool.query("SELECT COALESCE(SUM(jumlah_stok), 0) AS total_stok FROM stock");
    const employeeCountResult = await pool.query("SELECT COUNT(*) FROM employees");

    const dashboardData = {
      total_produk: parseInt(productCountResult.rows[0].count),
      total_stok_unit: parseInt(stockSumResult.rows[0].total_stok),
      total_karyawan: parseInt(employeeCountResult.rows[0].count),
    };

    res.json(dashboardData);
  } catch (error) {
    handleQueryError(res, error, "Gagal mengambil data ringkasan dashboard.");
  }
});

// =============================================================================
// ROUTE PRODUK
// =============================================================================

// GET semua produk (dengan fitur pencarian)
app.get("/api/products", async (req, res) => {
  const { search } = req.query;
  let queryText = "SELECT * FROM products";
  const queryParams = [];

  if (search) {
    queryParams.push(`%${search}%`);
    queryText += " WHERE nama_produk ILIKE $1 OR kategori_produk ILIKE $1 OR id_produk ILIKE $1";
  }

  try {
    const result = await pool.query(queryText, queryParams);
    res.json(result.rows);
  } catch (error) {
    handleQueryError(res, error, "Gagal mengambil data produk.");
  }
});

// POST (Menambah) Produk Baru
app.post("/api/products", async (req, res) => {
  const { id_produk, nama_produk, kategori_produk } = req.body;
  const queryText = "INSERT INTO products (id_produk, nama_produk, kategori_produk) VALUES ($1, $2, $3) RETURNING *";
  const queryParams = [id_produk, nama_produk, kategori_produk];

  try {
    const result = await pool.query(queryText, queryParams);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    // Cek jika error adalah unique constraint violation (id_produk sudah ada)
    if (error.code === "23505") {
      return res.status(409).json({ error: "Conflict", message: "ID Produk sudah ada." });
    }
    handleQueryError(res, error, "Gagal menambah produk baru.");
  }
});

// PUT (Mengubah) Produk
app.put("/api/products/:id_produk", async (req, res) => {
  const { id_produk } = req.params;
  const { nama_produk, kategori_produk } = req.body;
  const queryText = "UPDATE products SET nama_produk = $1, kategori_produk = $2 WHERE id_produk = $3 RETURNING *";
  const queryParams = [nama_produk, kategori_produk, id_produk];

  try {
    const result = await pool.query(queryText, queryParams);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not Found", message: "Produk tidak ditemukan." });
    }
    res.json(result.rows[0]);
  } catch (error) {
    handleQueryError(res, error, `Gagal mengubah produk dengan ID ${id_produk}.`);
  }
});

// DELETE Produk
app.delete("/api/products/:id_produk", async (req, res) => {
  const { id_produk } = req.params;
  const queryText = "DELETE FROM products WHERE id_produk = $1 RETURNING *";

  try {
    const result = await pool.query(queryText, [id_produk]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not Found", message: "Produk tidak ditemukan." });
    }
    res.json({ message: "Produk berhasil dihapus", deleted_product: result.rows[0] });
  } catch (error) {
    handleQueryError(res, error, `Gagal menghapus produk dengan ID ${id_produk}.`);
  }
});

// =============================================================================
// ROUTE STOK
// =============================================================================

// GET semua stok (digabung dengan nama produk)
app.get("/api/stock", async (req, res) => {
  const { search } = req.query;
  let queryText = `
        SELECT
            s.id,
            s.id_produk,
            s.nama_produk,
            s.jumlah_stok,
            p.kategori_produk
        FROM stock s
        LEFT JOIN products p ON s.id_produk = p.id_produk
    `;
  const queryParams = [];

  if (search) {
    queryParams.push(`%${search}%`);
    queryText += " WHERE s.nama_produk ILIKE $1 OR s.id_produk ILIKE $1";
  }

  try {
    const result = await pool.query(queryText, queryParams);
    res.json(result.rows);
  } catch (error) {
    handleQueryError(res, error, "Gagal mengambil data stok. Pastikan tabel stock sudah dibuat.");
  }
});

// POST (Menambah) Stok Baru
app.post("/api/stock", async (req, res) => {
  const { id_produk, nama_produk, jumlah_stok } = req.body;
  // Perlu cek apakah id_produk ada di tabel products (akan dicek oleh Foreign Key)
  const queryText = "INSERT INTO stock (id_produk, nama_produk, jumlah_stok) VALUES ($1, $2, $3) RETURNING *";
  const queryParams = [id_produk, nama_produk, jumlah_stok];

  try {
    const result = await pool.query(queryText, queryParams);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") {
      // Foreign key violation
      return res.status(400).json({ error: "Bad Request", message: "ID Produk tidak ada di tabel Produk." });
    }
    if (error.code === "23505") {
      // Unique constraint violation
      return res.status(409).json({ error: "Conflict", message: "Stok untuk ID Produk ini sudah ada. Gunakan PUT untuk mengubah jumlah." });
    }
    handleQueryError(res, error, "Gagal menambah stok baru.");
  }
});

// PUT (Mengubah) Stok (berdasarkan id_produk)
app.put("/api/stock/:id_produk", async (req, res) => {
  const { id_produk } = req.params;
  const { jumlah_stok } = req.body;
  const queryText = "UPDATE stock SET jumlah_stok = $1 WHERE id_produk = $2 RETURNING *";
  const queryParams = [jumlah_stok, id_produk];

  try {
    const result = await pool.query(queryText, queryParams);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not Found", message: "Stok untuk produk ini tidak ditemukan." });
    }
    res.json(result.rows[0]);
  } catch (error) {
    handleQueryError(res, error, `Gagal mengubah stok untuk ID ${id_produk}.`);
  }
});

// DELETE Stok
app.delete("/api/stock/:id_produk", async (req, res) => {
  const { id_produk } = req.params;
  const queryText = "DELETE FROM stock WHERE id_produk = $1 RETURNING *";

  try {
    const result = await pool.query(queryText, [id_produk]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not Found", message: "Stok untuk produk ini tidak ditemukan." });
    }
    res.json({ message: "Stok berhasil dihapus", deleted_stock: result.rows[0] });
  } catch (error) {
    handleQueryError(res, error, `Gagal menghapus stok untuk ID ${id_produk}.`);
  }
});

// =============================================================================
// ROUTE KARYAWAN
// =============================================================================

// GET semua karyawan (dengan fitur pencarian)
app.get("/api/employees", async (req, res) => {
  const { search } = req.query;
  let queryText = "SELECT * FROM employees";
  const queryParams = [];

  if (search) {
    queryParams.push(`%${search}%`);
    queryText += " WHERE nama ILIKE $1 OR posisi ILIKE $1 OR email ILIKE $1";
  }

  try {
    const result = await pool.query(queryText, queryParams);
    res.json(result.rows);
  } catch (error) {
    handleQueryError(res, error, "Gagal mengambil data karyawan. Pastikan tabel employees sudah dibuat.");
  }
});

// POST (Menambah) Karyawan Baru
app.post("/api/employees", async (req, res) => {
  const { nama, posisi, email } = req.body;
  const queryText = "INSERT INTO employees (nama, posisi, email) VALUES ($1, $2, $3) RETURNING *";
  const queryParams = [nama, posisi, email];

  try {
    const result = await pool.query(queryText, queryParams);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    handleQueryError(res, error, "Gagal menambah karyawan baru.");
  }
});

// PUT (Mengubah) Karyawan
app.put("/api/employees/:id", async (req, res) => {
  const { id } = req.params;
  const { nama, posisi, email } = req.body;
  const queryText = "UPDATE employees SET nama = $1, posisi = $2, email = $3 WHERE id = $4 RETURNING *";
  const queryParams = [nama, posisi, email, id];

  try {
    const result = await pool.query(queryText, queryParams);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not Found", message: "Karyawan tidak ditemukan." });
    }
    res.json(result.rows[0]);
  } catch (error) {
    handleQueryError(res, error, `Gagal mengubah data karyawan dengan ID ${id}.`);
  }
});

// DELETE Karyawan
app.delete("/api/employees/:id", async (req, res) => {
  const { id } = req.params;
  const queryText = "DELETE FROM employees WHERE id = $1 RETURNING *";

  try {
    const result = await pool.query(queryText, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Not Found", message: "Karyawan tidak ditemukan." });
    }
    res.json({ message: "Karyawan berhasil dihapus", deleted_employee: result.rows[0] });
  } catch (error) {
    handleQueryError(res, error, `Gagal menghapus karyawan dengan ID ${id}.`);
  }
});

// Route catch-all untuk deployment Vercel
// Vercel akan secara otomatis menangani listening port saat deployment
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server API berjalan di http://localhost:${port}`);
  });
}

// Ekspor handler Express untuk Serverless Function Vercel
module.exports = app;
