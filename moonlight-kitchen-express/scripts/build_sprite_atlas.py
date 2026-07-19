"""달빛 주방열차 GPT Image 원본을 런타임 스프라이트 아틀라스로 변환한다."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public" / "assets" / "gpt-image-sources"
OUTPUT_DIR = ROOT / "public" / "assets" / "sprites"

INGREDIENTS = (
    "moon_mushroom",
    "sunset_pepper",
    "silver_dough",
    "lantern_leaf",
    "comet_radish",
    "star_noodle",
)
PROCESSES = ("RAW", "PREPPED", "COOKED", "BURNT")
STATIONS = (
    "crate",
    "board",
    "dough",
    "plate_shelf",
    "cooling_pump",
    "brazier",
    "steamer",
    "pot",
    "noodle_supply",
    "plating",
    "service",
    "trash",
    "exhaust_valve",
)
DISHES = ("plate", "mushroom_skewer", "lantern_dumpling", "comet_noodle")
DIRECTIONS = ("down", "left", "up", "right")
PALETTE = tuple(
    tuple(bytes.fromhex(value))
    for value in (
        "090D1F", "111A36", "202348", "1B2A45", "50637A",
        "F5E9C9", "F4A64A", "FFD97A", "49C9BE", "B8ECE5",
        "D977A8", "64DC96", "FFD166", "FF6F6F", "79513F",
    )
)


def remove_green_background(image: Image.Image) -> Image.Image:
    """생성 원본의 녹색 크로마 배경과 녹색 가장자리 오염을 투명화한다."""
    rgba = image.convert("RGBA")
    pixels = list(rgba.get_flattened_data())
    converted: list[tuple[int, int, int, int]] = []
    for red, green, blue, _alpha in pixels:
        # 원본은 압축/안티앨리어싱 탓에 정확한 #00FF00이 아니므로 색 우세도도 함께 본다.
        dominance = green - max(red, blue)
        if green >= 170 and dominance >= 70:
            alpha = max(0, min(255, int((90 - dominance) * 12.75)))
            if alpha == 0:
                converted.append((0, 0, 0, 0))
                continue
            # 반투명 경계에 섞인 녹색을 줄여 축소 시 녹색 테두리가 생기지 않게 한다.
            corrected_green = min(green, max(red, blue) + 12)
            converted.append((red, corrected_green, blue, alpha))
        else:
            converted.append((red, green, blue, 255))
    rgba.putdata(converted)
    return rgba


def split_sheet(image: Image.Image, columns: int, rows: int) -> list[Image.Image]:
    """정수 나눗셈 오차를 마지막 셀까지 분산해 시트를 행 우선으로 분할한다."""
    cells: list[Image.Image] = []
    for row in range(rows):
        top = round(row * image.height / rows)
        bottom = round((row + 1) * image.height / rows)
        for column in range(columns):
            left = round(column * image.width / columns)
            right = round((column + 1) * image.width / columns)
            cells.append(image.crop((left, top, right, bottom)))
    return cells


def normalize_cell(cell: Image.Image, size: tuple[int, int], fill_ratio: float = 0.82) -> Image.Image:
    """불투명 영역을 trim한 뒤 안전 여백을 둔 표준 셀 중앙에 Lanczos로 배치한다."""
    alpha = cell.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        return Image.new("RGBA", size, (0, 0, 0, 0))
    trimmed = cell.crop(bounds)
    max_width = max(1, round(size[0] * fill_ratio))
    max_height = max(1, round(size[1] * fill_ratio))
    scale = min(max_width / trimmed.width, max_height / trimmed.height)
    resized_size = (max(1, round(trimmed.width * scale)), max(1, round(trimmed.height * scale)))
    resized = trimmed.resize(resized_size, Image.Resampling.LANCZOS)
    output = Image.new("RGBA", size, (0, 0, 0, 0))
    output.alpha_composite(resized, ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2))
    return output


def quantize_to_palette(image: Image.Image) -> Image.Image:
    """미세 회화 질감을 정리하고 불투명 RGB를 승인된 15색 중 최근접 색으로 치환한다."""
    rgba = image.convert("RGBA")
    # 작은 blur는 34px에서 사라질 grain만 합치며 alpha와 실루엣은 변경하지 않는다.
    softened = rgba.convert("RGB").filter(ImageFilter.GaussianBlur(radius=0.55))
    alpha_values = list(rgba.getchannel("A").get_flattened_data())
    output_pixels: list[tuple[int, int, int, int]] = []
    for (red, green, blue), alpha in zip(softened.get_flattened_data(), alpha_values):
        if alpha == 0:
            output_pixels.append((0, 0, 0, 0))
            continue
        nearest = min(PALETTE, key=lambda color: (red-color[0])**2+(green-color[1])**2+(blue-color[2])**2)
        output_pixels.append((*nearest, alpha))
    output = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    output.putdata(output_pixels)
    return output


def quality_metrics(cells: Iterable[Image.Image]) -> dict[str, object]:
    """manifest와 테스트가 공유할 팔레트 거리·안전 여백 정량 지표를 계산한다."""
    distances: list[float] = []
    margins: list[int] = []
    for cell in cells:
        bounds = cell.getchannel("A").getbbox()
        if bounds is None:
            continue
        margins.extend((bounds[0], bounds[1], cell.width-bounds[2], cell.height-bounds[3]))
        for red, green, blue, alpha in cell.get_flattened_data():
            if alpha < 128:
                continue
            distance = min(math.dist((red, green, blue), color) for color in PALETTE)
            distances.append(distance)
    return {
        "paletteAverageDistance": sum(distances)/len(distances) if distances else 0,
        "paletteWithin15Ratio": sum(distance <= 15 for distance in distances)/len(distances) if distances else 1,
        "minimumMarginPx": min(margins) if margins else 0,
    }


def compose_atlas(cells: Iterable[Image.Image], cell_size: tuple[int, int], columns: int) -> Image.Image:
    """표준 셀을 고정 열 수의 투명 아틀라스로 합성한다."""
    materialized = list(cells)
    rows = (len(materialized) + columns - 1) // columns
    atlas = Image.new("RGBA", (cell_size[0] * columns, cell_size[1] * rows), (0, 0, 0, 0))
    for index, cell in enumerate(materialized):
        atlas.alpha_composite(cell, ((index % columns) * cell_size[0], (index // columns) * cell_size[1]))
    return atlas


def add_frame(frames: dict[str, dict[str, object]], key: str, image: str, index: int,
              columns: int, cell_size: tuple[int, int], draw_size: tuple[int, int],
              anchor: tuple[float, float] = (0.5, 0.5)) -> None:
    """한 프레임의 source rect와 논리 그리기 크기를 manifest에 추가한다."""
    frames[key] = {
        "image": image,
        "x": (index % columns) * cell_size[0],
        "y": (index // columns) * cell_size[1],
        "w": cell_size[0],
        "h": cell_size[1],
        "anchorX": anchor[0],
        "anchorY": anchor[1],
        "drawW": draw_size[0],
        "drawH": draw_size[1],
    }


def save_webp(image: Image.Image, name: str) -> None:
    """브라우저 런타임용 무손실 WebP를 결정적인 옵션으로 저장한다."""
    image.save(OUTPUT_DIR / name, "WEBP", lossless=True, method=6, exact=True)


def build() -> dict[str, object]:
    """세 원본 시트를 처리하고 atlas manifest를 반환한다."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ingredient_source = remove_green_background(Image.open(SOURCE_DIR / "moonlight-ingredients-source.png"))
    station_source = remove_green_background(Image.open(SOURCE_DIR / "moonlight-stations-source.png"))
    crew_source = remove_green_background(Image.open(SOURCE_DIR / "moonlight-crew-source.png"))

    ingredient_cells = split_sheet(ingredient_source, 6, 4)
    station_cells = split_sheet(station_source, 4, 5)
    crew_cells = split_sheet(crew_source, 4, 2)
    # 생성 시트의 마지막 요리 장식이 바로 윗행 밸브 셀에 몇 픽셀 침범해 하단만 안전하게 제외한다.
    valve_cell = station_cells[12]
    station_cells[12] = valve_cell.crop((0, 0, valve_cell.width, round(valve_cell.height * 0.88)))

    # 재료 시트는 원본 행 우선이므로 atlas의 키 순서와 맞게 재배열한다.
    item_cells: list[Image.Image] = []
    item_keys: list[str] = []
    for row, process in enumerate(PROCESSES):
        for column, kind in enumerate(INGREDIENTS):
            item_cells.append(quantize_to_palette(normalize_cell(ingredient_cells[row * 6 + column], (128, 128), 0.80)))
            item_keys.append(f"item.{kind}.{process}")
    # 설비 시트의 14~17번 셀은 빈 접시와 완성 요리다.
    for offset, dish in enumerate(DISHES, start=13):
        item_cells.append(quantize_to_palette(normalize_cell(station_cells[offset], (128, 128), 0.80)))
        item_keys.append("item.plate.RAW" if dish == "plate" else f"dish.{dish}")

    normalized_stations = [quantize_to_palette(normalize_cell(station_cells[index], (192, 128), 0.80)) for index in range(13)]
    normalized_crew = [quantize_to_palette(normalize_cell(cell, (128, 160), 0.80)) for cell in crew_cells]
    save_webp(compose_atlas(item_cells, (128, 128), 7), "moonlight-items.webp")
    save_webp(compose_atlas(normalized_stations, (192, 128), 4), "moonlight-stations.webp")
    save_webp(compose_atlas(normalized_crew, (128, 160), 4), "moonlight-crew.webp")

    frames: dict[str, dict[str, object]] = {}
    for index, key in enumerate(item_keys):
        draw_size = (42, 42) if key.startswith("dish.") else (34, 34)
        add_frame(frames, key, "items", index, 7, (128, 128), draw_size, (0.5, 0.58))
    for index, station in enumerate(STATIONS):
        add_frame(frames, f"station.{station}", "stations", index, 4, (192, 128), (96, 64))
    for row, player_id in enumerate(("p1", "p2")):
        for column, direction in enumerate(DIRECTIONS):
            add_frame(frames, f"crew.{player_id}.{direction}", "crew", row * 4 + column,
                      4, (128, 160), (54, 62), (0.5, 0.82))

    manifest: dict[str, object] = {
        "version": 1,
        "images": {
            "items": "./moonlight-items.webp",
            "stations": "./moonlight-stations.webp",
            "crew": "./moonlight-crew.webp",
        },
        "frames": frames,
        "fallbacks": {"PREPPING": "RAW", "COOKING": "PREPPED"},
        "palette": ["#" + bytes(color).hex().upper() for color in PALETTE],
        "quality": {
            "items": quality_metrics(item_cells),
            "stations": quality_metrics(normalized_stations),
            "crew": quality_metrics(normalized_crew),
        },
    }
    (OUTPUT_DIR / "moonlight-atlas.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def verify(manifest: dict[str, object]) -> None:
    """필수 프레임 수, source rect, 투명 여백과 크로마 잔존을 검증한다."""
    expected = 24 + 4 + 13 + 8
    frames = manifest["frames"]
    if len(frames) != expected:
        raise RuntimeError(f"프레임 수 불일치: {len(frames)} != {expected}")
    images = {
        key: Image.open(OUTPUT_DIR / str(path).removeprefix("./")).convert("RGBA")
        for key, path in manifest["images"].items()
    }
    palette = [tuple(bytes.fromhex(value.removeprefix("#"))) for value in manifest["palette"]]
    palette_distances: list[float] = []
    minimum_margin = 10_000
    for key, frame in frames.items():
        image = images[str(frame["image"])]
        rectangle = (int(frame["x"]), int(frame["y"]), int(frame["w"]), int(frame["h"]))
        x, y, width, height = rectangle
        if x < 0 or y < 0 or x + width > image.width or y + height > image.height:
            raise RuntimeError(f"범위를 벗어난 프레임: {key}")
        cell = image.crop((x, y, x + width, y + height))
        bounds = cell.getchannel("A").getbbox()
        if bounds is None:
            raise RuntimeError(f"빈 프레임: {key}")
        margins = (bounds[0], bounds[1], width-bounds[2], height-bounds[3])
        minimum_margin = min(minimum_margin, *margins)
        required_margin = math.ceil(min(width, height) * 0.08)
        if min(margins) < required_margin:
            raise RuntimeError(f"8% 안전 여백 미달: {key} {margins} < {required_margin}")
        for red, green, blue, alpha in cell.get_flattened_data():
            if alpha > 24 and green >= 240 and red < 30 and blue < 30:
                raise RuntimeError(f"크로마 키 잔존: {key}")
            if alpha >= 128:
                palette_distances.append(min(math.dist((red, green, blue), color) for color in palette))
    average_distance = sum(palette_distances)/len(palette_distances)
    within_ratio = sum(distance <= 15 for distance in palette_distances)/len(palette_distances)
    if average_distance > 8 or within_ratio < 0.95:
        raise RuntimeError(f"팔레트 기준 미달: 평균 {average_distance:.2f}, 15 이내 {within_ratio:.2%}")
    print(f"quality: palette avg {average_distance:.2f}, within15 {within_ratio:.2%}, min margin {minimum_margin}px")


if __name__ == "__main__":
    built_manifest = build()
    verify(built_manifest)
    print(f"atlas build PASS: {len(built_manifest['frames'])} frames")
