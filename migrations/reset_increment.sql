-- Reset AUTO_INCREMENT semua table: melanjutkan dari ID terakhir
-- Table kosong → mulai dari 1
-- Table ada data → melanjutkan dari MAX(id) + 1

ALTER TABLE `admin_settings` AUTO_INCREMENT = 1;
ALTER TABLE `apis` AUTO_INCREMENT = 1;
ALTER TABLE `api_keys` AUTO_INCREMENT = 1;
ALTER TABLE `api_routes` AUTO_INCREMENT = 1;
ALTER TABLE `credits` AUTO_INCREMENT = 1;
ALTER TABLE `credit_transactions` AUTO_INCREMENT = 1;
ALTER TABLE `email_otps` AUTO_INCREMENT = 1;
ALTER TABLE `key_scopes` AUTO_INCREMENT = 1;
ALTER TABLE `notifications` AUTO_INCREMENT = 1;
ALTER TABLE `packages` AUTO_INCREMENT = 1;
ALTER TABLE `playground_sessions` AUTO_INCREMENT = 1;
ALTER TABLE `rate_limits` AUTO_INCREMENT = 1;
ALTER TABLE `referrals` AUTO_INCREMENT = 1;
ALTER TABLE `request_logs` AUTO_INCREMENT = 1;
ALTER TABLE `support_tickets` AUTO_INCREMENT = 1;
ALTER TABLE `system_logs` AUTO_INCREMENT = 1;
ALTER TABLE `ticket_messages` AUTO_INCREMENT = 1;
ALTER TABLE `transactions` AUTO_INCREMENT = 1;
ALTER TABLE `users` AUTO_INCREMENT = 1;
ALTER TABLE `user_favorites` AUTO_INCREMENT = 1;
ALTER TABLE `verification_requests` AUTO_INCREMENT = 1;
ALTER TABLE `webhooks` AUTO_INCREMENT = 1;
ALTER TABLE `webhook_logs` AUTO_INCREMENT = 1;