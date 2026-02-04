#!/usr/bin/env python3
"""Discover Govee devices on the local network.

Usage:
    ./discover_devices.py --scan                      # Listen for Govee LAN broadcasts (recommended)
    ./discover_devices.py --govee                     # Find Govee devices by MAC address
    ./discover_devices.py --govee --subnet 192.168.1  # Ping sweep + MAC check
"""

import argparse
import socket
import json
import subprocess
import re
import concurrent.futures
import sys
import struct

MULTICAST_IP = "239.255.255.250"
SCAN_PORT = 4001      # Send scan request here
RESPONSE_PORT = 4002  # Listen for responses here
CONTROL_PORT = 4003   # Send commands here

# Known Govee MAC address prefixes (OUI)
GOVEE_MAC_PREFIXES = [
    "98:17:3c",  # Most common
    "a4:c1:38",
    "d8:4f:c9",
]


def get_mac_for_ip(ip: str) -> str | None:
    """Look up MAC address for an IP from the ARP table."""
    # Ping first to ensure it's in the ARP table
    try:
        subprocess.run(
            ["ping", "-c", "1", "-W", "1", ip],
            capture_output=True,
            timeout=2,
        )
    except:
        pass

    # Get ARP table
    try:
        result = subprocess.run(["arp", "-n", ip], capture_output=True, text=True)
        # macOS/Linux format: hostname (192.168.1.1) at aa:bb:cc:dd:ee:ff ...
        # or: 192.168.1.1 ether aa:bb:cc:dd:ee:ff ...
        pattern = r'([0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2}:[0-9a-f]{1,2})'
        match = re.search(pattern, result.stdout, re.IGNORECASE)
        if match:
            return match.group(1).lower()
    except:
        pass

    return None


def discover_govee_lan(timeout: float = 5.0) -> list[dict]:
    """Discover Govee devices using LAN API multicast scan.

    Sends scan request to multicast 239.255.255.250:4001
    Listens for responses on port 4002.
    """
    devices = []

    # Create socket to listen for responses
    listen_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    listen_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listen_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    listen_sock.settimeout(timeout)

    try:
        listen_sock.bind(('', RESPONSE_PORT))
    except OSError as e:
        print(f"  Warning: Could not bind to port {RESPONSE_PORT}: {e}")
        # Try binding to any port
        listen_sock.bind(('', 0))

    # Join multicast group to receive responses
    try:
        mreq = struct.pack("4sl", socket.inet_aton(MULTICAST_IP), socket.INADDR_ANY)
        listen_sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    except Exception as e:
        print(f"  Warning: Could not join multicast group: {e}")

    # Create socket to send scan request
    send_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    send_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    send_sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)

    # Send scan request
    scan_msg = {"msg": {"cmd": "scan", "data": {"account_topic": "reserve"}}}
    print(f"Sending scan request to {MULTICAST_IP}:{SCAN_PORT}...")
    print(f"Listening for responses on port {RESPONSE_PORT} (timeout: {timeout}s)...")

    send_sock.sendto(json.dumps(scan_msg).encode(), (MULTICAST_IP, SCAN_PORT))
    send_sock.close()

    # Also send to broadcast just in case
    try:
        bcast_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        bcast_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        bcast_sock.sendto(json.dumps(scan_msg).encode(), ('255.255.255.255', SCAN_PORT))
        bcast_sock.close()
    except:
        pass

    # Listen for responses
    seen_ips = set()
    try:
        while True:
            try:
                data, addr = listen_sock.recvfrom(4096)
                response = json.loads(data.decode())

                if response.get("msg", {}).get("cmd") == "scan":
                    device_data = response["msg"]["data"]
                    ip = device_data.get("ip", addr[0])

                    if ip not in seen_ips:
                        seen_ips.add(ip)
                        mac = get_mac_for_ip(ip)
                        device = {
                            "ip": ip,
                            "sku": device_data.get("sku", "unknown"),
                            "device": device_data.get("device", "unknown"),
                            "mac": mac,
                        }
                        devices.append(device)
                        mac_str = f" (MAC: {mac})" if mac else ""
                        print(f"  Found: {ip} - {device['sku']} (ID: {device['device']}){mac_str}")
            except socket.timeout:
                break
            except json.JSONDecodeError:
                continue
    finally:
        listen_sock.close()

    return devices


def discover_govee_by_mac(subnet: str | None = None) -> list[dict]:
    """Discover Govee devices by scanning ARP table for known MAC prefixes.

    Optionally ping a subnet first to populate the ARP table.
    """
    devices = []

    # If subnet provided, ping sweep to populate ARP table
    if subnet:
        print(f"Ping sweeping {subnet}.0/24 to populate ARP table...")
        try:
            # Use nmap for fast ping sweep if available
            result = subprocess.run(
                ["nmap", "-sn", "-n", f"{subnet}.0/24"],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except FileNotFoundError:
            # Fall back to slower sequential ping
            print("  (nmap not found, using slower ping method)")
            for i in range(1, 255):
                subprocess.run(
                    ["ping", "-c", "1", "-W", "100", f"{subnet}.{i}"],
                    capture_output=True,
                    timeout=2,
                )
        except subprocess.TimeoutExpired:
            print("  Ping sweep timed out, continuing with ARP check...")

    # Get ARP table
    print("Checking ARP table for Govee devices...")
    try:
        result = subprocess.run(["arp", "-a"], capture_output=True, text=True)
        arp_output = result.stdout
    except Exception as e:
        print(f"  Error running arp: {e}")
        return devices

    # Parse ARP table for Govee MACs
    # macOS format: hostname (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
    # Linux format: hostname (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on eth0
    pattern = r'\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)'

    for match in re.finditer(pattern, arp_output, re.IGNORECASE):
        ip = match.group(1)
        mac = match.group(2).lower()

        # Check if MAC matches any Govee prefix
        for prefix in GOVEE_MAC_PREFIXES:
            if mac.startswith(prefix.lower()):
                devices.append({
                    "ip": ip,
                    "mac": mac,
                    "type": "govee",
                })
                print(f"  Found Govee: {ip} (MAC: {mac})")
                break

    return devices


def probe_device(ip: str, timeout: float = 1.0) -> dict | None:
    """Send status request to a specific IP on port 4003."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)

    status_msg = {"msg": {"cmd": "devStatus", "data": {}}}

    try:
        sock.sendto(json.dumps(status_msg).encode(), (ip, CONTROL_PORT))
        data, addr = sock.recvfrom(1024)
        response = json.loads(data.decode())
        if response.get("msg", {}).get("cmd") == "devStatus":
            device = response["msg"]["data"]
            return {
                "ip": ip,
                "sku": device.get("sku", "unknown"),
                "device": device.get("device", "unknown"),
                "on": device.get("onOff"),
                "brightness": device.get("brightness"),
                "color": device.get("color"),
            }
    except socket.timeout:
        pass
    except Exception:
        pass
    finally:
        sock.close()

    return None


def scan_subnet(subnet: str, timeout: float = 0.5, workers: int = 50) -> list[dict]:
    """Scan a /24 subnet for devices via UDP probe."""
    print(f"Probing {subnet}.1-254 on port {CONTROL_PORT}...")
    devices = []

    ips = [f"{subnet}.{i}" for i in range(1, 255)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(probe_device, ip, timeout): ip for ip in ips}
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            if result:
                devices.append(result)
                print(f"  Found: {result['ip']} - {result['sku']} ({result['device']})")

    return devices


def probe_ips(ips: list[str], timeout: float = 1.0) -> list[dict]:
    """Probe specific IPs via UDP."""
    print("Probing specified IPs...")
    devices = []
    for ip in ips:
        result = probe_device(ip, timeout)
        if result:
            devices.append(result)
            print(f"  Found: {result['ip']} - {result['sku']} ({result['device']})")
        else:
            print(f"  No response from {ip}")
    return devices


def main():
    parser = argparse.ArgumentParser(
        description="Discover Govee devices on the local network.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --scan
      Multicast scan for Govee devices (RECOMMENDED - uses LAN API)

  %(prog)s --scan --timeout 10
      Scan with longer timeout (some devices respond slowly)

  %(prog)s --govee --subnet 192.168.1
      Ping sweep subnet, then find Govee devices by MAC address

  %(prog)s --ips 192.168.1.100 192.168.1.101
      Probe specific IP addresses via UDP
        """,
    )

    parser.add_argument(
        "--scan",
        action="store_true",
        help="Multicast scan for Govee devices using LAN API (recommended)",
    )
    parser.add_argument(
        "--govee",
        "-g",
        action="store_true",
        help="Find Govee devices by MAC address prefix (ARP table)",
    )
    parser.add_argument(
        "--subnet",
        "-s",
        type=str,
        help="Subnet to scan (e.g., 192.168.1 for 192.168.1.0/24)",
    )
    parser.add_argument(
        "--ips",
        "-i",
        nargs="+",
        type=str,
        help="Specific IP addresses to probe",
    )
    parser.add_argument(
        "--timeout",
        "-t",
        type=float,
        default=5.0,
        help="Timeout in seconds (default: 5.0)",
    )
    parser.add_argument(
        "--workers",
        "-w",
        type=int,
        default=50,
        help="Number of concurrent workers for subnet scan (default: 50)",
    )
    parser.add_argument(
        "--json",
        "-j",
        action="store_true",
        help="Output JSON for import into controller (use with --scan)",
    )
    parser.add_argument(
        "--import-url",
        type=str,
        help="Controller URL to import discovered lights (e.g., http://localhost:8080)",
    )

    args = parser.parse_args()

    if not args.scan and not args.govee and not args.subnet and not args.ips:
        # Default to --scan if no args
        args.scan = True

    devices = []
    seen_ips = set()

    # Multicast LAN scan (recommended)
    if args.scan:
        lan_devices = discover_govee_lan(timeout=args.timeout)
        for d in lan_devices:
            devices.append(d)
            seen_ips.add(d["ip"])
        print()

    # Govee MAC-based discovery
    if args.govee:
        govee_devices = discover_govee_by_mac(subnet=args.subnet)
        for d in govee_devices:
            if d["ip"] not in seen_ips:
                devices.append(d)
                seen_ips.add(d["ip"])
        print()

    # Probe specific IPs
    if args.ips:
        ip_devices = probe_ips(args.ips, timeout=args.timeout)
        for d in ip_devices:
            if d["ip"] not in seen_ips:
                devices.append(d)
                seen_ips.add(d["ip"])
        print()

    # Subnet UDP probe (fallback, devices often don't respond)
    if args.subnet and not args.govee and not args.scan:
        subnet_devices = scan_subnet(
            args.subnet, timeout=args.timeout * 0.5, workers=args.workers
        )
        for d in subnet_devices:
            if d["ip"] not in seen_ips:
                devices.append(d)
                seen_ips.add(d["ip"])

    print(f"Found {len(devices)} device(s)")

    # Prepare import-ready format
    import_lights = []
    for d in devices:
        if d.get("device") and d.get("sku"):
            light = {
                "ip": d["ip"],
                "deviceId": d["device"],
                "sku": d["sku"],
            }
            if d.get("mac"):
                light["mac"] = d["mac"]
            import_lights.append(light)

    # JSON output for import
    if args.json:
        print(json.dumps({"lights": import_lights}, indent=2))
        return

    # Import to controller
    if args.import_url and import_lights:
        import urllib.request
        import_url = args.import_url.rstrip("/") + "/api/lights/import"
        print(f"\nImporting {len(import_lights)} lights to {import_url}...")
        try:
            req = urllib.request.Request(
                import_url,
                data=json.dumps({"lights": import_lights}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode())
                print(f"  Success: added={result['data']['added']}, updated={result['data']['updated']}")
        except Exception as e:
            print(f"  Error: {e}")
        return

    if devices:
        print("\nGovee device IPs (add to lights.py):")
        for d in devices:
            mac = d.get("mac", "")
            sku = d.get("sku", "")
            extra = []
            if sku:
                extra.append(sku)
            if mac:
                extra.append(f"MAC: {mac}")
            extra_str = f"  # {', '.join(extra)}" if extra else ""
            print(f"  \"{d['ip']}\",{extra_str}")

        # Show import command
        if import_lights:
            print("\nTo import into controller:")
            print(f"  ./discover_devices.py --scan --import-url http://localhost:8080")
            print("  # or")
            print(f"  ./discover_devices.py --scan --json | curl -X POST -H 'Content-Type: application/json' -d @- http://localhost:8080/api/lights/import")


if __name__ == "__main__":
    main()
