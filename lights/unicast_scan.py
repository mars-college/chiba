#!/usr/bin/env python3
"""Send Govee scan command as unicast to every IP in a subnet."""
import socket, json, sys

subnet = sys.argv[1] if len(sys.argv) > 1 else "10.10.13"
scan_msg = json.dumps({"msg": {"cmd": "scan", "data": {"account_topic": "reserve"}}}).encode()

listen = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
listen.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listen.settimeout(5)
listen.bind(("", 4002))

send = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
for i in range(1, 255):
    send.sendto(scan_msg, (f"{subnet}.{i}", 4001))
send.close()

print("Listening for responses on port 4002...")
while True:
    try:
        data, addr = listen.recvfrom(4096)
        print(f"  RESPONSE from {addr[0]}:{addr[1]} -> {data.decode()}")
    except socket.timeout:
        break
listen.close()
print("Done.")
