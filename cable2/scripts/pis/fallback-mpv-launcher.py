#!/usr/bin/env python3
"""Fallback launcher for Raspberry Pi nodes using mpv.

This script resolves a node's content target from:
- registry TOML (inventory + node ids)
- profile TOML (defaults.cable + pis.<node>.cable)
- config graph (channels -> blocks -> playlists -> media)

Then it pre-caches source media locally, writes an M3U playlist, and can launch mpv.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from dataclasses import replace
from typing import Any, Iterable

try:
    import tomllib  # type: ignore[attr-defined]
except Exception:  # pragma: no cover
    import tomli as tomllib  # type: ignore


TARGET_KINDS = {"media", "playlist", "block", "channel"}


@dataclass(frozen=True)
class SourceRef:
    src_type: str
    value: str
    cache: bool | None
    kind: str | None
    title: str | None
    artist: str | None
    description: str | None
    origin: str

    def cache_key(self) -> str:
        return f"{self.src_type}:{self.value}"


@dataclass(frozen=True)
class TargetRef:
    kind: str
    target_id: str


def eprint(*parts: object) -> None:
    print(*parts, file=sys.stderr)


def load_toml(path: str) -> dict[str, Any]:
    with open(path, "rb") as fh:
        parsed = tomllib.load(fh)
    if not isinstance(parsed, dict):
        return {}
    return parsed


def parse_source(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    src_type = raw.get("type")
    value = raw.get("value")
    if src_type not in ("path", "url"):
        return None
    if not isinstance(value, str) or not value.strip():
        return None
    cache_value = raw.get("cache")
    out: dict[str, Any] = {
        "type": src_type,
        "value": value.strip(),
    }
    if isinstance(cache_value, bool):
        out["cache"] = cache_value
    return out


def ensure_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def as_string(value: Any) -> str | None:
    if isinstance(value, str):
        out = value.strip()
        if out:
            return out
    return None


def load_resources(config_root: str) -> dict[str, Any]:
    root = pathlib.Path(config_root)

    media_by_id: dict[str, dict[str, Any]] = {}
    playlists_by_id: dict[str, dict[str, Any]] = {}
    blocks_by_id: dict[str, dict[str, Any]] = {}
    channels_by_id: dict[str, dict[str, Any]] = {}

    media_dir = root / "media"
    playlists_dir = root / "playlists"
    blocks_dir = root / "blocks"
    channels_dir = root / "channels"

    for path in sorted(media_dir.glob("*.toml")):
        parsed = load_toml(str(path))
        media_id = as_string(parsed.get("id")) or path.stem
        media_by_id[media_id] = {
            "id": media_id,
            "title": as_string(parsed.get("title")) or as_string(parsed.get("name")),
            "kind": as_string(parsed.get("kind")),
            "artist": as_string(parsed.get("artist")),
            "description": as_string(parsed.get("description")) or as_string(parsed.get("subtitle")),
            "source": parse_source(parsed.get("source")) or parse_source(parsed),
            "file": str(path),
        }

    for path in sorted(playlists_dir.glob("*.toml")):
        parsed = load_toml(str(path))
        playlist_id = as_string(parsed.get("id")) or path.stem
        items: list[dict[str, Any]] = []
        raw_items = ensure_list(parsed.get("items") or parsed.get("item"))
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            items.append(
                {
                    "media": as_string(raw.get("media")),
                    "playlist": as_string(raw.get("playlist")),
                    "source": parse_source(raw.get("source")),
                    "title": as_string(raw.get("title")),
                    "artist": as_string(raw.get("artist")),
                    "description": as_string(raw.get("description")) or as_string(raw.get("subtitle")),
                }
            )
        playlists_by_id[playlist_id] = {
            "id": playlist_id,
            "title": as_string(parsed.get("title")) or as_string(parsed.get("name")),
            "artist": as_string(parsed.get("artist")),
            "description": as_string(parsed.get("description")) or as_string(parsed.get("subtitle")),
            "items": items,
            "file": str(path),
        }

    for path in sorted(blocks_dir.glob("*.toml")):
        parsed = load_toml(str(path))
        block_id = as_string(parsed.get("id")) or path.stem
        items: list[dict[str, Any]] = []
        programs: list[dict[str, Any]] = []

        raw_items = ensure_list(parsed.get("items") or parsed.get("item"))
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            items.append(
                {
                    "media": as_string(raw.get("media")),
                    "playlist": as_string(raw.get("playlist")),
                    "source": parse_source(raw.get("source")),
                    "title": as_string(raw.get("title")),
                    "artist": as_string(raw.get("artist")),
                    "description": as_string(raw.get("description")) or as_string(raw.get("subtitle")),
                }
            )

        raw_programs = ensure_list(parsed.get("programs") or parsed.get("program"))
        for raw in raw_programs:
            if not isinstance(raw, dict):
                continue
            programs.append({"source": parse_source(raw.get("source"))})

        blocks_by_id[block_id] = {
            "id": block_id,
            "playlist": as_string(parsed.get("playlist")),
            "items": items,
            "programs": programs,
            "file": str(path),
        }

    for path in sorted(channels_dir.glob("*.toml")):
        parsed = load_toml(str(path))
        channel_id = as_string(parsed.get("id")) or path.stem

        block_list: list[str] = []
        raw_blocks = parsed.get("blocks")
        if isinstance(raw_blocks, list):
            for item in raw_blocks:
                item_id = as_string(item)
                if item_id:
                    block_list.append(item_id)

        raw_block_tables = ensure_list(parsed.get("block"))
        for raw in raw_block_tables:
            if not isinstance(raw, dict):
                continue
            item_id = as_string(raw.get("id"))
            if item_id:
                block_list.append(item_id)

        seen_blocks: set[str] = set()
        deduped_blocks: list[str] = []
        for bid in block_list:
            if bid in seen_blocks:
                continue
            seen_blocks.add(bid)
            deduped_blocks.append(bid)

        programs: list[dict[str, Any]] = []
        raw_programs = ensure_list(parsed.get("programs") or parsed.get("program"))
        for raw in raw_programs:
            if not isinstance(raw, dict):
                continue
            programs.append({"source": parse_source(raw.get("source"))})

        channels_by_id[channel_id] = {
            "id": channel_id,
            "title": as_string(parsed.get("name")) or as_string(parsed.get("title")),
            "blocks": deduped_blocks,
            "programs": programs,
            "file": str(path),
        }

    return {
        "media": media_by_id,
        "playlists": playlists_by_id,
        "blocks": blocks_by_id,
        "channels": channels_by_id,
    }


def resolve_rotation(node: dict[str, Any], defaults: dict[str, Any]) -> int:
    raw_rotate = node.get("display_rotate", defaults.get("display_rotate"))
    if isinstance(raw_rotate, (int, float)):
        val = int(raw_rotate)
        if val in (0, 90, 180, 270):
            return val
    if isinstance(raw_rotate, str) and raw_rotate.strip():
        try:
            val = int(raw_rotate.strip())
            if val in (0, 90, 180, 270):
                return val
        except Exception:
            pass

    orientation = node.get("orientation", defaults.get("orientation", ""))
    if isinstance(orientation, str) and orientation.strip().lower() == "portrait":
        return 90
    return 0


def resolve_infobox_rotate_ccw(node: dict[str, Any], defaults: dict[str, Any]) -> int:
    raw = node.get("infobox_rotate_ccw", defaults.get("infobox_rotate_ccw"))
    if isinstance(raw, (int, float)):
        return int(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            return int(raw.strip())
        except Exception:
            return 0
    return 0


def resolve_bool_option(node: dict[str, Any], defaults: dict[str, Any], key: str) -> bool:
    raw = node.get(key, defaults.get(key))
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return int(raw) != 0
    if isinstance(raw, str):
        value = raw.strip().lower()
        if value in ("1", "true", "yes", "on"):
            return True
        if value in ("0", "false", "no", "off", ""):
            return False
    return False


def merge_profile_mode(defaults_mode: dict[str, Any], node_mode: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = dict(defaults_mode)
    out.update(node_mode)

    override_targets = node_mode.get("prefetch_targets")
    default_targets = defaults_mode.get("prefetch_targets")
    if isinstance(override_targets, list) and len(override_targets) > 0:
        out["prefetch_targets"] = override_targets
    elif isinstance(default_targets, list):
        out["prefetch_targets"] = default_targets

    override_channels = node_mode.get("prefetch_channels")
    default_channels = defaults_mode.get("prefetch_channels")
    if isinstance(override_channels, list) and len(override_channels) > 0:
        out["prefetch_channels"] = override_channels
    elif isinstance(default_channels, list):
        out["prefetch_channels"] = default_channels

    return out


def parse_profile_mode(profile_path: str, node_id: str) -> dict[str, Any]:
    profile = load_toml(profile_path)
    defaults = profile.get("defaults") if isinstance(profile.get("defaults"), dict) else {}
    defaults_mode = defaults.get("cable") if isinstance(defaults, dict) and isinstance(defaults.get("cable"), dict) else {}

    pis = profile.get("pis") if isinstance(profile.get("pis"), dict) else {}
    node_row = pis.get(node_id) if isinstance(pis, dict) else {}
    node_mode = node_row.get("cable") if isinstance(node_row, dict) and isinstance(node_row.get("cable"), dict) else {}

    return merge_profile_mode(defaults_mode if isinstance(defaults_mode, dict) else {}, node_mode if isinstance(node_mode, dict) else {})


def load_profile_presentation(profile_path: str) -> dict[str, dict[str, dict[str, str]]]:
    profile = load_toml(profile_path)
    prepare = profile.get("prepare") if isinstance(profile.get("prepare"), dict) else {}
    rows: list[dict[str, Any]] = []
    for key in ("dir", "eden_collection", "eden"):
        values = prepare.get(key) if isinstance(prepare, dict) else None
        for row in ensure_list(values):
            if isinstance(row, dict):
                rows.append(row)

    by_channel: dict[str, dict[str, str]] = {}
    by_playlist: dict[str, dict[str, str]] = {}

    for row in rows:
        channel_id = as_string(row.get("channel_id")) or ""
        playlist_id = as_string(row.get("playlist_id")) or ""
        title = as_string(row.get("playlist_title")) or ""
        artist = as_string(row.get("artist")) or ""
        description = as_string(row.get("description")) or ""

        payload = {
            "title": title,
            "artist": artist,
            "description": description,
        }

        if channel_id:
            by_channel[channel_id] = payload
        if playlist_id:
            by_playlist[playlist_id] = payload

    return {
        "by_channel": by_channel,
        "by_playlist": by_playlist,
    }


def source_playlist_id_from_origin(origin: str) -> str | None:
    match = re.search(r"playlist:([^\\s]+)", origin)
    if not match:
        return None
    playlist_id = match.group(1).strip()
    return playlist_id if playlist_id else None


def source_channel_id_from_origin(origin: str) -> str | None:
    match = re.search(r"channel:([^\\s]+)", origin)
    if not match:
        return None
    channel_id = match.group(1).strip()
    return channel_id if channel_id else None


def apply_profile_presentation(
    sources: list[SourceRef],
    profile_presentation: dict[str, dict[str, dict[str, str]]],
    target: TargetRef,
) -> list[SourceRef]:
    by_channel = profile_presentation.get("by_channel", {})
    by_playlist = profile_presentation.get("by_playlist", {})
    target_channel_payload = by_channel.get(target.target_id) if target.kind == "channel" else None

    out: list[SourceRef] = []
    for source in sources:
        payload: dict[str, str] | None = None

        channel_id = source_channel_id_from_origin(source.origin)
        if channel_id and channel_id in by_channel:
            payload = by_channel[channel_id]

        if payload is None:
            playlist_id = source_playlist_id_from_origin(source.origin)
            if playlist_id and playlist_id in by_playlist:
                payload = by_playlist[playlist_id]

        if payload is None and target_channel_payload is not None:
            payload = target_channel_payload

        if payload is None:
            out.append(source)
            continue

        title = payload.get("title") or source.title
        artist = payload.get("artist") or source.artist
        description = payload.get("description") or source.description
        out.append(
            replace(
                source,
                title=title,
                artist=artist,
                description=description,
            )
        )

    return out


def resolve_target(mode: dict[str, Any]) -> TargetRef | None:
    target_kind = as_string(mode.get("target_kind"))
    target_id = as_string(mode.get("target_id"))
    if target_kind and target_id and target_kind in TARGET_KINDS:
        return TargetRef(target_kind, target_id)

    channel_id = as_string(mode.get("channel"))
    if channel_id:
        return TargetRef("channel", channel_id)

    return None


def parse_runtime_target(token_raw: Any) -> TargetRef | None:
    if not isinstance(token_raw, str):
        return None
    token = token_raw.strip()
    if not token:
        return None
    idx = token.find(":")
    if idx <= 0 or idx >= len(token) - 1:
        return None
    kind = token[:idx].strip()
    target_id = token[idx + 1 :].strip()
    if kind not in TARGET_KINDS or not target_id:
        return None
    return TargetRef(kind, target_id)


def source_from_media(
    media: dict[str, Any],
    origin: str,
    overrides: dict[str, Any] | None = None,
) -> SourceRef | None:
    source = media.get("source")
    if not isinstance(source, dict):
        return None
    src_type = source.get("type")
    value = source.get("value")
    if src_type not in ("path", "url") or not isinstance(value, str) or not value.strip():
        return None
    cache_flag = source.get("cache") if isinstance(source.get("cache"), bool) else None
    title = as_string((overrides or {}).get("title")) or as_string(media.get("title"))
    artist = as_string((overrides or {}).get("artist")) or as_string(media.get("artist"))
    description = (
        as_string((overrides or {}).get("description"))
        or as_string(media.get("description"))
        or as_string(media.get("subtitle"))
        or as_string(media.get("tag"))
    )
    return SourceRef(
        src_type=src_type,
        value=value.strip(),
        cache=cache_flag,
        kind=as_string(media.get("kind")),
        title=title,
        artist=artist,
        description=description,
        origin=origin,
    )


def source_from_inline(row: dict[str, Any], origin: str) -> SourceRef | None:
    source = row.get("source")
    if not isinstance(source, dict):
        return None
    src_type = source.get("type")
    value = source.get("value")
    if src_type not in ("path", "url") or not isinstance(value, str) or not value.strip():
        return None
    cache_flag = source.get("cache") if isinstance(source.get("cache"), bool) else None
    return SourceRef(
        src_type=src_type,
        value=value.strip(),
        cache=cache_flag,
        kind=None,
        title=as_string(row.get("title")),
        artist=as_string(row.get("artist")),
        description=as_string(row.get("description")) or as_string(row.get("subtitle")),
        origin=origin,
    )


def collect_target_sources(
    target: TargetRef,
    store: dict[str, Any],
    warnings: list[str],
) -> list[SourceRef]:
    out: list[SourceRef] = []

    visiting_playlists: set[str] = set()
    visiting_blocks: set[str] = set()
    visiting_channels: set[str] = set()

    def resolve_media(media_id: str, context: str, overrides: dict[str, Any] | None = None) -> None:
        media = store["media"].get(media_id)
        if not isinstance(media, dict):
            warnings.append(f"missing_media:{media_id}")
            return
        src = source_from_media(media, f"{context} -> media:{media_id}", overrides=overrides)
        if src is None:
            warnings.append(f"missing_media_source:{media_id}")
            return
        out.append(src)

    def resolve_playlist(playlist_id: str, context: str) -> None:
        if playlist_id in visiting_playlists:
            warnings.append(f"playlist_cycle:{playlist_id}")
            return
        playlist = store["playlists"].get(playlist_id)
        if not isinstance(playlist, dict):
            warnings.append(f"missing_playlist:{playlist_id}")
            return
        visiting_playlists.add(playlist_id)
        playlist_artist = as_string(playlist.get("artist"))
        playlist_description = as_string(playlist.get("description"))
        for item in playlist.get("items", []):
            if not isinstance(item, dict):
                continue
            media_id = as_string(item.get("media"))
            nested = as_string(item.get("playlist"))
            if media_id:
                merged_overrides = {
                    "title": as_string(item.get("title")),
                    "artist": as_string(item.get("artist")) or playlist_artist,
                    "description": as_string(item.get("description")) or playlist_description,
                }
                resolve_media(media_id, f"{context} -> playlist:{playlist_id}", overrides=merged_overrides)
                continue
            if nested:
                resolve_playlist(nested, f"{context} -> playlist:{playlist_id}")
                continue
            inline = source_from_inline(item, f"{context} -> playlist:{playlist_id}:inline")
            if inline:
                out.append(inline)
        visiting_playlists.remove(playlist_id)

    def resolve_block(block_id: str, context: str) -> None:
        if block_id in visiting_blocks:
            warnings.append(f"block_cycle:{block_id}")
            return
        block = store["blocks"].get(block_id)
        if not isinstance(block, dict):
            warnings.append(f"missing_block:{block_id}")
            return

        visiting_blocks.add(block_id)
        playlist_id = as_string(block.get("playlist"))
        if playlist_id:
            resolve_playlist(playlist_id, f"{context} -> block:{block_id}")

        for item in block.get("items", []):
            if not isinstance(item, dict):
                continue
            media_id = as_string(item.get("media"))
            nested = as_string(item.get("playlist"))
            if media_id:
                merged_overrides = {
                    "title": as_string(item.get("title")),
                    "artist": as_string(item.get("artist")),
                    "description": as_string(item.get("description")),
                }
                resolve_media(media_id, f"{context} -> block:{block_id}", overrides=merged_overrides)
                continue
            if nested:
                resolve_playlist(nested, f"{context} -> block:{block_id}")
                continue
            inline = source_from_inline(item, f"{context} -> block:{block_id}:inline")
            if inline:
                out.append(inline)

        for program in block.get("programs", []):
            if not isinstance(program, dict):
                continue
            inline = source_from_inline(program, f"{context} -> block:{block_id}:program")
            if inline:
                out.append(inline)

        visiting_blocks.remove(block_id)

    def resolve_channel(channel_id: str, context: str) -> None:
        if channel_id in visiting_channels:
            warnings.append(f"channel_cycle:{channel_id}")
            return
        channel = store["channels"].get(channel_id)
        if not isinstance(channel, dict):
            warnings.append(f"missing_channel:{channel_id}")
            return

        visiting_channels.add(channel_id)
        blocks = channel.get("blocks", [])
        if isinstance(blocks, list) and len(blocks) > 0:
            for block_id in blocks:
                if isinstance(block_id, str) and block_id.strip():
                    resolve_block(block_id.strip(), f"{context} -> channel:{channel_id}")
        else:
            for program in channel.get("programs", []):
                if not isinstance(program, dict):
                    continue
                inline = source_from_inline(program, f"{context} -> channel:{channel_id}:program")
                if inline:
                    out.append(inline)

        visiting_channels.remove(channel_id)

    if target.kind == "media":
        resolve_media(target.target_id, "target")
    elif target.kind == "playlist":
        resolve_playlist(target.target_id, "target")
    elif target.kind == "block":
        resolve_block(target.target_id, "target")
    elif target.kind == "channel":
        resolve_channel(target.target_id, "target")

    return out


def parse_path_maps(raw_values: Iterable[str]) -> list[tuple[str, str]]:
    maps: list[tuple[str, str]] = []
    for raw in raw_values:
        chunks = [chunk.strip() for chunk in raw.split(",") if chunk.strip()]
        for chunk in chunks:
            if "=" not in chunk:
                raise ValueError(f"Invalid --path-map entry (expected from=to): {chunk}")
            left, right = chunk.split("=", 1)
            from_prefix = left.strip()
            to_prefix = right.strip()
            if not from_prefix:
                raise ValueError(f"Invalid --path-map entry (empty from prefix): {chunk}")
            maps.append((from_prefix, to_prefix))
    maps.sort(key=lambda pair: len(pair[0]), reverse=True)
    return maps


def pick_path_source(path_value: str, path_maps: list[tuple[str, str]]) -> tuple[str | None, list[str]]:
    candidates: list[str] = []

    raw = path_value.strip()
    if raw:
        candidates.append(raw)

    for from_prefix, to_prefix in path_maps:
        if raw.startswith(from_prefix):
            mapped = to_prefix + raw[len(from_prefix) :]
            if mapped not in candidates:
                candidates.append(mapped)

    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate, candidates

    return None, candidates


def guess_extension(source: SourceRef) -> str:
    if source.src_type == "path":
        suffix = pathlib.Path(source.value).suffix
        if suffix:
            return suffix
    if source.src_type == "url":
        parsed = urllib.parse.urlparse(source.value)
        suffix = pathlib.Path(parsed.path).suffix
        if suffix:
            return suffix

    if source.kind == "image":
        return ".jpg"
    if source.kind == "video":
        return ".mp4"
    if source.kind == "audio":
        return ".mp3"
    return ".bin"


def _looks_like_text_payload(header: bytes) -> bool:
    if not header:
        return False
    lower = header[:512].lower()
    if b"<html" in lower or b"<!doctype html" in lower:
        return True
    if lower.startswith(b"<?xml"):
        return True
    if lower.startswith(b"{") or lower.startswith(b"["):
        # Common API error payloads.
        return True
    return False


def _matches_magic(ext: str, header: bytes) -> bool | None:
    ext_l = ext.lower()
    if ext_l in (".jpg", ".jpeg"):
        return header.startswith(b"\xff\xd8")
    if ext_l == ".png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if ext_l == ".gif":
        return header.startswith(b"GIF87a") or header.startswith(b"GIF89a")
    if ext_l == ".webp":
        return len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    if ext_l in (".mp4", ".m4v", ".mov"):
        return len(header) >= 12 and header[4:8] == b"ftyp"
    if ext_l == ".webm":
        return header.startswith(b"\x1a\x45\xdf\xa3")
    if ext_l == ".mp3":
        if header.startswith(b"ID3"):
            return True
        return len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0
    if ext_l == ".wav":
        return len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WAVE"
    if ext_l in (".ogg", ".oga"):
        return header.startswith(b"OggS")
    return None


def validate_cached_media(source: SourceRef, path: str, ext: str) -> str | None:
    if not os.path.isfile(path):
        return "missing_file"
    try:
        size = os.path.getsize(path)
    except Exception as exc:
        return f"stat_failed:{exc}"
    if size <= 0:
        return "empty_file"

    try:
        with open(path, "rb") as fh:
            header = fh.read(1024)
    except Exception as exc:
        return f"read_failed:{exc}"

    # Guard against cached HTML/JSON/API error pages where media is expected.
    if source.kind in ("image", "video", "audio") and _looks_like_text_payload(header):
        return "text_payload_in_media_slot"

    signature_ok = _matches_magic(ext, header)
    if signature_ok is False:
        return f"signature_mismatch:{ext}"
    return None


def download_with_curl(url: str, output_path: str, timeout_sec: int) -> bool:
    cmd = [
        "curl",
        "-fL",
        "--retry",
        "6",
        "--retry-delay",
        "2",
        "--connect-timeout",
        "10",
        "--max-time",
        str(timeout_sec),
        "-o",
        output_path,
        url,
    ]
    try:
        subprocess.run(cmd, check=True)
        return True
    except Exception:
        return False


def download_with_urllib(url: str, output_path: str, timeout_sec: int) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "chiba-mpv-fallback/1.0"})
    with urllib.request.urlopen(req, timeout=timeout_sec) as response:
        with open(output_path, "wb") as fh:
            shutil.copyfileobj(response, fh)


def cache_one_source(
    source: SourceRef,
    cache_dir: str,
    path_maps: list[tuple[str, str]],
    timeout_sec: int,
    dry_run: bool,
) -> tuple[str | None, str | None]:
    source_hash = hashlib.sha1(source.cache_key().encode("utf-8")).hexdigest()[:16]
    ext = guess_extension(source)
    final_name = f"{source_hash}{ext}"
    final_path = os.path.join(cache_dir, final_name)
    temp_path = f"{final_path}.tmp"

    if os.path.isfile(final_path) and os.path.getsize(final_path) > 0:
        stale_reason = validate_cached_media(source, final_path, ext)
        if stale_reason is None:
            return final_path, None
        eprint(f"warning: removing invalid cached media {final_path} ({stale_reason})")
        try:
            os.remove(final_path)
        except Exception as exc:
            return None, f"stale_cache_remove_failed:{final_path}:{exc}"

    if dry_run:
        return final_path, None

    os.makedirs(cache_dir, exist_ok=True)

    if os.path.exists(temp_path):
        try:
            os.remove(temp_path)
        except Exception:
            pass

    if source.src_type == "path":
        picked, candidates = pick_path_source(source.value, path_maps)
        if not picked:
            return None, f"path_not_found:{source.value} candidates={candidates}"
        try:
            shutil.copy2(picked, temp_path)
            os.replace(temp_path, final_path)
            return final_path, None
        except Exception as exc:
            return None, f"copy_failed:{picked}:{exc}"

    if source.src_type == "url":
        parsed = urllib.parse.urlparse(source.value)
        if parsed.scheme not in ("http", "https"):
            return None, f"unsupported_url_scheme:{source.value}"

        ok = download_with_curl(source.value, temp_path, timeout_sec)
        if not ok:
            try:
                download_with_urllib(source.value, temp_path, timeout_sec)
            except Exception as exc:
                return None, f"download_failed:{source.value}:{exc}"

        if not os.path.isfile(temp_path) or os.path.getsize(temp_path) <= 0:
            return None, f"empty_download:{source.value}"

        bad_reason = validate_cached_media(source, temp_path, ext)
        if bad_reason is not None:
            try:
                os.remove(temp_path)
            except Exception:
                pass
            return None, f"invalid_download:{source.value}:{bad_reason}"

        os.replace(temp_path, final_path)
        return final_path, None

    return None, f"unsupported_source_type:{source.src_type}"


def dedupe_sources_keep_order(sources: list[SourceRef]) -> list[SourceRef]:
    seen: set[str] = set()
    out: list[SourceRef] = []
    for src in sources:
        token = src.cache_key()
        if token in seen:
            continue
        seen.add(token)
        out.append(src)
    return out


def build_m3u(playlist_path: str, entries: list[tuple[str, SourceRef]]) -> None:
    os.makedirs(os.path.dirname(playlist_path), exist_ok=True)
    with open(playlist_path, "w", encoding="utf-8") as fh:
        fh.write("#EXTM3U\n")
        for local_path, source in entries:
            title = source.title or source.origin
            fh.write(f"#EXTINF:-1,{title}\n")
            fh.write(f"{local_path}\n")


def build_infobox_metadata(metadata_path: str, entries: list[tuple[str, SourceRef]]) -> None:
    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
    out_entries: list[dict[str, str]] = []
    seen_paths: set[str] = set()

    for local_path, source in entries:
        if local_path in seen_paths:
            continue
        seen_paths.add(local_path)
        out_entries.append(
            {
                "path": local_path,
                "artist": source.artist or "",
                "title": source.title or "",
                "description": source.description or "",
            }
        )

    payload = {"entries": out_entries}
    with open(metadata_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")


def default_paths() -> tuple[str, str, str]:
    script_dir = pathlib.Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent.parent
    return (
        str(repo_root / "cable2" / "config" / "registry.prod.toml"),
        str(repo_root / "cable2" / "config" / "profiles" / "midterms-gallery.toml"),
        str(repo_root / "cable2" / "config"),
    )


def parse_args() -> argparse.Namespace:
    default_registry, default_profile, default_config_root = default_paths()

    parser = argparse.ArgumentParser(description="Cache node media and run mpv fallback player.")
    parser.add_argument("--node-id", required=True, help="Node id from registry [pis.<id>]")
    parser.add_argument("--registry", default=default_registry, help="Path to registry TOML")
    parser.add_argument("--profile", default=default_profile, help="Path to profile TOML")
    parser.add_argument("--config-root", default=default_config_root, help="Path to cable2/config root")
    parser.add_argument("--cache-dir", default="/var/lib/chiba-mpv-fallback/cache", help="Local media cache dir")
    parser.add_argument("--state-dir", default="/var/lib/chiba-mpv-fallback/state", help="State/output dir")
    parser.add_argument("--image-seconds", type=int, default=12, help="mpv image-display-duration")
    parser.add_argument("--path-map", action="append", default=[], help="Path rewrite mapping: from=to[,from=to]")
    parser.add_argument("--download-timeout-sec", type=int, default=1800, help="Max seconds per remote download")
    parser.add_argument("--no-prefetch", action="store_true", help="Cache only primary target, ignore prefetch_* hints")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero on unresolved sources or cache failures")
    parser.add_argument("--dry-run", action="store_true", help="Plan only, do not copy/download or launch mpv")
    parser.add_argument("--run", action="store_true", help="Launch mpv after caching")
    parser.add_argument("--no-infobox", action="store_true", help="Disable lower-left metadata infobox")
    parser.add_argument("--mpv-bin", default="mpv", help="mpv binary path")
    parser.add_argument("--extra-mpv-arg", action="append", default=[], help="Extra arg passed to mpv (repeatable)")
    parser.add_argument(
        "--playlist-path",
        default="",
        help="Optional explicit M3U output path (default: <state-dir>/<node-id>.m3u8)",
    )
    parser.add_argument(
        "--plan-path",
        default="",
        help="Optional explicit JSON plan output path (default: <state-dir>/<node-id>-plan.json)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    for required in (args.registry, args.profile):
        if not os.path.isfile(required):
            eprint(f"Missing required file: {required}")
            return 2

    if not os.path.isdir(args.config_root):
        eprint(f"Missing config root directory: {args.config_root}")
        return 2

    try:
        path_maps = parse_path_maps(args.path_map) if args.path_map else [("/Volumes/share", "/mnt/share")]
    except ValueError as exc:
        eprint(str(exc))
        return 2

    registry = load_toml(args.registry)
    defaults = registry.get("defaults") if isinstance(registry.get("defaults"), dict) else {}
    pis = registry.get("pis") if isinstance(registry.get("pis"), dict) else {}
    node = pis.get(args.node_id)
    if not isinstance(node, dict):
        eprint(f"Unknown node id in registry: {args.node_id}")
        return 2

    rotation = resolve_rotation(node, defaults if isinstance(defaults, dict) else {})
    infobox_rotate_ccw = resolve_infobox_rotate_ccw(node, defaults if isinstance(defaults, dict) else {})
    display_vflip = resolve_bool_option(node, defaults if isinstance(defaults, dict) else {}, "display_vflip")
    display_hflip = resolve_bool_option(node, defaults if isinstance(defaults, dict) else {}, "display_hflip")
    mode = parse_profile_mode(args.profile, args.node_id)
    target = resolve_target(mode)
    if target is None:
        eprint(f"No target resolved for node '{args.node_id}' from profile '{args.profile}'")
        return 2

    store = load_resources(args.config_root)

    warnings: list[str] = []
    target_sources = collect_target_sources(target, store, warnings)
    profile_presentation = load_profile_presentation(args.profile)
    target_sources = apply_profile_presentation(target_sources, profile_presentation, target)

    prefetch_sources: list[SourceRef] = []
    if not args.no_prefetch:
        prefetch_channels_raw = mode.get("prefetch_channels") if isinstance(mode.get("prefetch_channels"), list) else []
        for channel_raw in prefetch_channels_raw:
            channel_id = as_string(channel_raw)
            if not channel_id:
                continue
            prefetch_sources.extend(collect_target_sources(TargetRef("channel", channel_id), store, warnings))

        prefetch_targets_raw = mode.get("prefetch_targets") if isinstance(mode.get("prefetch_targets"), list) else []
        for token_raw in prefetch_targets_raw:
            parsed = parse_runtime_target(token_raw)
            if parsed is None:
                warnings.append(f"invalid_prefetch_target:{token_raw}")
                continue
            prefetch_sources.extend(collect_target_sources(parsed, store, warnings))
    if not args.no_prefetch and len(prefetch_sources) > 0:
        prefetch_sources = apply_profile_presentation(prefetch_sources, profile_presentation, target)

    if len(target_sources) == 0:
        eprint(f"No playable sources found for target {target.kind}:{target.target_id}")
        for warning in sorted(set(warnings)):
            eprint(f"warning: {warning}")
        return 3

    cache_sources = dedupe_sources_keep_order(target_sources + prefetch_sources)

    node_cache_dir = os.path.join(args.cache_dir, args.node_id)
    if not args.dry_run:
        os.makedirs(node_cache_dir, exist_ok=True)
        os.makedirs(args.state_dir, exist_ok=True)

    playlist_path = args.playlist_path or os.path.join(args.state_dir, f"{args.node_id}.m3u8")
    plan_path = args.plan_path or os.path.join(args.state_dir, f"{args.node_id}-plan.json")
    infobox_metadata_path = os.path.join(args.state_dir, f"{args.node_id}-infobox.json")

    cached_map: dict[str, str] = {}
    cache_failures: list[str] = []

    for source in cache_sources:
        local_path, err = cache_one_source(
            source=source,
            cache_dir=node_cache_dir,
            path_maps=path_maps,
            timeout_sec=max(1, int(args.download_timeout_sec)),
            dry_run=args.dry_run,
        )
        if local_path:
            cached_map[source.cache_key()] = local_path
        if err:
            cache_failures.append(f"{source.origin} :: {err}")

    playlist_entries: list[tuple[str, SourceRef]] = []
    for source in target_sources:
        cached = cached_map.get(source.cache_key())
        if cached:
            playlist_entries.append((cached, source))

    if len(playlist_entries) == 0:
        eprint("No playable cached entries were produced.")
        for err in cache_failures:
            eprint(f"cache_error: {err}")
        return 4

    if not args.dry_run:
        build_m3u(playlist_path, playlist_entries)
        if not args.no_infobox:
            build_infobox_metadata(infobox_metadata_path, playlist_entries)

    plan_payload = {
        "ok": len(cache_failures) == 0,
        "nodeId": args.node_id,
        "registry": args.registry,
        "profile": args.profile,
        "configRoot": args.config_root,
        "target": {"kind": target.kind, "id": target.target_id},
        "rotation": rotation,
        "displayVFlip": display_vflip,
        "displayHFlip": display_hflip,
        "sources": {
            "target": len(target_sources),
            "prefetch": len(prefetch_sources),
            "cacheDistinct": len(cache_sources),
            "cachedPlayable": len(playlist_entries),
        },
        "playlistPath": playlist_path,
        "infoboxMetadataPath": infobox_metadata_path if not args.no_infobox else None,
        "warnings": sorted(set(warnings)),
        "cacheFailures": cache_failures,
    }

    if not args.dry_run:
        with open(plan_path, "w", encoding="utf-8") as fh:
            json.dump(plan_payload, fh, indent=2)
            fh.write("\n")

    print(json.dumps(plan_payload, indent=2))

    if args.strict and (len(warnings) > 0 or len(cache_failures) > 0):
        return 5

    if not args.run:
        return 0

    mpv_cmd = [
        args.mpv_bin,
        "--fullscreen",
        "--keepaspect=yes",
        "--panscan=0.0",
        "--loop-playlist=inf",
        "--osd-level=0",
        "--no-osc",
        "--cursor-autohide=always",
        "--keep-open=no",
        f"--image-display-duration={max(1, int(args.image_seconds))}",
        "--hwdec=auto-safe",
        "--framedrop=vo",
        "--video-sync=audio",
    ]

    # Use video filters for rotation so OSD/infobox text stays screen-anchored.
    if rotation == 90:
        mpv_cmd.append("--vf-add=transpose=clock")
    elif rotation == 270:
        mpv_cmd.append("--vf-add=transpose=cclock")
    elif rotation == 180:
        mpv_cmd.append("--vf-add=hflip,vflip")
    if display_hflip and rotation != 180:
        mpv_cmd.append("--vf-add=hflip")
    if display_vflip and rotation != 180:
        mpv_cmd.append("--vf-add=vflip")

    if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        mpv_cmd.extend(["--vo=gpu", "--gpu-context=drm"])

    for extra in args.extra_mpv_arg:
        if isinstance(extra, str) and extra.strip():
            mpv_cmd.append(extra.strip())

    if not args.no_infobox:
        infobox_script = os.path.join(os.path.dirname(os.path.realpath(__file__)), "mpv-infobox.lua")
        if os.path.isfile(infobox_script):
            script_opts = [
                f"chiba-infobox-metadata={infobox_metadata_path}",
                f"chiba-infobox-rotate_ccw={infobox_rotate_ccw}",
            ]
            mpv_cmd.extend(
                [
                    f"--script={infobox_script}",
                    f"--script-opts={','.join(script_opts)}",
                ]
            )
        else:
            eprint(f"warning: infobox script not found: {infobox_script}")

    mpv_cmd.append(playlist_path)

    eprint("Launching mpv:", " ".join(shlex_quote(part) for part in mpv_cmd))
    try:
        result = subprocess.run(mpv_cmd)
        return int(result.returncode)
    except FileNotFoundError:
        eprint(f"mpv binary not found: {args.mpv_bin}")
        return 127


def shlex_quote(value: str) -> str:
    try:
        import shlex

        return shlex.quote(value)
    except Exception:
        return value


if __name__ == "__main__":
    raise SystemExit(main())
