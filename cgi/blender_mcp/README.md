# Jarvis Blender MCP: Claude'un Blender'ı yönetmesi

Claude (Desktop ya da Claude Code) sahneyi kurar, ışıklandırır, kamerayı hareket ettirir,
render alır, sonucu **görür** ve düzeltir. Gerçek mekânları Gaussian Splat olarak,
nesneleri Poly Haven'ın ücretsiz taranmış modelleriyle getirir. Elle poligon çizmen gerekmez.

```
Claude ──MCP (stdio)──▶ sunucu/jarvis_blender_mcp.py ──TCP 127.0.0.1:9876──▶ Blender eklentisi
                                                                              (komutları bpy ile çalıştırır)
```

Bağlantı yalnızca bu bilgisayarda (`127.0.0.1`) açılır, ağa açılmaz.

## Kurulum (Windows, bir kez)

**1. Blender + uv**

```powershell
winget install BlenderFoundation.Blender
winget install astral-sh.uv          # Python ve MCP paketini kendisi getirir
```

**2. Eklentiyi paketle ve kur**

```powershell
cd C:\...\Jarvis-thing
uv run python cgi\blender_mcp\paketle.py     # → cgi\blender_mcp\dist\jarvis_blender.zip
```

Blender → *Edit → Preferences → Add-ons* → sağ üstteki **⌄** → **Install from Disk…** →
`jarvis_blender.zip` → kutucuğu işaretle. 3B görünümde **N** → **Jarvis** sekmesi →
**Sunucuyu başlat**. (Tercihlerde "Blender açılınca sunucuyu başlat" varsayılan olarak açık.)

**3. Claude'a bağla**

*Claude Desktop:* `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "blender": {
      "command": "uv",
      "args": ["run", "--with", "mcp", "python",
               "C:\\...\\Jarvis-thing\\cgi\\blender_mcp\\sunucu\\jarvis_blender_mcp.py"]
    }
  }
}
```

Claude Desktop'ı kapatıp aç. Araç listesinde `blender` görünmeli.

*Claude Code:*

```powershell
claude mcp add blender -- uv run --with mcp python C:\...\Jarvis-thing\cgi\blender_mcp\sunucu\jarvis_blender_mcp.py
```

**4. Dene**

> Sahneyi temizle. Stüdyo HDRI'ı ile mermer bir kaide üstünde altın bir küre kur,
> 85 mm f/2 ile ürün çekimi yap ve bana göster.

## Araçlar

| Grup | Araçlar |
|---|---|
| Sahne | `get_scene_info`, `get_object_info`, `clear_scene`, `save_file`, `open_file` |
| Nesne | `create_object` (pahlı kenar destekli), `transform_object`, `duplicate_object`, `delete_objects`, `keyframe_object`, `import_model` (glb/fbx/obj/usd/stl/abc/blend/ply) |
| Malzeme | `set_material` (18 hazır fiziksel malzeme: altın, krom, cam, araba boyası, cilt, mermer…) |
| Işık | `lighting_preset` (three_point, golden_hour, studio, noir, neon, moonlight, overcast), `add_light` (Kelvin renk sıcaklığı), `set_world` (HDRI / fiziksel gökyüzü), `world_color`, `add_atmosphere` (hacimsel sis, ışık hüzmesi) |
| Kamera | `set_render_format` (2.39:1 sinema, 4K, dikey…), `setup_camera` (mm lens, f-stop, odak), `camera_move` (orbit, push_in, pull_out, truck, crane, flyover, reveal + el kamerası titremesi), `set_color_look` (AgX sinema, hareket bulanıklığı) |
| Render | `apply_render_profile` (G870 profilleri), `render_image` (görüntüyü Claude'a döndürür), `viewport_screenshot`, `render_animation` (ayrı süreçte), `job_status` |
| Gaussian Splat | `import_gaussian_splat` (.ply/.splat), `tune_splat` |
| Poly Haven | `polyhaven_search`, `polyhaven_categories`, `polyhaven_download` (HDRI → dünya, model → sahne, doku → PBR malzeme) |
| Serbest | `execute_python` (hazır araç yetmezse bpy kodu) |

Hazır istem: **`sinematik_cekim`** (konu, süre, stil). Claude Desktop'ta "+" menüsünden
seçilir, çekimi baştan sona adım adım kurdurur.

## Neden bu yöntemle hızlı ve gerçekçi?

| Klasik yol | Bu kurulum |
|---|---|
| Mekânı poligonla modelle, doku boya | Telefonla çek → Gaussian Splat ([cgi/splat](../splat/README.md)) |
| Nesneleri sıfırdan modelle | Poly Haven taranmış modeller + PBR dokular (CC0, ticari serbest) |
| Işığı deneme yanılmayla kur | Gerçek HDRI + sinema ışık düzenleri |
| Kamera animasyonunu elle anahtar karele | Tek komutla sinematik hareket |
| Render al, bak, ayarla, tekrar | Claude düşük çözünürlükte render alır, görüntüye bakar, kendisi düzeltir |
| Her şeyi Cycles'ta render et | EEVEE (`hizli`) animasyon, Cycles + OptiX (`final`) still |

## Arayüzsüz (render makinesi) modu

```powershell
blender -b --python-expr "import jarvis_blender as j; j.calistir_bloklayan()"
```

Arayüz VRAM'i boşa harcamaz. Claude aynı araçlarla bağlanır; `viewport_screenshot`
hariç her şey çalışır.

## Güvenlik

`execute_python` Blender içinde her türlü Python kodunu çalıştırabilir (dosya silme dahil).
Sunucu yalnızca `127.0.0.1`'i dinler, dışarıdan erişilemez. Yine de Claude'un bu araçla
yaptığı çağrıları onay penceresinde gözden geçirmen iyi olur.

## Test

```bash
pip install bpy mcp numpy               # bpy 5.2 → Python 3.13
python cgi/blender_mcp/test/test_uctan_uca.py
```

Gerçek MCP istemcisiyle tüm araçları arayüzsüz Blender'a karşı çalıştırır, sentetik bir
splat'ı render edip kadrajda doğru renkte göründüğünü doğrular. Ağ varsa Poly Haven
indirmelerini de dener.
