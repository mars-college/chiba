# Pi Bootstrap

Bootstrap a Raspberry Pi with Chiba + Chiba Cable from your local checkout.

## Setup

1) Copy `registry.example.toml` to `registry.local.toml` and fill in credentials.
2) Run the bootstrap script for a registered Pi:

```sh
./scripts/pis/bootstrap.sh upper-east-2
```

The script will:
- rsync the repo to `/home/pi/chiba`
- run `scripts/setup-node.sh` with `--skip-git`
- install + enable `chiba-cable-server` and `chiba-cable-guide`
- set the kiosk URL to `http://localhost:5173/?screenId=<node_name>`
- optionally mount the NAS if credentials are present

## Notes

- The registry is TOML (to match channel configs).
- `registry.local.toml` is gitignored.
