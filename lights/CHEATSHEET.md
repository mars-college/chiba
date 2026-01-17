# Govee Lights Cheatsheet

## Lights

> **Config**: `packages/shared/src/config/lights.json` (single source of truth)

| Code | Name |
|------|------|
| gw1 | Gallery West 1 |
| gw2 | Gallery West 2 |
| ge1 | Gallery East 1 |
| ge2 | Gallery East 2 |
| a | Auditorium |
| all | All lights |

Run `python lights.py list lights` to see current IPs.

## Quick Commands

```bash
# On/Off
python lights.py on all
python lights.py off gw1 gw2

# Colors (presets)
python lights.py color all red
python lights.py color gw1 purple
python lights.py color ge1 ge2 cyan

# Colors (custom RGB)
python lights.py color all --rgb 255,100,50

# Colors (HSB: hue 0-360, sat 0-100, bright 0-100)
python lights.py color all --hsb 180,100,100

# Brightness
python lights.py brightness all 50
python lights.py dim gw1 30

# White temperature
python lights.py temp all warm
python lights.py temp gw1 --kelvin 4000

# Status
python lights.py status all
python lights.py status gw1

# List available options
python lights.py list lights
python lights.py list colors
python lights.py list temps
```

## Color Presets

| Name | RGB |
|------|-----|
| red | 255,0,0 |
| green | 0,255,0 |
| blue | 0,0,255 |
| yellow | 255,255,0 |
| purple | 128,0,255 |
| orange | 255,165,0 |
| cyan | 0,255,255 |
| white | 255,255,255 |
| pink | 255,105,180 |
| magenta | 255,0,255 |

## Temperature Presets

| Name | Kelvin | Description |
|------|--------|-------------|
| warm | 2700K | Cozy, incandescent |
| neutral | 4000K | Balanced |
| cool | 6500K | Daylight |

## HSB Color Guide

Hue values (0-360):
- 0 = Red
- 30 = Orange
- 60 = Yellow
- 120 = Green
- 180 = Cyan
- 240 = Blue
- 270 = Purple
- 300 = Magenta
- 360 = Red (wraps around)

Saturation (0-100): 0 = white/gray, 100 = vivid color
Brightness (0-100): 0 = black, 100 = full brightness
