# Cron Setup Scripts

## Temp File Cleanup

Auto-hapus file di `temp/` yang sudah lebih dari 40 detik.

### Linux (Hosting)

```bash
# Jalankan sekali
bash scripts/setup-cron.sh

# Atau via npm
npm run temp:cron:setup
```

### Windows

```bash
# Jalankan sebagai Administrator
scripts\setup-cron.bat

# Atau via npm
npm run temp:cron:setup:win
```

### Commands

| Action | Linux | Windows |
|--------|-------|---------|
| Lihat | `crontab -l` | `schtasks /Query /TN SaasGateway_TempCleanup` |
| Hapus | `crontab -l \| grep -v tempCleanup \| crontab -` | `schtasks /Delete /TN SaasGateway_TempCleanup /F` |
| Log | `tail -f logs/cron-cleanup.log` | Lihat `logs/cron-cleanup.log` |
| Test | `node script/tempCleanup.js` | `node script\tempCleanup.js` |
