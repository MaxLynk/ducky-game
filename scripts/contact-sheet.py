"""Make the review sheet from the browser capture's unmodified stills."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('capture_dir', type=Path)
args = parser.parse_args()
rows = [
    ('t3.0.jpg', '01  Belly slide and momentum'),
    ('t6.0.jpg', '02  Target hit and splat'),
    ('t8.5.jpg', '03  Ice hit and splat'),
    ('t24.9.jpg', '04  Ship hull hit'),
    ('t27.5.jpg', '05  Airlock opens'),
    ('t29.0.jpg', '06  Walk through the doorway'),
    ('t36.0.jpg', '07  Main deck forward'),
    ('t43.0.jpg', '08  Cockpit controls'),
    ('t46.0.jpg', '09  Console responds'),
    ('t49.0.jpg', '10  Inspect the cockpit blockout'),
    ('t54.0.jpg', '11  Inspect the Blender cockpit'),
    ('t60.0.jpg', '12  Inspect the solid-ring ship'),
]
console_still = args.capture_dir / 'stills/t46.0.jpg'
if not console_still.exists():
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', '46', '-i',
                    str(args.capture_dir / 'ducky-game-60s-1080p.mp4'), '-frames:v', '1',
                    '-q:v', '2', str(console_still)], check=True)
# The capture uses frame timestamps, rounded to one decimal in its filenames.
files = sorted((args.capture_dir / 'stills').glob('t*.jpg'))
font = ImageFont.load_default(size=18)
sheet = Image.new('RGB', (1920, 1684), '#0b1726')
draw = ImageDraw.Draw(sheet)
draw.text((24, 18), 'DUCKY | M1 powers and M2 ship exploration | 1920 x 1080 browser capture', fill='#ead1a6', font=ImageFont.load_default(size=25))
for i, (name, caption) in enumerate(rows):
    at = float(name[1:-4])
    source = min(files, key=lambda p: abs(float(p.stem[1:]) - at))
    image = Image.open(source).convert('RGB')
    assert image.size == (1920, 1080), (source, image.size)
    image = image.resize((624, 351), Image.Resampling.LANCZOS)
    x, y = 8 + (i % 3) * 640, 66 + (i // 3) * 400
    sheet.paste(image, (x, y))
    draw.text((x + 8, y + 363), caption, fill='#e7e8e5', font=font)
path = args.capture_dir / 'contact-sheet.jpg'
sheet.save(path, quality=92)
print(path)
