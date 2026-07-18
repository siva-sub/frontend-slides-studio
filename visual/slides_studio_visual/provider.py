# Licensed under the Apache License, Version 2.0.
# Adapted and modified from gpt-image2-ppt-skills commit ce4714225d938b02806af3660a46e62be8900e29.
"""Optional image-provider boundary. No credentials or network are touched at import time."""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Literal, Protocol, cast


class ImageProvider(Protocol):
    def generate(self, prompt: str, output: str | Path, references: tuple[Path, ...] = ()) -> Path: ...
    def edit(self, prompt: str, image: Path, mask: Path, output: str | Path) -> Path: ...
    def capabilities(self) -> dict[str, bool]: ...
    def describe(self) -> dict[str, object]: ...


# Capability keys reported by every provider boundary. Values are booleans so
# manifests can record exactly which operations an adapter supports without ever
# leaking credentials, base URLs, or account identifiers.
CAPABILITY_ORDINARY_GENERATION = "ordinary-generation"
CAPABILITY_MASKED_EDIT = "masked-edit"
CAPABILITY_ORDERED_REFERENCES = "ordered-references"

# Quality strings accepted by the OpenAI images boundary, matching the SDK's
# Literal type. Validated at construction so the value passed to the SDK is
# always one of these literals.
ALLOWED_QUALITIES = ("standard", "hd", "low", "medium", "high", "auto")
QualityValue = Literal["standard", "hd", "low", "medium", "high", "auto"]


def safe_capability_report(provider: ImageProvider) -> dict[str, object]:
    """
    Return a credential-free provider boundary description.

    The report intentionally contains only the provider name, model, quality
    string, and capability flags. It must never include API keys, base URLs, or
    account identifiers and is the only provider information written to manifests.
    """
    return dict(provider.describe())


class OpenAIImageProvider:
    def __init__(self, client=None, model: str = "gpt-image-2", quality: str = "high"):
        if quality not in ALLOWED_QUALITIES:
            raise ValueError(f"quality must be one of {ALLOWED_QUALITIES}, got {quality!r}")
        if client is None:
            from openai import OpenAI
            api_key = os.environ.get("OPENAI_API_KEY", "").strip()
            if not api_key:
                raise ValueError("OPENAI_API_KEY must be explicitly configured")
            client = OpenAI(api_key=api_key, base_url=os.environ.get("OPENAI_BASE_URL") or None)
        self.client, self.model, self.quality = client, model, quality

    @staticmethod
    def _save(response, output: str | Path) -> Path:
        if not response.data or not response.data[0].b64_json:
            raise RuntimeError("provider returned no b64_json")
        path = Path(output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(response.data[0].b64_json, validate=True))
        return path

    def generate(self, prompt: str, output: str | Path, references: tuple[Path, ...] = ()) -> Path:
        if references:
            raise ValueError("reference generation must use a provider adapter that explicitly supports ordered references")
        quality = cast("QualityValue", self.quality)
        return self._save(self.client.images.generate(model=self.model, prompt=prompt, size="1536x864", quality=quality), output)

    def edit(self, prompt: str, image: Path, mask: Path, output: str | Path) -> Path:
        quality = cast("QualityValue", self.quality)
        with image.open("rb") as image_file, mask.open("rb") as mask_file:
            response = self.client.images.edit(model=self.model, image=image_file, mask=mask_file, prompt=prompt, size="1536x864", quality=quality)
        return self._save(response, output)

    def capabilities(self) -> dict[str, bool]:
        # The OpenAI images.generate / images.edit boundary supports ordinary
        # generation and masked edits, but does not accept an ordered sequence
        # of reference images. An adapter that explicitly supports ordered
        # references overrides this method to report True.
        return {
            CAPABILITY_ORDINARY_GENERATION: True,
            CAPABILITY_MASKED_EDIT: True,
            CAPABILITY_ORDERED_REFERENCES: False,
        }

    def describe(self) -> dict[str, object]:
        # Credential-free, manifest-safe description. Credentials and base URLs
        # are intentionally never included here.
        return {
            "name": "openai",
            "model": self.model,
            "quality": self.quality,
            "capabilities": self.capabilities(),
        }
