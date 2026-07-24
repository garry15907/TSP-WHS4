const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createStore({ dbPath, reportThreshold, adminSeed }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'banned')),
      wallet_balance INTEGER NOT NULL DEFAULT 100000,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'sold', 'deleted')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('user', 'product')),
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (reporter_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS global_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      amount INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  seedAdmin();

  function now() {
    return new Date().toISOString();
  }

  function seedAdmin() {
    const existing = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(adminSeed.username);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (username, display_name, password_hash, bio, role, status, wallet_balance, created_at)
        VALUES (?, ?, ?, ?, 'admin', 'active', 100000000, ?)
      `).run(
        adminSeed.username,
        adminSeed.displayName,
        adminSeed.passwordHash,
        "보안 과제 검증용 기본 관리자 계정입니다.",
        now(),
      );
    }
  }

  function mapUser(row) {
    return row
      ? {
          ...row,
          isAdmin: row.role === "admin",
        }
      : null;
  }

  function getUserById(id) {
    return mapUser(
      db
        .prepare(
          "SELECT id, username, display_name, bio, role, status, wallet_balance, created_at, password_hash FROM users WHERE id = ?",
        )
        .get(id),
    );
  }

  function getUserByUsername(username) {
    return mapUser(
      db
        .prepare(
          "SELECT id, username, display_name, bio, role, status, wallet_balance, created_at, password_hash FROM users WHERE username = ?",
        )
        .get(username),
    );
  }

  function listUsers(currentUserId) {
    return db
      .prepare(`
        SELECT id, username, display_name, bio, role, status, wallet_balance, created_at
        FROM users
        WHERE id <> ? AND status = 'active'
        ORDER BY role DESC, username ASC
      `)
      .all(currentUserId)
      .map(mapUser);
  }

  function createUser({ username, displayName, passwordHash }) {
    const createdAt = now();
    const result = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, bio, role, status, wallet_balance, created_at)
      VALUES (?, ?, ?, '', 'user', 'active', 100000, ?)
    `).run(username, displayName, passwordHash, createdAt);
    return getUserById(Number(result.lastInsertRowid));
  }

  function updateProfile(userId, { displayName, bio }) {
    db.prepare("UPDATE users SET display_name = ?, bio = ? WHERE id = ?").run(
      displayName,
      bio,
      userId,
    );
    return getUserById(userId);
  }

  function updatePassword(userId, passwordHash) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      passwordHash,
      userId,
    );
  }

  function setUserStatus(userId, status) {
    db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, userId);
    return getUserById(userId);
  }

  function createProduct({ sellerId, title, description, price, imageUrl }) {
    const result = db.prepare(`
      INSERT INTO products (seller_id, title, description, price, image_url, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(sellerId, title, description, price, imageUrl, now());
    return getProductById(Number(result.lastInsertRowid));
  }

  function listProducts({ search = "", includeHidden = false } = {}) {
    const where = [];
    const params = [];
    if (!includeHidden) {
      where.push("p.status = 'active'");
    }
    if (search) {
      where.push("(p.title LIKE ? OR p.description LIKE ?)");
      const keyword = `%${search}%`;
      params.push(keyword, keyword);
    }

    const sql = `
      SELECT
        p.*,
        u.username AS seller_username,
        u.display_name AS seller_display_name,
        u.status AS seller_status,
        (
          SELECT COUNT(*)
          FROM reports r
          WHERE r.target_type = 'product' AND r.target_id = p.id
        ) AS report_count
      FROM products p
      JOIN users u ON u.id = p.seller_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.id DESC
    `;

    return db.prepare(sql).all(...params);
  }

  function listProductsBySeller(sellerId) {
    return db
      .prepare(`
        SELECT
          p.*,
          (
            SELECT COUNT(*)
            FROM reports r
            WHERE r.target_type = 'product' AND r.target_id = p.id
          ) AS report_count
        FROM products p
        WHERE p.seller_id = ?
        ORDER BY p.id DESC
      `)
      .all(sellerId);
  }

  function getProductById(productId) {
    return (
      db
        .prepare(`
          SELECT
            p.*,
            u.username AS seller_username,
            u.display_name AS seller_display_name,
            u.status AS seller_status,
            (
              SELECT COUNT(*)
              FROM reports r
              WHERE r.target_type = 'product' AND r.target_id = p.id
            ) AS report_count
          FROM products p
          JOIN users u ON u.id = p.seller_id
          WHERE p.id = ?
        `)
        .get(productId) || null
    );
  }

  function setProductStatus(productId, status) {
    db.prepare("UPDATE products SET status = ? WHERE id = ?").run(status, productId);
    return getProductById(productId);
  }

  function listRecentGlobalMessages(limit = 30) {
    return db
      .prepare(`
        SELECT gm.*, u.username, u.display_name
        FROM global_messages gm
        JOIN users u ON u.id = gm.user_id
        ORDER BY gm.id DESC
        LIMIT ?
      `)
      .all(limit)
      .reverse();
  }

  function addGlobalMessage({ userId, content }) {
    const result = db
      .prepare(
        "INSERT INTO global_messages (user_id, content, created_at) VALUES (?, ?, ?)",
      )
      .run(userId, content, now());
    return db.prepare(`
      SELECT gm.*, u.username, u.display_name
      FROM global_messages gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.id = ?
    `).get(Number(result.lastInsertRowid));
  }

  function listDirectMessages(userId, otherUserId, limit = 60) {
    return db
      .prepare(`
        SELECT dm.*, u.username AS sender_username, u.display_name AS sender_display_name
        FROM direct_messages dm
        JOIN users u ON u.id = dm.sender_id
        WHERE
          (dm.sender_id = ? AND dm.recipient_id = ?)
          OR
          (dm.sender_id = ? AND dm.recipient_id = ?)
        ORDER BY dm.id DESC
        LIMIT ?
      `)
      .all(userId, otherUserId, otherUserId, userId, limit)
      .reverse();
  }

  function addDirectMessage({ senderId, recipientId, content }) {
    const result = db
      .prepare(
        "INSERT INTO direct_messages (sender_id, recipient_id, content, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(senderId, recipientId, content, now());
    return db.prepare(`
      SELECT dm.*, u.username AS sender_username, u.display_name AS sender_display_name
      FROM direct_messages dm
      JOIN users u ON u.id = dm.sender_id
      WHERE dm.id = ?
    `).get(Number(result.lastInsertRowid));
  }

  function listTransfersForUser(userId, limit = 20) {
    return db
      .prepare(`
        SELECT
          t.*,
          sender.username AS sender_username,
          sender.display_name AS sender_display_name,
          recipient.username AS recipient_username,
          recipient.display_name AS recipient_display_name
        FROM transfers t
        JOIN users sender ON sender.id = t.sender_id
        JOIN users recipient ON recipient.id = t.recipient_id
        WHERE t.sender_id = ? OR t.recipient_id = ?
        ORDER BY t.id DESC
        LIMIT ?
      `)
      .all(userId, userId, limit);
  }

  function createTransfer({ senderId, recipientId, productId, amount, note }) {
    if (senderId === recipientId) {
      throw new Error("자기 자신에게는 송금할 수 없습니다.");
    }

    const sender = getUserById(senderId);
    const recipient = getUserById(recipientId);
    if (!sender || !recipient) {
      throw new Error("송금 대상 사용자를 찾을 수 없습니다.");
    }
    if (sender.status !== "active" || recipient.status !== "active") {
      throw new Error("활성 사용자끼리만 송금할 수 있습니다.");
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      const freshSender = getUserById(senderId);
      if (freshSender.wallet_balance < amount) {
        throw new Error("잔액이 부족합니다.");
      }

      db.prepare("UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?").run(
        amount,
        senderId,
      );
      db.prepare("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?").run(
        amount,
        recipientId,
      );
      const result = db.prepare(`
        INSERT INTO transfers (sender_id, recipient_id, product_id, amount, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(senderId, recipientId, productId, amount, note, now());
      db.exec("COMMIT");
      return db.prepare(`
        SELECT
          t.*,
          sender.username AS sender_username,
          sender.display_name AS sender_display_name,
          recipient.username AS recipient_username,
          recipient.display_name AS recipient_display_name
        FROM transfers t
        JOIN users sender ON sender.id = t.sender_id
        JOIN users recipient ON recipient.id = t.recipient_id
        WHERE t.id = ?
      `).get(Number(result.lastInsertRowid));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function createReport({ reporterId, targetType, targetId, reason }) {
    const reporter = getUserById(reporterId);
    if (!reporter || reporter.status !== "active") {
      throw new Error("활성 사용자만 신고할 수 있습니다.");
    }

    if (targetType === "user") {
      const targetUser = getUserById(targetId);
      if (!targetUser) {
        throw new Error("신고 대상 사용자를 찾을 수 없습니다.");
      }
      if (targetUser.id === reporterId) {
        throw new Error("자기 자신은 신고할 수 없습니다.");
      }
    }

    if (targetType === "product") {
      const product = getProductById(targetId);
      if (!product) {
        throw new Error("신고 대상 상품을 찾을 수 없습니다.");
      }
      if (product.seller_id === reporterId) {
        throw new Error("자신의 상품은 신고할 수 없습니다.");
      }
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        INSERT INTO reports (reporter_id, target_type, target_id, reason, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(reporterId, targetType, targetId, reason, now());

      const countRow = db.prepare(`
        SELECT COUNT(*) AS count
        FROM reports
        WHERE target_type = ? AND target_id = ?
      `).get(targetType, targetId);

      let action = null;
      if (countRow.count >= reportThreshold) {
        if (targetType === "product") {
          db.prepare("UPDATE products SET status = 'blocked' WHERE id = ?").run(targetId);
          action = "product_blocked";
        }
        if (targetType === "user") {
          db.prepare("UPDATE users SET status = 'dormant' WHERE id = ?").run(targetId);
          action = "user_dormant";
        }
      }

      db.exec("COMMIT");
      return { reportCount: countRow.count, action };
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE")) {
        throw new Error("같은 대상을 중복 신고할 수 없습니다.");
      }
      throw error;
    }
  }

  function listReports(limit = 100) {
    return db
      .prepare(`
        SELECT
          r.*,
          reporter.username AS reporter_username,
          reporter.display_name AS reporter_display_name
        FROM reports r
        JOIN users reporter ON reporter.id = r.reporter_id
        ORDER BY r.id DESC
        LIMIT ?
      `)
      .all(limit);
  }

  function listAdminUsers() {
    return db
      .prepare(`
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.role,
          u.status,
          u.wallet_balance,
          u.created_at,
          (
            SELECT COUNT(*)
            FROM reports r
            WHERE r.target_type = 'user' AND r.target_id = u.id
          ) AS report_count,
          (
            SELECT COUNT(*)
            FROM products p
            WHERE p.seller_id = u.id
          ) AS product_count
        FROM users u
        ORDER BY u.role DESC, u.id ASC
      `)
      .all();
  }

  function listAdminProducts() {
    return db
      .prepare(`
        SELECT
          p.*,
          u.username AS seller_username,
          u.display_name AS seller_display_name,
          (
            SELECT COUNT(*)
            FROM reports r
            WHERE r.target_type = 'product' AND r.target_id = p.id
          ) AS report_count
        FROM products p
        JOIN users u ON u.id = p.seller_id
        ORDER BY p.id DESC
      `)
      .all();
  }

  function getSummary() {
    return {
      activeUsers: db.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'active'").get()
        .count,
      activeProducts: db
        .prepare("SELECT COUNT(*) AS count FROM products WHERE status = 'active'")
        .get().count,
      blockedProducts: db
        .prepare("SELECT COUNT(*) AS count FROM products WHERE status = 'blocked'")
        .get().count,
      dormantUsers: db
        .prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'dormant'")
        .get().count,
      reportCount: db.prepare("SELECT COUNT(*) AS count FROM reports").get().count,
      transferCount: db.prepare("SELECT COUNT(*) AS count FROM transfers").get().count,
    };
  }

  function close() {
    db.close();
  }

  return {
    addDirectMessage,
    addGlobalMessage,
    close,
    createProduct,
    createReport,
    createTransfer,
    createUser,
    db,
    getProductById,
    getSummary,
    getUserById,
    getUserByUsername,
    listAdminProducts,
    listAdminUsers,
    listDirectMessages,
    listProducts,
    listProductsBySeller,
    listRecentGlobalMessages,
    listReports,
    listTransfersForUser,
    listUsers,
    setProductStatus,
    setUserStatus,
    updatePassword,
    updateProfile,
  };
}

module.exports = { createStore };
