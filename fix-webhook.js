const fs = require('fs');
const path = 'models/Webhook.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Update listByUser signature + body to support search
const oldSig = "static async listByUser(userId, { page = 1, limit = 20 } = {}) {\n    const [countResult] = await db.query(\n      'SELECT COUNT(*) as total FROM webhooks WHERE user_id = ?',\n      [userId]\n    );\n    const total = countResult[0].total;\n    const offset = (page - 1) * limit;\n\n    const [rows] = await db.query(\n      `SELECT w.*,\n              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id) as total_deliveries,\n              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'success') as success_deliveries,\n              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'failed') as failed_deliveries,\n              (SELECT wl.created_at FROM webhook_logs wl WHERE wl.webhook_id = w.id ORDER BY wl.created_at DESC LIMIT 1) as last_triggered_at\n       FROM webhooks w\n       WHERE w.user_id = ?\n       ORDER BY w.created_at DESC\n       LIMIT ? OFFSET ?`,\n      [userId, limit, offset]\n    );\n\n    return { webhooks: rows, total };\n  }";

const newFunc = `static async listByUser(userId, { page = 1, limit = 20, search = '' } = {}) {\n    let where = 'w.user_id = ?';\n    const params = [userId];\n\n    if (search) {\n      where += ' AND (w.name LIKE ? OR w.url LIKE ?)';\n      const s = \`%\${search}%\`;\n      params.push(s, s);\n    }\n\n    const [countResult] = await db.query(\n      \`SELECT COUNT(*) as total FROM webhooks w WHERE \${where}\`,\n      params\n    );\n    const total = countResult[0].total;\n    const offset = (page - 1) * limit;\n\n    const [rows] = await db.query(\n      \`SELECT w.*,\n              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id) as total_deliveries,\n              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'success') as success_deliveries,\n              (SELECT COUNT(*) FROM webhook_logs wl WHERE wl.webhook_id = w.id AND wl.status = 'failed') as failed_deliveries,\n              (SELECT wl.created_at FROM webhook_logs wl WHERE wl.webhook_id = w.id ORDER BY wl.created_at DESC LIMIT 1) as last_triggered_at\n       FROM webhooks w\n       WHERE \${where}\n       ORDER BY w.created_at DESC\n       LIMIT ? OFFSET ?\`,\n      [...params, limit, offset]\n    );\n\n    return { webhooks: rows, total };\n  }`;

if (content.includes(oldSig)) {
  content = content.replace(oldSig, newFunc);
  console.log('1. listByUser updated with search support');
} else {
  console.log('1. listByUser: signature not found exactly, skipping');
}

fs.writeFileSync(path, content);
console.log('Done writing', path);
