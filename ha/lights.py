import colorsys
import math
import os
import time
from dotenv import load_dotenv
from homeassistant_api import Client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
HA_TOKEN = os.getenv("HA_TOKEN")
HA_URL = "http://10.10.13.9:8123/api"

# ====== CONFIG ======
ENTITY_ID = "light.h7039"
DURATION_SECONDS = 12          # total rotation time
STEPS = DURATION_SECONDS                     # number of updates
SATURATION = 100                # keep vivid colors
BRIGHTNESS_MIN = 0             # 0–255
BRIGHTNESS_MAX = 255            # 0–255
BRIGHTNESS_CYCLES = 8           # oscillations per run
# ====================

client = Client(HA_URL, HA_TOKEN)

# Check light capabilities
entity = client.get_entity(entity_id=ENTITY_ID)
print(f"Entity: {entity.entity_id}")
print(f"State: {entity.state.state}")
print(f"Attributes: {entity.state.attributes}")
print()

for step in range(STEPS):
    hue = step / STEPS
    r, g, b = colorsys.hsv_to_rgb(hue, SATURATION / 100, 1.0)
    rgb = [int(r * 255), int(g * 255), int(b * 255)]

    # Oscillate brightness using sine wave
    brightness_wave = (math.sin(2 * math.pi * BRIGHTNESS_CYCLES * step / STEPS) + 1) / 2
    brightness = int(BRIGHTNESS_MIN + brightness_wave * (BRIGHTNESS_MAX - BRIGHTNESS_MIN))
    r, g, b = 120, 240, 95
    rgb = [120, 240, 95]
    print(f"Step {step + 1}/{STEPS} - Hue: {int(hue * 360)}° - Brightness: {brightness} - RGB: {rgb}")

    result = client.trigger_service(
        "light",
        "turn_on",
        entity_id=ENTITY_ID,
        rgb_color=rgb,
        brightness=brightness,
        transition=1
    )

    print(f"  Response: {result}")

    time.sleep(DURATION_SECONDS / STEPS)

print("Done.")
