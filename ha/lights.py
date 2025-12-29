import colorsys
import math
import socket
import json
import time

# ====== CONFIG ======
GOVEE_IP = "100.124.3.230"
GOVEE_PORT = 4003
DURATION_SECONDS = 100          # total rotation time
STEPS = DURATION_SECONDS * 4       # number of updates
SATURATION = 100               # keep vivid colors
BRIGHTNESS_MIN = 0             # 0–100 for Govee
BRIGHTNESS_MAX = 100           # 0–100 for Govee
BRIGHTNESS_CYCLES = 8          # oscillations per run
# ====================

def govee_send(cmd, data):
    """Send command to Govee light via LAN API"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(1)
    msg = {"msg": {"cmd": cmd, "data": data}}
    sock.sendto(json.dumps(msg).encode(), (GOVEE_IP, GOVEE_PORT))
    sock.close()

def govee_turn_on():
    govee_send("turn", {"value": 1})

def govee_turn_off():
    govee_send("turn", {"value": 0})

def govee_set_color(r, g, b):
    govee_send("colorwc", {"color": {"r": r, "g": g, "b": b}, "colorTemInKelvin": 0})

def govee_set_brightness(value):
    """Set brightness 0-100"""
    govee_send("brightness", {"value": value})

# Turn on first
print("Turning on Govee light...")
govee_turn_on()
time.sleep(0.5)

for step in range(STEPS):
    hue = step / STEPS
    r, g, b = colorsys.hsv_to_rgb(hue, SATURATION / 100, 1.0)
    r, g, b = int(r * 255), int(g * 255), int(b * 255)

    # Oscillate brightness using sine wave
    brightness_wave = (math.sin(2 * math.pi * BRIGHTNESS_CYCLES * step / STEPS) + 1) / 2
    brightness = int(BRIGHTNESS_MIN + brightness_wave * (BRIGHTNESS_MAX - BRIGHTNESS_MIN))

    print(f"Step {step + 1}/{STEPS} - Hue: {int(hue * 360)}° - Brightness: {brightness}% - RGB: ({r}, {g}, {b})")

    
    # govee_set_color(r, g, b)
    govee_set_brightness(brightness)

    time.sleep(DURATION_SECONDS / STEPS)

print("Done.")
