-- PostgreSQL 15 / MySQL 8 均可按类型映射实施。

CREATE TABLE users (
  id VARCHAR(32) PRIMARY KEY,
  nickname VARCHAR(80) NOT NULL,
  avatar_url TEXT,
  wechat_openid VARCHAR(128) UNIQUE,
  phone VARCHAR(32) UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- H5 账号登录凭证。密码只保存 scrypt 派生摘要，邮箱注册必须先完成验证码校验。
CREATE TABLE account_credentials (
  user_id VARCHAR(32) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash CHAR(128) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE email_verification_codes (
  id VARCHAR(32) PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  sent_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMP
);

-- SMTP 凭据由后台维护，password 应在实际数据库中使用密钥管理或加密字段。
CREATE TABLE smtp_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  host VARCHAR(200) NOT NULL,
  port INT NOT NULL DEFAULT 465,
  secure BOOLEAN NOT NULL DEFAULT TRUE,
  username VARCHAR(254) NOT NULL,
  password_ciphertext TEXT NOT NULL,
  from_name VARCHAR(200),
  updated_by VARCHAR(32) REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE tags (
  id VARCHAR(32) PRIMARY KEY,
  dimension VARCHAR(16) NOT NULL CHECK (dimension IN ('platform', 'project', 'skill')),
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (dimension, slug)
);

-- 权限分组不是商品；商品化会员计划通过 membership_plans 关联到分组。
CREATE TABLE member_groups (
  id VARCHAR(32) PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  description TEXT,
  rank INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  permissions_json JSON NOT NULL,
  initial_points BIGINT NOT NULL DEFAULT 0 CHECK (initial_points >= 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- 积分单位名称由管理员维护，所有前端和后台展示读取这一条配置。
CREATE TABLE point_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  unit_name VARCHAR(40) NOT NULL DEFAULT '积分',
  updated_at TIMESTAMP NOT NULL
);

-- 用户购买积分使用一次性兑换码。数据库只保存哈希和尾号，明文 CDKEY 只在后台生成响应中展示一次。
-- 兑换成功后通过 point_ledger 追加积分，不直接修改历史流水。
CREATE TABLE commerce_contact_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  wechat_qr_url TEXT NOT NULL,
  wechat_id VARCHAR(120),
  display_name VARCHAR(120),
  instructions VARCHAR(500),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(32) REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE membership_plans (
  id VARCHAR(32) PRIMARY KEY,
  group_id VARCHAR(32) NOT NULL REFERENCES member_groups(id),
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  billing_period VARCHAR(16) NOT NULL CHECK (billing_period IN ('one_time', 'month', 'quarter', 'year')),
  duration_days INT NOT NULL CHECK (duration_days > 0),
  -- 会员等级由用户消费积分开通；price_minor 保留用于线下收款历史展示和迁移兼容。
  price_points BIGINT NOT NULL DEFAULT 0 CHECK (price_points >= 0),
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  initial_points BIGINT NOT NULL DEFAULT 0 CHECK (initial_points >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- 后台批量生成的积分 CDKEY。明文 code 只返回给管理员一次，兑换接口按 code_hash 查找。
CREATE TABLE cdkeys (
  id VARCHAR(32) PRIMARY KEY,
  batch_id VARCHAR(32),
  code_hash CHAR(64) NOT NULL UNIQUE,
  code_prefix VARCHAR(16) NOT NULL,
  points BIGINT NOT NULL CHECK (points > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'redeemed', 'disabled', 'expired')),
  generated_by VARCHAR(32) NOT NULL REFERENCES users(id),
  redeemed_by VARCHAR(32) REFERENCES users(id),
  redeemed_at TIMESTAMP,
  expires_at TIMESTAMP,
  note VARCHAR(240),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- CDKEY 兑换事件不可删除；points 是兑换时的快照，便于审计和对账。
CREATE TABLE cdkey_redemptions (
  id VARCHAR(32) PRIMARY KEY,
  cdkey_id VARCHAR(32) NOT NULL UNIQUE REFERENCES cdkeys(id),
  user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  points BIGINT NOT NULL CHECK (points > 0),
  ledger_entry_id VARCHAR(32),
  request_id VARCHAR(80),
  ip_address VARCHAR(64),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE posts (
  id VARCHAR(32) PRIMARY KEY,
  author_id VARCHAR(32) NOT NULL REFERENCES users(id),
  title VARCHAR(240) NOT NULL,
  excerpt TEXT,
  content_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'published',
  is_digest BOOLEAN NOT NULL DEFAULT FALSE,
  access_type VARCHAR(16) NOT NULL DEFAULT 'public' CHECK (access_type IN ('public', 'member', 'paid')),
  price_points BIGINT NOT NULL DEFAULT 0 CHECK (price_points >= 0),
  required_group_id VARCHAR(32) REFERENCES member_groups(id),
  allow_tip BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE post_tags (
  post_id VARCHAR(32) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id VARCHAR(32) NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE comments (
  id VARCHAR(32) PRIMARY KEY,
  post_id VARCHAR(32) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  parent_id VARCHAR(32) REFERENCES comments(id),
  content TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'published',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE post_interactions (
  post_id VARCHAR(32) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interaction VARCHAR(16) NOT NULL CHECK (interaction IN ('like', 'favorite', 'anchor')),
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (post_id, user_id, interaction)
);

CREATE TABLE saved_filters (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  filter_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE collections (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(32) REFERENCES users(id),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE collection_posts (
  collection_id VARCHAR(32) NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  post_id VARCHAR(32) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, post_id)
);

-- 商品只保存销售快照；实际可访问资源通过 product_resources 绑定。
CREATE TABLE products (
  id VARCHAR(32) PRIMARY KEY,
  product_type VARCHAR(16) NOT NULL CHECK (product_type IN ('content', 'bundle', 'membership')),
  name VARCHAR(160) NOT NULL,
  description TEXT,
  membership_plan_id VARCHAR(32) REFERENCES membership_plans(id),
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  stock_limit INT,
  created_by VARCHAR(32) REFERENCES users(id),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE product_resources (
  product_id VARCHAR(32) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  resource_type VARCHAR(16) NOT NULL CHECK (resource_type IN ('post', 'collection')),
  resource_id VARCHAR(32) NOT NULL,
  PRIMARY KEY (product_id, resource_type, resource_id)
);

CREATE TABLE coupons (
  id VARCHAR(32) PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  discount_type VARCHAR(16) NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
  discount_value BIGINT NOT NULL CHECK (discount_value >= 0),
  max_discount_minor BIGINT,
  min_order_minor BIGINT NOT NULL DEFAULT 0,
  total_limit INT,
  per_user_limit INT NOT NULL DEFAULT 1,
  claimed_count INT NOT NULL DEFAULT 0,
  used_count INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(32) REFERENCES users(id),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE coupon_products (
  coupon_id VARCHAR(32) NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  product_id VARCHAR(32) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, product_id)
);

CREATE TABLE orders (
  id VARCHAR(32) PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('content', 'membership', 'tip')),
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'partially_refunded', 'refunded')),
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  total_amount_minor BIGINT NOT NULL CHECK (total_amount_minor >= 0),
  discount_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount_minor >= 0),
  payable_amount_minor BIGINT NOT NULL CHECK (payable_amount_minor >= 0),
  points_amount BIGINT NOT NULL DEFAULT 0 CHECK (points_amount >= 0),
  points_unit_name VARCHAR(40),
  coupon_id VARCHAR(32) REFERENCES coupons(id),
  idempotency_key VARCHAR(128) NOT NULL,
  metadata_json JSON,
  paid_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

-- 用户当前和历史会员关系；支付成功后才写入 active 记录。
CREATE TABLE user_memberships (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id VARCHAR(32) NOT NULL REFERENCES member_groups(id),
  plan_id VARCHAR(32) REFERENCES membership_plans(id),
  source_order_id VARCHAR(32) REFERENCES orders(id),
  source_cdkey_id VARCHAR(32) REFERENCES cdkeys(id),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'refunded')),
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE order_items (
  id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id VARCHAR(32) REFERENCES products(id),
  resource_type VARCHAR(16),
  resource_id VARCHAR(32),
  name_snapshot VARCHAR(160) NOT NULL,
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  unit_price_points BIGINT NOT NULL DEFAULT 0 CHECK (unit_price_points >= 0),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  amount_points BIGINT NOT NULL DEFAULT 0 CHECK (amount_points >= 0),
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE payment_transactions (
  id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL REFERENCES orders(id),
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('wechat', 'alipay', 'manual')),
  provider_transaction_id VARCHAR(128),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  raw_payload_json JSON,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (provider, provider_transaction_id)
);

CREATE TABLE refunds (
  id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL REFERENCES orders(id),
  payment_id VARCHAR(32) REFERENCES payment_transactions(id),
  refund_no VARCHAR(64) NOT NULL UNIQUE,
  provider_refund_id VARCHAR(128),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason VARCHAR(240),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  requested_by VARCHAR(32) REFERENCES users(id),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE coupon_redemptions (
  id VARCHAR(32) PRIMARY KEY,
  coupon_id VARCHAR(32) NOT NULL REFERENCES coupons(id),
  user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  order_id VARCHAR(32) NOT NULL REFERENCES orders(id),
  discount_amount_minor BIGINT NOT NULL CHECK (discount_amount_minor >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'used', 'released')),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE (coupon_id, user_id, order_id)
);

-- 权益表同时承载会员资格、单篇内容和专题集合权益。
CREATE TABLE user_entitlements (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_type VARCHAR(16) NOT NULL CHECK (entitlement_type IN ('membership', 'post', 'collection')),
  resource_id VARCHAR(32) NOT NULL,
  source_order_id VARCHAR(32) REFERENCES orders(id),
  source_order_item_id VARCHAR(32) REFERENCES order_items(id),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'refunded')),
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE tips (
  id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) UNIQUE REFERENCES orders(id),
  sender_user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  recipient_user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  post_id VARCHAR(32) REFERENCES posts(id),
  points BIGINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  net_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (net_amount_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  message VARCHAR(500),
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'rejected')),
  settlement_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'batched', 'settled', 'held')),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- 积分只通过管理员线下充值、会员赠送或消费流水变动；流水不可删除或覆盖。
CREATE TABLE point_accounts (
  user_id VARCHAR(32) PRIMARY KEY REFERENCES users(id),
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE point_ledger (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  delta BIGINT NOT NULL CHECK (delta <> 0),
  balance_before BIGINT NOT NULL CHECK (balance_before >= 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  entry_type VARCHAR(32) NOT NULL,
  reason VARCHAR(240),
  source_id VARCHAR(64),
  note VARCHAR(500),
  actor_user_id VARCHAR(32),
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE creator_settlements (
  id VARCHAR(32) PRIMARY KEY,
  recipient_user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  gross_amount_minor BIGINT NOT NULL DEFAULT 0,
  fee_amount_minor BIGINT NOT NULL DEFAULT 0,
  net_amount_minor BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'paid', 'failed')),
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE content_reports (
  id VARCHAR(32) PRIMARY KEY,
  reporter_user_id VARCHAR(32) REFERENCES users(id),
  post_id VARCHAR(32) REFERENCES posts(id),
  comment_id VARCHAR(32) REFERENCES comments(id),
  reason VARCHAR(40) NOT NULL,
  description TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'resolved', 'rejected')),
  handled_by VARCHAR(32) REFERENCES users(id),
  resolution TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE admin_roles (
  id VARCHAR(32) PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE user_admin_roles (
  user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id VARCHAR(32) NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE audit_logs (
  id VARCHAR(32) PRIMARY KEY,
  actor_user_id VARCHAR(32) REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(40) NOT NULL,
  resource_id VARCHAR(32),
  before_json JSON,
  after_json JSON,
  request_id VARCHAR(80),
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX posts_published_idx ON posts (published_at DESC);
CREATE INDEX posts_digest_idx ON posts (is_digest, published_at DESC);
CREATE INDEX post_tags_tag_idx ON post_tags (tag_id, post_id);
CREATE INDEX comments_post_idx ON comments (post_id, created_at DESC);
CREATE INDEX saved_filters_user_idx ON saved_filters (user_id, updated_at DESC);
CREATE INDEX user_memberships_user_idx ON user_memberships (user_id, status, ends_at DESC);
CREATE INDEX cdkeys_status_idx ON cdkeys (status, created_at DESC);
CREATE INDEX cdkeys_batch_idx ON cdkeys (batch_id, created_at DESC);
CREATE INDEX cdkey_redemptions_user_idx ON cdkey_redemptions (user_id, created_at DESC);
CREATE INDEX product_resources_resource_idx ON product_resources (resource_type, resource_id);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX payment_transactions_order_idx ON payment_transactions (order_id, created_at DESC);
CREATE INDEX refunds_order_idx ON refunds (order_id, created_at DESC);
CREATE INDEX coupon_redemptions_user_idx ON coupon_redemptions (user_id, created_at DESC);
CREATE INDEX user_entitlements_lookup_idx ON user_entitlements (user_id, entitlement_type, resource_id, status, ends_at);
CREATE INDEX tips_recipient_idx ON tips (recipient_user_id, created_at DESC);
CREATE INDEX tips_sender_idx ON tips (sender_user_id, created_at DESC);
CREATE INDEX point_ledger_user_idx ON point_ledger (user_id, created_at DESC);
CREATE INDEX point_ledger_type_idx ON point_ledger (entry_type, created_at DESC);
CREATE INDEX creator_settlements_recipient_idx ON creator_settlements (recipient_user_id, created_at DESC);
CREATE INDEX content_reports_status_idx ON content_reports (status, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, created_at DESC);

