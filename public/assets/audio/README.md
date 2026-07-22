# PowerBox presentation loop

Place the final 5–10 second loop in this directory, for example:

`powerbox-loop.mp3`

Then set `audio.url` in `public/config/presentation-shots.json` to:

`assets/audio/powerbox-loop.mp3`

The viewer attempts autoplay and retries once after the first user gesture when
the browser blocks sound autoplay.
