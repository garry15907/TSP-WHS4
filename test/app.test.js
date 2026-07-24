const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const { createApp, createSessionMiddleware } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createStore } = require("../src/db");
const { hashPassword } = require("../src/security");

function extractCsrf(body) {
  const match = body.match(/name="csrfToken" value="([^"]+)"/);
  if (!match) {
    throw new Error("CSRF token not found");
  }
  return match[1];
}

function buildHarness() {
  const rootDir = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiny-market-"));
  const config = loadConfig({
    rootDir,
    dbPath: path.join(tmpDir, "test.sqlite"),
    sessionSecret: "test-secret",
    adminPassword: "AdminPass123!",
  });
  const store = createStore({
    dbPath: config.dbPath,
    reportThreshold: 3,
    adminSeed: {
      ...config.adminSeed,
      passwordHash: hashPassword(config.adminSeed.password),
    },
  });
  const sessionMiddleware = createSessionMiddleware(config);
  const app = createApp({ config, store, sessionMiddleware });

  return {
    app,
    store,
    cleanup() {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

test("user can register and log in", async () => {
  const harness = buildHarness();
  const agent = request.agent(harness.app);

  try {
    const registerPage = await agent.get("/register").expect(200);
    const registerCsrf = extractCsrf(registerPage.text);
    await agent
      .post("/register")
      .type("form")
      .send({
        csrfToken: registerCsrf,
        username: "tester1",
        displayName: "테스터1",
        password: "StrongPass123!",
      })
      .expect(302);

    const loginPage = await agent.get("/login").expect(200);
    const loginCsrf = extractCsrf(loginPage.text);
    const loginResponse = await agent
      .post("/login")
      .type("form")
      .send({
        csrfToken: loginCsrf,
        username: "tester1",
        password: "StrongPass123!",
      })
      .expect(302);

    assert.equal(loginResponse.headers.location, "/market");
  } finally {
    harness.cleanup();
  }
});

test("product report threshold blocks the product", async () => {
  const harness = buildHarness();
  try {
    const seller = harness.store.createUser({
      username: "seller1",
      displayName: "판매자",
      passwordHash: hashPassword("SellerPass123!"),
    });
    const reporterA = harness.store.createUser({
      username: "reporta",
      displayName: "신고자A",
      passwordHash: hashPassword("ReporterA123!"),
    });
    const reporterB = harness.store.createUser({
      username: "reportb",
      displayName: "신고자B",
      passwordHash: hashPassword("ReporterB123!"),
    });
    const reporterC = harness.store.createUser({
      username: "reportc",
      displayName: "신고자C",
      passwordHash: hashPassword("ReporterC123!"),
    });
    const product = harness.store.createProduct({
      sellerId: seller.id,
      title: "맥북 판매",
      description: "실사용 6개월, 상태 좋음",
      price: 500000,
      imageUrl: "https://example.com/macbook.jpg",
    });

    for (const user of [reporterA, reporterB, reporterC]) {
      harness.store.createReport({
        reporterId: user.id,
        targetType: "product",
        targetId: product.id,
        reason: "사기성 판매가 의심됩니다. 상세 검토가 필요합니다.",
      });
    }

    const blockedProduct = harness.store.getProductById(product.id);
    assert.equal(blockedProduct.status, "blocked");
  } finally {
    harness.cleanup();
  }
});

test("transfer moves wallet balance between users", async () => {
  const harness = buildHarness();
  try {
    const sender = harness.store.createUser({
      username: "sender1",
      displayName: "보내는사람",
      passwordHash: hashPassword("SenderPass123!"),
    });
    const recipient = harness.store.createUser({
      username: "recv1",
      displayName: "받는사람",
      passwordHash: hashPassword("RecvPass123!"),
    });

    harness.store.createTransfer({
      senderId: sender.id,
      recipientId: recipient.id,
      productId: null,
      amount: 15000,
      note: "테스트 송금",
    });

    const freshSender = harness.store.getUserById(sender.id);
    const freshRecipient = harness.store.getUserById(recipient.id);
    assert.equal(freshSender.wallet_balance, 85000);
    assert.equal(freshRecipient.wallet_balance, 115000);
  } finally {
    harness.cleanup();
  }
});
