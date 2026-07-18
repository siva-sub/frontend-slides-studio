# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
# ============================================================================
# PROMINENT MODIFICATION NOTICE (Apache-2.0 §4(b))
# ----------------------------------------------------------------------------
# This module is ported and modified from the upstream Apache-2.0 project
# gpt-image2-ppt-skills (commit ce4714225d938b02806af3660a46e62be8900e29).
# Original upstream docstrings were in Chinese; they have been rewritten in
# English for this project. The letterbox-safe prepare/restore pair, the
# mask-inversion helper, and the pixel-locked outside-change audit are kept
# behaviour-compatible with upstream while fitting the contained job-root
# boundary used by Frontend Slides Studio.
# ============================================================================
"""
Pixel-locked image repairs: white internal mask pixels may change; black must not.

Adds letterbox-safe edit preparation and exact restoration so a slide can be
fitted onto a provider-supported canvas without distortion and then cropped
back to its original size and aspect after the masked edit returns.
"""

from __future__ import annotations

from PIL import Image, ImageChops


def _check(original: Image.Image, edited: Image.Image, mask: Image.Image) -> None:
    if original.size != edited.size or original.size != mask.size:
        raise ValueError("image and mask sizes must match")


def composite_masked_edit(original: Image.Image, edited: Image.Image, internal_mask: Image.Image) -> Image.Image:
    _check(original, edited, internal_mask)
    return Image.composite(edited.convert("RGBA"), original.convert("RGBA"), internal_mask.convert("L"))


def make_api_edit_mask(internal_mask: Image.Image) -> Image.Image:
    alpha = ImageChops.invert(internal_mask.convert("L"))
    result = Image.new("RGBA", internal_mask.size, (255, 255, 255, 255))
    result.putalpha(alpha)
    return result


def changed_outside_mask(original: Image.Image, result: Image.Image, internal_mask: Image.Image) -> int:
    _check(original, result, internal_mask)
    difference = ImageChops.difference(original.convert("RGBA"), result.convert("RGBA"))
    changed = difference.convert("L").point(lambda value: 255 if value else 0)
    preserve = internal_mask.convert("L").point(lambda value: 255 if value == 0 else 0)
    outside = ImageChops.multiply(changed, preserve)
    return sum(1 for value in outside.getdata() if value)


def prepare_letterboxed_edit(
    image: Image.Image,
    internal_mask: Image.Image,
    target_size: tuple[int, int],
) -> tuple[Image.Image, Image.Image, tuple[int, int, int, int]]:
    """
    Fit a slide and its mask into a supported API canvas without distortion.

    The source aspect is preserved by scaling with the smaller of the two axis
    scales and centring the content; the surrounding canvas is filled with a
    neutral letterbox. The image is resampled with a high-quality LANCZOS filter
    while the mask uses NEAREST so that 0=preserve / 255=replace labels are never
    blended into ambiguous grey values.

    Returns the letterboxed image canvas, the matching letterboxed mask canvas,
    and the integer content box ``(left, top, width, height)`` describing the
    pasted region. Both canvases share ``target_size``.
    """
    if image.size != internal_mask.size:
        raise ValueError("image and internal mask sizes must match")
    target_width, target_height = target_size
    if target_width <= 0 or target_height <= 0:
        raise ValueError("target_size must be positive")

    scale = min(target_width / image.width, target_height / image.height)
    content_width = max(1, round(image.width * scale))
    content_height = max(1, round(image.height * scale))
    left = (target_width - content_width) // 2
    top = (target_height - content_height) // 2

    canvas = Image.new("RGB", target_size, (0, 0, 0))
    resized_image = image.convert("RGB").resize(
        (content_width, content_height), Image.Resampling.LANCZOS
    )
    canvas.paste(resized_image, (left, top))

    canvas_mask = Image.new("L", target_size, 0)
    resized_mask = internal_mask.convert("L").resize(
        (content_width, content_height), Image.Resampling.NEAREST
    )
    canvas_mask.paste(resized_mask, (left, top))
    return canvas, canvas_mask, (left, top, content_width, content_height)


def restore_letterboxed_edit(
    edited_canvas: Image.Image,
    content_box: tuple[int, int, int, int],
    original_size: tuple[int, int],
) -> Image.Image:
    """
    Crop the slide region out of an API canvas and restore its original size.

    Uses the exact ``content_box`` returned by :func:`prepare_letterboxed_edit`
    so the editable region is extracted from the same pixels that were pasted.
    The crop is resampled with LANCZOS back to ``original_size``. Because the
    round-trip scales content to the box and back, an unedited canvas restores
    to a size equal to ``original_size``; exact original pixel identity is only
    guaranteed when the source already matched ``original_size`` 1:1.
    """
    left, top, width, height = content_box
    if left < 0 or top < 0 or width <= 0 or height <= 0:
        raise ValueError(f"invalid content_box: {content_box}")
    if left + width > edited_canvas.width or top + height > edited_canvas.height:
        raise ValueError(f"content_box exceeds edited canvas: {content_box}")
    crop = edited_canvas.crop((left, top, left + width, top + height))
    return crop.resize(original_size, Image.Resampling.LANCZOS)
