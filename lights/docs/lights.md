# Govee Lights CLI Documentation

Control Govee lights via the LAN API using simple CLI commands.

## Installation

No dependencies required - uses Python standard library only.

```bash
cd /Users/gene/Dev/chiba/lights
python lights.py --help
```

---

## Zone Legend

The lighting system consists of 5 Govee H7039 string lights across 3 zones:

```
┌─────────────────────────────────────────────────────────────┐
│                        GALLERY                               │
│                                                              │
│   ┌─────────────────┐              ┌─────────────────┐      │
│   │  GALLERY WEST   │              │  GALLERY EAST   │      │
│   │                 │              │                 │      │
│   │   gw1   gw2     │              │   ge1   ge2     │      │
│   └─────────────────┘              └─────────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       AUDITORIUM                             │
│                                                              │
│                          a                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Light Codes

| Code | Full Name | Location | IP Address |
|------|-----------|----------|------------|
| `gw1` | Gallery West 1 | Gallery, west side | 100.124.2.207 |
| `gw2` | Gallery West 2 | Gallery, west side | 100.124.2.115 |
| `ge1` | Gallery East 1 | Gallery, east side | 100.124.2.208 |
| `ge2` | Gallery East 2 | Gallery, east side | 100.124.2.114 |
| `a` | Auditorium | Auditorium | 100.124.2.209 |
| `all` | All Lights | All zones | (all 5 lights) |

---

## Commands

### `on` - Turn Lights On

```bash
python lights.py on <targets...>
```

**Examples:**
```bash
python lights.py on all           # Turn on all lights
python lights.py on gw1           # Turn on Gallery West 1
python lights.py on gw1 gw2 a     # Turn on multiple lights
```

---

### `off` - Turn Lights Off

```bash
python lights.py off <targets...>
```

**Examples:**
```bash
python lights.py off all          # Turn off all lights
python lights.py off ge1 ge2      # Turn off Gallery East lights
```

---

### `color` - Set Light Color

```bash
python lights.py color <targets...> <preset>
python lights.py color <targets...> --rgb R,G,B
python lights.py color <targets...> --hsb H,S,B
```

**Color Presets:**

| Preset | RGB Value | Description |
|--------|-----------|-------------|
| `red` | 255,0,0 | Pure red |
| `green` | 0,255,0 | Pure green |
| `blue` | 0,0,255 | Pure blue |
| `yellow` | 255,255,0 | Bright yellow |
| `purple` | 128,0,255 | Violet purple |
| `orange` | 255,165,0 | Warm orange |
| `cyan` | 0,255,255 | Cyan/teal |
| `white` | 255,255,255 | Pure white |
| `pink` | 255,105,180 | Hot pink |
| `magenta` | 255,0,255 | Bright magenta |

**Examples:**
```bash
# Using presets
python lights.py color all red
python lights.py color gw1 gw2 purple
python lights.py color a orange

# Using custom RGB (0-255 per channel)
python lights.py color all --rgb 255,100,50
python lights.py color gw1 --rgb 0,128,255

# Using HSB (Hue 0-360, Saturation 0-100, Brightness 0-100)
python lights.py color all --hsb 180,100,100    # Cyan
python lights.py color all --hsb 270,100,100    # Purple
python lights.py color all --hsb 30,100,100     # Orange
```

**HSB Color Wheel Reference:**

| Hue | Color |
|-----|-------|
| 0 | Red |
| 30 | Orange |
| 60 | Yellow |
| 120 | Green |
| 180 | Cyan |
| 240 | Blue |
| 270 | Purple |
| 300 | Magenta |
| 360 | Red (wraps) |

---

### `brightness` / `dim` - Set Brightness

```bash
python lights.py brightness <targets...> <value>
python lights.py dim <targets...> <value>
```

**Value:** 1-100 (percentage)

**Examples:**
```bash
python lights.py brightness all 100    # Full brightness
python lights.py brightness all 50     # Half brightness
python lights.py dim gw1 gw2 30        # Dim Gallery West to 30%
```

---

### `temp` - Set Color Temperature

Set white light color temperature (warm to cool).

```bash
python lights.py temp <targets...> <preset>
python lights.py temp <targets...> --kelvin <value>
```

**Temperature Presets:**

| Preset | Kelvin | Description |
|--------|--------|-------------|
| `warm` | 2700K | Cozy, incandescent-like (yellowish) |
| `neutral` | 4000K | Balanced white |
| `cool` | 6500K | Daylight (bluish white) |

**Kelvin Range:** 2000-9000K

**Examples:**
```bash
python lights.py temp all warm         # Cozy warm white
python lights.py temp all cool         # Daylight white
python lights.py temp gw1 neutral      # Balanced white
python lights.py temp all --kelvin 3000   # Custom temperature
```

---

### `status` - Query Light Status

```bash
python lights.py status <targets...>
```

**Examples:**
```bash
python lights.py status all            # Status of all lights
python lights.py status gw1            # Status of single light
```

**Output:**
```
gw1: ON, brightness: 100%, rgb(255,0,0)
gw2: ON, brightness: 50%, temp: 2700K
ge1: OFF, brightness: 100%, rgb(0,0,0)
```

---

### `list` - List Available Options

```bash
python lights.py list lights    # Show all light codes and IPs
python lights.py list colors    # Show color presets
python lights.py list temps     # Show temperature presets
```

---

## Quick Reference

```bash
# Power
python lights.py on all
python lights.py off all

# Colors
python lights.py color all red
python lights.py color all --rgb 255,100,0
python lights.py color all --hsb 180,100,100

# Brightness
python lights.py brightness all 50

# Temperature (white light)
python lights.py temp all warm

# Status
python lights.py status all

# Help
python lights.py --help
python lights.py color --help
```

---

## Targeting Multiple Lights

All commands accept multiple targets:

```bash
# Individual lights
python lights.py color gw1 red
python lights.py color gw1 gw2 red

# All lights
python lights.py color all red

# Mix zones
python lights.py color gw1 gw2 ge1 ge2 purple
python lights.py color a orange
```

Commands are executed **in parallel** - all targeted lights change simultaneously.

---

## Technical Details

- **Protocol:** UDP on port 4003
- **API:** Govee LAN Control API
- **Device Model:** H7039 (all 5 lights)
- **Network:** Tailscale (100.124.2.x)

### Govee LAN API Commands Used

| Command | Description |
|---------|-------------|
| `turn` | On/Off control |
| `brightness` | Brightness 1-100 |
| `colorwc` | RGB color or color temperature |
| `devStatus` | Query device state |

---

## Controller API

The Chiba controller provides HTTP endpoints for controlling lights programmatically. This is the same controller that manages the display screens.

### Authentication

All POST/DELETE endpoints require authentication via API key. Pass the key using one of:

- **Header:** `Authorization: Bearer <API_KEY>`
- **Header:** `X-API-Key: <API_KEY>`
- **Query:** `?api_key=<API_KEY>`

The API key is configured in the controller's `.env` file (`API_KEY=...`).

### Base URL

```
http://<controller-host>:8080/api
```

### Endpoints

#### GET /api/lights

Get all lights with their current state.

```bash
curl http://localhost:8080/api/lights
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "gw1",
      "name": "Gallery West 1",
      "ipAddress": "100.124.2.207",
      "port": 4003,
      "state": {
        "power": true,
        "hue": 0,
        "saturation": 100,
        "brightness": 100
      },
      "reachable": true
    }
  ]
}
```

#### POST /api/lights/:id/control

Control a single light. Requires authentication.

```bash
# Turn on
curl -X POST http://localhost:8080/api/lights/gw1/control \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"power": true}'

# Set color (HSB)
curl -X POST http://localhost:8080/api/lights/gw1/control \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hue": 240, "saturation": 100, "brightness": 80}'

# Set brightness only
curl -X POST http://localhost:8080/api/lights/gw1/control \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"brightness": 50}'
```

**Request Body:**
```json
{
  "power": true,        // optional: true/false
  "hue": 0,             // optional: 0-360
  "saturation": 100,    // optional: 0-100
  "brightness": 100     // optional: 0-100
}
```

#### POST /api/lights/all/control

Control all lights at once. Requires authentication.

```bash
# Turn all lights off
curl -X POST http://localhost:8080/api/lights/all/control \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"power": false}'

# Set all lights to red
curl -X POST http://localhost:8080/api/lights/all/control \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"power": true, "hue": 0, "saturation": 100, "brightness": 100}'
```

#### GET /api/presets

Get all light presets.

```bash
curl http://localhost:8080/api/presets
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "preset-all-off",
      "name": "All Off",
      "isPredefined": true,
      "settings": [{"lightId": "*", "power": false}]
    },
    {
      "id": "preset-max-bright",
      "name": "Max Bright",
      "isPredefined": true,
      "settings": [{"lightId": "*", "power": true, "hue": 0, "saturation": 0, "brightness": 100}]
    }
  ]
}
```

#### POST /api/presets/:id/apply

Apply a preset to lights. Requires authentication.

```bash
curl -X POST http://localhost:8080/api/presets/preset-max-bright/apply \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### POST /api/presets

Create a new preset. Requires authentication.

```bash
curl -X POST http://localhost:8080/api/presets \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Gallery Purple",
    "settings": [
      {"lightId": "gw1", "power": true, "hue": 270, "saturation": 100, "brightness": 100},
      {"lightId": "gw2", "power": true, "hue": 270, "saturation": 100, "brightness": 100},
      {"lightId": "ge1", "power": true, "hue": 270, "saturation": 100, "brightness": 100},
      {"lightId": "ge2", "power": true, "hue": 270, "saturation": 100, "brightness": 100}
    ]
  }'
```

**Preset Settings:**
- Use `"lightId": "*"` to target all lights
- Use specific light IDs (`gw1`, `gw2`, `ge1`, `ge2`, `a`) for individual control

#### DELETE /api/presets/:id

Delete a custom preset. Requires authentication. Cannot delete predefined presets.

```bash
curl -X DELETE http://localhost:8080/api/presets/my-custom-preset \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Predefined Presets

| ID | Name | Description |
|----|------|-------------|
| `preset-all-off` | All Off | Turn all lights off |
| `preset-all-on` | All On | Turn all lights on at 100% |
| `preset-warm-dim` | Warm Dim | Warm orange at 30% brightness |
| `preset-cool-bright` | Cool Bright | Cool blue-white at 100% |
| `preset-max-bright` | Max Bright | Pure white at 100% (maximum output) |

### Light IDs

| ID | Name |
|----|------|
| `gw1` | Gallery West 1 |
| `gw2` | Gallery West 2 |
| `ge1` | Gallery East 1 |
| `ge2` | Gallery East 2 |
| `a` | Auditorium |

---

## Troubleshooting

### Lights not responding

1. Ensure LAN Control is enabled in Govee Home app for each light
2. Check network connectivity to Tailscale
3. Verify IP addresses with `python lights.py list lights`

### Discovery

To discover Govee devices on the network:

```bash
python discover_devices.py --scan
```

### Status shows "no response"

Govee devices don't always respond to status queries. The light may still be controllable even if status fails.
