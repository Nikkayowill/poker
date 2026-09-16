-- Build one character's layered, tagged .aseprite file and spritesheet from rig.py's JSON.
-- Usage: aseprite --batch --script-param json=<build/name.json> --script-param out=<dir/name> --script build_aseprite.lua
local fh = assert(io.open(app.params.json, "r"))
local data = json.decode(fh:read("a"))
fh:close()
local out = app.params.out

local function rgb(hex)
  return tonumber(hex:sub(2, 3), 16), tonumber(hex:sub(4, 5), 16), tonumber(hex:sub(6, 7), 16)
end

local spr = Sprite(data.width, data.height, ColorMode.RGB)
app.activeSprite = spr

local pal = Palette(#data.palette)
for i, hex in ipairs(data.palette) do
  local r, g, b = rgb(hex)
  pal:setColor(i - 1, Color{ r = r, g = g, b = b })
end
spr:setPalette(pal)

local layers = {}
spr.layers[1].name = data.layers[1]
layers[data.layers[1]] = spr.layers[1]
for i = 2, #data.layers do
  local layer = spr:newLayer()
  layer.name = data.layers[i]
  layers[data.layers[i]] = layer
end

for i = 2, #data.frames do
  spr:newEmptyFrame(i)
end

for i, frame in ipairs(data.frames) do
  spr.frames[i].duration = frame.duration / 1000
  for name, pixels in pairs(frame.cels) do
    local minx, miny, maxx, maxy = data.width, data.height, -1, -1
    for _, p in ipairs(pixels) do
      minx, miny = math.min(minx, p[1]), math.min(miny, p[2])
      maxx, maxy = math.max(maxx, p[1]), math.max(maxy, p[2])
    end
    local img = Image(maxx - minx + 1, maxy - miny + 1, ColorMode.RGB)
    for _, p in ipairs(pixels) do
      local r, g, b = rgb(p[3])
      img:drawPixel(p[1] - minx, p[2] - miny, app.pixelColor.rgba(r, g, b, 255))
    end
    spr:newCel(layers[name], i, img, Point(minx, miny))
  end
end

for _, t in ipairs(data.tags) do
  local tag = spr:newTag(t.from, t.to)
  tag.name = t.name
  tag.aniDir = AniDir.FORWARD
end

-- Real links (pixel-mcp's link_cel only copies): identical cels within one animation
-- share an image, so editing one pose updates every frame that reuses it.
local linked = 0
for _, t in ipairs(data.tags) do
  for _, name in ipairs(data.layers) do
    local layer = layers[name]
    local done = {}
    for a = t.from, t.to do
      local ca = layer:cel(a)
      if ca and not done[a] then
        local group = { spr.frames[a] }
        for b = a + 1, t.to do
          local cb = layer:cel(b)
          if cb and not done[b] and cb.position.x == ca.position.x and cb.position.y == ca.position.y
              and cb.image:isEqual(ca.image) then
            table.insert(group, spr.frames[b])
            done[b] = true
          end
        end
        if #group > 1 then
          app.range:clear()
          app.range.layers = { layer }
          app.range.frames = group
          app.command.LinkCels()
          linked = linked + #group - 1
        end
      end
    end
  end
end

spr:saveAs(out .. ".aseprite")

app.command.ExportSpriteSheet{
  ui = false, askOverwrite = false,
  type = SpriteSheetType.ROWS,
  textureFilename = out .. "-sheet.png",
  dataFilename = out .. "-sheet.json",
  dataFormat = SpriteSheetDataFormat.JSON_ARRAY,
  splitTags = true, listTags = true, listLayers = false, listSlices = false,
  ignoreEmpty = false, mergeDuplicates = false, trim = false,
  borderPadding = 0, shapePadding = 0, innerPadding = 0,
  openGenerated = false,
}

-- Read the saved file back rather than trusting the in-memory sprite.
local saved = app.open(out .. ".aseprite")
local names, cels, images = {}, 0, {}
for _, layer in ipairs(saved.layers) do table.insert(names, layer.name) end
local unique = 0
for _, cel in ipairs(saved.cels) do
  cels = cels + 1
  if not images[cel.image.id] then
    images[cel.image.id] = true
    unique = unique + 1
  end
end
print(string.format("%s: %d frames, %d tags, %d cels (%d linked in build, %d shared on reopen)",
  data.name, #saved.frames, #saved.tags, cels, linked, cels - unique))
print("  layers bottom->top: " .. table.concat(names, ", "))
