import { escapeText } from './learning-workspace';
type Cue = {start:number; end:number; text:string};
type Media = {poster:string; captions:string; transcript:string; duration:number; automatic:boolean};
let manifestPromise: Promise<Record<string,Media>> | undefined;
const stamp = (seconds:number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;

export async function enhanceTrainingMedia(root: HTMLElement) {
  manifestPromise ||= fetch('/assets/media/manifest.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const manifest = await manifestPromise;
  if (!root.isConnected) return;
  for (const video of root.querySelectorAll<HTMLVideoElement>('video:not([autoplay])')) {
    if (video.dataset.mediaEnhanced) continue;
    video.dataset.mediaEnhanced = 'true'; video.playsInline = true; video.preload = 'metadata';
    const source = video.querySelector('source')?.src || video.src;
    const name = source.split('/').pop() || '';
    const media = manifest[name];
    const panel = document.createElement('div'); panel.className = 'media-companion'; panel.id = `media-${name.replace(/\.mp4$/,'')}`;
    panel.innerHTML = '<p class="media-status" role="status"></p><button type="button" class="media-retry" hidden>Retry video</button>';
    video.after(panel);
    const status = panel.querySelector<HTMLElement>('.media-status')!;
    const retry = panel.querySelector<HTMLButtonElement>('.media-retry')!;
    const fail = () => { status.textContent = 'Video could not load. Check your connection and retry. Your saved training record is unchanged.'; retry.hidden = false; };
    video.addEventListener('error',fail);
    video.querySelector('source')?.addEventListener('error',fail);
    video.addEventListener('waiting', () => {status.textContent = 'Video is buffering…';});
    video.addEventListener('playing', () => {status.textContent = ''; retry.hidden = true;});
    retry.onclick = () => { status.textContent = 'Retrying video…'; video.load(); };
    if (!media) continue;
    video.poster = media.poster;
    const track = document.createElement('track'); track.kind = 'captions'; track.srclang = 'en'; track.label = 'English (automatic)'; track.src = media.captions; video.append(track);
    const details = document.createElement('details'); details.className = 'media-transcript';
    details.innerHTML = `<summary>Read or search the video transcript</summary><p>Automatically transcribed from this video. Wording may contain errors; editorial review is pending.</p><label>Find in this video<input type="search" placeholder="Search spoken words"></label><p class="transcript-status" role="status">Loading transcript…</p><div class="transcript-cues"></div>`;
    panel.append(details);
    let loaded = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded) return;
      const message = details.querySelector<HTMLElement>('.transcript-status')!;
      try {
        const response = await fetch(media.transcript); if (!response.ok) throw Error();
        const {cues}: {cues:Cue[]} = await response.json(); loaded = true;
        const list = details.querySelector<HTMLElement>('.transcript-cues')!;
        const input = details.querySelector<HTMLInputElement>('input')!;
        // Source-derived transcript navigation never bypasses video watch requirements.
        const chapterNav = document.createElement('nav'); chapterNav.setAttribute('aria-label','Transcript sections');
        chapterNav.className = 'transcript-chapters';
        const starts = cues.filter((cue,i) => i === 0 || cue.start >= Math.floor(cues[i-1].start / 60 + 1) * 60);
        starts.forEach(cue => {
          const button = document.createElement('button'); button.type='button';
          button.textContent = `${stamp(cue.start)} · ${cue.text.split(/\s+/).slice(0,7).join(' ')}…`;
          button.onclick = () => { input.value=''; render(); const target=list.querySelector<HTMLElement>(`[data-cue="${cue.start}"]`); if(target){target.tabIndex=-1;target.scrollIntoView({block:'nearest'});target.focus({preventScroll:true});} };
          chapterNav.append(button);
        });
        input.parentElement?.before(chapterNav);
        const render = () => {
          const matches = cues.filter(c => c.text.toLowerCase().includes(input.value.trim().toLowerCase()));
          message.textContent = matches.length ? 'Timestamps refer to the original video. Use the player controls to review available sections.' : 'No matching spoken words.';
          list.innerHTML = matches.map(c => `<p data-cue="${c.start}"><span class="cue-time">${stamp(c.start)}</span>${escapeText(c.text)}</p>`).join('');
        };
        input.oninput = render; render();
      } catch { message.textContent = 'Transcript could not load. Close and reopen to retry.'; }
    });
  }
}
