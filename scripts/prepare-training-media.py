"""Generate posters and automatic English captions from the checked-in source videos.

Requires local ffmpeg and openai-whisper with the small.en model cached.
No provider calls. Captions are explicitly marked automatic pending editorial review.
"""
import json
import re
import subprocess
from pathlib import Path
import torch
import whisper
from whisper.utils import get_writer

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'public/assets/media'
OUTPUT.mkdir(parents=True, exist_ok=True)
names = list(dict.fromkeys(re.findall(r'raw\.githubusercontent\.com/[^\s\'"]+/([^/\'"]+\.mp4)', (ROOT / 'index.tsx').read_text())))
torch.set_num_threads(4)
model = None
manifest = {}
for name in names:
    source = ROOT / 'public/assets/training/videos' / name
    if not source.exists():
        raise FileNotFoundError(source)
    slug = source.stem
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(source)]))
    poster = OUTPUT / (slug + '.jpg')
    if not poster.exists():
        subprocess.run(['ffmpeg', '-v', 'error', '-ss', '2', '-i', str(source), '-frames:v', '1', '-vf', 'scale=960:-1', '-y', str(poster)], check=True)
    transcript = OUTPUT / (slug + '.json')
    if not transcript.exists():
        if model is None:
            model = whisper.load_model('small.en', device='cpu')
        print('Transcribing ' + name, flush=True)
        result = model.transcribe(str(source), language='en', fp16=False, verbose=False, beam_size=1, best_of=1)
        get_writer('vtt', str(OUTPUT))(result, str(source))
        cues = [{'start': round(s['start'], 2), 'end': round(s['end'], 2), 'text': s['text'].strip()} for s in result['segments']]
        transcript.write_text(json.dumps({'automatic': True, 'cues': cues}, ensure_ascii=False))
    manifest[name] = {'poster': '/assets/media/' + slug + '.jpg', 'captions': '/assets/media/' + slug + '.vtt', 'transcript': '/assets/media/' + slug + '.json', 'duration': duration, 'automatic': True}
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print('Prepared ' + name, flush=True)
