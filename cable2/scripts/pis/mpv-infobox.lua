local mp = require("mp")
local msg = require("mp.msg")
local utils = require("mp.utils")
local options = require("mp.options")

local opts = {
  metadata = "",
  rotate_ccw = 0,
  margin_x = 36,
  margin_y = 30,
  artist_size = 30,
  title_size = 30,
}

options.read_options(opts, "chiba-infobox")

local metadata_by_path = {}
local metadata_by_base = {}

local function trim(s)
  if type(s) ~= "string" then
    return ""
  end
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function ass_escape(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub("{", "\\{")
  s = s:gsub("}", "\\}")
  s = s:gsub("\n", "\\N")
  return s
end

local function normalize_path(p)
  if type(p) ~= "string" then
    return ""
  end
  local out = p:gsub("\\", "/")
  out = out:gsub("^file://", "")
  return out
end

local function basename(p)
  local n = normalize_path(p)
  return n:match("([^/]+)$") or n
end

local function load_metadata(path)
  metadata_by_path = {}
  metadata_by_base = {}

  local meta_path = trim(path)
  if meta_path == "" then
    msg.warn("metadata path is empty")
    return
  end

  local fh = io.open(meta_path, "r")
  if not fh then
    msg.warn("cannot open metadata file: " .. meta_path)
    return
  end
  local raw = fh:read("*a")
  fh:close()

  local parsed = utils.parse_json(raw)
  if type(parsed) ~= "table" or type(parsed.entries) ~= "table" then
    msg.warn("invalid metadata JSON: " .. meta_path)
    return
  end

  for _, row in ipairs(parsed.entries) do
    if type(row) == "table" then
      local p = normalize_path(row.path)
      if p ~= "" then
        local payload = {
          artist = trim(row.artist),
          title = trim(row.title),
        }
        metadata_by_path[p] = payload
        local base = basename(p)
        if base ~= "" and metadata_by_base[base] == nil then
          metadata_by_base[base] = payload
        end
      end
    end
  end
end

local function lookup_entry()
  local p = normalize_path(mp.get_property("path", ""))
  if p == "" then
    return nil
  end

  local direct = metadata_by_path[p]
  if direct ~= nil then
    return direct
  end

  local base = basename(p)
  if base ~= "" then
    return metadata_by_base[base]
  end

  return nil
end

local function render_overlay()
  local entry = lookup_entry()
  if entry == nil then
    mp.set_osd_ass(0, 0, "")
    return
  end

  local artist = trim(entry.artist)
  local title = trim(entry.title)

  if artist == "" and title == "" then
    mp.set_osd_ass(0, 0, "")
    return
  end

  local w, h = mp.get_osd_size()
  if not w or not h or w <= 0 or h <= 0 then
    mp.set_osd_ass(0, 0, "")
    return
  end

  local x = tonumber(opts.margin_x) or 36
  local y = h - (tonumber(opts.margin_y) or 30)
  local rotate_ccw = tonumber(opts.rotate_ccw) or 0
  -- ASS \frz uses CCW-positive degrees in this mpv overlay context.
  local frz = rotate_ccw
  local an = 1

  local norm = ((rotate_ccw % 360) + 360) % 360
  if norm == 90 then
    -- Keep rotated text visually rooted at the lower-left corner.
    an = 7
  elseif norm == 270 then
    -- Symmetric anchor for 270deg so text doesn't drift offscreen on portrait nodes.
    an = 3
  end

  local lines = {}
  if artist ~= "" then
    table.insert(lines, string.format("{\\fs%d\\b1}%s{\\b0}", tonumber(opts.artist_size) or 30, ass_escape(artist)))
  end
  if title ~= "" then
    table.insert(lines, string.format("{\\fs%d}%s", tonumber(opts.title_size) or 30, ass_escape(title)))
  end

  local text = string.format(
    "{\\an%d\\pos(%d,%d)\\frz%.2f\\bord2\\shad0\\1c&HFFFFFF&\\3c&H000000&}%s",
    an,
    x,
    y,
    frz,
    table.concat(lines, "\\N")
  )

  mp.set_osd_ass(w, h, text)
end

load_metadata(opts.metadata)

mp.register_event("file-loaded", render_overlay)
mp.observe_property("path", "string", function()
  render_overlay()
end)
mp.add_periodic_timer(1, render_overlay)
render_overlay()
