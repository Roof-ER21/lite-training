import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

test('every referenced training video has usable caption, transcript, and poster assets', () => {
  const source=fs.readFileSync('index.tsx','utf8');
  const names=[...new Set([...source.matchAll(/raw\.githubusercontent\.com\/[^\s'"]+\/([^/'"]+\.mp4)/g)].map(m=>m[1]))];
  const manifest=JSON.parse(fs.readFileSync('public/assets/media/manifest.json','utf8'));
  expect(names.length).toBeGreaterThan(0);
  for(const name of names){
    const media=manifest[name];expect(media,name).toBeDefined();
    for(const asset of [media.poster,media.captions,media.transcript])expect(fs.statSync(path.join('public',asset)).size,asset).toBeGreaterThan(20);
    expect(fs.readFileSync(path.join('public',media.captions),'utf8')).toMatch(/^WEBVTT/);
    const transcript=JSON.parse(fs.readFileSync(path.join('public',media.transcript),'utf8'));
    expect(transcript.automatic).toBe(true);
    expect(transcript.cues.length).toBeGreaterThan(0);
    let last=0;
    for(const cue of transcript.cues){
      expect(cue.start).toBeGreaterThanOrEqual(last);expect(cue.end).toBeGreaterThan(cue.start);
      expect(cue.end).toBeLessThanOrEqual(media.duration+1);expect(cue.text.trim()).not.toBe('');last=cue.start;
    }
  }
});
