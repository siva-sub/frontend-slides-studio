<workflow>
1. Run `slides-studio motion analyze` on the reference video. ffmpeg/ffprobe are optional dependencies used only here.
2. Treat energy, holds, beats, loop/easing hints, and keyframe timestamps as measured WHEN evidence.
3. Inspect curated frames to decide WHAT moved. Record uncertainty instead of inventing transform magnitudes.
4. Write MotionIntent mappings from observations to stable `data-object-id` values.
5. Compile and validate MotionProgram tracks. Use WAAPI/CSS/SVG adapters, deterministic replay, hidden-slide suspension, and meaningful reduced-motion final states.
6. Test slide revisit and settled export so entrances do not double-play and loops do not capture mid-cycle.
</workflow>
