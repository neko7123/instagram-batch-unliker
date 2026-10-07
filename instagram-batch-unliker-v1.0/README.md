# Instagram Batch Unliker 12.1.0

Chrome/Edge MV3 extension for batch-managing liked Instagram posts.

## 12.1.0 resume fix

- Pause during post selection now preserves the active selection coroutine.
- Resume continues from the exact point where selection paused instead of restarting the Select phase.
- Changing batch size, speed, target, delay, or loop mode while paused applies the new settings without restarting the current batch.
- Pressing Start while already running applies updated settings without creating a second runner.
- Stop remains a full reset and clears the processed counter.

The extension processes the Instagram Likes page locally and does not send Instagram page content to a developer-operated server.
