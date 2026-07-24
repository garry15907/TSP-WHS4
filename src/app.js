const path = require("node:path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { csrfSync } = require("csrf-sync");
const {
  formatCurrency,
  formatDate,
  hashPassword,
  loginSchema,
  parseOrThrow,
  passwordChangeSchema,
  productSchema,
  profileSchema,
  registerSchema,
  reportSchema,
  transferSchema,
  verifyPassword,
} = require("./security");

function createSessionMiddleware(config) {
  return session({
    name: "tiny_market_sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    },
  });
}

function createApp({ config, store, sessionMiddleware = createSessionMiddleware(config) }) {
  const app = express();
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "인증 요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  });
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  });
  const csrfTools = csrfSync({
    getTokenFromRequest: (req) => req.body.csrfToken || req.headers["x-csrf-token"],
  });

  app.set("view engine", "ejs");
  app.set("views", path.join(config.rootDir, "views"));
  app.locals.formatCurrency = formatCurrency;
  app.locals.formatDate = formatDate;
  app.locals.appName = "Tiny Second-hand Shopping Platform";

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "10kb" }));
  app.use(express.json({ limit: "10kb" }));
  app.use(sessionMiddleware);
  app.use(generalLimiter);
  app.use(express.static(path.join(config.rootDir, "public")));

  app.use((req, res, next) => {
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    next();
  });

  app.use((req, res, next) => {
    const userId = req.session.userId;
    if (!userId) {
      req.user = null;
      res.locals.currentUser = null;
      return next();
    }

    const user = store.getUserById(userId);
    if (!user || user.status !== "active") {
      req.session.destroy(() => {});
      req.user = null;
      res.locals.currentUser = null;
      return res.redirect("/login");
    }

    req.user = user;
    res.locals.currentUser = user;
    next();
  });

  app.use((req, res, next) => {
    res.locals.csrfToken = csrfTools.generateToken(req);
    next();
  });
  app.use(csrfTools.csrfSynchronisedProtection);

  function setFlash(req, type, message) {
    req.session.flash = { type, message };
  }

  function requireAuth(req, res, next) {
    if (!req.user) {
      setFlash(req, "error", "로그인이 필요합니다.");
      return res.redirect("/login");
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin) {
      return res.status(403).render("error", {
        pageTitle: "권한 없음",
        message: "관리자만 접근할 수 있습니다.",
      });
    }
    next();
  }

  function redirectBack(req, fallback) {
    return req.get("referer") || fallback;
  }

  app.get("/", (req, res) => {
    if (req.user) {
      return res.redirect("/market");
    }
    return res.redirect("/login");
  });

  app.get("/register", (req, res) => {
    if (req.user) {
      return res.redirect("/market");
    }
    return res.render("register", { pageTitle: "회원가입" });
  });

  app.post("/register", authLimiter, (req, res) => {
    try {
      const payload = parseOrThrow(registerSchema, req.body, {
        username: "line",
        displayName: "line",
        password: "line",
      });

      if (store.getUserByUsername(payload.username)) {
        throw new Error("이미 사용 중인 아이디입니다.");
      }

      store.createUser({
        username: payload.username,
        displayName: payload.displayName,
        passwordHash: hashPassword(payload.password),
      });
      setFlash(req, "success", "회원가입이 완료되었습니다. 로그인해 주세요.");
      return res.redirect("/login");
    } catch (error) {
      setFlash(req, "error", error.message);
      return res.redirect("/register");
    }
  });

  app.get("/login", (req, res) => {
    if (req.user) {
      return res.redirect("/market");
    }
    return res.render("login", { pageTitle: "로그인" });
  });

  app.post("/login", authLimiter, (req, res) => {
    try {
      const payload = parseOrThrow(loginSchema, req.body, {
        username: "line",
        password: "line",
      });
      const user = store.getUserByUsername(payload.username);
      if (!user || !verifyPassword(payload.password, user.password_hash)) {
        throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
      }
      if (user.status !== "active") {
        throw new Error("현재 계정 상태로는 로그인할 수 없습니다. 관리자에게 문의하세요.");
      }
      req.session.userId = user.id;
      setFlash(req, "success", `${user.display_name}님, 로그인되었습니다.`);
      return res.redirect("/market");
    } catch (error) {
      setFlash(req, "error", error.message);
      return res.redirect("/login");
    }
  });

  app.post("/logout", requireAuth, (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  app.get("/market", requireAuth, (req, res) => {
    const search = String(req.query.q || "").trim();
    return res.render("market", {
      pageTitle: "마켓",
      products: store.listProducts({ search }),
      users: store.listUsers(req.user.id),
      transfers: store.listTransfersForUser(req.user.id, 8),
      globalMessages: store.listRecentGlobalMessages(30),
      search,
    });
  });

  app.get("/products/new", requireAuth, (req, res) => {
    return res.render("product-form", { pageTitle: "상품 등록" });
  });

  app.post("/products", requireAuth, (req, res) => {
    try {
      const payload = parseOrThrow(productSchema, req.body, {
        title: "line",
        description: "multiline",
        imageUrl: "line",
      });
      const product = store.createProduct({
        sellerId: req.user.id,
        title: payload.title,
        description: payload.description,
        price: payload.price,
        imageUrl: payload.imageUrl,
      });
      setFlash(req, "success", "상품이 등록되었습니다.");
      return res.redirect(`/products/${product.id}`);
    } catch (error) {
      setFlash(req, "error", error.message);
      return res.redirect("/products/new");
    }
  });

  app.get("/products/:id", requireAuth, (req, res) => {
    const product = store.getProductById(Number(req.params.id));
    if (!product) {
      return res.status(404).render("error", {
        pageTitle: "상품 없음",
        message: "요청한 상품을 찾을 수 없습니다.",
      });
    }
    if (
      product.status !== "active" &&
      product.seller_id !== req.user.id &&
      !req.user.isAdmin
    ) {
      return res.status(404).render("error", {
        pageTitle: "상품 없음",
        message: "요청한 상품을 찾을 수 없습니다.",
      });
    }

    return res.render("product-detail", {
      pageTitle: product.title,
      product,
      seller: store.getUserById(product.seller_id),
    });
  });

  app.get("/profile", requireAuth, (req, res) => {
    return res.render("profile", {
      pageTitle: "마이페이지",
      transfers: store.listTransfersForUser(req.user.id, 20),
    });
  });

  app.post("/profile", requireAuth, (req, res) => {
    try {
      const payload = parseOrThrow(profileSchema, req.body, {
        displayName: "line",
        bio: "multiline",
      });
      store.updateProfile(req.user.id, payload);
      setFlash(req, "success", "프로필이 업데이트되었습니다.");
    } catch (error) {
      setFlash(req, "error", error.message);
    }
    return res.redirect("/profile");
  });

  app.post("/profile/password", requireAuth, (req, res) => {
    try {
      const payload = parseOrThrow(passwordChangeSchema, req.body, {
        currentPassword: "line",
        newPassword: "line",
      });
      const user = store.getUserById(req.user.id);
      if (!verifyPassword(payload.currentPassword, user.password_hash)) {
        throw new Error("현재 비밀번호가 올바르지 않습니다.");
      }
      store.updatePassword(req.user.id, hashPassword(payload.newPassword));
      setFlash(req, "success", "비밀번호가 변경되었습니다.");
    } catch (error) {
      setFlash(req, "error", error.message);
    }
    return res.redirect("/profile");
  });

  app.get("/my/products", requireAuth, (req, res) => {
    return res.render("my-products", {
      pageTitle: "내 상품 관리",
      products: store.listProductsBySeller(req.user.id),
    });
  });

  app.post("/my/products/:id/status", requireAuth, (req, res) => {
    const product = store.getProductById(Number(req.params.id));
    const nextStatus = String(req.body.status || "");
    if (!product || product.seller_id !== req.user.id) {
      setFlash(req, "error", "관리할 수 없는 상품입니다.");
      return res.redirect("/my/products");
    }
    if (!["sold", "deleted", "active"].includes(nextStatus)) {
      setFlash(req, "error", "허용되지 않는 상태값입니다.");
      return res.redirect("/my/products");
    }
    store.setProductStatus(product.id, nextStatus);
    setFlash(req, "success", "상품 상태가 변경되었습니다.");
    return res.redirect("/my/products");
  });

  app.post("/products/:id/report", requireAuth, (req, res) => {
    try {
      const payload = parseOrThrow(reportSchema, req.body, { reason: "multiline" });
      const result = store.createReport({
        reporterId: req.user.id,
        targetType: "product",
        targetId: Number(req.params.id),
        reason: payload.reason,
      });
      const message =
        result.action === "product_blocked"
          ? `신고가 접수되었고, 누적 신고 ${result.reportCount}회로 상품이 자동 차단되었습니다.`
          : `신고가 접수되었습니다. 현재 누적 신고 ${result.reportCount}회입니다.`;
      setFlash(req, "success", message);
    } catch (error) {
      setFlash(req, "error", error.message);
    }
    return res.redirect(redirectBack(req, "/market"));
  });

  app.post("/users/:id/report", requireAuth, (req, res) => {
    try {
      const payload = parseOrThrow(reportSchema, req.body, { reason: "multiline" });
      const result = store.createReport({
        reporterId: req.user.id,
        targetType: "user",
        targetId: Number(req.params.id),
        reason: payload.reason,
      });
      const message =
        result.action === "user_dormant"
          ? `신고가 접수되었고, 누적 신고 ${result.reportCount}회로 계정이 휴면 전환되었습니다.`
          : `신고가 접수되었습니다. 현재 누적 신고 ${result.reportCount}회입니다.`;
      setFlash(req, "success", message);
    } catch (error) {
      setFlash(req, "error", error.message);
    }
    return res.redirect(redirectBack(req, "/market"));
  });

  app.get("/users/:id/messages", requireAuth, (req, res) => {
    const otherUser = store.getUserById(Number(req.params.id));
    if (!otherUser || otherUser.id === req.user.id) {
      return res.status(404).render("error", {
        pageTitle: "대화 대상 없음",
        message: "대화할 사용자를 찾을 수 없습니다.",
      });
    }
    return res.render("direct-messages", {
      pageTitle: `${otherUser.display_name}님과의 대화`,
      otherUser,
      messages: store.listDirectMessages(req.user.id, otherUser.id, 80),
    });
  });

  app.post("/transfers", requireAuth, (req, res) => {
    try {
      const payload = parseOrThrow(transferSchema, req.body, { note: "line" });
      const transfer = store.createTransfer({
        senderId: req.user.id,
        recipientId: payload.recipientId,
        amount: payload.amount,
        note: payload.note,
        productId: payload.productId,
      });
      setFlash(
        req,
        "success",
        `${transfer.recipient_display_name}님에게 ${formatCurrency(transfer.amount)}원을 송금했습니다.`,
      );
      if (transfer.product_id) {
        return res.redirect(`/products/${transfer.product_id}`);
      }
      return res.redirect("/market");
    } catch (error) {
      setFlash(req, "error", error.message);
      return res.redirect(redirectBack(req, "/market"));
    }
  });

  app.get("/admin", requireAuth, requireAdmin, (req, res) => {
    return res.render("admin", {
      pageTitle: "관리자 대시보드",
      summary: store.getSummary(),
      users: store.listAdminUsers(),
      products: store.listAdminProducts(),
      reports: store.listReports(80),
    });
  });

  app.post("/admin/users/:id/status", requireAuth, requireAdmin, (req, res) => {
    const nextStatus = String(req.body.status || "");
    if (!["active", "dormant", "banned"].includes(nextStatus)) {
      setFlash(req, "error", "허용되지 않는 사용자 상태입니다.");
      return res.redirect("/admin");
    }
    store.setUserStatus(Number(req.params.id), nextStatus);
    setFlash(req, "success", "사용자 상태가 변경되었습니다.");
    return res.redirect("/admin");
  });

  app.post("/admin/products/:id/status", requireAuth, requireAdmin, (req, res) => {
    const nextStatus = String(req.body.status || "");
    if (!["active", "blocked", "sold", "deleted"].includes(nextStatus)) {
      setFlash(req, "error", "허용되지 않는 상품 상태입니다.");
      return res.redirect("/admin");
    }
    store.setProductStatus(Number(req.params.id), nextStatus);
    setFlash(req, "success", "상품 상태가 변경되었습니다.");
    return res.redirect("/admin");
  });

  app.use((req, res) => {
    res.status(404).render("error", {
      pageTitle: "페이지 없음",
      message: "요청한 페이지를 찾을 수 없습니다.",
    });
  });

  app.use((error, req, res, next) => {
    if (error === csrfTools.invalidCsrfTokenError) {
      setFlash(req, "error", "잘못된 요청 토큰입니다. 다시 시도해 주세요.");
      return res.redirect(redirectBack(req, "/market"));
    }
    console.error(error);
    return res.status(500).render("error", {
      pageTitle: "서버 오류",
      message: "예상하지 못한 오류가 발생했습니다.",
    });
  });

  return app;
}

module.exports = { createApp, createSessionMiddleware };
