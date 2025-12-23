#!/bin/bash
# Raspberry Pi Kiosk Setup Script
# Run on a fresh Raspberry Pi OS 64-bit install
# This sets up the signage system with Node.js server

set -e

echo "=== Raspberry Pi Kiosk Setup ==="
echo ""

echo "=== Updating system ==="
sudo apt update && sudo apt upgrade -y

echo "=== Installing packages ==="
sudo apt install -y cage chromium nodejs npm

echo "=== Setting up directories ==="
mkdir -p /home/pi/public
mkdir -p /home/pi/media
mkdir -p /home/pi/node_modules

echo "=== Installing Node.js dependencies ==="
cd /home/pi
npm install ws

echo "=== Creating screen blanking disable service ==="
sudo bash -c 'cat << EOF > /etc/systemd/system/disable-blanking.service
[Unit]
Description=Disable screen blanking

[Service]
Type=oneshot
ExecStart=/bin/sh -c "echo 0 > /sys/class/graphics/fb0/blank"
ExecStart=/usr/bin/setterm --blank 0 --powerdown 0 --powersave off

[Install]
WantedBy=multi-user.target
EOF'

echo "=== Disabling console blanking permanently ==="
if ! grep -q "consoleblank=0" /boot/firmware/cmdline.txt 2>/dev/null; then
  sudo sed -i 's/$/ consoleblank=0/' /boot/firmware/cmdline.txt 2>/dev/null || \
  sudo sed -i 's/$/ consoleblank=0/' /boot/cmdline.txt 2>/dev/null || true
fi

echo "=== Setting boot to console autologin ==="
sudo raspi-config nonint do_boot_behaviour B2

echo "=== Disabling desktop environment ==="
sudo systemctl set-default multi-user.target
sudo systemctl disable lightdm 2>/dev/null || true
sudo systemctl disable gdm3 2>/dev/null || true

echo "=== Creating systemd service ==="
sudo bash -c 'cat << EOF > /etc/systemd/system/kiosk.service
[Unit]
Description=Kiosk Signage Server
After=network.target

[Service]
User=pi
Group=pi
PAMName=login
Type=simple
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=WLR_LIBINPUT_NO_DEVICES=1
Environment=NODE_ENV=production
WorkingDirectory=/home/pi
ExecStart=/home/pi/run_kiosk.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF'

echo "=== Enabling services ==="
sudo systemctl daemon-reload
sudo systemctl enable disable-blanking
sudo systemctl enable kiosk

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Copy files to Pi:"
echo "   scp server.js run_kiosk.sh kiosk-server.sh pi@<IP>:/home/pi/"
echo "   scp -r public media pi@<IP>:/home/pi/"
echo ""
echo "2. Make scripts executable:"
echo "   chmod +x /home/pi/run_kiosk.sh /home/pi/kiosk-server.sh"
echo ""
echo "3. Reboot: sudo reboot"
echo ""
echo "API endpoints:"
echo "  GET  /status  - Server status"
echo "  GET  /files   - List media files"
echo "  POST /file    - Switch video: curl -X POST -d '{\"file\":\"example.mp4\"}' http://<IP>:8080/file"
echo "  POST /url     - Show URL"
echo "  POST /off     - Black screen"
echo ""
echo "Player: http://<IP>:8080/player"
