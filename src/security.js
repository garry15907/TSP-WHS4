const bcrypt = require("bcryptjs");
const { z } = require("zod");

const usernameSchema = z
  .string()
  .min(4, "아이디는 4자 이상이어야 합니다.")
  .max(24, "아이디는 24자 이하여야 합니다.")
  .regex(/^[a-zA-Z0-9_]+$/, "아이디는 영문, 숫자, 밑줄만 사용할 수 있습니다.");

const passwordSchema = z
  .string()
  .min(10, "비밀번호는 10자 이상이어야 합니다.")
  .max(72, "비밀번호는 72자 이하여야 합니다.")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/,
    "비밀번호는 대문자, 소문자, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.",
  );

const displayNameSchema = z
  .string()
  .min(2, "표시 이름은 2자 이상이어야 합니다.")
  .max(30, "표시 이름은 30자 이하여야 합니다.");

const registerSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "비밀번호를 입력하세요."),
});

const profileSchema = z.object({
  displayName: displayNameSchema,
  bio: z
    .string()
    .max(300, "소개글은 300자 이하여야 합니다.")
    .default(""),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "현재 비밀번호를 입력하세요."),
  newPassword: passwordSchema,
});

const productSchema = z.object({
  title: z.string().min(4, "상품명은 4자 이상이어야 합니다.").max(80),
  description: z
    .string()
    .min(10, "상품 설명은 10자 이상이어야 합니다.")
    .max(1200),
  price: z.coerce
    .number()
    .int("가격은 정수여야 합니다.")
    .min(100, "가격은 100원 이상이어야 합니다.")
    .max(100000000, "가격이 너무 큽니다."),
  imageUrl: z
    .string()
    .url("이미지 URL 형식이 올바르지 않습니다.")
    .refine(
      (value) => value.startsWith("https://") || value.startsWith("http://"),
      "이미지 URL은 http 또는 https로 시작해야 합니다.",
    ),
});

const reportSchema = z.object({
  reason: z
    .string()
    .min(10, "신고 사유는 10자 이상 작성하세요.")
    .max(500, "신고 사유는 500자 이하여야 합니다."),
});

const transferSchema = z.object({
  recipientId: z.coerce.number().int().positive(),
  amount: z.coerce
    .number()
    .int("송금 금액은 정수여야 합니다.")
    .min(100, "송금 금액은 100원 이상이어야 합니다.")
    .max(100000000, "송금 금액이 너무 큽니다."),
  note: z.string().min(4, "메모는 4자 이상이어야 합니다.").max(140),
  productId: z
    .union([z.coerce.number().int().positive(), z.literal("")])
    .optional()
    .transform((value) => (value === "" || value == null ? null : value)),
});

const chatSchema = z.object({
  content: z
    .string()
    .min(1, "메시지를 입력하세요.")
    .max(300, "메시지는 300자 이하여야 합니다."),
});

function normalizeText(value, { multiline = false } = {}) {
  const source = String(value ?? "");
  const cleaned = multiline
    ? source.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    : source.replace(/[\u0000-\u001F\u007F]/g, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(value) {
  const source = String(value ?? "");
  const cleaned = source.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseOrThrow(schema, input, transforms = {}) {
  const prepared = { ...input };
  for (const [key, mode] of Object.entries(transforms)) {
    if (mode === "line") {
      prepared[key] = normalizeText(prepared[key], { multiline: false });
    }
    if (mode === "multiline") {
      prepared[key] = normalizeMultilineText(prepared[key]);
    }
  }
  const result = schema.safeParse(prepared);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message || "입력값이 올바르지 않습니다.");
  }
  return result.data;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compareSync(password, passwordHash);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

module.exports = {
  chatSchema,
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
};
