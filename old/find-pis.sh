#!/bin/bash
# Find Raspberry Pis by mDNS hostname (mars01.local, mars02.local, etc.)

PREFIX="${1:-mars}"
MAX="${2:-20}"

for i in $(seq -w 1 $MAX); do
  hostname="${PREFIX}${i}.local"
  ip=$(ping -c1 -t1 "$hostname" 2>/dev/null | head -1 | grep -oE '\d+\.\d+\.\d+\.\d+')
  if [ -n "$ip" ]; then
    echo "$hostname $ip"
  fi
done
