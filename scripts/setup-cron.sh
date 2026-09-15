#!/bin/bash
# ============================================================
# Setup Cron Job - Temp File Cleanup
# Jalankan sekali di hosting untuk mendaftarkan cron job
# ============================================================

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(which node)"
SCRIPT="$APP_DIR/script/tempCleanup.js"
LOG_FILE="$APP_DIR/logs/cron-cleanup.log"

# Buat logs folder jika belum ada
mkdir -p "$APP_DIR/logs"

# Cron entry: setiap 1 menit
CRON_ENTRY="* * * * * $NODE_BIN $SCRIPT >> $LOG_FILE 2>&1"

# Cek apakah cron sudah terdaftar
if crontab -l 2>/dev/null | grep -qF "$SCRIPT"; then
    echo "[OK] Cron job sudah terdaftar sebelumnya"
    echo ""
    echo "Current entry:"
    crontab -l | grep "$SCRIPT"
else
    # Tambah cron entry
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
    echo "[OK] Cron job berhasil ditambahkan"
fi

echo ""
echo "========================================="
echo "  Temp Cleanup Cron Job"
echo "========================================="
echo "  Schedule : Setiap 1 menit"
echo "  Script   : $SCRIPT"
echo "  Log      : $LOG_FILE"
echo "  Max Age  : 40 detik"
echo "========================================="
echo ""
echo "Commands:"
echo "  Lihat cron  : crontab -l"
echo "  Hapus cron  : crontab -l | grep -v '$SCRIPT' | crontab -"
echo "  Lihat log   : tail -f $LOG_FILE"
echo "  Test manual : $NODE_BIN $SCRIPT"
