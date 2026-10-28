"""Build compact, annotated answer sheets from the published stage catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


CANVAS_SIZE = (1600, 720)
IMAGE_SIZE = (756, 504)
IMAGE_TOP = 104
IMAGE_LEFTS = (32, 812)
RED = "#ff4655"

COLLECTION_NAMES = {
    "moonlight-mystery": "달빛 미스터리",
    "world-adventure": "세계 모험",
    "seasonal-stories": "계절 이야기",
    "style-lab": "스타일 랩",
    "japanese-comics": "일본 만화",
    "wonder-park": "원더 파크",
    "goblin-night-village": "도깨비 밤마을",
    "tiny-things-city": "작은 것들의 도시",
    "cat-detective-agency": "고양이 탐정 사무소",
    "animal-detectives": "동물 탐정단",
    "magic-delivery-office": "마법 배달국",
    "toy-kingdom": "장난감 왕국",
    "dragon-academy": "드래곤 아카데미",
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "malgunbd.ttf" if bold else "malgun.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)


def annotate(draw: ImageDraw.ImageDraw, zone: dict, left: int, number: int) -> None:
    x1 = left + round(zone["x"] * IMAGE_SIZE[0])
    y1 = IMAGE_TOP + round(zone["y"] * IMAGE_SIZE[1])
    x2 = x1 + round(zone["w"] * IMAGE_SIZE[0])
    y2 = y1 + round(zone["h"] * IMAGE_SIZE[1])
    pad = 6
    box = (x1 - pad, y1 - pad, x2 + pad, y2 + pad)
    draw.ellipse(box, outline="#ffffff", width=10)
    draw.ellipse(box, outline=RED, width=6)

    badge_radius = 17
    badge_x = max(left + badge_radius, x1 - 2)
    badge_y = max(IMAGE_TOP + badge_radius, y1 - 2)
    draw.ellipse(
        (badge_x - badge_radius, badge_y - badge_radius, badge_x + badge_radius, badge_y + badge_radius),
        fill=RED,
        outline="#ffffff",
        width=2,
    )
    number_text = str(number)
    bbox = draw.textbbox((0, 0), number_text, font=font(20, True))
    draw.text(
        (badge_x - (bbox[2] - bbox[0]) / 2, badge_y - (bbox[3] - bbox[1]) / 2 - 2),
        number_text,
        fill="#ffffff",
        font=font(20, True),
    )


def render_stage(stage: dict, number: int, output_dir: Path) -> dict:
    canvas = Image.new("RGB", CANVAS_SIZE, "#0b1122")
    draw = ImageDraw.Draw(canvas)

    collection_id = stage["collectionId"]
    collection_name = COLLECTION_NAMES.get(collection_id, collection_id)
    draw.text((32, 24), f"{number:02d} · {stage['title']}", fill="#fff4d6", font=font(36, True))
    meta = f"{collection_name}  ·  {stage['difficulty']}  ·  정답 {len(stage['differences'])}개"
    meta_bbox = draw.textbbox((0, 0), meta, font=font(22))
    draw.text((1568 - (meta_bbox[2] - meta_bbox[0]), 36), meta, fill="#a9bdd8", font=font(22))

    for side_index, (image_key, side_key, side_label) in enumerate(
        (("imageA", "a", "A"), ("imageB", "b", "B"))
    ):
        left = IMAGE_LEFTS[side_index]
        with Image.open(stage[image_key]) as source:
            fitted = source.convert("RGB").resize(IMAGE_SIZE, Image.Resampling.LANCZOS)
        canvas.paste(fitted, (left, IMAGE_TOP))
        draw.rounded_rectangle(
            (left - 2, IMAGE_TOP - 2, left + IMAGE_SIZE[0] + 2, IMAGE_TOP + IMAGE_SIZE[1] + 2),
            radius=8,
            outline="#e7edf7",
            width=4,
        )
        draw.rounded_rectangle((left + 12, IMAGE_TOP + 12, left + 58, IMAGE_TOP + 54), radius=10, fill="#0b1122cc")
        draw.text((left + 26, IMAGE_TOP + 14), side_label, fill="#ffffff", font=font(24, True))
        for difference_index, difference in enumerate(stage["differences"], start=1):
            annotate(draw, difference["zones"][side_key], left, difference_index)

    pill_top = 628
    pill_gap = 8
    pill_width = (CANVAS_SIZE[0] - 64 - pill_gap * 4) // 5
    for difference_index, difference in enumerate(stage["differences"], start=1):
        x = 32 + (difference_index - 1) * (pill_width + pill_gap)
        draw.rounded_rectangle((x, pill_top, x + pill_width, 690), radius=14, fill="#17243b", outline="#31445f", width=2)
        draw.ellipse((x + 12, pill_top + 14, x + 46, pill_top + 48), fill=RED)
        draw.text((x + 23, pill_top + 16), str(difference_index), fill="#ffffff", font=font(18, True), anchor="ma")
        label = difference["label"]
        if len(label) > 13:
            label = f"{label[:12]}…"
        draw.text((x + 56, pill_top + 17), label, fill="#edf4ff", font=font(19, True))

    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{number:02d}-{stage['id']}.webp"
    canvas.save(output_dir / filename, "WEBP", quality=84, method=6)
    return {
        "number": number,
        "id": stage["id"],
        "title": stage["title"],
        "description": stage.get("description", ""),
        "collectionId": collection_id,
        "collectionName": collection_name,
        "difficulty": stage["difficulty"],
        "stageType": stage["stageType"],
        "differenceCount": len(stage["differences"]),
        "labels": [difference["label"] for difference in stage["differences"]],
        "image": f"assets/spot-difference-answers/{filename}",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=Path("content/published/stages.json"))
    parser.add_argument("--output", type=Path, default=Path("assets/answers"))
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    stages = json.loads(args.catalog.read_text(encoding="utf-8"))
    published = [stage for stage in stages if stage.get("status") == "published"]
    entries = [render_stage(stage, index, args.output) for index, stage in enumerate(published, start=1)]
    manifest_path = args.manifest or args.output / "answer-sheets.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"stageCount": len(entries), "differenceCount": sum(item["differenceCount"] for item in entries), "stages": entries}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"answer sheets: {len(entries)} -> {args.output}")


if __name__ == "__main__":
    main()
