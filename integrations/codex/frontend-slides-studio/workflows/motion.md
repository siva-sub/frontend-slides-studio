<workflow name="motion-and-transitions">
<required_reading>
- Read `references/commands.md` and the motion/transition sections of `references/studio-controls.md`.
</required_reading>

<process>
1. Run `pnpm cli -- motion analyze <reference-video> --output motion-analysis.json`. ffmpeg and ffprobe are optional dependencies used only for analysis.
2. Treat energy, holds, beats, loop/easing hints, and keyframe timestamps as measured WHEN evidence.
3. Inspect curated frames to decide WHAT moved. Record uncertainty instead of inventing transform magnitudes.
4. Write MotionIntent mappings from observations to stable `data-object-id` values. Compile with `pnpm cli -- motion apply` and validate the resulting MotionProgram.
5. In Studio, select the intended object, choose a motion preset, duration, delay, and replay policy, then **Apply motion**. Configure page transitions separately on the current slide.
6. Save and reload. Test navigation, rapid navigation cleanup, replay always/once/never, reduced motion, and hidden-slide suspension.
7. Run settled export so entrances finish and loops freeze at their declared poster progress rather than capturing mid-cycle.
</process>

<success_criteria>
- Measured timing remains separate from semantic object mapping.
- Motion targets stable IDs and persists after Studio reload.
- Revisit, reduced-motion, and settled-export behavior are deterministic.
</success_criteria>
</workflow>
