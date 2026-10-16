const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const Referral = require('./Referral');

class User {
  static async findById(id) {
    const [rows] = await db.query(
      `SELECT u.*, p.name as package_name, p.slug as package_slug,
              c.balance as credit_balance, c.total_earned as credit_total_earned, c.total_spent as credit_total_spent
       FROM users u
       LEFT JOIN packages p ON u.package_id = p.id
       LEFT JOIN credits c ON u.id = c.user_id
       WHERE u.id = ? AND u.deleted_at IS NULL`, [id]
    );
    return rows[0] || null;
  }

  static async findByUuid(uuid) {
    const [rows] = await db.query(
      `SELECT u.*, p.name as package_name, p.slug as package_slug,
              c.balance as credit_balance, c.total_earned as credit_total_earned, c.total_spent as credit_total_spent
       FROM users u
       LEFT JOIN packages p ON u.package_id = p.id
       LEFT JOIN credits c ON u.id = c.user_id
       WHERE u.uuid = ? AND u.deleted_at IS NULL`, [uuid]
    );
    return rows[0] || null;
  }

  static async findByEmail(email) {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email]
    );
    return rows[0] || null;
  }

  static async findByUsername(username) {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL', [username]
    );
    return rows[0] || null;
  }

  static async findByReferralCode(code) {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE referral_code = ? AND deleted_at IS NULL', [code]
    );
    return rows[0] || null;
  }

  static async create(data) {
    const uuid = uuidv4();
    const hash = await bcrypt.hash(data.password, 12);

    // Generate unique referral code for new user
    const referralCode = await Referral.createUniqueCode();

    const [result] = await db.query(
      `INSERT INTO users (
        uuid,
        username,
        email,
        password_hash,
        full_name,
        role,
        is_active,
        package_id,
        referral_code
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`,
      [
        uuid,
        data.username,
        data.email,
        hash,
        data.fullName || data.username,
        data.role || 'user',
        referralCode
      ]
    );

    return this.findById(result.insertId);
  }

  static async update(id, data) {
    const fields = [];
    const values = [];
    const allowed = ['full_name', 'email', 'role', 'is_active', 'is_verified', 'package_id', 'custom_rate_limit', 'avatar', 'referral_code', 'google_id'];

    for (const field of allowed) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  static async updatePassword(id, newPassword) {
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  }

  static async updateLastLogin(id, ip) {
    await db.query('UPDATE users SET last_login = NOW(), last_login_ip = ? WHERE id = ?', [ip, id]);
  }

  static async verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
  }

  static async listAll({ page = 1, limit = 20, search = '', role = '', status = '' } = {}) {
    let where = 'u.deleted_at IS NULL';
    const params = [];

    if (search) {
      where += ' AND (u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (role) { where += ' AND u.role = ?'; params.push(role); }
    if (status !== '') { where += ' AND u.is_active = ?'; params.push(status === 'active' ? 1 : 0); }

    const [countResult] = await db.query(`SELECT COUNT(*) as total FROM users u WHERE ${where}`, params);
    const total = countResult[0].total;

    const offset = (page - 1) * limit;
    const [rows] = await db.query(
      `SELECT u.id, u.uuid, u.username, u.email, u.full_name, u.role, u.is_active, u.is_verified,
              u.avatar, u.last_login, u.created_at,
              p.name as package_name,
              c.balance as credit_balance,
              (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id) as api_key_count
       FROM users u
       LEFT JOIN packages p ON u.package_id = p.id
       LEFT JOIN credits c ON u.id = c.user_id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { users: rows, total };
  }

  static async count(filters = {}) {
    let where = 'deleted_at IS NULL';
    const params = [];
    if (filters.role) { where += ' AND role = ?'; params.push(filters.role); }
    if (filters.active !== undefined) { where += ' AND is_active = ?'; params.push(filters.active ? 1 : 0); }
    const [rows] = await db.query(`SELECT COUNT(*) as total FROM users WHERE ${where}`, params);
    return rows[0].total;
  }

  static async softDelete(id) {
    await db.query('UPDATE users SET deleted_at = NOW() WHERE id = ? AND role != "admin"', [id]);
  }

  // Hard delete user and all related data
  static async hardDeleteByUuid(uuid) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      console.log('--- Mulai proses hapus user dengan UUID:', uuid);

      const [users] = await conn.query('SELECT id, role, avatar FROM users WHERE uuid = ?', [uuid]);
      if (users.length === 0) {
        throw new Error('User not found di database');
      }
      const user = users[0];
      console.log('User ditemukan:', user.id, user.role);

      if (user.role === 'admin') {
        throw new Error('Tidak dapat menghapus user admin');
      }

      const userId = user.id;

      if (user.avatar) {
        const fs = require('fs');
        const path = require('path');
        const avatarPath = path.join(__dirname, '../../public', user.avatar);
        
        if (fs.existsSync(avatarPath)) {
          try {
            fs.unlinkSync(avatarPath);
            console.log('Avatar berhasil dihapus dari server');
          } catch (fileErr) {
            console.error('Gagal menghapus file avatar:', fileErr.message);
          }
        }
      }

      await conn.query('DELETE FROM request_logs WHERE user_id = ?', [userId]);
      await conn.query('DELETE FROM credit_transactions WHERE user_id = ?', [userId]);
      await conn.query('DELETE FROM credits WHERE user_id = ?', [userId]);

      const [apiKeys] = await conn.query('SELECT id FROM api_keys WHERE user_id = ?', [userId]);
      if (apiKeys.length > 0) {
        for (const key of apiKeys) {
          await conn.query('DELETE FROM rate_limits WHERE api_key_id = ?', [key.id]);
        }
      }

      await conn.query('DELETE FROM api_keys WHERE user_id = ?', [userId]);
      await conn.query('DELETE FROM transactions WHERE user_id = ?', [userId]);
      
      const [deleteResult] = await conn.query('DELETE FROM users WHERE uuid = ?', [uuid]);
      console.log('Hasil eksekusi DELETE users:', deleteResult);

      await conn.commit();
      console.log('--- Transaksi COMMIT berhasil, data terhapus permanen');
      return true;
    } catch (err) {
      await conn.rollback();
      console.error('--- Transaksi ROLLBACK karena error:', err.message);
      throw err;
    } finally {
      conn.release();
    }
  }
  
  static async findByGoogleId(googleId) {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE google_id = ? AND deleted_at IS NULL',
      [googleId]
    );
    return rows[0] || null;
  }

  static async createFromGoogle(data) {
    const uuid = uuidv4();
    const referralCode = await Referral.createUniqueCode();

    const [result] = await db.query(
      `INSERT INTO users (
        uuid, username, email, password_hash, full_name, role, is_active, is_verified, package_id, referral_code, google_id, avatar
      ) VALUES (?, ?, ?, '', ?, 'user', 1, 1, NULL, ?, ?, ?)`,
      [
        uuid,
        data.username,
        data.email,
        data.fullName || data.username,
        referralCode,
        data.googleId,
        data.avatar || null
      ]
    );

    return this.findById(result.insertId);
  }
}

module.exports = User;
