# MPV Fallback Launcher (Pi)

Fallback plan when the Guide/player stack is unstable.

This path resolves each Pi's assigned content from:
- `registry.prod.toml` inventory (`[pis.<id>]`)
- profile mode file (`[defaults.cable]` + `[pis.<id>.cable]`)
- `channels -> blocks -> playlists -> media`

Then it:
1. caches media locally on each Pi,
2. writes a node-specific `.m3u8`,
3. writes per-item infobox metadata (`artist/title/description`),
4. plays it fullscreen with `mpv` on boot (`systemd`) with a lower-left info box.

## Files

- `cable2/scripts/pis/fallback-mpv-launcher.py`
- `cable2/scripts/pis/install-mpv-fallback-service.sh`
- `cable2/scripts/pis/deploy-mpv-fallback.sh`

## Quick Test (local planning)

```bash
python3 cable2/scripts/pis/fallback-mpv-launcher.py \
  --node-id upper-west-4 \
  --registry cable2/config/registry.prod.toml \
  --profile cable2/config/profiles/midterms-gallery.toml \
  --config-root cable2/config \
  --dry-run
```

## Deploy To One Pi

```bash
cable2/scripts/pis/deploy-mpv-fallback.sh \
  --pi upper-west-4 \
  --registry cable2/config/registry.prod.toml \
  --profile cable2/config/profiles/midterms-gallery.toml \
  --config-root cable2/config

# default behavior: deploy disables chiba-kiosk + chiba-cable-guide
# so fallback owns display on boot
```

## Deploy To All Pis

```bash
cable2/scripts/pis/deploy-mpv-fallback.sh \
  --all \
  --registry cable2/config/registry.prod.toml \
  --profile cable2/config/profiles/midterms-gallery.toml \
  --config-root cable2/config
```

## Verify On Pi

```bash
sudo systemctl status chiba-mpv-fallback.service
sudo journalctl -u chiba-mpv-fallback.service -n 200 --no-pager
```

## Notes

- Default source path rewrite is `/Volumes/share=/mnt/share`.
- Override with `--path-map FROM=TO` in deploy/install.
- Deploy/install disable conflicting display services by default:
  - `chiba-kiosk.service`
  - `chiba-cable-guide.service`
- To keep Cable display services enabled, pass `--keep-cable-display`.
- Cache/state defaults:
  - `/var/lib/chiba-mpv-fallback/cache`
  - `/var/lib/chiba-mpv-fallback/state`
