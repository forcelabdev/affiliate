-- Affiliate Management Schema for Neon PostgreSQL

-- Super admins, admins, partners table
CREATE TABLE IF NOT EXISTS affiliate_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  role VARCHAR(20) NOT NULL CHECK (role IN ('superadmin', 'admin', 'partner')),
  ref_code VARCHAR(50) UNIQUE,
  commission_rate DECIMAL(5, 2) DEFAULT 10,
  commission_type VARCHAR(20) CHECK (commission_type IN ('deposit', 'net')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

-- Affiliate transfer logs
CREATE TABLE IF NOT EXISTS affiliate_transfer_logs (
  id SERIAL PRIMARY KEY,
  from_user_id VARCHAR(255) NOT NULL,
  from_username VARCHAR(50) NOT NULL,
  to_partner_id VARCHAR(255) NOT NULL,
  to_partner_username VARCHAR(50) NOT NULL,
  performed_by VARCHAR(50) NOT NULL,
  performed_by_role VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'completed',
  reason TEXT,
  ip_address VARCHAR(45),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Affiliate commission tracking
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id SERIAL PRIMARY KEY,
  affiliate_username VARCHAR(50) NOT NULL REFERENCES affiliate_users(username),
  user_id VARCHAR(255) NOT NULL,
  amount DECIMAL(15, 2) NOT NULL,
  commission_rate DECIMAL(5, 2),
  earned_amount DECIMAL(15, 2),
  transaction_type VARCHAR(20) CHECK (transaction_type IN ('deposit', 'net_loss')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP
);

-- Affiliate statistics cache (for performance)
CREATE TABLE IF NOT EXISTS affiliate_stats (
  id SERIAL PRIMARY KEY,
  affiliate_username VARCHAR(50) UNIQUE NOT NULL REFERENCES affiliate_users(username),
  total_referrals INT DEFAULT 0,
  total_deposits DECIMAL(15, 2) DEFAULT 0,
  total_commissions DECIMAL(15, 2) DEFAULT 0,
  total_earned DECIMAL(15, 2) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_affiliate_users_username ON affiliate_users(username);
CREATE INDEX IF NOT EXISTS idx_affiliate_users_role ON affiliate_users(role);
CREATE INDEX IF NOT EXISTS idx_affiliate_users_ref_code ON affiliate_users(ref_code);
CREATE INDEX IF NOT EXISTS idx_transfer_logs_timestamp ON affiliate_transfer_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON affiliate_commissions(affiliate_username);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON affiliate_commissions(status);
