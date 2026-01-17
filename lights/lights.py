#!/usr/bin/env python3
"""Govee Lights CLI - Control Govee lights via LAN API.

Usage:
    python lights.py on all
    python lights.py color gw1 red
    python lights.py brightness all 50
    python lights.py status all
"""

import argparse
import colorsys
import concurrent.futures
import json
import socket
import sys

GOVEE_PORT = 4003

# Light configuration
LIGHTS = {
    "gw1": "100.128.2.181",  # Gallery West 1
    "gw2": "100.128.2.146",  # Gallery West 2
    "ge1": "100.128.2.160",   # Gallery East 1
    "ge2": "100.128.2.183",  # Gallery East 2
    "a": "100.128.2.182",    # Auditorium
}

# Color presets (RGB)
COLORS = {
    "red": (255, 0, 0),
    "green": (0, 255, 0),
    "blue": (0, 0, 255),
    "yellow": (255, 255, 0),
    "purple": (128, 0, 255),
    "orange": (255, 165, 0),
    "cyan": (0, 255, 255),
    "white": (255, 255, 255),
    "pink": (255, 105, 180),
    "magenta": (255, 0, 255),
}

# Temperature presets (Kelvin)
TEMPS = {
    "warm": 2700,     # Cozy incandescent
    "neutral": 4000,  # Balanced
    "cool": 6500,     # Daylight
}


# --- Core Functions ---

def send_command(ip: str, cmd: str, data: dict) -> dict | None:
    """Send command to Govee light via LAN API."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(1)
    msg = {"msg": {"cmd": cmd, "data": data}}
    try:
        sock.sendto(json.dumps(msg).encode(), (ip, GOVEE_PORT))
        # Try to receive response (for status queries)
        try:
            data, _ = sock.recvfrom(4096)
            return json.loads(data.decode())
        except socket.timeout:
            return None
    finally:
        sock.close()


def turn_on(ip: str) -> None:
    """Turn light on."""
    send_command(ip, "turn", {"value": 1})


def turn_off(ip: str) -> None:
    """Turn light off."""
    send_command(ip, "turn", {"value": 0})


def set_color(ip: str, r: int, g: int, b: int) -> None:
    """Set light color (RGB 0-255)."""
    send_command(ip, "colorwc", {
        "color": {"r": r, "g": g, "b": b},
        "colorTemInKelvin": 0
    })


def set_brightness(ip: str, value: int) -> None:
    """Set brightness (0-100)."""
    send_command(ip, "brightness", {"value": max(1, min(100, value))})


def set_temp(ip: str, kelvin: int) -> None:
    """Set color temperature (2000-9000K)."""
    send_command(ip, "colorwc", {
        "color": {"r": 0, "g": 0, "b": 0},
        "colorTemInKelvin": max(2000, min(9000, kelvin))
    })


def get_status(ip: str) -> dict | None:
    """Query device status."""
    response = send_command(ip, "devStatus", {})
    if response and response.get("msg", {}).get("cmd") == "devStatus":
        return response["msg"]["data"]
    return None


# --- Helper Functions ---

def resolve_targets(targets: list[str]) -> list[tuple[str, str]]:
    """Resolve target names to (name, ip) pairs."""
    results = []
    for target in targets:
        if target == "all":
            results.extend(LIGHTS.items())
        elif target in LIGHTS:
            results.append((target, LIGHTS[target]))
        else:
            print(f"Unknown target: {target}", file=sys.stderr)
            print(f"Available: {', '.join(LIGHTS.keys())}, all", file=sys.stderr)
            sys.exit(1)
    return results


def hsb_to_rgb(h: float, s: float, b: float) -> tuple[int, int, int]:
    """Convert HSB to RGB. H: 0-360, S: 0-100, B: 0-100."""
    r, g, b_val = colorsys.hsv_to_rgb(h / 360, s / 100, b / 100)
    return int(r * 255), int(g * 255), int(b_val * 255)


def parse_rgb(rgb_str: str) -> tuple[int, int, int]:
    """Parse RGB string like '255,128,0' to tuple."""
    parts = rgb_str.split(",")
    if len(parts) != 3:
        raise ValueError(f"Invalid RGB format: {rgb_str}")
    return tuple(max(0, min(255, int(p.strip()))) for p in parts)


def parse_hsb(hsb_str: str) -> tuple[float, float, float]:
    """Parse HSB string like '180,100,100' to tuple."""
    parts = hsb_str.split(",")
    if len(parts) != 3:
        raise ValueError(f"Invalid HSB format: {hsb_str}")
    h = max(0, min(360, float(parts[0].strip())))
    s = max(0, min(100, float(parts[1].strip())))
    b = max(0, min(100, float(parts[2].strip())))
    return h, s, b


def run_parallel(targets: list[tuple[str, str]], func, *args) -> list[tuple[str, any]]:
    """Run a function on multiple targets in parallel.

    Args:
        targets: List of (name, ip) tuples
        func: Function to call with (ip, *args)
        *args: Additional arguments to pass to func

    Returns:
        List of (name, result) tuples
    """
    results = []

    def task(name, ip):
        result = func(ip, *args)
        return name, result

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(targets)) as executor:
        futures = [executor.submit(task, name, ip) for name, ip in targets]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    # Sort by original order
    order = {name: i for i, (name, _) in enumerate(targets)}
    results.sort(key=lambda x: order.get(x[0], 0))
    return results


# --- CLI Handlers ---

def cmd_on(args) -> None:
    """Handle 'on' command."""
    targets = resolve_targets(args.targets)
    run_parallel(targets, lambda ip: send_command(ip, "turn", {"value": 1}))
    for name, _ in targets:
        print(f"{name}: on")


def cmd_off(args) -> None:
    """Handle 'off' command."""
    targets = resolve_targets(args.targets)
    run_parallel(targets, lambda ip: send_command(ip, "turn", {"value": 0}))
    for name, _ in targets:
        print(f"{name}: off")


def cmd_color(args) -> None:
    """Handle 'color' command."""
    # Parse color from preset, --rgb, or --hsb
    r, g, b = None, None, None
    target_list = list(args.targets)

    # Check if last target is actually a color preset
    preset = args.preset
    if not preset and not args.rgb and not args.hsb:
        if target_list and target_list[-1] in COLORS:
            preset = target_list.pop()

    if args.rgb:
        r, g, b = parse_rgb(args.rgb)
    elif args.hsb:
        h, s, bri = parse_hsb(args.hsb)
        r, g, b = hsb_to_rgb(h, s, bri)
    elif preset:
        if preset in COLORS:
            r, g, b = COLORS[preset]
        else:
            print(f"Unknown color preset: {preset}", file=sys.stderr)
            print(f"Available: {', '.join(COLORS.keys())}", file=sys.stderr)
            sys.exit(1)
    else:
        print("Must specify color preset, --rgb, or --hsb", file=sys.stderr)
        sys.exit(1)

    def set_color_on(ip):
        send_command(ip, "turn", {"value": 1})
        send_command(ip, "colorwc", {"color": {"r": r, "g": g, "b": b}, "colorTemInKelvin": 0})

    targets = resolve_targets(target_list)
    run_parallel(targets, set_color_on)
    for name, _ in targets:
        print(f"{name}: rgb({r},{g},{b})")


def cmd_brightness(args) -> None:
    """Handle 'brightness' command."""
    targets = resolve_targets(args.targets)
    value = max(1, min(100, args.value))
    run_parallel(targets, lambda ip: send_command(ip, "brightness", {"value": value}))
    for name, _ in targets:
        print(f"{name}: brightness {value}%")


def cmd_temp(args) -> None:
    """Handle 'temp' command."""
    kelvin = None
    target_list = list(args.targets)

    # Check if last target is actually a temp preset
    preset = args.preset
    if not preset and not args.kelvin:
        if target_list and target_list[-1] in TEMPS:
            preset = target_list.pop()

    if args.kelvin:
        kelvin = args.kelvin
    elif preset:
        if preset in TEMPS:
            kelvin = TEMPS[preset]
        else:
            print(f"Unknown temp preset: {preset}", file=sys.stderr)
            print(f"Available: {', '.join(TEMPS.keys())}", file=sys.stderr)
            sys.exit(1)
    else:
        print("Must specify temp preset or --kelvin", file=sys.stderr)
        sys.exit(1)

    kelvin = max(2000, min(9000, kelvin))

    def set_temp_on(ip):
        send_command(ip, "turn", {"value": 1})
        send_command(ip, "colorwc", {"color": {"r": 0, "g": 0, "b": 0}, "colorTemInKelvin": kelvin})

    targets = resolve_targets(target_list)
    run_parallel(targets, set_temp_on)
    for name, _ in targets:
        print(f"{name}: {kelvin}K")


def cmd_status(args) -> None:
    """Handle 'status' command."""
    targets = resolve_targets(args.targets)
    results = run_parallel(targets, get_status)

    for name, status in results:
        if status:
            on_off = "ON" if status.get("onOff") else "OFF"
            brightness = status.get("brightness", "?")
            color = status.get("color", {})
            temp = status.get("colorTemInKelvin", 0)

            if temp and temp > 0:
                print(f"{name}: {on_off}, brightness: {brightness}%, temp: {temp}K")
            else:
                r, g, b = color.get("r", 0), color.get("g", 0), color.get("b", 0)
                print(f"{name}: {on_off}, brightness: {brightness}%, rgb({r},{g},{b})")
        else:
            print(f"{name}: no response")


def cmd_list(args) -> None:
    """Handle 'list' command."""
    if args.what == "lights":
        print("Lights:")
        for name, ip in LIGHTS.items():
            print(f"  {name}: {ip}")
        print("  all: (all lights)")
    elif args.what == "colors":
        print("Color presets:")
        for name, (r, g, b) in COLORS.items():
            print(f"  {name}: rgb({r},{g},{b})")
    elif args.what == "temps":
        print("Temperature presets:")
        for name, kelvin in TEMPS.items():
            print(f"  {name}: {kelvin}K")


# --- Main ---

def main():
    parser = argparse.ArgumentParser(
        description="Control Govee lights via LAN API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s on all                    Turn all lights on
  %(prog)s off gw1 gw2               Turn off Gallery West lights
  %(prog)s color all red             Set all lights to red
  %(prog)s color gw1 --rgb 255,100,0 Set custom RGB color
  %(prog)s color all --hsb 180,100,100  Set color via HSB
  %(prog)s brightness all 50         Set brightness to 50%%
  %(prog)s temp all warm             Set warm white temperature
  %(prog)s status all                Query status of all lights
  %(prog)s list colors               List color presets
        """,
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # on
    p_on = subparsers.add_parser("on", help="Turn lights on")
    p_on.add_argument("targets", nargs="+", help="Light names (gw1, gw2, ge1, ge2, a, all)")
    p_on.set_defaults(func=cmd_on)

    # off
    p_off = subparsers.add_parser("off", help="Turn lights off")
    p_off.add_argument("targets", nargs="+", help="Light names")
    p_off.set_defaults(func=cmd_off)

    # color
    p_color = subparsers.add_parser("color", help="Set light color")
    p_color.add_argument("targets", nargs="+", help="Light names")
    p_color.add_argument("preset", nargs="?", help="Color preset name")
    p_color.add_argument("--rgb", type=str, help="RGB values (e.g., 255,128,0)")
    p_color.add_argument("--hsb", type=str, help="HSB values (e.g., 180,100,100)")
    p_color.set_defaults(func=cmd_color)

    # brightness
    p_bright = subparsers.add_parser("brightness", help="Set brightness (0-100)")
    p_bright.add_argument("targets", nargs="+", help="Light names")
    p_bright.add_argument("value", type=int, help="Brightness value (0-100)")
    p_bright.set_defaults(func=cmd_brightness)

    # dim (alias for brightness)
    p_dim = subparsers.add_parser("dim", help="Set brightness (alias)")
    p_dim.add_argument("targets", nargs="+", help="Light names")
    p_dim.add_argument("value", type=int, help="Brightness value (0-100)")
    p_dim.set_defaults(func=cmd_brightness)

    # temp
    p_temp = subparsers.add_parser("temp", help="Set color temperature")
    p_temp.add_argument("targets", nargs="+", help="Light names")
    p_temp.add_argument("preset", nargs="?", help="Temp preset (warm, neutral, cool)")
    p_temp.add_argument("--kelvin", type=int, help="Temperature in Kelvin (2000-9000)")
    p_temp.set_defaults(func=cmd_temp)

    # status
    p_status = subparsers.add_parser("status", help="Query light status")
    p_status.add_argument("targets", nargs="+", help="Light names")
    p_status.set_defaults(func=cmd_status)

    # list
    p_list = subparsers.add_parser("list", help="List available options")
    p_list.add_argument("what", choices=["lights", "colors", "temps"], help="What to list")
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
