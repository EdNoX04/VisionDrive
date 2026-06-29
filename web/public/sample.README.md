# Sample video slot

The web app's **Load sample video** button plays `sample.mp4` from this folder.

The file isn't committed by default (to keep the repo light). Add it with:

```bash
bash tools/fetch_sample_video.sh
```

This downloads a small openly-licensed traffic clip to `web/public/sample.mp4`.
Commit it so it also ships with the Vercel deploy:

```bash
git add web/public/sample.mp4 && git commit -m "Add sample video"
```

You can also drop in any `.mp4` of your own named `sample.mp4`.
